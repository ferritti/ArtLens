// Import MediaPipe Tasks Vision from CDN
import { FilesetResolver, ObjectDetector } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
import { MODEL_URL } from './constants.js';

export let detector = null;

export async function initDetector() {
  const filesetResolver = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );
  detector = await ObjectDetector.createFromOptions(filesetResolver, {
    baseOptions: {
      modelAssetPath: MODEL_URL,
      delegate: 'GPU'
    },
    runningMode: 'VIDEO',
    scoreThreshold: 0.3
  });
}

export function closeDetector() {
  if (detector) {
    try { detector.close && detector.close(); } catch {}
    detector = null;
  }
}
