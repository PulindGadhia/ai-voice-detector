FROM python:3.11-slim

# Install system dependencies for librosa / soundfile / ffmpeg
RUN apt-get update && apt-get install -y \
    ffmpeg \
    libsndfile1 \
    libsndfile1-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ── Install CPU-only PyTorch first (saves ~2 GB vs full CUDA build) ──────────
RUN pip install --no-cache-dir \
    torch==2.2.2 \
    --index-url https://download.pytorch.org/whl/cpu

# Install remaining Python deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy app source
COPY . .

# Ensure directories exist
RUN mkdir -p /app/data /app/uploads /app/models

# ── Pre-download the HuggingFace model into the image ─────────────────────────
ENV HF_HOME=/app/models
RUN python preload_model.py

# PORT is injected by Railway/Render; default to 8000 for local Docker runs
EXPOSE 8000

# Gunicorn with long timeout for CPU-heavy inference
CMD gunicorn --bind "0.0.0.0:${PORT:-8000}" --timeout 300 --workers 1 app:app
