"""
AI Voice Detector — Detection Engine
Uses 'garystafford/wav2vec2-deepfake-voice-detector' (a fine-tuned wav2vec2 model
specifically trained to classify audio as REAL human or FAKE AI-generated).

Trained to detect: ElevenLabs, Amazon Polly, Kokoro, OpenAI TTS, Google TTS, etc.
Falls back to a feature-based heuristic if the model cannot be loaded.

Model source: https://huggingface.co/garystafford/wav2vec2-deepfake-voice-detector
Model size:   ~360 MB (downloaded once, cached in ~/.cache/huggingface)
"""

import logging
import os
import time
import uuid

import librosa
import numpy as np

logger = logging.getLogger("detector")

SAMPLE_RATE = 16_000
MAX_DURATION = 30  # seconds — clips longer than this are trimmed

# ─────────────────────────── audio loading ────────────────────────────────────

def load_audio(path: str) -> np.ndarray:
    """Load any audio file → mono float32 at 16 kHz."""
    audio, _ = librosa.load(path, sr=SAMPLE_RATE, mono=True, duration=MAX_DURATION)
    if np.abs(audio).max() > 0:
        audio = audio / np.abs(audio).max()
    return audio.astype(np.float32)


# ─────────────────────────── pre-trained HuggingFace model ───────────────────

_hf_model     = None
_hf_extractor = None
_hf_loaded    = False   # True = successfully loaded | False = never tried | None = failed

PRIMARY_MODEL = "garystafford/wav2vec2-deepfake-voice-detector"
# Use pre-baked model dir (set by Dockerfile); fall back to default HF cache for local dev
HF_CACHE_DIR  = os.environ.get("HF_HOME", None)


def _load_hf_model():
    """Lazy-load the deepfake detection model (downloaded once, cached forever)."""
    global _hf_model, _hf_extractor, _hf_loaded
    if _hf_loaded is True:
        return True
    if _hf_loaded is None:
        return False   # already tried and failed

    try:
        import torch
        from transformers import (
            AutoFeatureExtractor,
            AutoModelForAudioClassification,
        )

        logger.info(f"Loading deepfake detector: {PRIMARY_MODEL} (cache={HF_CACHE_DIR}) …")
        _hf_extractor = AutoFeatureExtractor.from_pretrained(
            PRIMARY_MODEL, cache_dir=HF_CACHE_DIR
        )
        _hf_model = AutoModelForAudioClassification.from_pretrained(
            PRIMARY_MODEL, cache_dir=HF_CACHE_DIR
        )
        _hf_model.eval()
        logger.info("Deepfake detection model loaded successfully!")
        _hf_loaded = True
        return True

    except Exception as e:
        logger.warning(
            f"Could not load {PRIMARY_MODEL}: {e}\n"
            "Falling back to feature-based detection."
        )
        _hf_loaded = None   # mark as permanently failed
        return False


def _run_hf_inference(audio: np.ndarray) -> dict | None:
    """
    Run the HuggingFace deepfake model.
    Returns {"label": "REAL"|"FAKE", "score": float} or None on error.
    """
    if not _load_hf_model():
        return None
    try:
        import torch

        inputs = _hf_extractor(
            audio, sampling_rate=SAMPLE_RATE, return_tensors="pt", padding=True
        )
        with torch.no_grad():
            logits = _hf_model(**inputs).logits          # shape: (1, 2)

        probs    = torch.softmax(logits, dim=-1)[0]      # (2,)
        id2label = _hf_model.config.id2label             # {0: "FAKE", 1: "REAL"} or similar
        pred_id  = int(torch.argmax(probs))
        label    = id2label[pred_id].upper()             # normalise to upper case
        score    = float(probs[pred_id])

        # Build probability of being AI (FAKE)
        fake_id  = next(k for k, v in id2label.items() if "FAKE" in v.upper() or "AI" in v.upper())
        ai_prob  = float(probs[fake_id])

        return {"label": label, "score": score, "ai_probability": ai_prob}

    except Exception as e:
        logger.warning(f"HuggingFace inference failed: {e}")
        return None


# ─────────────────────────── fallback: feature heuristic ─────────────────────

def _extract_features(audio: np.ndarray) -> dict:
    hop = 512
    mel   = librosa.feature.melspectrogram(y=audio, sr=SAMPLE_RATE, n_mels=128, hop_length=hop)
    mel_db = librosa.power_to_db(mel, ref=np.max)
    mfcc  = librosa.feature.mfcc(y=audio, sr=SAMPLE_RATE, n_mfcc=20, hop_length=hop)
    zcr   = librosa.feature.zero_crossing_rate(audio, hop_length=hop)[0]
    centroid = librosa.feature.spectral_centroid(y=audio, sr=SAMPLE_RATE, hop_length=hop)[0]

    f0, _, _ = librosa.pyin(
        audio,
        fmin=librosa.note_to_hz("C2"),
        fmax=librosa.note_to_hz("C7"),
        sr=SAMPLE_RATE,
        hop_length=hop,
    )
    return {"mel_db": mel_db, "mfcc": mfcc, "zcr": zcr, "centroid": centroid, "f0": f0}


