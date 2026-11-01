"""
AI Voice Detector — Flask Application
A clean, minimal web server that accepts audio uploads and classifies them
as Human or AI-generated using the detect module.
"""

import base64
import json
import logging
import os
import sqlite3
import time
import uuid

from flask import Flask, jsonify, render_template, request

from detect import detect as run_detect
from detect import _load_hf_model as _warmup_model

# ─── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(message)s")
logger = logging.getLogger("app")

# ─── Paths ────────────────────────────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads", "audio")
DB_PATH = os.path.join(BASE_DIR, "data", "history.db")

os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)

SUPPORTED_EXTS = {".wav", ".mp3", ".ogg", ".flac", ".m4a", ".aac"}
MAX_CONTENT_LENGTH = 100 * 1024 * 1024  # 100 MB

# ─── Flask app ────────────────────────────────────────────────────────────────
app = Flask(__name__, template_folder="templates", static_folder="static")
app.config["MAX_CONTENT_LENGTH"] = MAX_CONTENT_LENGTH
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0   # disable static file caching

@app.after_request
def no_cache(response):
    """Force no-cache on every response so CSS/JS changes are always visible."""
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response

# ─── SQLite helper ────────────────────────────────────────────────────────────

def _get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _init_db():
    with _get_db() as db:
        db.execute("""
            CREATE TABLE IF NOT EXISTS history (
                id          TEXT PRIMARY KEY,
                timestamp   TEXT NOT NULL,
                filename    TEXT NOT NULL,
                prediction  TEXT NOT NULL,
                confidence  REAL NOT NULL,
                risk_score  REAL NOT NULL,
                conf_level  TEXT NOT NULL,
                duration    REAL,
                proc_ms     REAL,
                indicators  TEXT
            )
        """)
        db.commit()


_init_db()

# Pre-load the HuggingFace model into RAM on startup so the first real
# request doesn't stall while ~360 MB of weights are loaded from disk.
logger.info("Warming up detection model …")
_warmup_model()
logger.info("Model warm-up complete.")

# ─── Routes ───────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/predict", methods=["POST"])
def predict():
    """Accept base64-encoded audio and return a detection result."""
    if not request.is_json:
        return jsonify({"error": "Request must be JSON"}), 415

    data = request.get_json()
    if "audio_base64" not in data:
        return jsonify({"error": "Missing 'audio_base64' field"}), 400

    # Decode audio
    try:
        audio_bytes = base64.b64decode(data["audio_base64"])
    except Exception:
        return jsonify({"error": "Invalid base64 encoding"}), 400

    # Save to temp file
    req_id = str(uuid.uuid4())
    ext = data.get("ext", ".wav")   # frontend should pass the file extension
    if ext not in SUPPORTED_EXTS:
        ext = ".wav"
    temp_path = os.path.join(UPLOAD_DIR, f"{req_id}{ext}")

    try:
        with open(temp_path, "wb") as f:
            f.write(audio_bytes)

        # Run detection
        result = run_detect(temp_path)

        # Persist to history
        timestamp = time.strftime("%Y-%m-%dT%H:%M:%S")
        filename = data.get("filename", f"upload{ext}")
        with _get_db() as db:
            db.execute(
                """INSERT INTO history
                   (id, timestamp, filename, prediction, confidence, risk_score,
                    conf_level, duration, proc_ms, indicators)
                   VALUES (?,?,?,?,?,?,?,?,?,?)""",
                (
                    req_id,
                    timestamp,
                    filename,
                    result["prediction"],
                    result["confidence"],
                    result["risk_score"],
                    result["confidence_level"],
                    result["metadata"]["duration_seconds"],
                    result["processing_time_ms"],
                    json.dumps(result["indicators"]),
                ),
            )
            db.commit()

        result["request_id"] = req_id
        result["timestamp"] = timestamp
        return jsonify({"success": True, "data": result})

    except Exception as e:
        logger.exception("Detection failed")
        return jsonify({"error": str(e)}), 500

    finally:
        # Always clean up the temp file
        if os.path.exists(temp_path):
            os.remove(temp_path)


