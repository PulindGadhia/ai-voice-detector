FROM python:3.11-slim

# Install system dependencies for librosa / soundfile / ffmpeg
RUN apt-get update && apt-get install -y \
    ffmpeg \
    libsndfile1 \
    libsndfile1-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps first (layer cache)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy app source
COPY . .

# Ensure data directory exists for SQLite
RUN mkdir -p /app/data /app/uploads /app/models

# ── Pre-download the HuggingFace model into the image ──────────────────────
# This means Render doesn't download ~360 MB on every cold start.
ENV HF_HOME=/app/models
RUN python preload_model.py

EXPOSE 8000

# Use Gunicorn with a 300-second timeout to handle slow CPU inference
CMD ["gunicorn", "--bind", "0.0.0.0:8000", "--timeout", "300", "--workers", "1", "app:app"]
