import { videoEl, canvasEl } from './dom.js';
import { clearHotspots, renderHotspot, placeHintOverBox, showHintFor, hideHint, showInfo } from './ui.js';
import { cropToCanvasFromVideo, embedFromCanvas, cosineSim, hasEmbedModel } from './embedding.js';
import { artworkDB, dbDim, pickLangText } from './db.js';
import { COSINE_THRESHOLD, DEBUG_FALLBACK_CROP, MAX_BOXES_PER_FRAME, MIN_BOX_SCORE } from './constants.js';

let lastMatches = [];
let lastRecognizedKey = null;
let categoryLogCount = 0;

// Hysteresis and sticky best to reduce flicker
const STICKY_MS = 180; // keep best match visible for 180ms
const HYSTERESIS_DROP = 0.04; // allow small confidence drop to keep sticky
let stickyBest = null; // { entry, confidence, box, until }

// Visual styling constants for bounding box and label placement
const CORNER_LEN_FACTOR = 0.085; // bracket length as fraction of min(w,h)
const CORNER_OFFSET = 6;         // gap between rounded box and corner brackets
const LABEL_GAP_FROM_TL = 8;     // extra gap after the TL bracket so label never overlaps it
const LABEL_TOP_OFFSET = 36;     // vertical distance from box top to label top

function nowMs() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }

