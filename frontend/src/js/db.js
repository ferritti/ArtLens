import { BACKEND_URL } from './constants.js';
import { ensureRuntimeDim, getRuntimeDim } from './embedding.js';

export let artworkDB = [];
export let dbDim = null;

// Language state
let _lang = null;
export function getLang() {
  if (_lang) return _lang;
  try {
    const stored = localStorage.getItem('lang');
    if (stored) _lang = stored;
  } catch {}
  if (!_lang && typeof navigator !== 'undefined') {
    const nav = (navigator.language || 'it').slice(0,2).toLowerCase();
    _lang = (nav === 'en') ? 'en' : 'it';
  }
  if (!_lang) _lang = 'it';
  return _lang;
}
export function setLang(l) {
  const v = (l || '').slice(0,2).toLowerCase();
  _lang = (v === 'en') ? 'en' : 'it';
  try { localStorage.setItem('lang', _lang); } catch {}
  return _lang;
}

export function pickLangText(descriptions, preferred) {
  if (!descriptions || typeof descriptions !== 'object') return null;
  const lang = (preferred || getLang() || 'it').slice(0,2).toLowerCase();
  return descriptions[lang] || descriptions.it || descriptions.en || Object.values(descriptions)[0] || null;
}

function normalizeEmbedding(vec) {
  if (!Array.isArray(vec)) return null;
  const norm = Math.hypot(...vec);
  if (norm <= 0) return null;
  return vec.map(v => v / norm);
}

function toMapFromDescriptors(data) {
  // Accept either a map { id: embedding[] } or an array of { id, embedding }
  if (!data) return {};
  if (Array.isArray(data)) {
    const m = {};
    for (const it of data) {
      const id = it?.id ?? it?.ID ?? it?.Id ?? it?.name ?? null;
      if (!id) continue;
      if (Array.isArray(it.embedding)) m[String(id)] = it.embedding;
    }
    return m;
  }
  if (typeof data === 'object') return data;
  return {};
}

function toArrayFromCatalog(data) {
  // Accept an array of items, { items: [...] }, or a map { id: {...} }
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (typeof data === 'object') {
    return Object.entries(data).map(([id, v]) => ({ id, ...v }));
  }
  return [];
}

async function loadOptionB_v2() {
  const [catRes, descRes] = await Promise.all([
    fetch(`${BACKEND_URL}/catalog`, { cache: 'no-store' }),
    fetch(`${BACKEND_URL}/descriptors_v2`, { cache: 'no-store' })
  ]);
  if (!catRes.ok || !descRes.ok) {
    throw new Error(`/catalog or /descriptors_v2 not available (${catRes.status}, ${descRes.status})`);
  }
  const catalog = await catRes.json(); // array of artworks
  const descMap = await descRes.json(); // { artwork_id: [ [..emb1..], [..emb2..] ] }

  const flattened = [];
  for (const art of Array.isArray(catalog) ? catalog : []) {
    const artId = art?.id != null ? String(art.id) : (art?.title != null ? String(art.title) : null);
    if (!artId) continue;
    const embs = Array.isArray(descMap?.[artId]) ? descMap[artId] : [];
    for (let i = 0; i < embs.length; i++) {
      const emb = embs[i];
      const norm = normalizeEmbedding(emb);
      if (!norm) continue;
      flattened.push({
        id: `${artId}#${i}`,
        parentId: artId,
        title: art.title,
        artist: art.artist,
        year: art.year,
        museum: art.museum,
        location: art.location,
        descriptions: art.descriptions,
        image_path: art?.visual_descriptors?.[i]?.image_path,
        embedding: norm,
      });
    }
  }
  return flattened;
}

async function loadOptionB() {
  const [catRes, descRes] = await Promise.all([
    fetch(`${BACKEND_URL}/catalog`, { cache: 'no-store' }),
    fetch(`${BACKEND_URL}/descriptors`, { cache: 'no-store' })
  ]);
  if (!catRes.ok || !descRes.ok) {
    throw new Error(`/catalog or /descriptors not available (${catRes.status}, ${descRes.status})`);
  }
  const catalogRaw = await catRes.json();
  const descriptorsRaw = await descRes.json();
  const catalog = toArrayFromCatalog(catalogRaw);
  const descMap = toMapFromDescriptors(descriptorsRaw);

  const merged = [];
  for (const item of catalog) {
    const id = item?.id != null ? String(item.id) : (item?.title != null ? String(item.title) : null);
    if (!id) {
      // skip entries without stable id
      continue;
    }
    const emb = descMap[id];
    const normEmb = normalizeEmbedding(emb);
    const entry = { ...item };
    if (normEmb) entry.embedding = normEmb;
    merged.push(entry);
  }
  return merged;
}


export async function loadArtworkDB() {
  // Prefer v2 endpoints
  try {
    artworkDB = await loadOptionB_v2();
  } catch (eV2) {
    console.warn('V2 endpoints not available. Trying legacy /descriptors. Reason:', eV2?.message || eV2);
    try {
      artworkDB = await loadOptionB();
    } catch (e) {
      console.warn('Both /descriptors_v2 and /descriptors failed:', e?.message || e);
      artworkDB = [];
    }
  }

  // Determine dbDim and ensure normalization
  dbDim = null;
  let normalized = 0;
  for (const e of artworkDB) {
    if (!Array.isArray(e.embedding)) continue;
    const normVec = normalizeEmbedding(e.embedding);
    if (normVec) {
      // if already normalized, this is idempotent
      if (normVec !== e.embedding) normalized++;
      e.embedding = normVec;
      dbDim = dbDim ?? e.embedding.length;
    }
  }

  if (dbDim != null) {
    try {
      ensureRuntimeDim();
      const runtimeDim = getRuntimeDim();
      if (runtimeDim != null && runtimeDim !== dbDim) {
        console.warn(`Embedding dimension mismatch: DB=${dbDim}, runtime=${runtimeDim}. Rigenera gli embedding del DB con lo stesso MobileNet e preprocessing.`);
      }
    } catch (e) {
      console.warn('Ensure embedding dim match failed:', e);
    }
  }

  console.log('Artwork DB entries:', artworkDB.length, 'dim:', dbDim, 'normalized:', normalized);
  if (!artworkDB.length) {
    console.warn('Nessun dato nel catalogo/descrittori. Verifica le API del backend e il popolamento del DB.');
  }
}
