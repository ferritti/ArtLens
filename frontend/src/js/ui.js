import { appEl, videoEl, hintEl, hotspotsEl, infoEl } from './dom.js';

let hintHideTimer = null;

export function status(statusEl, msg) {
  if (statusEl) statusEl.textContent = msg;
}

export function showInfo(name, description, confidence) {
  if (!infoEl) return;
  if (!name) {
    infoEl.style.display = 'none';
    return;
  }
  const conf = (confidence * 100).toFixed(1);
  infoEl.innerHTML = `<div style="font-weight:700;margin-bottom:4px;">${name} <span style="opacity:.8;font-weight:500;">(${conf}%)</span></div><div style="opacity:.9;">${description || ''}</div>`;
  infoEl.style.display = 'block';
  hideHint();
}

export function showHintFor(entry, box) {
  const text = "Tocca l’opera";
  if (hintEl) {
    hintEl.textContent = text;
    placeHintOverBox(box);
    hintEl.classList.remove('hidden');
    scheduleHideHint(3000);
  }
}

export function hideHint() {
  if (hintHideTimer) { clearTimeout(hintHideTimer); hintHideTimer = null; }
  if (hintEl) hintEl.classList.add('hidden');
}

export function scheduleHideHint(ms = 3000) {
  if (hintHideTimer) clearTimeout(hintHideTimer);
  hintHideTimer = setTimeout(() => { hideHint(); }, ms);
}

export function clientPointToVideo(clientX, clientY) {
  const rect = appEl.getBoundingClientRect();
  const vW = videoEl.videoWidth || 1;
  const vH = videoEl.videoHeight || 1;
  const dW = rect.width;
  const dH = rect.height;
  const scale = Math.max(dW / vW, dH / vH);
  const displayW = vW * scale;
  const displayH = vH * scale;
  const offsetX = rect.left + (dW - displayW) / 2;
  const offsetY = rect.top + (dH - displayH) / 2;
  const x = (clientX - offsetX) / scale;
  const y = (clientY - offsetY) / scale;
  return { x, y };
}

export function pointInBox(px, py, box, pad = 6) {
  const x1 = box.originX - pad;
  const y1 = box.originY - pad;
  const x2 = box.originX + box.width + pad;
  const y2 = box.originY + box.height + pad;
  return px >= x1 && px <= x2 && py >= y1 && py <= y2;
}

export function getDisplayMapping() {
  const rect = appEl.getBoundingClientRect();
  const vW = videoEl.videoWidth || 1;
  const vH = videoEl.videoHeight || 1;
  const dW = rect.width;
  const dH = rect.height;
  const scale = Math.max(dW / vW, dH / vH);
  const displayW = vW * scale;
  const displayH = vH * scale;
  const offsetX = (dW - displayW) / 2;
  const offsetY = (dH - displayH) / 2;
  return { scale, offsetX, offsetY, dW, dH };
}
export function videoPointToDisplay(vx, vy) {
  const map = getDisplayMapping();
  return { x: map.offsetX + vx * map.scale, y: map.offsetY + vy * map.scale, dW: map.dW, dH: map.dH };
}
export function placeHintOverBox(box) {
  if (!hintEl || !box) return;
  const map = getDisplayMapping();
  const dx = map.offsetX + (box.originX || 0) * map.scale;
  const dy = map.offsetY + (box.originY || 0) * map.scale;
  const dw = (box.width || 0) * map.scale;
  const dh = (box.height || 0) * map.scale;
  const margin = 12;
  const cx = Math.max(margin, Math.min(map.dW - margin, dx + dw / 2));
  const cy = Math.max(margin, Math.min(map.dH - margin, dy + dh / 2));
  hintEl.style.left = `${cx}px`;
  hintEl.style.top = `${cy}px`;
  // Keep hint width reasonable and within the box when possible
  const maxW = Math.max(100, Math.floor(Math.min(Math.max(0, dw - margin * 2), map.dW - margin * 2)));
  if (isFinite(maxW) && maxW > 0) hintEl.style.maxWidth = `${maxW}px`;
}

export function clearHotspots() {
  if (!hotspotsEl) return;
  hotspotsEl.innerHTML = '';
}

export function renderHotspot(match, onClick) {
  // Hotspot (emoji button) intentionally removed.
  if (!hotspotsEl) return;
  hotspotsEl.innerHTML = '';
}
