// Centralized DOM element references
export const appEl = document.getElementById('app');
export const videoEl = document.getElementById('camera');
export const canvasEl = document.getElementById('overlay');
export const hudEl = document.getElementById('hud');
export const startBtn = document.getElementById('startBtn');
export const statusEl = document.getElementById('status');
export const infoEl = document.getElementById('info');
export const hintEl = document.getElementById('hint');
export const hotspotsEl = document.getElementById('hotspots');
export const detailEl = document.getElementById('detail');
export const detailTitleEl = document.getElementById('detailTitle');
export const detailMetaEl = document.getElementById('detailMeta');
export const detailBodyEl = document.getElementById('detailBody');
export const backBtn = document.getElementById('backBtn');

export function get2DContext() {
  return canvasEl.getContext('2d');
}
