/**
 * AI Voice Detector — Application Logic v2
 * Every Voice Has a Story. Verify Its Origin.
 */

/* ═══ Globals ════════════════════════════════════ */
let currentFile      = null;
let isAnalyzing      = false;
let allHistory       = [];
let dashHistory      = [];   // recent list (right column)
let donutChart       = null;
let lineChart        = null;

// Recording
let mediaRecorder    = null;
let recChunks        = [];
let recBlob          = null;
let recStartTime     = null;
let recTimerInterval = null;

/* ═══ Boot ═══════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  initNav();
  initUpload();
  initRecording();
  initTheme();
  initRecentControls();
  loadDashboard();
  lucide.createIcons();
});

/* ═══ Theme ══════════════════════════════════════ */
function initTheme() {
  const saved = localStorage.getItem('avd-theme') || 'light';
  setTheme(saved);
  document.getElementById('theme-toggle')?.addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme') || 'light';
    setTheme(cur === 'dark' ? 'light' : 'dark');
  });
}
function setTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('avd-theme', t);
  const icon = document.getElementById('theme-icon');
  if (icon) { icon.setAttribute('data-lucide', t === 'dark' ? 'sun' : 'moon'); lucide.createIcons(); }
}

/* ═══ Navigation ══════════════════════════════════ */
const PAGE_TITLES = { dashboard: 'Dashboard', history: 'History', insights: 'Insights', settings: 'Settings' };

function switchView(view) {
  document.querySelectorAll('.nav-item[data-view]').forEach(el =>
    el.classList.toggle('active', el.dataset.view === view)
  );
  document.querySelectorAll('.view').forEach(el =>
    el.classList.toggle('active', el.id === `view-${view}`)
  );
  const t = document.getElementById('page-title');
  if (t) t.textContent = PAGE_TITLES[view] || view;
  document.getElementById('sidebar')?.classList.remove('open');

  if (view === 'dashboard') loadDashboard();
  if (view === 'history')   loadHistory();
  if (view === 'insights')  loadInsights();
}
window.switchView = switchView;

function initNav() {
  document.querySelectorAll('.nav-item[data-view]').forEach(el =>
    el.addEventListener('click', () => switchView(el.dataset.view))
  );
}

/* ═══ Upload + Tab Switching ══════════════════════ */
function showState(state) {
  const analyzing = document.getElementById('s-analyzing');
  const tabsWrap  = document.getElementById('tabs-wrap');
  if (state === 'analyzing') {
    analyzing?.classList.remove('hidden');
    tabsWrap?.classList.add('hidden');
  } else {
    analyzing?.classList.add('hidden');
    tabsWrap?.classList.remove('hidden');
    ['s-default', 's-selected'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.toggle('hidden', id !== `s-${state}`);
    });
  }
}

function switchUploadTab(tab) {
  document.querySelectorAll('.upload-tab').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === tab)
  );
  document.getElementById('tab-upload')?.classList.toggle('hidden', tab !== 'upload');
  document.getElementById('tab-record')?.classList.toggle('hidden', tab !== 'record');
  if (tab !== 'record' && mediaRecorder?.state === 'recording') stopRecording();
}
window.switchUploadTab = switchUploadTab;

function initUpload() {
  const fileInput  = document.getElementById('file-input');
  const uploadCard = document.getElementById('upload-card');

  fileInput?.addEventListener('change', e => {
    const f = e.target.files?.[0];
    if (f) selectFile(f);
    e.target.value = '';
  });

  uploadCard?.addEventListener('dragenter', e => { e.preventDefault(); uploadCard.classList.add('drag-over'); });
  uploadCard?.addEventListener('dragover',  e => { e.preventDefault(); uploadCard.classList.add('drag-over'); });
  uploadCard?.addEventListener('dragleave', e => { if (!uploadCard.contains(e.relatedTarget)) uploadCard.classList.remove('drag-over'); });
  uploadCard?.addEventListener('drop', e => {
    e.preventDefault();
    uploadCard.classList.remove('drag-over');
    switchUploadTab('upload');
    const f = e.dataTransfer?.files?.[0];
    if (f) selectFile(f);
  });

  document.getElementById('btn-remove') ?.addEventListener('click', resetUpload);
  document.getElementById('btn-replace')?.addEventListener('click', () => {
    resetUpload();
    setTimeout(() => document.getElementById('file-input')?.click(), 50);
  });
  document.getElementById('btn-analyze')?.addEventListener('click', runAnalysis);

  document.querySelectorAll('.upload-tab[data-tab]').forEach(btn =>
    btn.addEventListener('click', () => switchUploadTab(btn.dataset.tab))
  );

  showState('default');
}