function roundRectPath(ctx, x, y, w, h, r){
  const rr = Math.max(1, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
}

function drawCornerBrackets(ctx, x, y, w, h, len, offset){
  const l = Math.max(6, len|0), o = Math.max(0, offset|0);
  ctx.save();
  const baseLW = ctx.lineWidth || 1;
  ctx.lineWidth = Math.max(6, baseLW + 2); /* thicker, bold-like */
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  // TL
  ctx.moveTo(x - o, y + l);
  ctx.lineTo(x - o, y - o);
  ctx.lineTo(x + l, y - o);
  // TR
  ctx.moveTo(x + w - l, y - o);
  ctx.lineTo(x + w + o, y - o);
  ctx.lineTo(x + w + o, y + l);
  // BR
  ctx.moveTo(x + w + o, y + h - l);
  ctx.lineTo(x + w + o, y + h + o);
  ctx.lineTo(x + w - l, y + h + o);
  // BL
  ctx.moveTo(x + l, y + h + o);
  ctx.lineTo(x - o, y + h + o);
  ctx.lineTo(x - o, y + h - l);
  ctx.stroke();
  ctx.restore();
}

function getCornerLen(w, h) {
  return Math.round(Math.min(w, h) * CORNER_LEN_FACTOR);
}

function drawRoundedBox(ctx, x, y, w, h) {
  const r = Math.max(10, Math.min(w, h) * 0.06);
  ctx.save();
  roundRectPath(ctx, x + 0.5, y + 0.5, Math.max(1, w - 1), Math.max(1, h - 1), r);
  // Subtle glass gradient similar to reference
  const grad = ctx.createLinearGradient(x, y, x + w, y);
  grad.addColorStop(0, 'rgba(0,212,255,0.16)');
  grad.addColorStop(0.55, 'rgba(50,120,220,0.14)');
  grad.addColorStop(1, 'rgba(0,212,255,0.16)');
  const prevFill = ctx.fillStyle;
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.fillStyle = prevFill;
  ctx.restore();
  // Decorative corner brackets outside the box (slightly offset)
  drawCornerBrackets(ctx, x, y, w, h, getCornerLen(w, h), CORNER_OFFSET);
}

function drawBestGlow(ctx, x, y, w, h) {
  ctx.save();
  ctx.lineWidth = 3;
  ctx.shadowBlur = 14;
  ctx.shadowColor = 'rgba(0,212,255,0.35)';
  ctx.strokeStyle = 'rgba(0,212,255,0.85)';
  roundRectPath(ctx, x, y, w, h, Math.max(10, Math.min(w, h) * 0.06));
  ctx.stroke();
  ctx.restore();
}

function drawCrosshair(ctx, x, y, w, h) {
  // Draw a centered plus sign inside the box
  const cx = Math.round(x + w / 2);
  const cy = Math.round(y + h / 2);
  const len = Math.round(Math.min(w, h) * 0.08); // 8% of min dimension
  ctx.save();
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  const col = getComputedStyle(document.documentElement).getPropertyValue('--box-color') || '#00D4FF';
  ctx.strokeStyle = col.trim();
  ctx.shadowColor = 'rgba(0,212,255,0.45)';
  ctx.shadowBlur = 6;
  ctx.beginPath();
  ctx.moveTo(cx - len, cy);
  ctx.lineTo(cx + len, cy);
  ctx.moveTo(cx, cy - len);
  ctx.lineTo(cx, cy + len);
  ctx.stroke();
  ctx.restore();
}

function drawCapsuleLabel(ctx, x, y, text, badge) {
  const padX = 10, padY = 6;
  const dotR = 4; // small status dot radius
  const dotGap = 6; // gap between dot and text
  ctx.save();
  ctx.font = '14px Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';
  const label = text || '';
  const textW = Math.round(ctx.measureText(label).width);
  const h = 18 + padY * 2;
  // account for the dot inside the chip
  const w = textW + padX * 2 + dotR * 2 + dotGap;
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--label-bg') || '#00D4FF';
  const fg = getComputedStyle(document.documentElement).getPropertyValue('--label-fg') || '#072a31';

  // soft shadow behind capsule
  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowBlur = 8;
  ctx.fillStyle = bg;
  ctx.strokeStyle = 'transparent';
  roundRectPath(ctx, x, y, w, h, 10);
  ctx.fill();

  // turn off shadow for inner elements
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;

  // left green status dot
  ctx.beginPath();
  ctx.fillStyle = '#00E98A';
  ctx.arc(x + padX + dotR, y + h / 2, dotR, 0, Math.PI * 2);
  ctx.fill();

  // text
  ctx.fillStyle = fg;
  ctx.fillText(label, x + padX + dotR * 2 + dotGap, y + padY + 12);
  ctx.restore();
}

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

  const lw = 4;
  ctx.lineWidth = lw;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--box-color') || '#00D4FF';
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--box-fill') || 'rgba(0,212,255,0.06)';
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

          drawRoundedBox(ctx, box.originX, box.originY, box.width, box.height);
          // premium glow for the matched box
          drawBestGlow(ctx, box.originX, box.originY, box.width, box.height);
          // centered crosshair
          drawCrosshair(ctx, box.originX, box.originY, box.width, box.height);

          const pct = (confidence*100).toFixed(1) + '%';
          {
            const cornerLen = getCornerLen(box.width, box.height);
            const labelX = Math.round(box.originX + cornerLen + CORNER_OFFSET + LABEL_GAP_FROM_TL);
            const labelY = Math.max(0, Math.round(box.originY - LABEL_TOP_OFFSET));
            drawCapsuleLabel(ctx, labelX, labelY, 'Artwork Detected');
          }

          // Show placard with localized description

          const key = (entry && (entry.id != null ? String(entry.id) : (entry.title || '')));
          if (key && key !== lastRecognizedKey) {
            lastRecognizedKey = key;
            showHintFor(entry, box);
          }
          renderHotspot({ entry, confidence, box }, onHotspotClick);
        }
      } catch (e) { console.warn('Fallback match failed:', e); }
    }
    if (!fallbackMatched) {
      lastRecognizedKey = null;
      hideHint();
      showInfo(null);
      clearHotspots();
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

  // Draw rounded boxes per detection with pixel-aligned coords
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
    det.__alignedBox = { originX: x, originY: y, width: rw, height: rh };
    drawRoundedBox(ctx, x, y, rw, rh);
    drawCrosshair(ctx, x, y, rw, rh);
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
      let uiLabel = `Artwork Detected`;
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
        uiLabel = `${entry.title || 'Artwork'}`; // title only; confidence shown in badge
        const hitBox = det.__alignedBox || det.boundingBox;
        lastMatches.push({ entry, confidence, box: hitBox });
        anyMatch = true;
      }

      {
        const cornerLen = getCornerLen(box.width, box.height);
        const labelX = Math.round(box.originX + cornerLen + CORNER_OFFSET + LABEL_GAP_FROM_TL);
        const labelY = Math.max(0, Math.round(box.originY - LABEL_TOP_OFFSET));
        // If we have a matched artwork, show its confidence as badge, otherwise show detector score
        const badge = (matched && matched.confidence != null)
          ? `${(matched.confidence*100).toFixed(1)}%`
          : (cat?.score != null ? `${(cat.score*100).toFixed(0)}%` : null);
        drawCapsuleLabel(ctx, labelX, labelY, uiLabel, badge);
      }
    }
  }

  const t = nowMs();
  if (lastMatches && lastMatches.length) {
    let best = lastMatches[0];
    for (const m of lastMatches) if (m.confidence > best.confidence) best = m;
    stickyBest = { entry: best.entry, confidence: best.confidence, box: best.box, until: t + STICKY_MS };
    // Glow highlight on best
    drawBestGlow(ctx, best.box.originX, best.box.originY, best.box.width, best.box.height);
    // Crosshair on best (ensure visibility above fill)
    drawCrosshair(ctx, best.box.originX, best.box.originY, best.box.width, best.box.height);
    // Hotspot and hint for current best
    renderHotspot(best, onHotspotClick);
    placeHintOverBox(best.box);
    const key = (best.entry && (best.entry.id != null ? String(best.entry.id) : (best.entry.title || '')));
    if (key && key !== lastRecognizedKey) {
      lastRecognizedKey = key;
      showHintFor(best.entry, best.box);
    }
    // Show placard with localized description
  } else if (stickyBest && t < stickyBest.until && stickyBest.confidence >= (COSINE_THRESHOLD - HYSTERESIS_DROP)) {
    // Keep last best briefly to avoid flicker
    const b = stickyBest;
    drawBestGlow(ctx, b.box.originX, b.box.originY, b.box.width, b.box.height);
    drawCrosshair(ctx, b.box.originX, b.box.originY, b.box.width, b.box.height);
  } else {
    stickyBest = null;
    lastRecognizedKey = null;
    hideHint();
    showInfo(null);
    clearHotspots();
  }
}

export function getLastMatches() {
  return lastMatches;
}

export function resetRenderState() {
  lastMatches = [];
  lastRecognizedKey = null;
}
