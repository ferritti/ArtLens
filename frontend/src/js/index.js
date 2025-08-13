import { appEl, videoEl, canvasEl, hudEl, startBtn, statusEl, infoEl, detailEl, detailTitleEl, detailMetaEl, detailBodyEl, backBtn } from './dom.js';
import { status as setStatus, showInfo, hideHint, clearHotspots, clientPointToVideo, pointInBox } from './ui.js';
import { initDetector, detector, closeDetector } from './detection.js';
import { initEmbeddingModel } from './embedding.js';
import { loadArtworkDB } from './db.js';
import { drawDetections, getLastMatches, resetRenderState } from './render.js';

let stream = null;
let running = false;
let lastVideoTime = -1;

function status(msg) {
  setStatus(statusEl, msg);
}

function openDetail(entry, confidence) {
  try { infoEl.style.display = 'none'; } catch {}
  hideHint();
  clearHotspots();
  if (detailTitleEl) detailTitleEl.textContent = entry?.title || 'Opera';
  let meta = '';
  if (entry?.artist) meta += entry.artist;
  if (entry?.year) meta += (meta ? ' · ' : '') + entry.year;
  if (entry?.museum || entry?.location) meta += (meta ? ' · ' : '') + (entry.museum || entry.location);
  if (detailMetaEl) detailMetaEl.textContent = meta;
  if (detailBodyEl) detailBodyEl.textContent = entry?.description || '';
  if (detailEl) detailEl.classList.remove('hidden');
  running = false;
  try { const ctx = canvasEl.getContext('2d'); ctx.clearRect(0, 0, canvasEl.width, canvasEl.height); } catch {}
}

function closeDetail() {
  if (detailEl) detailEl.classList.add('hidden');
  try { hideHint(); } catch {}
  try { showInfo(null); } catch {}
  try { clearHotspots(); } catch {}
  resetRenderState();
  if (!running) { running = true; startLoop(); }
}

backBtn?.addEventListener('click', (e) => {
  e.preventDefault();
  if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
  if (typeof e.stopPropagation === 'function') e.stopPropagation();
  closeDetail();
});

appEl.addEventListener('click', (ev) => {
  if (!running) return;
  const matches = getLastMatches();
  if (!matches || !matches.length) return;
  const pt = clientPointToVideo(ev.clientX, ev.clientY);
  let best = null;
  for (const m of matches) {
    if (pointInBox(pt.x, pt.y, m.box, 8)) {
      if (!best || m.confidence > best.confidence) best = m;
    }
  }
  if (best) openDetail(best.entry, best.confidence);
});

startBtn.addEventListener('click', async () => {
  startBtn.disabled = true;
  try {
    status('Starting camera…');
    await startCamera();
    hudEl.classList.add('hidden');
    running = true;
    startLoop();

    try {
      status('Initializing object detector…');
      await initDetector();
      status('Loading embedding model…');
      await initEmbeddingModel();
      status('Loading artwork database…');
      await loadArtworkDB();
      status('Ready');
    } catch (modelErr) {
      console.warn('Model init error (continuing with camera only):', modelErr);
      status('Camera running. Model init failed: ' + (modelErr?.message || modelErr));
    }
  } catch (err) {
    console.error(err);
    startBtn.disabled = false;
    status('Error: ' + (err?.message || err));
  }
});

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Camera API non disponibile. Usa un browser moderno su HTTPS o localhost.');
  }
  if (!window.isSecureContext && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
    throw new Error('La videocamera richiede HTTPS (oppure localhost). Apri la pagina con https:// o avvia un server locale.');
  }

  try { videoEl.setAttribute('playsinline', ''); } catch {}
  try { videoEl.setAttribute('webkit-playsinline', ''); } catch {}
  try { videoEl.setAttribute('muted', ''); } catch {}
  videoEl.playsInline = true;
  videoEl.muted = true;
  videoEl.autoplay = true;

  const constraintAttempts = [
    { video: { facingMode: { exact: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false },
    { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
    { video: { facingMode: 'environment' }, audio: false },
    { video: true, audio: false }
  ];

  let lastError = null;
  for (const constraints of constraintAttempts) {
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      break;
    } catch (e) {
      lastError = e;
    }
  }
  if (!stream) {
    const msg = lastError?.name === 'NotAllowedError'
      ? 'Accesso alla camera negato. Vai nelle impostazioni del browser e consenti l\'uso della fotocamera per questo sito.'
      : `Impossibile avviare la camera: ${lastError?.message || lastError || 'sconosciuto'}`;
    throw new Error(msg);
  }

  try { videoEl.srcObject = null; } catch {}
  videoEl.srcObject = stream;

  let played = false;
  try {
    await videoEl.play();
    played = true;
  } catch (e) {}
  if (!played) {
    await new Promise((res) => {
      const onMeta = async () => {
        videoEl.removeEventListener('loadedmetadata', onMeta);
        try { await videoEl.play(); } catch {}
        res();
      };
      if (videoEl.readyState >= 2 && videoEl.videoWidth > 0) return onMeta();
      videoEl.addEventListener('loadedmetadata', onMeta);
    });
  }

  resizeCanvasToVideo();
  window.addEventListener('resize', resizeCanvasToVideo);
  window.addEventListener('orientationchange', resizeCanvasToVideo);
}

function resizeCanvasToVideo() {
  const vw = videoEl.videoWidth || 1280;
  const vh = videoEl.videoHeight || 720;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvasEl.width = Math.max(1, Math.floor(vw * dpr));
  canvasEl.height = Math.max(1, Math.floor(vh * dpr));
  const ctx = canvasEl.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
}

function startLoop() {
  const ctx = canvasEl.getContext('2d');
  const loop = async () => {
    if (!running) return;
    const now = performance.now();
    const t = videoEl.currentTime;
    if (detector && videoEl.readyState >= 2 && (t !== lastVideoTime)) {
      lastVideoTime = t;
      const result = detector.detectForVideo(videoEl, now);
      await drawDetections(ctx, result, (entry, confidence) => openDetail(entry, confidence));
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

window.addEventListener('pagehide', stopAll, { once: true });
window.addEventListener('beforeunload', stopAll, { once: true });

function stopAll() {
  running = false;
  try { closeDetector(); } catch {}
  if (stream) {
    for (const track of stream.getTracks?.() || []) track.stop();
    stream = null;
  }
}

// Tip: For local development, serve over HTTPS (or localhost) for camera permissions.