function selectFile(file) {
  const ALLOWED = ['.wav','.mp3','.m4a','.ogg','.flac','.aac','.webm','.opus'];
  const ext = '.' + file.name.split('.').pop().toLowerCase();
  if (!ALLOWED.includes(ext)) {
    toast(`Unsupported format: ${ext}. Use WAV, MP3, M4A, OGG or FLAC.`, 'error');
    return;
  }
  if (file.size > 100 * 1024 * 1024) {
    toast('File too large — maximum 100 MB.', 'error');
    return;
  }
  currentFile = file;
  setText('sel-name', file.name);
  setText('sel-meta', formatBytes(file.size));
  const player = document.getElementById('audio-player');
  if (player) {
    player.src = URL.createObjectURL(file);
    player.onloadedmetadata = () => {
      if (isFinite(player.duration))
        setText('sel-meta', `${formatBytes(file.size)} · ${formatDuration(player.duration)}`);
    };
  }
  showState('selected');
  document.getElementById('result-area')?.classList.add('hidden');
  toast(`${file.name} ready.`, 'success');
}

function resetUpload() {
  currentFile = null;
  const player = document.getElementById('audio-player');
  if (player) { player.pause(); player.src = ''; }
  showState('default');
  document.getElementById('result-area')?.classList.add('hidden');
}
window.dismissResult = function () {
  document.getElementById('result-area')?.classList.add('hidden');
};

/* ═══ Analysis ════════════════════════════════════ */
async function runAnalysis() {
  if (!currentFile || isAnalyzing) return;
  isAnalyzing = true;
  const btn = document.getElementById('btn-analyze');
  if (btn) { btn.disabled = true; btn.textContent = 'Analyzing…'; }
  setText('analyzing-name', currentFile.name);
  showState('analyzing');
  try {
    const b64  = await toBase64(currentFile);
    const ext  = '.' + currentFile.name.split('.').pop().toLowerCase();
    const resp = await API.predict(b64, currentFile.name, ext);
    if (!resp.success) throw new Error(resp.error || 'Detection failed');
    displayResult(resp.data);
    loadDashboard();
  } catch (err) {
    showState('selected');
    toast(err.message || 'Analysis failed. Please try again.', 'error');
  } finally {
    isAnalyzing = false;
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="search" style="width:14px;height:14px;display:inline;vertical-align:middle;margin-right:6px"></i>Analyze Audio';
      lucide.createIcons();
    }
  }
}

function displayResult(data) {
  const pred = data.prediction || '?';
  const conf = data.confidence > 0 ? Math.round(data.confidence * 100) : null;
  const cls  = pred === 'Human' ? 'human'
             : pred === 'AI'    ? 'ai'
             : (pred||'').includes('Music') ? 'music'
             : pred === 'Low Confidence'    ? 'low' : 'other';

  const badgeEl = document.getElementById('res-badge');
  if (badgeEl) { badgeEl.textContent = pred; badgeEl.className = `result-badge ${cls}`; }
  setText('res-conf', conf ? `${conf}%` : '');

  const metaEl = document.getElementById('result-meta');
  if (metaEl) {
    const fname = data.filename || currentFile?.name || '—';
    const dur   = data.duration_seconds ? formatDuration(data.duration_seconds) : '—';
    const model = data.model_used || '—';
    const procT = data.processing_time_ms ? `${Math.round(data.processing_time_ms)} ms` : '—';
    metaEl.innerHTML = `
      <div class="result-meta-item"><div class="result-meta-label">File</div><div class="result-meta-val">${escHtml(fname)}</div></div>
      <div class="result-meta-item"><div class="result-meta-label">Duration</div><div class="result-meta-val">${dur}</div></div>
      <div class="result-meta-item"><div class="result-meta-label">Processing</div><div class="result-meta-val">${procT}</div></div>
      <div class="result-meta-item"><div class="result-meta-label">Model</div><div class="result-meta-val">${escHtml(model)}</div></div>
    `;
  }
  const indEl = document.getElementById('res-indicators');
  if (indEl) {
    const indicators = (data.indicators || []).slice(0, 5);
    indEl.innerHTML = indicators.map(i => `<div class="indicator-chip">${escHtml(i)}</div>`).join('');
    indEl.style.display = indicators.length ? '' : 'none';
  }

  showState('default');
  currentFile = null;
  const player = document.getElementById('audio-player');
  if (player) player.src = '';
  document.getElementById('result-area')?.classList.remove('hidden');
  lucide.createIcons();

  const ttype = pred === 'Human' ? 'success' : pred === 'AI' ? 'error' : 'info';
  toast(`Result: ${pred}${conf ? ` · ${conf}%` : ''}`, ttype);
}

