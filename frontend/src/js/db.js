import { BACKEND_URL } from './constants.js';
import { ensureRuntimeDim, getRuntimeDim } from './embedding.js';

export let artworkDB = [];
export let dbDim = null;

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

async function loadFallbackItems() {
  const res = await fetch(`${BACKEND_URL}/items`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to load database: ${res.status}`);
  const data = await res.json();
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (data && typeof data === 'object') return Object.entries(data).map(([id, v]) => ({ id, ...v }));
  return [];
}

export async function loadArtworkDB() {
  try {
    // Try Option B first
    artworkDB = await loadOptionB();
  } catch (e) {
    console.warn('Option B endpoints not available or failed. Falling back to /items. Reason:', e?.message || e);
    try {
      artworkDB = await loadFallbackItems();
    } catch (e2) {
      console.warn('Fallback /items load failed:', e2);
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
    console.warn('Artwork DB è vuoto dopo il parsing. Controlla il formato JSON.');
  }
}
