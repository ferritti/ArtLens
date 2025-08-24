import { appEl, videoEl, canvasEl, hudEl, startBtn, statusEl, infoEl, detailEl, detailTitleEl, detailMetaEl, detailBodyEl, backBtn } from './dom.js';
import { status as setStatus, showInfo, hideHint, clearHotspots, clientPointToVideo, pointInBox } from './ui.js';
import { initDetector, detector, closeDetector } from './detection.js';
import { initEmbeddingModel } from './embedding.js';
import { loadArtworkDB, pickLangText, getLang, setLang } from './db.js';
import { drawDetections, getLastMatches, resetRenderState } from './render.js';

// Language toggle setup
function initLanguageToggle() {
  const current = getLang();
  const btnIt = document.querySelector('.lang-toggle button[data-lang="it"]');
  const btnEn = document.querySelector('.lang-toggle button[data-lang="en"]');
  const all = [btnIt, btnEn].filter(Boolean);
  function updateActive() {
    const lang = getLang();
    all.forEach(b => {
      if (!b) return;
      const isActive = b.dataset.lang === lang;
      b.classList.toggle('active', isActive);
      b.setAttribute('aria-selected', String(isActive));
    });
  }
  all.forEach(b => b && b.addEventListener('click', () => {
    const chosen = b.dataset.lang;
    setLang(chosen);
    updateActive();
    applyLanguageToUI();
  }));
  updateActive();
}

function applyLanguageToUI() {
  const lang = getLang();
  const dict = {
    it: {
      // Scanner UI strings
      title: "Scopri l'arte intorno a te",
      status: "Inquadra le opere con la fotocamera",
      start: "Avvia",
      back: "Back",
      // Homepage strings
      home: {
        subtitle: "Scopri l'arte attraverso la tecnologia",
        scan: "Scansiona Opera",
        curator: "Accesso Curatore",
        foot: "Basato su un sistema di riconoscimento AI",
      }
    },
    en: {
      title: "Discover art around you",
      status: "Point the camera at artworks",
      start: "Start",
      back: "Back",
      home: {
        subtitle: "Discover art through technology",
        scan: "Scan Artwork",
        curator: "Curator Login",
        foot: "Powered by AI recognition system",
      }
    }
  };
  const t = dict[lang] || {};

  // Set <html lang=".."> for accessibility/SEO
  try { document.documentElement.setAttribute('lang', (lang === 'en' ? 'en' : 'it')); } catch {}

  // Scanner UI (if present)
  const titleEl = document.querySelector('.card-title');
  if (titleEl && t.title) titleEl.textContent = t.title;
  if (statusEl && t.status) statusEl.textContent = t.status;
  if (startBtn && t.start) startBtn.textContent = t.start;
  if (backBtn && t.back) backBtn.textContent = t.back;

  // Homepage UI (gate on presence of #scanBtn)
  const scanBtnEl = document.getElementById('scanBtn');
  if (scanBtnEl && t.home) {
    const subtitleEl = document.querySelector('.card > p.subtitle');
    const curatorBtnEl = document.getElementById('curatorBtn');
    const scanLabelEl = scanBtnEl.querySelector('span:last-child');
    const curatorLabelEl = curatorBtnEl ? curatorBtnEl.querySelector('span:last-child') : null;
    const footEl = document.querySelector('.card .foot');
    if (subtitleEl && t.home.subtitle) subtitleEl.textContent = t.home.subtitle;
    if (scanLabelEl && t.home.scan) scanLabelEl.textContent = t.home.scan;
    if (curatorLabelEl && t.home.curator) curatorLabelEl.textContent = t.home.curator;
    if (footEl && t.home.foot) footEl.textContent = t.home.foot;
  }
}

// Bottom sheet gestures (swipe-to-close)
function initBottomSheetGestures() {
  const sheet = document.querySelector('.detail-card');
  if (!sheet) return;
  let dragging = false;
  let startY = 0;
  let lastY = 0;
  let hasMoved = false;

  const onPointerDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // Only start drag if at top of scroll
    if (sheet.scrollTop > 0) return;
    dragging = true;
    hasMoved = false;
    startY = (e.touches ? e.touches[0].clientY : e.clientY) || 0;
    lastY = startY;
    sheet.style.transition = 'none';
    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp, { passive: true, once: true });
    window.addEventListener('pointercancel', onPointerUp, { passive: true, once: true });
  };

  const onPointerMove = (e) => {
    if (!dragging) return;
    const y = (e.touches ? e.touches[0].clientY : e.clientY) || 0;
    const dy = Math.max(0, y - startY);
    if (dy > 2) hasMoved = true;
    // Prevent page scroll while dragging sheet
    try { e.preventDefault(); } catch {}
    sheet.style.transform = `translateY(${dy}px)`;
  };

  const onPointerUp = (e) => {
    window.removeEventListener('pointermove', onPointerMove, { passive: false });
    dragging = false;
    const endY = (e.changedTouches ? e.changedTouches[0].clientY : e.clientY) || lastY;
    const dy = Math.max(0, endY - startY);
    sheet.style.transition = '';
    if (dy > 120) {
      // Close
      sheet.style.transform = `translateY(100vh)`;
      setTimeout(() => { try { sheet.style.transform = ''; } catch {}; try { closeDetail(); } catch {}; }, 180);
    } else {
      // Snap back
      sheet.style.transform = 'translateY(0)';
    }
  };

  // Use pointer events when available
  sheet.addEventListener('pointerdown', onPointerDown, { passive: true });
}