/* ═══ Dashboard ═══════════════════════════════════ */
async function loadDashboard() {
  try {
    const [sr, hr] = await Promise.all([API.stats(), API.history(50)]);
    if (sr.success) renderDashStats(sr.data);
    if (hr.success) {
      dashHistory = hr.data;
      renderRecentList();
    }
  } catch(e) { console.warn('Dashboard:', e); }
}

function renderDashStats(s) {
  animNum('stat-total', s.total || 0);
  animNum('stat-human', s.human || 0);
  animNum('stat-ai',    s.ai    || 0);
  const avgEl = document.getElementById('stat-avgtime');
  if (avgEl) {
    if (s.avg_processing_ms) {
      avgEl.textContent = s.avg_processing_ms >= 1000
        ? `${(s.avg_processing_ms / 1000).toFixed(1)}s`
        : `${s.avg_processing_ms}ms`;
      avgEl.classList.add('stat-small-val');
    } else {
      avgEl.textContent = '—';
    }
  }
}

/* ── Recent list (right column) ───────────────── */
function initRecentControls() {
  document.getElementById('recent-search')?.addEventListener('input',  renderRecentList);
  document.getElementById('recent-filter')?.addEventListener('change', renderRecentList);
}

function renderRecentList() {
  const el     = document.getElementById('recent-list');
  if (!el) return;
  const search = (document.getElementById('recent-search')?.value || '').toLowerCase().trim();
  const filter = document.getElementById('recent-filter')?.value || '';

  let rows = [...dashHistory];
  if (search) rows = rows.filter(r => (r.filename||'').toLowerCase().includes(search));
  if (filter === 'Human') rows = rows.filter(r => r.prediction === 'Human');
  else if (filter === 'AI')    rows = rows.filter(r => r.prediction === 'AI');
  else if (filter === 'Music') rows = rows.filter(r => (r.prediction||'').includes('Music'));

  if (!rows.length) {
    el.innerHTML = `<div class="empty-zone"><p>${search || filter ? 'No matching analyses.' : 'Your analyzed files will appear here.'}</p></div>`;
    return;
  }

  el.innerHTML = rows.slice(0, 20).map(r => {
    const cls  = r.prediction === 'Human' ? 'human'
               : r.prediction === 'AI'    ? 'ai'
               : (r.prediction||'').includes('Music') ? 'music'
               : r.prediction === 'Low Confidence'    ? 'low' : 'other';
    const conf = r.confidence > 0 ? ` · ${Math.round(r.confidence * 100)}%` : '';
    const dur  = r.duration_seconds ? ` · ${formatDuration(r.duration_seconds)}` : '';
    const ago  = timeAgo(new Date(r.timestamp));
    return `<div class="recent-item">
      <div class="recent-file-icon"><svg data-lucide="file-audio" style="width:13px;height:13px"></svg></div>
      <div class="recent-info">
        <div class="recent-fname" title="${escHtml(r.filename)}">${escHtml((r.filename||'—').substring(0,36))}</div>
        <div class="recent-time">${ago}${dur}${conf}</div>
      </div>
      <span class="result-pill ${cls}">${escHtml(shortLabel(r.prediction))}</span>
    </div>`;
  }).join('');
  lucide.createIcons();
}

function shortLabel(pred) {
  if (!pred) return '?';
  if (pred.includes('Music')) return 'Music';
  if (pred === 'Low Confidence') return 'Low';
  return pred;
}

