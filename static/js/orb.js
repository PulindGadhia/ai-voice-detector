/**
 * AI Voice Detector — Canvas Audio Visualizer
 * Clean, minimal circular waveform visualization.
 * No Three.js — pure Canvas 2D for lightweight performance.
 */
class AudioVisualizer {
  constructor(canvasId) {
    this.canvas  = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx     = this.canvas.getContext('2d');
    this.state   = 'idle';   // idle | uploaded | analyzing | human | ai | music | error | low
    this.t       = 0;
    this.running = true;
    this._resize();
    this._animate();
    window.addEventListener('resize', () => this._resize());
  }

  setState(state) { this.state = state; }

  _animate() {
    if (!this.running) return;
    requestAnimationFrame(() => this._animate());
    this.t += 0.016;
    this._draw();
  }

  _draw() {
    const { canvas, ctx, t, state } = this;
    const W = canvas.width, H = canvas.height;
    const cx = W / 2, cy = H / 2;
    const R  = Math.min(W, H) * 0.34;
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';

    ctx.clearRect(0, 0, W, H);

    // Theme colors
    const baseAlpha = dark ? 0.12 : 0.10;
    const ringColor = dark ? `rgba(255,255,255,${baseAlpha})` : `rgba(0,0,0,${baseAlpha})`;

    // State-dependent accent color
    let accentRgb;
    switch (state) {
      case 'human': accentRgb = '22,163,74';  break;
      case 'ai':
      case 'error': accentRgb = '220,38,38';  break;
      case 'music':
      case 'uploaded': accentRgb = dark ? '255,255,255' : '17,17,17'; break;
      default: accentRgb = dark ? '255,255,255' : '17,17,17';
    }

    // Concentric background rings
    [0.55, 0.72, 0.90, 1.08].forEach(f => {
      ctx.beginPath();
      ctx.arc(cx, cy, R * f, 0, Math.PI * 2);
      ctx.strokeStyle = ringColor;
      ctx.lineWidth = 1;
      ctx.stroke();
    });

    // Waveform bars
    const bars   = 72;
    const speed  = state === 'analyzing' ? 2.5 : state === 'uploaded' ? 1.5 : 0.9;
    const ampMul = state === 'analyzing' ? 1.8 : state === 'uploaded' ? 1.1 : 0.7;

    for (let i = 0; i < bars; i++) {
      const theta = (i / bars) * Math.PI * 2 - Math.PI / 2;
      const phase = t * speed + i * (Math.PI * 2 / bars) * 0.6;
      const wave  = (Math.sin(phase) * 0.5 + Math.sin(phase * 2.3) * 0.3 + 0.2) * ampMul;
      const amp   = Math.max(0.02, Math.min(0.22, 0.05 + wave * 0.13));

      const r1 = R * 0.86;
      const r2 = R * (0.86 + amp);

      ctx.beginPath();
      ctx.moveTo(cx + r1 * Math.cos(theta), cy + r1 * Math.sin(theta));
      ctx.lineTo(cx + r2 * Math.cos(theta), cy + r2 * Math.sin(theta));

      const alpha = 0.3 + (wave / (ampMul || 1)) * 0.55;
      ctx.strokeStyle = `rgba(${accentRgb},${Math.min(alpha, 0.85)})`;
      ctx.lineWidth = 1.5;
      ctx.lineCap = 'round';
      ctx.stroke();
    }

    // Outer accent ring for result states
    if (state === 'human' || state === 'ai' || state === 'error') {
      const pulse = 0.6 + (Math.sin(t * 1.8) + 1) * 0.2;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 1.06, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${accentRgb},${pulse * 0.25})`;
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }

    // Rotating sweep arc for analyzing
    if (state === 'analyzing') {
      const sweep = this.t * 2.2;
      const len   = Math.PI * 0.6;
      const grd   = ctx.createLinearGradient(0, 0, W, H);
      grd.addColorStop(0, `rgba(${accentRgb},0.5)`);
      grd.addColorStop(1, `rgba(${accentRgb},0)`);

      ctx.beginPath();
      ctx.arc(cx, cy, R * 1.1, sweep, sweep + len);
      ctx.strokeStyle = grd;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Center dot
    const dotR = state === 'analyzing' ? 2.5 + Math.sin(t * 4) * 0.8 : 2.5;
    ctx.beginPath();
    ctx.arc(cx, cy, dotR, 0, Math.PI * 2);
    ctx.fillStyle = dark ? '#FFFFFF' : '#111111';
    ctx.fill();
  }

  _resize() {
    if (!this.canvas) return;
    const size = 200;   // fixed compact size
    this.canvas.width  = size;
    this.canvas.height = size;
  }

  destroy() { this.running = false; }
}
