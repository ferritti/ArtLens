// Centralized constants and thresholds
export const MODEL_URL = "/public/models/model.tflite"; // path to tflite model
export const ART_DB_URL = "/src/data/artwork_database.json"; // embeddings database file

// Offscreen crop size for embeddings
export const CROP_SIZE = 224; // MobileNet input size

// Matching settings
export const COSINE_THRESHOLD = 0.75; // tune as needed [0..1]
export const DEBUG_FALLBACK_CROP = false; // try center crop when no detections (debug only)
