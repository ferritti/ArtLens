import { videoEl, canvasEl } from './dom.js';
import { clearHotspots, renderHotspot, placeHintOverBox, showHintFor, hideHint, showInfo, showAimGuide, hideAimGuide } from './ui.js';
import { cropToCanvasFromVideo, embedFromCanvas, cosineSim, hasEmbedModel } from './embedding.js';
import { artworkDB, dbDim, pickLangText } from './db.js';
import { COSINE_THRESHOLD, DEBUG_FALLBACK_CROP, MAX_BOXES_PER_FRAME, MIN_BOX_SCORE } from './constants.js';

let lastMatches = [];
let lastRecognizedKey = null;
let categoryLogCount = 0;

function findBestMatch(embedding) {
  if (!artworkDB.length) return null;
  let best = { idx: -1, sim: -1 };
  for (let i = 0; i < artworkDB.length; i++) {
    const e = artworkDB[i];
    if (!Array.isArray(e.embedding)) continue;
    if (dbDim != null && e.embedding.length !== embedding.length) continue;
    const sim = cosineSim(embedding, e.embedding);
    if (sim > best.sim) best = { idx: i, sim };
  }
  if (best.idx < 0) return null;
  const entry = artworkDB[best.idx];
  return { entry, confidence: best.sim };
}