/* ═══ Recording (MediaRecorder API) ══════════════ */
function initRecording() {
  document.getElementById('btn-start-rec')  ?.addEventListener('click', startRecording);
  document.getElementById('btn-stop-rec')   ?.addEventListener('click', stopRecording);
  document.getElementById('btn-rec-discard')?.addEventListener('click', discardRecording);
  document.getElementById('btn-rec-redo')   ?.addEventListener('click', discardRecording);
  document.getElementById('btn-rec-analyze')?.addEventListener('click', analyzeRecording);
}

function showRecState(state) {
  ['r-idle','r-recording','r-ready'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('hidden', id !== `r-${state}`);
  });
}

async function startRecording() {
  if (!navigator.mediaDevices?.getUserMedia) {
    toast('Your browser does not support microphone recording.', 'error'); return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    const TYPES  = ['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/mp4','audio/ogg'];
    const mimeType = TYPES.find(t => MediaRecorder.isTypeSupported(t)) || '';
    recChunks = [];
    mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recChunks.push(e.data); };
    mediaRecorder.onstop = handleRecordStop;
    mediaRecorder.start(100);
    recStartTime = Date.now();
    showRecState('recording');
    lucide.createIcons();
    recTimerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - recStartTime) / 1000);
      setText('rec-timer', formatDuration(elapsed));
      if (elapsed >= 300) stopRecording();
    }, 1000);
  } catch (err) {
    const msgs = {
      NotAllowedError:  'Microphone access denied. Please allow it in your browser.',
      NotFoundError:    'No microphone found. Please connect a microphone.',
      NotReadableError: 'Microphone is in use by another application.',
    };
    toast(msgs[err.name] || `Microphone error: ${err.message}`, 'error');
  }
}

function stopRecording() {
  clearInterval(recTimerInterval);
  if (mediaRecorder?.state === 'recording') {
    mediaRecorder.stop();
    mediaRecorder.stream?.getTracks().forEach(t => t.stop());
  }
}

function handleRecordStop() {
  const duration = Math.floor((Date.now() - recStartTime) / 1000);
  const mime     = mediaRecorder.mimeType || 'audio/webm';
  const ext      = mime.includes('ogg') ? '.ogg' : mime.includes('mp4') ? '.mp4' : '.webm';
  recBlob = new Blob(recChunks, { type: mime });
  const ts    = new Date().toISOString().replace(/[:.]/g,'-').substring(0,19);
  const fname = `recording-${ts}${ext}`;
  setText('rec-fname', fname);
  setText('rec-meta',  `${formatDuration(duration)} · ${formatBytes(recBlob.size)}`);
  const player = document.getElementById('rec-player');
  if (player) player.src = URL.createObjectURL(recBlob);
  showRecState('ready');
  lucide.createIcons();
}

function discardRecording() {
  recBlob = null; recChunks = [];
  const player = document.getElementById('rec-player');
  if (player) { player.pause(); player.src = ''; }
  showRecState('idle');
}

async function analyzeRecording() {
  if (!recBlob || isAnalyzing) return;
  isAnalyzing = true;
  const fname = document.getElementById('rec-fname')?.textContent || 'recording.webm';
  setText('analyzing-name', fname);
  showState('analyzing');
  try {
    const b64 = await blobToBase64(recBlob);
    const ext  = recBlob.type.includes('ogg') ? '.ogg' : recBlob.type.includes('mp4') ? '.mp4' : '.webm';
    const resp = await API.predict(b64, fname, ext);
    if (!resp.success) throw new Error(resp.error || 'Detection failed');
    displayResult(resp.data);
    loadDashboard();
    recBlob = null; recChunks = [];
    switchUploadTab('upload');
    showRecState('idle');
  } catch (err) {
    switchUploadTab('record');
    showState('default');
    showRecState('ready');
    toast(err.message || 'Analysis failed. Please try again.', 'error');
  } finally {
    isAnalyzing = false;
  }
}

function blobToBase64(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload  = e => res(e.target.result.split(',')[1]);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}