def _feature_based_ai_probability(audio: np.ndarray) -> float:
    """
    Pure signal-based AI probability score [0=human, 1=AI].
    Used only when the HuggingFace model cannot be loaded.
    """
    feats = _extract_features(audio)
    mel, mfcc, zcr, centroid, f0 = (
        feats["mel_db"], feats["mfcc"], feats["zcr"], feats["centroid"], feats["f0"],
    )

    score, w_total = 0.0, 0.0

    # 1. Spectral flux (lower → more AI-like)
    flux = float(np.mean(np.abs(np.diff(mel, axis=1))))
    w = 0.25
    score += w * (1.0 - np.clip((flux - 0.1) / 2.4, 0, 1))
    w_total += w

    # 2. ZCR variance (lower → AI)
    zcr_v = float(np.var(zcr))
    w = 0.20
    zcr_vote = 1.0 if zcr_v < 0.0015 else max(0.0, 1.0 - zcr_v / 0.0075)
    score += w * zcr_vote
    w_total += w

    # 3. High MFCC variance (lower → AI)
    mfcc_v = float(np.mean(np.var(mfcc[12:, :], axis=1)))
    w = 0.25
    score += w * (1.0 - np.clip((mfcc_v - 5.0) / 45.0, 0, 1))
    w_total += w

    # 4. Pitch regularity (CV < 0.08 → AI)
    valid_f0 = f0[~np.isnan(f0)] if f0 is not None else np.array([])
    if len(valid_f0) > 10:
        w = 0.30
        cv = float(np.std(valid_f0) / (np.mean(valid_f0) + 1e-9))
        score += w * (1.0 - np.clip(cv / 0.25, 0, 1))
        w_total += w

    return float(np.clip(score / (w_total + 1e-9), 0.0, 1.0))


# ─────────────────────────── audio categorizer ───────────────────────────────

AUDIO_CATEGORIES = {
    "speech":       "Analysable as speech — proceed to detection.",
    "robot_voice":  "Robot / heavily-processed voice — treated as AI.",
    "music":        "Music / beats detected — not a voice recording.",
    "silence":      "Audio is too quiet or silent.",
    "noise":        "Random noise detected — cannot classify.",
}


