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
  const cx = dx + dw / 2;
  const clampedCenter = Math.max(dx + margin, Math.min(dx + Math.max(0, dw - margin), cx));
  const y = Math.max(margin, Math.min(map.dH - margin, dy + Math.max(8, Math.min(16, dh * 0.06))));
  hintEl.style.left = `${clampedCenter}px`;
  hintEl.style.top = `${y}px`;
  const maxW = Math.max(100, Math.floor(Math.min(Math.max(0, dw - margin * 2), map.dW - margin * 2)));
  if (isFinite(maxW) && maxW > 0) hintEl.style.maxWidth = `${maxW}px`;
}

export function clearHotspots() {
  if (!hotspotsEl) return;
  hotspotsEl.innerHTML = '';
}

export function renderHotspot(match, onClick) {
  if (!hotspotsEl || !match) return;
  clearHotspots();
  const { entry, confidence, box } = match;
  const map = getDisplayMapping();
  const dx = map.offsetX + (box.originX || 0) * map.scale;
  const dy = map.offsetY + (box.originY || 0) * map.scale;
  const dw = (box.width || 0) * map.scale;
  const dh = (box.height || 0) * map.scale;
  const margin = 12;
  let hx = Math.max(margin, Math.min(map.dW - margin, dx + dw * 0.5));
  let hy = Math.max(margin, Math.min(map.dH - margin, dy + Math.max(16, Math.min(32, dh * 0.12))));
  const btn = document.createElement('button');
  btn.className = 'hotspot';
  btn.type = 'button';
  btn.innerHTML = '<span class="icon" aria-hidden="true">👆</span>';
  btn.setAttribute('aria-label', 'Tocca per i dettagli sull’opera');
  btn.title = 'Tocca per i dettagli';
  btn.style.left = `${hx}px`;
  btn.style.top = `${hy}px`;
  btn.addEventListener('click', (e) => { e.stopPropagation(); if (onClick) onClick(entry, confidence); });
  hotspotsEl.appendChild(btn);
}