/* ═══ History View ════════════════════════════════ */
async function loadHistory() {
  const tbody = document.getElementById('history-tbody');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="7" class="table-empty">Loading…</td></tr>`;
  try {
    const res = await API.history(500);
    if (!res.success) throw new Error();
    allHistory = res.data;
    renderHistory();
  } catch(e) {
    tbody.innerHTML = `<tr><td colspan="7" class="table-empty" style="color:var(--red-text)">Failed to load history.</td></tr>`;
  }
  // Wire controls (re-attach safely)
  ['history-search','history-filter','history-sort'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.removeEventListener('input', renderHistory); el.removeEventListener('change', renderHistory); el.addEventListener('input', renderHistory); el.addEventListener('change', renderHistory); }
  });
}

function renderHistory() {
  const tbody  = document.getElementById('history-tbody');
  if (!tbody) return;
  const search = (document.getElementById('history-search')?.value || '').toLowerCase().trim();
  const filter = document.getElementById('history-filter')?.value || '';
  const sort   = document.getElementById('history-sort')?.value   || 'desc';

  let rows = [...allHistory];
  if (search) rows = rows.filter(r => (r.filename||'').toLowerCase().includes(search));
  if (filter === 'Human') rows = rows.filter(r => r.prediction === 'Human');
  else if (filter === 'AI')    rows = rows.filter(r => r.prediction === 'AI');
  else if (filter === 'Music') rows = rows.filter(r => (r.prediction||'').includes('Music'));
  else if (filter === 'Low')   rows = rows.filter(r => r.prediction === 'Low Confidence');
  rows.sort((a,b) => { const d = new Date(a.timestamp) - new Date(b.timestamp); return sort === 'asc' ? d : -d; });

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="table-empty">${search || filter ? 'No matching records.' : 'No analyses yet.'}</td></tr>`;
    return;
  }
  const CLS = { 'Human':'human','AI':'ai','Low Confidence':'low' };
  tbody.innerHTML = rows.map(r => {
    const cls  = CLS[r.prediction] || ((r.prediction||'').includes('Music') ? 'music' : 'other');
    const conf = r.confidence > 0 ? `${Math.round(r.confidence * 100)}%` : '—';
    const dur  = r.duration_seconds ? formatDuration(r.duration_seconds) : '—';
    const proc = r.processing_time_ms ? `${Math.round(r.processing_time_ms)} ms` : '—';
    const ts   = new Date(r.timestamp).toLocaleString(undefined, { dateStyle:'medium', timeStyle:'short' });
    return `<tr>
      <td title="${escHtml(r.filename)}">${escHtml((r.filename||'—').substring(0,40))}</td>
      <td style="white-space:nowrap;font-size:12px">${ts}</td>
      <td><span class="result-pill ${cls}">${escHtml(r.prediction||'?')}</span></td>
      <td>${conf}</td>
      <td>${dur}</td>
      <td>${proc}</td>
      <td>
        <button type="button"
          style="font:inherit;font-size:12px;border:none;background:none;color:var(--text-muted);cursor:pointer;padding:2px 6px;border-radius:5px;transition:color .12s"
          onmouseover="this.style.color='var(--red-text)'"
          onmouseout="this.style.color='var(--text-muted)'"
          onclick="deleteRow('${r.id}')">Remove</button>
      </td>
    </tr>`;
  }).join('');
}

async function deleteRow(id) {
  try {
    await API.deleteRecord(id);
    allHistory  = allHistory.filter(r => r.id != id);
    dashHistory = dashHistory.filter(r => r.id != id);
    renderHistory();
    renderRecentList();
    loadDashboard();
    toast('Record removed.', 'info');
  } catch(e) { toast('Failed to remove.', 'error'); }
}
window.deleteRow = deleteRow;

async function clearHistory() {
  if (!confirm('Clear all history? This cannot be undone.')) return;
  try {
    await API.clearHistory();
    allHistory = []; dashHistory = [];
    renderHistory(); renderRecentList(); loadDashboard();
    toast('History cleared.', 'info');
  } catch(e) { toast('Failed to clear history.', 'error'); }
}
window.clearHistory = clearHistory;

/* ═══ Insights ════════════════════════════════════ */
async function loadInsights() {
  try {
    const [sr, hr] = await Promise.all([API.stats(), API.history(500)]);
    if (sr.success) {
      const s = sr.data;
      animNum('ins-total', s.total || 0);
      animNum('ins-human', s.human || 0);
      animNum('ins-ai',    s.ai    || 0);
      buildDonut(s);
    }
    if (hr.success) buildTimeline(hr.data);
  } catch(e) { console.warn('Insights:', e); }
}