export async function drawDetections(ctx, result, onHotspotClick) {
  const w = videoEl.videoWidth;
  const h = videoEl.videoHeight;

  // Clear full canvas (device-pixel aware)
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
  ctx.restore();

  const lw = 2;
  ctx.lineWidth = lw;
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--box-color') || '#2ee6a7';
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--box-fill') || 'rgba(46,230,167,0.15)';
  ctx.font = '14px Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';
  lastMatches = [];

  if (!result?.detections?.length) {
    lastMatches = [];
    let fallbackMatched = false;
    if (DEBUG_FALLBACK_CROP && hasEmbedModel()) {
      try {
        const box = { originX: w * 0.25, originY: h * 0.25, width: w * 0.5, height: h * 0.5 };
        const crop = cropToCanvasFromVideo(box);
        const emb = embedFromCanvas(crop);
        const matched = findBestMatch(emb);
        if (matched && matched.confidence >= COSINE_THRESHOLD) {
          const { entry, confidence } = matched;
          lastMatches.push({ entry, confidence, box });
          fallbackMatched = true;

          ctx.beginPath();
          ctx.rect(box.originX, box.originY, box.width, box.height);
          ctx.fill();
          ctx.stroke();

          const uiLabel = `${entry.title || 'Artwork'} ${(confidence*100).toFixed(1)}%`;
          const textPaddingX = 6;
          const textPaddingY = 4;
          const metrics = ctx.measureText(uiLabel);
          const textW = metrics.width + textPaddingX * 2;
          const textH = 18 + textPaddingY * 2;
          ctx.save();
          ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--label-bg') || 'rgba(0,0,0,0.6)';
          ctx.strokeStyle = 'transparent';
          ctx.beginPath();
          ctx.rect(box.originX, Math.max(0, box.originY - textH), textW, textH);
          ctx.fill();
          ctx.restore();

          ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--label-fg') || '#fff';
          ctx.fillText(uiLabel, box.originX + textPaddingX, Math.max(12 + textPaddingY, box.originY - textH + 12 + textPaddingY));

          const key = (entry && (entry.id != null ? String(entry.id) : (entry.title || '')));
          if (key && key !== lastRecognizedKey) {
            lastRecognizedKey = key;
            showHintFor(entry, box);
          }
          renderHotspot({ entry, confidence, box }, onHotspotClick);
          hideAimGuide();
        }
      } catch (e) { console.warn('Fallback match failed:', e); }
    }
    if (!fallbackMatched) {
      lastRecognizedKey = null;
      hideHint();
      showInfo(null);
      clearHotspots();
      showAimGuide();
    }
    return;
  }

  let anyMatch = false;

  // Filter detections by score and limit to top-N
  const filtered = (result.detections || [])
    .map(d => ({ det: d, score: d.categories?.[0]?.score ?? 0 }))
    .filter(x => x.score >= MIN_BOX_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_BOXES_PER_FRAME);

  // Batch draw rectangles (one fill + one stroke) with pixel-aligned coords
  if (filtered.length) {
    ctx.beginPath();
    for (const { det } of filtered) {
      const box = det.boundingBox;
      const rawX = box.originX; const rawY = box.originY;
      const rawW = box.width;   const rawH = box.height;
      const x1 = Math.max(0, Math.min(w, rawX));
      const y1 = Math.max(0, Math.min(h, rawY));
      const x2 = Math.max(0, Math.min(w, rawX + rawW));
      const y2 = Math.max(0, Math.min(h, rawY + rawH));
      let x = Math.round(Math.min(x1, x2));
      let y = Math.round(Math.min(y1, y2));
      let rw = Math.round(Math.abs(x2 - x1));
      let rh = Math.round(Math.abs(y2 - y1));
      rw = Math.max(1, rw);
      rh = Math.max(1, rh);
      ctx.rect(x, y, rw, rh);
      det.__alignedBox = { originX: x, originY: y, width: rw, height: rh };
    }
    ctx.fill();
    ctx.stroke();
  }

  // Labels and matching per detection (limited set)
  for (const { det } of filtered) {
    const cat = det.categories?.[0];
    const box = det.__alignedBox || det.boundingBox;
    if (cat) {
      if (categoryLogCount < 8) {
        try { console.log('Detected categories:', det.categories?.map(c => ({ name: c.categoryName, score: c.score }))); } catch {}
        categoryLogCount++;
      }
      let name = cat.categoryName || 'artwork';
      let confDisplay = cat.score != null ? (cat.score*100).toFixed(0) + '%' : '';
      let uiLabel = `${name}${confDisplay ? ` ${confDisplay}` : ''}`;
      let matched = null;

      try {
        if (hasEmbedModel()) {
          const crop = cropToCanvasFromVideo(det.boundingBox);
          const emb = embedFromCanvas(crop);
          matched = findBestMatch(emb);
        }
      } catch (e) {
        console.warn('Embedding/match failed:', e);
      }

      if (matched && matched.confidence >= COSINE_THRESHOLD) {
        const { entry, confidence } = matched;
        uiLabel = `${entry.title || 'Artwork'} ${(confidence*100).toFixed(1)}%`;
        const hitBox = det.__alignedBox || det.boundingBox;
        lastMatches.push({ entry, confidence, box: hitBox });
        anyMatch = true;
      }

      const textPaddingX = 6;
      const textPaddingY = 4;
      const metrics = ctx.measureText(uiLabel);
      const textW = Math.round(metrics.width + textPaddingX * 2);
      const textH = 18 + textPaddingY * 2;

      const labelX = Math.round(box.originX);
      const labelY = Math.max(0, Math.round(box.originY - textH));
      ctx.save();
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--label-bg') || 'rgba(0,0,0,0.6)';
      ctx.strokeStyle = 'transparent';
      ctx.beginPath();
      ctx.rect(labelX, labelY, textW, textH);
      ctx.fill();
      ctx.restore();

      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--label-fg') || '#fff';
      ctx.fillText(uiLabel, labelX + textPaddingX, Math.max(12 + textPaddingY, labelY + 12 + textPaddingY));
    }
  }

  if (!anyMatch) {
    lastRecognizedKey = null;
    hideHint();
    showInfo(null);
    clearHotspots();
    showAimGuide();
  } else if (lastMatches && lastMatches.length) {
    hideAimGuide();
    let best = lastMatches[0];
    for (const m of lastMatches) if (m.confidence > best.confidence) best = m;
    renderHotspot(best, onHotspotClick);
    placeHintOverBox(best.box);
    const key = (best.entry && (best.entry.id != null ? String(best.entry.id) : (best.entry.title || '')));
    if (key && key !== lastRecognizedKey) {
      lastRecognizedKey = key;
      showHintFor(best.entry, best.box);
    }
  }
}

export function getLastMatches() {
  return lastMatches;
}

export function resetRenderState() {
  lastMatches = [];
  lastRecognizedKey = null;
}
