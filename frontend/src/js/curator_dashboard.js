import { initEmbeddingModel, embedFromCanvas } from './embedding.js';
import { BACKEND_URL, CROP_SIZE } from './constants.js';

const submitBtn = document.getElementById('submitBtn');
const statusEl = document.getElementById('statusMsg');
function setStatus(msg) {
  if (statusEl) statusEl.textContent = msg || '';
}
function setLoading(loading) {
  if (submitBtn) submitBtn.disabled = !!loading;
}

async function imageToCanvas224(file) {
  const can = document.createElement('canvas');
  can.width = can.height = CROP_SIZE;
  const ctx = can.getContext('2d', { willReadFrequently: true });
  const img = new Image();
  img.src = URL.createObjectURL(file);
  await img.decode();
  // Center-crop square then scale to 224
  const s = Math.min(img.width, img.height);
  const sx = Math.max(0, Math.floor((img.width - s) / 2));
  const sy = Math.max(0, Math.floor((img.height - s) / 2));
  ctx.clearRect(0, 0, CROP_SIZE, CROP_SIZE);
  ctx.drawImage(img, sx, sy, s, s, 0, 0, CROP_SIZE, CROP_SIZE);
  URL.revokeObjectURL(img.src);
  return can;
}

function buildDescriptions(fd) {
  const it = (fd.get('desc_it') || '').trim();
  const en = (fd.get('desc_en') || '').trim();
  const out = {};
  if (it) out.it = it;
  if (en) out.en = en;
  return Object.keys(out).length ? out : undefined;
}

function descriptorIdFor(file, index) {
  const base = (file.name || `img_${index+1}`)
    .replace(/\.[a-z0-9]+$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-') || `img-${index+1}`;
  return base;
}

async function onSubmit(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const fd = new FormData(form);
  setLoading(true);
  setStatus('Preparazione modello…');
  try {
    const filesInput = /** @type {HTMLInputElement} */ (document.querySelector('input[name="images"]'));
    const files = filesInput?.files;
    if (!files || !files.length) { alert('Seleziona almeno un’immagine'); return; }

    // Init model
    await initEmbeddingModel();

    // Compute embeddings locally
    const visual_descriptors = [];
    for (let i = 0; i < files.length; i++) {
      setStatus(`Calcolo embedding ${i+1}/${files.length}…`);
      const f = files[i];
      const can = await imageToCanvas224(f);
      const embedding = embedFromCanvas(can); // already L2-normalized
      visual_descriptors.push({ id: descriptorIdFor(f, i), embedding });
    }

    const payload = {
      title: (fd.get('title') || '').trim() || null,
      artist: (fd.get('artist') || '').trim() || null,
      year: (fd.get('year') || '').trim() || null,
      museum: (fd.get('museum') || '').trim() || null,
      location: (fd.get('location') || '').trim() || null,
      descriptions: buildDescriptions(fd),
      visual_descriptors,
    };

    // Token admin
    const defaultToken = (typeof localStorage !== 'undefined' ? localStorage.getItem('X_ADMIN_TOKEN') : '') || '';
    let token = defaultToken || '';
    if (!token) token = prompt('Inserisci X-Admin-Token') || '';
    if (!token) { alert('Token mancante. Operazione annullata.'); return; }
    try { if (localStorage) localStorage.setItem('X_ADMIN_TOKEN', token); } catch {}

    setStatus('Salvataggio in corso…');
    const res = await fetch(`${BACKEND_URL}/artworks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Token': token
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const t = await res.text();
      throw new Error(`${res.status} ${t}`);
    }
    const json = await res.json().catch(() => ({}));
    setStatus('Operazione completata.');
    alert(`Opera salvata!\nID: ${json.id || '(generato)'}\nDescrittori: ${visual_descriptors.length}`);
    form.reset();
  } catch (err) {
    console.error('Admin save error:', err);
    setStatus('Errore durante il salvataggio.');
    alert(`Errore durante il salvataggio: ${err?.message || err}`);
  } finally {
    setLoading(false);
    setTimeout(() => setStatus(''), 1200);
  }
}

const formEl = document.getElementById('f');
if (formEl) formEl.addEventListener('submit', onSubmit);

// Dashboard auth guard and UI helpers (migrated from curator_dashboard.html inline scripts)
(function(){
  // Detect curator dashboard by presence of main container or form
  const isDashboard = document.querySelector('.cdash') || document.getElementById('f');
  if (!isDashboard) return;

  // Auth guard and optional logout handling
  try {
    const AUTH_KEY = 'artlens.auth';
    const qs = new URLSearchParams(location.search);
    if (qs.has('logout')) { try { localStorage.removeItem(AUTH_KEY); } catch(_) {} }
    const authed = !!localStorage.getItem(AUTH_KEY);
    if (!authed) { location.replace('./curator_access.html'); return; }
  } catch (e) {
    try { location.replace('./curator_access.html'); } catch(_) {}
    return;
  }

  // Dropzone behavior for image uploads
  const drop = document.getElementById('drop');
  const input = document.getElementById('images');
  function openPicker(){ try { input?.click(); } catch(_) {} }
  function stop(e){ try { e.preventDefault(); e.stopPropagation(); } catch(_) {} }
  if (drop && input) {
    drop.addEventListener('click', openPicker);
    drop.addEventListener('keydown', (e)=>{ if (e.key==='Enter' || e.key===' ') { stop(e); openPicker(); }});
    ['dragenter','dragover'].forEach(ev=> drop.addEventListener(ev, (e)=>{ stop(e); drop.classList.add('drag'); }));
    ['dragleave','drop'].forEach(ev=> drop.addEventListener(ev, (e)=>{ stop(e); drop.classList.remove('drag'); }));
    drop.addEventListener('drop', (e)=>{ const files = e.dataTransfer?.files; if (files?.length) { try { input.files = files; } catch(_) {} input.dispatchEvent(new Event('change',{bubbles:true})); }});
  }
  const out = document.getElementById('statusMsg');
  const previews = document.getElementById('previews');
  let previewURLs = [];
  function clearPreviews(){
    try { previewURLs.forEach(url => URL.revokeObjectURL(url)); } catch(_) {}
    previewURLs = [];
    if (previews) previews.innerHTML = '';
  }
  function renderPreviews(fileList){
    if (!previews) return;
    clearPreviews();
    const files = Array.from(fileList || []);
    const frag = document.createDocumentFragment();
    files.forEach((f)=>{
      if (!f || !f.type?.startsWith('image/')) return;
      const url = URL.createObjectURL(f);
      previewURLs.push(url);
      const fig = document.createElement('figure');
      fig.className = 'preview';
      const img = document.createElement('img');
      img.src = url; img.alt = 'Anteprima immagine';
      fig.appendChild(img);
      frag.appendChild(fig);
    });
    previews.appendChild(frag);
  }
  if (input) input.addEventListener('change', ()=>{
    const n = input.files?.length || 0;
    if (out) { out.textContent = n ? `${n} file selected` : ''; }
    if (n) renderPreviews(input.files);
    else clearPreviews();
  });

  // Clear previews on form reset
  const form = document.getElementById('f');
  if (form) form.addEventListener('reset', ()=>{ clearPreviews(); if (out) out.textContent=''; });

  // Sign out
  const signOut = document.getElementById('signOutBtn');
  if (signOut) signOut.addEventListener('click', ()=>{ try { localStorage.removeItem('artlens.auth'); } catch(_) {} location.href = './curator_access.html'; });
})();