function buildDonut(stats) {
  const ctx = document.getElementById('donut-chart');
  if (!ctx || typeof Chart === 'undefined') return;
  if (donutChart) { donutChart.destroy(); donutChart = null; }
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  const tc   = dark ? '#A1A1A1' : '#717171';
  donutChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Human','AI Generated','Low Confidence','Music / Beats','Other'],
      datasets: [{
        data: [stats.human, stats.ai, stats.low_confidence, stats.music, stats.other],
        backgroundColor: dark
          ? ['#14532d','#450a0a','#451a03','#1e3a5f','#262626']
          : ['#dcfce7','#fee2e2','#fef3c7','#dbeafe','#f5f5f5'],
        borderColor: dark
          ? ['#16a34a','#dc2626','#d97706','#2563eb','#525252']
          : ['#16a34a','#dc2626','#d97706','#2563eb','#d4d4d4'],
        borderWidth: 1.5,
      }],
    },
    options: {
      cutout: '62%',
      plugins: { legend: { position:'bottom', labels:{ color:tc, font:{size:11,family:'Plus Jakarta Sans'}, padding:10 } } },
    },
  });
}

function buildTimeline(records) {
  const ctx = document.getElementById('timeline-chart');
  if (!ctx || typeof Chart === 'undefined') return;
  if (lineChart) { lineChart.destroy(); lineChart = null; }
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  const tc   = dark ? '#525252' : '#a1a1a1';
  const bc   = dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)';
  const br   = dark ? '#525252' : '#d4d4d4';

  if (!records.length) {
    ctx.parentElement.innerHTML = `<p style="text-align:center;color:var(--text-muted);padding:60px 0;font-size:13px">No data yet</p>`;
    return;
  }
  const g = {};
  records.forEach(r => { const d = (r.timestamp||'').substring(0,10); if(d) g[d] = (g[d]||0) + 1; });
  const labels = Object.keys(g).sort().slice(-14);
  lineChart = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ label:'Analyses', data: labels.map(d=>g[d]), backgroundColor: bc, borderColor: br, borderWidth:1, borderRadius:3 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        x: { ticks:{ color:tc, font:{size:10} }, grid:{ color: dark?'rgba(255,255,255,0.05)':'rgba(0,0,0,0.05)' } },
        y: { ticks:{ color:tc, stepSize:1 }, grid:{ color: dark?'rgba(255,255,255,0.05)':'rgba(0,0,0,0.05)' }, beginAtZero:true },
      },
      plugins: { legend:{ display:false } },
    },
  });
}

/* ═══ Utilities ═══════════════════════════════════ */
function toBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload  = e => res(e.target.result.split(',')[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}
function formatBytes(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b/1024).toFixed(1)} KB`;
  return `${(b/1048576).toFixed(1)} MB`;
}
function formatDuration(s) {
  s = Math.round(s);
  const m = Math.floor(s / 60), sec = s % 60;
  return m > 0 ? `${m}:${sec.toString().padStart(2,'0')}` : `${sec}s`;
}
function timeAgo(d) {
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60)    return 'just now';
  if (s < 3600)  return `${Math.floor(s/60)}m ago`;
  if (s < 86400) return `${Math.floor(s/3600)}h ago`;
  return `${Math.floor(s/86400)}d ago`;
}
function escHtml(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function setText(id, val) { const e = document.getElementById(id); if(e) e.textContent = val; }
function animNum(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  const start = parseInt(el.textContent) || 0;
  const t0 = performance.now();
  (function step(ts) {
    const p = Math.min((ts - t0) / 500, 1);
    el.textContent = Math.round(start + (target - start) * p);
    if (p < 1) requestAnimationFrame(step);
  })(t0);
}
function toast(msg, type = 'info') {
  const cont = document.getElementById('toast-container');
  if (!cont) return;
  const icons = { success:'check', error:'alert-circle', info:'info' };
  const el = document.createElement('div');
  el.className = `toast ${type === 'success' ? 'success' : type === 'error' ? 'error' : ''}`;
  el.innerHTML = `<i data-lucide="${icons[type]||'info'}"></i><span>${escHtml(msg)}</span>`;
  cont.appendChild(el);
  lucide.createIcons();
  setTimeout(() => {
    el.style.opacity = '0'; el.style.transition = 'opacity .25s';
    setTimeout(() => el.remove(), 300);
  }, 3500);
}
