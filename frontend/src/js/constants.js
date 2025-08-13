// Centralized constants and thresholds
export const MODEL_URL = "models/model.tflite"; // path to tflite model relative to public/

// Backend API base URL
export const BACKEND_URL = (typeof window !== 'undefined' && window.BACKEND_URL) || "http://localhost:8000";

// Offscreen crop size for embeddings
export const CROP_SIZE = 224; // MobileNet input size

// Matching settings
export const COSINE_THRESHOLD = 0.75; // tune as needed [0..1]
export const DEBUG_FALLBACK_CROP = false; // try center crop when no detections (debug only)
