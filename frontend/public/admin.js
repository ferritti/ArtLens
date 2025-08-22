import { initEmbeddingModel, embedFromCanvas } from '../src/js/embedding.js';
import { BACKEND_URL, CROP_SIZE } from '../src/js/constants.js';

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
  try {
    const id = (fd.get('id') || '').trim();
    if (!id) return alert('Specifica un ID');

    const filesInput = /** @type {HTMLInputElement} */ (document.querySelector('input[name="images"]'));
    const files = filesInput?.files;
    if (!files || !files.length) return alert('Seleziona almeno un’immagine');

    // Init and compute embeddings locally
    await initEmbeddingModel();
    const visual_descriptors = [];

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const can = await imageToCanvas224(f);
      const embedding = embedFromCanvas(can); // already L2-normalized
      visual_descriptors.push({ id: descriptorIdFor(f, i), embedding });
    }

    const payload = {
      id,
      title: (fd.get('title') || '').trim() || null,
      artist: (fd.get('artist') || '').trim() || null,
      year: (fd.get('year') || '').trim() || null,
      museum: (fd.get('museum') || '').trim() || null,
      location: (fd.get('location') || '').trim() || null,
      descriptions: buildDescriptions(fd),
      visual_descriptors,
    };

    const defaultToken = (typeof localStorage !== 'undefined' ? localStorage.getItem('X_ADMIN_TOKEN') : '') || '';
    let token = defaultToken || '';
    if (!token) token = prompt('Inserisci X-Admin-Token') || '';
    if (!token) return alert('Token mancante. Operazione annullata.');
    try { if (localStorage) localStorage.setItem('X_ADMIN_TOKEN', token); } catch {}

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
    alert(`Opera salvata con successo! (${visual_descriptors.length} immagini/embedding)`);
    form.reset();
  } catch (err) {
    console.error('Admin save error:', err);
    alert(`Errore durante il salvataggio: ${err?.message || err}`);
  }
}

const formEl = document.getElementById('f');
if (formEl) formEl.addEventListener('submit', onSubmit);
