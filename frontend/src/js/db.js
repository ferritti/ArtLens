import { BACKEND_URL } from './constants.js';
import { ensureRuntimeDim, getRuntimeDim } from './embedding.js';

export let artworkDB = [];
export let dbDim = null;

export async function loadArtworkDB() {
  try {
    const res = await fetch(`${BACKEND_URL}/items`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Failed to load database: ${res.status}`);
    const data = await res.json();

    if (Array.isArray(data)) {
      artworkDB = data;
    } else if (Array.isArray(data?.items)) {
      artworkDB = data.items;
    } else if (data && typeof data === 'object') {
      artworkDB = Object.entries(data).map(([id, v]) => ({ id, ...v }));
    } else {
      artworkDB = [];
    }

    dbDim = null;
    let normalized = 0;
    for (const e of artworkDB) {
      if (!Array.isArray(e.embedding)) continue;
      const norm = Math.hypot(...e.embedding);
      if (norm > 0) {
        e.embedding = e.embedding.map(v => v / norm);
        normalized++;
      }
      dbDim = dbDim ?? e.embedding.length;
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
  } catch (e) {
    console.warn('Artwork DB load failed, proceeding with empty DB.', e);
    artworkDB = [];
    dbDim = null;
  }
}