// Initialize language on module load
initLanguageToggle();
applyLanguageToUI();
initBottomSheetGestures();

let stream = null;
let running = false;
let lastVideoTime = -1;
let lastInferTime = 0;
const INFER_INTERVAL_MS = 90; // ~11 Hz throttling to reduce load and artifacts

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
  const desc = entry?.descriptions ? pickLangText(entry.descriptions) : (entry?.description || '');
  if (detailBodyEl) detailBodyEl.textContent = desc;
  if (detailEl) {
    detailEl.classList.remove('hidden', 'closing');
    // Force reflow to ensure animation restarts
    void detailEl.offsetWidth;
    detailEl.classList.add('open');
  }
  // Ensure the sheet starts from top and is fully visible when content fits
  try {
    const sheet = document.querySelector('.detail-card');
    if (sheet) { sheet.scrollTop = 0; sheet.style.transform = ''; }
  } catch {}
  running = false;
  try { const ctx = canvasEl.getContext('2d'); ctx.clearRect(0, 0, canvasEl.width, canvasEl.height); } catch {}
}

function closeDetail() {
  if (detailEl) {
    // play graceful closing animation
    detailEl.classList.remove('open');
    detailEl.classList.add('closing');
    const end = () => {
      detailEl.classList.add('hidden');
      detailEl.classList.remove('closing');
      try { detailEl.removeEventListener('animationend', end); } catch {}
    };
    try { detailEl.addEventListener('animationend', end, { once: true }); } catch {}
    // Fallback in case animationend doesn't fire
    setTimeout(() => { try { end(); } catch {} }, 260);
  }
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

appEl?.addEventListener('click', (ev) => {
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

async function runStartup() {
  if (running || stream) return;
  if (startBtn) startBtn.disabled = true;
  try {
    status('Starting camera…');
    await startCamera();
    if (hudEl) hudEl.classList.add('hidden');
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
    if (startBtn) startBtn.disabled = false;
    status('Error: ' + (err?.message || err));
  }
}

if (startBtn) {
  startBtn.addEventListener('click', (e) => { try { e.preventDefault(); e.stopPropagation(); } catch {}; runStartup(); });
}

// Auto-start the camera only when scanner elements are present
(function(){
  if (!videoEl) return; // Not on scanner page
  function kick(){ try{ runStartup(); } catch(e){} }
  if (document.readyState==='complete' || document.readyState==='interactive') setTimeout(kick, 200);
  else document.addEventListener('DOMContentLoaded', function(){ setTimeout(kick, 200); }, { once: true });
})();

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
    if (detector && videoEl.readyState >= 2 && (t !== lastVideoTime) && (now - lastInferTime >= INFER_INTERVAL_MS)) {
      lastVideoTime = t;
      lastInferTime = now;
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

// Homepage overlay and navigation setup (runs only if elements exist)
(function(){
  const scanBtn = document.getElementById('scanBtn');
  const overlay = document.getElementById('scannerOverlay');
  const frame = document.getElementById('scannerFrame');
  const closeBtn = document.getElementById('closeScanner');
  const curatorBtn = document.getElementById('curatorBtn');

  if (curatorBtn) {
    curatorBtn.addEventListener('click', () => { location.href = './curator_access.html'; });
  }

  if (!scanBtn || !overlay || !frame || !closeBtn) return; // Not on homepage

  function openScanner(){
    if (!window.isSecureContext && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
      alert('La fotocamera richiede HTTPS (oppure localhost). Apri la pagina con https://');
      return;
    }
    try { frame.src = 'about:blank'; } catch {}
    frame.src = 'scanner.html';
    overlay.classList.add('on');
    overlay.setAttribute('aria-hidden', 'false');
  }

  function closeScanner(){
    overlay.classList.remove('on');
    overlay.setAttribute('aria-hidden', 'true');
    try { frame.src = 'about:blank'; } catch {}
  }

  scanBtn.addEventListener('click', openScanner);
  closeBtn.addEventListener('click', closeScanner);
  window.addEventListener('pagehide', closeScanner, { once: true });
  window.addEventListener('beforeunload', closeScanner, { once: true });

  // Listen for close requests from the scanner iframe (Back button)
  window.addEventListener('message', (e)=>{
    const data = e?.data;
    if (data && (data.type === 'close-scanner')) {
      closeScanner();
    }
  });
})();
