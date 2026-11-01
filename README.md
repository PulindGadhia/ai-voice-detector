# AI Voice Detector

> **Every Voice Has a Story. Verify Its Origin.**

A clean, minimal, production-quality SaaS dashboard for detecting whether an audio recording contains a **human voice** or **AI-generated speech** — powered by a fine-tuned Wav2Vec2 deepfake detection model.

![AI Voice Detector Dashboard](https://img.shields.io/badge/status-production--ready-brightgreen?style=flat-square)
![Python](https://img.shields.io/badge/python-3.10%2B-blue?style=flat-square&logo=python)
![Flask](https://img.shields.io/badge/flask-3.x-black?style=flat-square&logo=flask)
![License](https://img.shields.io/badge/license-MIT-lightgrey?style=flat-square)

---

## ✨ Features

- 🎙 **Upload or record audio** directly from your microphone
- 🤖 **AI vs Human detection** using a fine-tuned Wav2Vec2 neural model
- 📊 **Live analytics dashboard** — total analyses, human/AI counts, avg processing time
- 🕓 **Full history** — searchable, filterable, sortable analysis log
- 📈 **Insights** — classification distribution chart + activity over time
- 🎧 **In-browser audio preview** before and after analysis
- 🌙 **Dark mode** toggle, persistent across sessions
- ⚡ **No cloud dependency** — fully local inference, no data leaves your device

---

## 🖥 Dashboard Preview

```
┌─────────────────┬──────────────────────────────┬──────────────────┐
│   Sidebar Nav   │   Hero + Audio Upload/Record  │   Analytics      │
│  ─────────────  │  ──────────────────────────── │  ──────────────  │
│  Dashboard      │  "Every Voice Has a Story."   │  Total: 42       │
│  History        │  Upload File | Record Audio   │  Human: 31       │
│  Insights       │  ┌────────────────────────┐   │  AI: 11          │
│  Settings       │  │  ↑ Drop audio here     │   │  Avg: 2.7s       │
│                 │  └────────────────────────┘   │  ──────────────  │
│                 │  ● Analyze Audio              │  Recent Analyses  │
│                 │  Result: Human · 97%          │  [search/filter] │
└─────────────────┴──────────────────────────────┴──────────────────┘
```

---

## 🛠 Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | Vanilla HTML, CSS, JavaScript |
| **Font** | Plus Jakarta Sans (Google Fonts) |
| **Icons** | Lucide Icons |
| **Charts** | Chart.js |
| **Backend** | Python · Flask |
| **AI Model** | [`garystafford/wav2vec2-deepfake-voice-detector`](https://huggingface.co/garystafford/wav2vec2-deepfake-voice-detector) |
| **Audio Processing** | librosa · soundfile |
| **Database** | SQLite (local, persistent) |
| **Recording** | Browser MediaRecorder API |

---

## 🚀 Getting Started

### Prerequisites

- Python 3.10 or higher
- pip
- ~500 MB disk space (for the AI model cache)

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/YOUR_USERNAME/ai-voice-detector.git
cd ai-voice-detector

# 2. Create and activate a virtual environment
python3 -m venv venv
source venv/bin/activate      # Mac/Linux
# venv\Scripts\activate       # Windows

# 3. Install dependencies
pip install -r requirements.txt

# 4. Run the app
PORT=5001 python3 app.py
```

Open your browser at **http://localhost:5001**

> **First run:** The Wav2Vec2 model (~360 MB) will be downloaded automatically from HuggingFace and cached locally. Subsequent runs start instantly.

---

## 📁 Project Structure

```
ai-voice-detector/
├── app.py                  # Flask server & REST APIs
├── detect.py               # Audio detection engine (model + heuristics)
├── requirements.txt        # Python dependencies
│
├── templates/
│   └── index.html          # Single-page dashboard
│
├── static/
│   ├── css/
│   │   ├── variables.css   # Design tokens (colors, spacing)
│   │   ├── main.css        # Layout — sidebar, topbar, two-column grid
│   │   └── components.css  # UI components — cards, buttons, tables
│   └── js/
│       ├── api.js          # Backend API client
│       └── app.js          # Dashboard logic, state, charts
│
└── data/
    └── history.db          # SQLite database (auto-created)
```

---

## 🔌 API Reference

All endpoints return JSON `{ success: bool, data: ... }`.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/predict` | Analyze base64-encoded audio |
| `GET`  | `/api/stats` | Aggregated statistics |
| `GET`  | `/api/history?limit=N` | Paginated analysis history |
| `DELETE` | `/api/history/<id>` | Delete a record |
| `DELETE` | `/api/history/clear` | Clear all history |
| `GET`  | `/api/health` | Server health check |

### Example `/api/predict` request

```json
{
  "audio_b64": "<base64-encoded audio>",
  "filename": "recording.wav",
  "extension": ".wav"
}
```

### Example response

```json
{
  "success": true,
  "data": {
    "prediction": "Human",
    "confidence": 0.9984,
    "risk_score": 0.0016,
    "confidence_level": "High",
    "model_used": "garystafford/wav2vec2-deepfake-voice-detector",
    "indicators": [
      "Natural spectral variation detected — human speech pattern.",
      "Natural pitch variation and intonation — human signature."
    ],
    "metadata": {
      "duration_seconds": 4.5,
      "sample_rate": 16000,
      "channels": 1
    },
    "processing_time_ms": 2730.4
  }
}
```

---

## 🎙 Audio Recording

The **Record Audio** tab uses the browser's native `MediaRecorder API`:

- Records in **WebM/Opus** format (Chrome/Firefox) or **MP4** (Safari)
- Live animated waveform + timer while recording
- Auto-stops at **5 minutes**
- Full audio preview before analysis
- No audio is stored — deleted immediately after analysis

---

## 🧠 Detection Engine

### Primary: Wav2Vec2 Neural Model
- Model: [`garystafford/wav2vec2-deepfake-voice-detector`](https://huggingface.co/garystafford/wav2vec2-deepfake-voice-detector)
- Trained to detect: ElevenLabs, Amazon Polly, Kokoro, OpenAI TTS, Google TTS, etc.
- Size: ~360 MB (downloaded once, cached in `~/.cache/huggingface`)

### Fallback: Feature Heuristic
When the model cannot be loaded, a signal-based heuristic scores 4 features:
- Spectral flux (lower → AI-like)
- Zero-crossing rate variance
- High-frequency MFCC variance
- Pitch regularity (coefficient of variation)

### Classification Result Labels

| Label | Meaning |
|---|---|
| `Human` | Real human voice detected |
| `AI` | AI-generated / synthetic voice detected |
| `Low Confidence` | Model score in ambiguous range (35–65%) |
| `Music / Beats Detected` | Audio contains music, not speech |
| `Insufficient Audio` | Too quiet or silent |
| `Unsupported Audio Type` | Noise or unrecognizable content |

---

## 🔒 Privacy

- **All processing is 100% local** — no audio or results are ever sent to external servers
- Audio files are **deleted immediately** after analysis
- History is stored locally in `data/history.db` (SQLite)
- You can clear your history at any time from the History view

---

## 🎨 Design

- **Font:** Plus Jakarta Sans
- **Color palette:** White `#FFFFFF` · Black `#111111` · Gray `#717171` · Light borders `#E5E5E5`
- **Style:** Minimal premium SaaS — no neon, no gradients, no heavy animations
- **Responsive:** Works on desktop, tablet, and mobile
- **Dark mode:** Full dark theme, toggled via topbar button

---

## 📦 Supported Audio Formats

`WAV` · `MP3` · `M4A` · `OGG` · `FLAC` · `AAC` · `WebM` · up to **100 MB**

---

## 🤝 Contributing

Pull requests are welcome. For major changes, please open an issue first.

1. Fork the repo
2. Create your feature branch: `git checkout -b feature/my-feature`
3. Commit your changes: `git commit -m 'Add my feature'`
4. Push: `git push origin feature/my-feature`
5. Open a pull request

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

---

<div align="center">
  Built by <strong>~Pulind Gadhia</strong>
</div>
