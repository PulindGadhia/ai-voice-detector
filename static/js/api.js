/* Voice यंत्र — API client */
const API = {
  async predict(audioBase64, filename, ext) {
    const res = await fetch('/api/predict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio_base64: audioBase64, filename, ext }),
    });
    return res.json();
  },

  async history(limit = 100) {
    const res = await fetch(`/api/history?limit=${limit}`);
    return res.json();
  },

  async deleteRecord(id) {
    const res = await fetch(`/api/history/${id}`, { method: 'DELETE' });
    return res.json();
  },

  async clearHistory() {
    const res = await fetch('/api/history/clear', { method: 'DELETE' });
    return res.json();
  },

  async stats() {
    const res = await fetch('/api/stats');
    return res.json();
  },

  async health() {
    const res = await fetch('/api/health');
    return res.json();
  },

  async metrics() {
    const res = await fetch('/api/metrics');
    return res.json();
  },
};