def _categorize_audio(audio: np.ndarray) -> str:
    """
    Classify the audio into one of:
      'speech'      — proceed with AI vs Human detection
      'robot_voice' — skip HF model, score as AI directly
      'music'       — reject with 'Music / Beats Detected'
      'silence'     — reject with 'Insufficient Audio'
      'noise'       — reject with 'Unsupported Audio Type'

    Tuned to NOT false-positive on browser microphone recordings (WebM/Opus)
    which naturally have higher chroma energy due to codec spectral artifacts.
    """
    hop = 512

    # ── Silence check ──────────────────────────────────────────────────────────
    rms = float(np.sqrt(np.mean(audio ** 2)))
    if rms < 0.005:
        return "silence"

    # ── Feature extraction ─────────────────────────────────────────────────────
    flatness = float(np.mean(librosa.feature.spectral_flatness(y=audio, hop_length=hop)))
    chroma   = librosa.feature.chroma_stft(y=audio, sr=SAMPLE_RATE, hop_length=hop)
    chroma_v = float(np.var(chroma))

    # Beat / tempo detection
    tempo, beats    = librosa.beat.beat_track(y=audio, sr=SAMPLE_RATE, hop_length=hop)
    beats_per_sec   = len(beats) / max(len(audio) / SAMPLE_RATE, 1.0)

    # Zero-crossing rate
    zcr_mean = float(np.mean(librosa.feature.zero_crossing_rate(audio, hop_length=hop)))

    # Mean chroma energy across all bins and frames
    chroma_energy = float(np.mean(chroma))

    # ── Pitch analysis (used for both music and robot detection) ──────────────
    try:
        f0, _, _ = librosa.pyin(
            audio,
            fmin=librosa.note_to_hz("C2"),
            fmax=librosa.note_to_hz("C7"),
            sr=SAMPLE_RATE,
            hop_length=hop,
        )
        valid_f0 = f0[~np.isnan(f0)] if f0 is not None else np.array([])
    except Exception:
        valid_f0 = np.array([])

    voiced_ratio = len(valid_f0) / max((len(audio) // hop), 1)

    # ── Music / beats detection ────────────────────────────────────────────────
    #
    # Root cause of false-positives on mic recordings:
    #   • WebM/Opus codec compression inflates chroma_energy (was triggering >0.55)
    #   • Speech rhythm can trigger beats_per_sec > 0.4 (syllable cadence ~3-5 Hz)
    #
    # New conservative criteria — ALL of the following must be true for "music":
    #   1. High chroma variance (genuine tonal content moving across keys)
    #   2. High beat density (actual rhythmic pulse, > 1 beat/s)
    #   3. Very high chroma energy (truly dominated by tonal harmonic content)
    #   4. Low voiced ratio (music doesn't have a sustained pitch track like speech)
    #   5. ZCR in music range (> 0.15 — drum transients push this up)
    #
    # OR for clearly noisy beats (EDM/drums with no speech):
    #   flatness > 0.4 AND very high beats (> 1.5/s) AND very low voiced ratio

    is_tonal_music = (
        chroma_v > 0.10              # strong movement across chroma bins
        and beats_per_sec > 1.0      # genuine rhythmic pulse (was 0.4 — way too low)
        and chroma_energy > 0.65     # very high tonal energy (was 0.55 — too low)
        and voiced_ratio < 0.40      # sustained fundamental pitch NOT dominant
    )

    is_noisy_beats = (
        flatness > 0.40              # noisy/percussive spectrum
        and beats_per_sec > 1.5      # strong beat pulse
        and voiced_ratio < 0.25      # almost no speech-like pitch
    )

    if is_tonal_music or is_noisy_beats:
        return "music"

    # ── Pure noise ─────────────────────────────────────────────────────────────
    # Very flat spectrum with essentially no pitch and no beats at all
    if flatness > 0.55 and voiced_ratio < 0.05 and beats_per_sec < 0.3:
        return "noise"

    # ── Robot / heavily-processed voice ───────────────────────────────────────
    # Must satisfy ALL conditions to avoid false-positives:
    if len(valid_f0) > 30:
        cv_pitch = float(np.std(valid_f0) / (np.mean(valid_f0) + 1e-9))
        is_robot = (
            cv_pitch < 0.03           # pitch almost perfectly constant
            and 0.02 < zcr_mean < 0.20  # ZCR in speech range
            and flatness < 0.30       # spectrum not flat
            and chroma_energy < 0.50  # not musical
        )
        if is_robot:
            return "robot_voice"

    # ── Default: treat as speech ───────────────────────────────────────────────
    return "speech"


# ─────────────────────────── indicator builder ───────────────────────────────

def _build_indicators(audio: np.ndarray, ai_prob: float, used_hf: bool) -> list[str]:
    feats  = _extract_features(audio)
    flux   = float(np.mean(np.abs(np.diff(feats["mel_db"], axis=1))))
    zcr_v  = float(np.var(feats["zcr"]))
    mfcc_v = float(np.mean(np.var(feats["mfcc"][12:, :], axis=1)))
    valid  = feats["f0"][~np.isnan(feats["f0"])] if feats["f0"] is not None else np.array([])

    inds = []

    if used_hf:
        inds.append(
            "Primary detection: fine-tuned deepfake classification model "
            "(garystafford/wav2vec2-deepfake-voice-detector)."
        )

    # Spectral smoothness
    inds.append(
        "Spectral transitions are abnormally smooth — AI signature."
        if flux < 0.6 else
        "Natural spectral variation detected — human speech pattern."
    )

    # ZCR
    inds.append(
        "Zero-crossing rate is unusually consistent — AI signature."
        if zcr_v < 0.0015 else
        "Natural micro-jitter in zero-crossing rate — human signature."
    )

    # MFCC texture
    inds.append(
        "Low high-frequency MFCC variance — uniform phoneme texture (AI)."
        if mfcc_v < 20 else
        "Rich phoneme-level texture variation — human speech pattern."
    )

    # Pitch
    if len(valid) > 10:
        cv = float(np.std(valid) / (np.mean(valid) + 1e-9))
        inds.append(
            "Pitch is highly regular and mechanical — AI signature."
            if cv < 0.08 else
            "Natural pitch variation and intonation — human signature."
        )
    else:
        inds.append("Insufficient voiced frames to evaluate pitch regularity.")

    return inds


# ─────────────────────────── public API ───────────────────────────────────────

def detect(file_path: str) -> dict:
    """
    Analyse an audio file and return:
    {
      prediction        : "AI" | "Human" | "Low Confidence" | "Unsupported Audio Type"
      confidence        : float  (0–1)
      risk_score        : float  (probability of being AI)
      confidence_level  : "High" | "Medium" | "Low"
      model_used        : str
      indicators        : [str, …]
      metadata          : {duration_seconds, sample_rate, channels}
      processing_time_ms: float
    }
    """
    t0     = time.time()
    req_id = str(uuid.uuid4())[:8]
    logger.info(f"[{req_id}] Analysing: {os.path.basename(file_path)}")

    # 1. Load audio
    audio    = load_audio(file_path)
    duration = len(audio) / SAMPLE_RATE
    metadata = {"duration_seconds": round(duration, 2), "sample_rate": SAMPLE_RATE, "channels": 1}

    # 2. Audio categorisation
    category = _categorize_audio(audio)

    if category == "silence":
        return {
            "prediction": "Insufficient Audio",
            "confidence": 0.0,
            "risk_score": 0.0,
            "confidence_level": "N/A",
            "model_used": "N/A",
            "indicators": [
                "The audio is silent or too quiet to analyse.",
                "Please upload a recording with audible speech.",
            ],
            "metadata": metadata,
            "processing_time_ms": round((time.time() - t0) * 1000, 1),
        }

    if category == "music":
        return {
            "prediction": "Music / Beats Detected",
            "confidence": 0.0,
            "risk_score": 0.0,
            "confidence_level": "N/A",
            "model_used": "N/A",
            "indicators": [
                "Detected rhythmic beat structure and tonal musical content.",
                "This tool is designed for voice / speech recordings only.",
                "Please upload a clip that contains only human or AI-generated voice.",
            ],
            "metadata": metadata,
            "processing_time_ms": round((time.time() - t0) * 1000, 1),
        }

    if category == "noise":
        return {
            "prediction": "Unsupported Audio Type",
            "confidence": 0.0,
            "risk_score": 0.0,
            "confidence_level": "N/A",
            "model_used": "N/A",
            "indicators": [
                "Detected random noise or unsupported audio content.",
                "Please upload a clear voice / speech recording.",
            ],
            "metadata": metadata,
            "processing_time_ms": round((time.time() - t0) * 1000, 1),
        }

    # For robot_voice: force AI result immediately (skip slow HF model path)
    if category == "robot_voice":
        indicators = [
            "Heavily processed / robotic voice characteristics detected.",
            "Pitch is almost perfectly constant — mechanically generated.",
            "Spectral signature matches synthesized or vocoder-processed audio.",
            "Classified as AI-generated without neural model inference.",
        ]
        elapsed = round((time.time() - t0) * 1000, 1)
        logger.info(f"[{req_id}] → AI (robot voice fast-path) | {elapsed} ms")
        return {
            "prediction":         "AI",
            "confidence":         0.97,
            "risk_score":         0.97,
            "confidence_level":   "High",
            "model_used":         "robot-voice-fast-path",
            "indicators":         indicators,
            "metadata":           metadata,
            "processing_time_ms": elapsed,
        }

    # 3. PRIMARY: HuggingFace deepfake model
    hf_result = _run_hf_inference(audio)
    used_hf   = hf_result is not None

    if used_hf:
        ai_prob   = hf_result["ai_probability"]
        model_tag = PRIMARY_MODEL
    else:
        # FALLBACK: feature heuristic
        ai_prob   = _feature_based_ai_probability(audio)
        model_tag = "feature-heuristic (wav2vec2 unavailable)"

    # 4. Decision thresholds
    if used_hf:
        # Neural model → tighter thresholds (model is more confident)
        HIGH_THRESH = 0.65
        LOW_THRESH  = 0.35
    else:
        # Heuristic → more conservative
        HIGH_THRESH = 0.62
        LOW_THRESH  = 0.38

    if ai_prob >= HIGH_THRESH:
        label      = "AI"
        confidence = ai_prob
    elif ai_prob <= LOW_THRESH:
        label      = "Human"
        confidence = 1.0 - ai_prob
    else:
        label      = "Low Confidence"
        confidence = max(ai_prob, 1.0 - ai_prob)

    # 5. Confidence level
    conf_level = "High" if confidence >= 0.85 else "Medium" if confidence >= 0.70 else "Low"

    # 6. Indicators
    indicators = _build_indicators(audio, ai_prob, used_hf)

    elapsed = round((time.time() - t0) * 1000, 1)
    logger.info(
        f"[{req_id}] → {label} | confidence={confidence:.2%} | ai_prob={ai_prob:.3f} "
        f"| model={'HF' if used_hf else 'heuristic'} | {elapsed} ms"
    )

    return {
        "prediction":         label,
        "confidence":         round(confidence, 4),
        "risk_score":         round(ai_prob, 4),
        "confidence_level":   conf_level,
        "model_used":         model_tag,
        "indicators":         indicators,
        "metadata":           metadata,
        "processing_time_ms": elapsed,
    }