@app.route("/api/history", methods=["GET"])
def history():
    limit = min(int(request.args.get("limit", 50)), 200)
    offset = int(request.args.get("offset", 0))
    with _get_db() as db:
        rows = db.execute(
            "SELECT * FROM history ORDER BY timestamp DESC LIMIT ? OFFSET ?",
            (limit, offset)
        ).fetchall()
    records = []
    for r in rows:
        records.append({
            "id": r["id"],
            "timestamp": r["timestamp"],
            "filename": r["filename"],
            "prediction": r["prediction"],
            "confidence": r["confidence"],
            "risk_score": r["risk_score"],
            "confidence_level": r["conf_level"],
            "duration_seconds": r["duration"],
            "processing_time_ms": r["proc_ms"],
            "indicators": json.loads(r["indicators"] or "[]"),
        })
    return jsonify({"success": True, "data": records})


@app.route("/api/history/<record_id>", methods=["DELETE"])
def delete_record(record_id):
    with _get_db() as db:
        db.execute("DELETE FROM history WHERE id = ?", (record_id,))
        db.commit()
    return jsonify({"success": True})


@app.route("/api/history/clear", methods=["DELETE"])
def clear_history():
    with _get_db() as db:
        db.execute("DELETE FROM history")
        db.commit()
    return jsonify({"success": True})


@app.route("/api/stats", methods=["GET"])
def stats():
    with _get_db() as db:
        total  = db.execute("SELECT COUNT(*) FROM history").fetchone()[0]
        ai     = db.execute("SELECT COUNT(*) FROM history WHERE prediction='AI'").fetchone()[0]
        human  = db.execute("SELECT COUNT(*) FROM history WHERE prediction='Human'").fetchone()[0]
        low    = db.execute("SELECT COUNT(*) FROM history WHERE prediction='Low Confidence'").fetchone()[0]
        music  = db.execute("SELECT COUNT(*) FROM history WHERE prediction='Music / Beats Detected'").fetchone()[0]
        other  = total - ai - human - low - music
        avg_ms_row = db.execute(
            "SELECT AVG(proc_ms) FROM history WHERE proc_ms IS NOT NULL AND proc_ms > 0"
        ).fetchone()[0]
        avg_ms = round(avg_ms_row) if avg_ms_row else None
    return jsonify({"success": True, "data": {
        "total": total, "ai": ai, "human": human,
        "low_confidence": low, "music": music, "other": max(other, 0),
        "avg_processing_ms": avg_ms,
    }})


@app.route("/api/health", methods=["GET"])
def health():
    db_ok = True
    try:
        with _get_db() as db:
            db.execute("SELECT 1")
    except Exception:
        db_ok = False

    return jsonify({
        "success": True,
        "data": {
            "status": "healthy",
            "service": "AI Voice Detector",
            "version": "2.0.0",
            "database": "ok" if db_ok else "error",
        }
    })


@app.route("/api/metrics", methods=["GET"])
def metrics():
    try:
        import psutil
        proc = psutil.Process()
        uptime = time.time() - proc.create_time()
        cpu_pct = psutil.cpu_percent()
        ram_pct = psutil.virtual_memory().percent
    except ImportError:
        uptime, cpu_pct, ram_pct = 0, 0, 0

    with _get_db() as db:
        count = db.execute("SELECT COUNT(*) FROM history").fetchone()[0]

    return jsonify({
        "success": True,
        "data": {
            "cpu_percent": cpu_pct,
            "ram_percent": ram_pct,
            "uptime_seconds": round(uptime),
            "total_analyses": count,
        }
    })


# ─── Entry point ──────────────────────────────────────────────────────────────
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    logger.info(f"Starting AI Voice Detector on port {port}")
    app.run(host="0.0.0.0", port=port, debug=os.environ.get("DEBUG", "false").lower() == "true")
