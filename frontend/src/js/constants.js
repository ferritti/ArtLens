// Centralized constants and thresholds
export const MODEL_URL = "models/last_model.tflite"; // path to tflite model relative to public/

// Backend API base URL
export const BACKEND_URL = (typeof window !== 'undefined' && window.BACKEND_URL) || "http://localhost:8000";

// Offscreen crop size for embeddings
export const CROP_SIZE = 224; // MobileNet input size

// Matching settings
export const COSINE_THRESHOLD = 0.65; // tune as needed [0..1]
export const DEBUG_FALLBACK_CROP = false; // try center crop when no detections (debug only)

// Rendering limits
export const MAX_BOXES_PER_FRAME = 4; // limit number of boxes drawn per frame
export const MIN_BOX_SCORE = 0.65; // min category score to draw a box/attempt match
