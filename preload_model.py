"""
Pre-download the HuggingFace model during Docker build.
This script is run at build time so the model is baked into the image
and doesn't need to be downloaded at runtime on Render.
"""

import os

MODEL_NAME = "garystafford/wav2vec2-deepfake-voice-detector"
# Store model in /app/models so it's in the image layer
CACHE_DIR  = os.environ.get("HF_HOME", "/app/models")

print(f"Pre-downloading {MODEL_NAME} → {CACHE_DIR}")

from transformers import AutoFeatureExtractor, AutoModelForAudioClassification

AutoFeatureExtractor.from_pretrained(MODEL_NAME, cache_dir=CACHE_DIR)
AutoModelForAudioClassification.from_pretrained(MODEL_NAME, cache_dir=CACHE_DIR)

print("Model download complete.")
