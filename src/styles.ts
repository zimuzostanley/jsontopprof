export const CSS = `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --mono: 'IBM Plex Mono', monospace;
  --sans: 'Geist', system-ui, sans-serif;
  --radius: 4px;
  --radius-sm: 2px;
  --transition: 120ms ease;
}

[data-theme="light"] {
  --bg: #fafafa;
  --bg-card: #ffffff;
  --bg-input: #ffffff;
  --bg-hover: #f4f4f5;
  --bg-accent: #f0f0f2;
  --border: #e0e0e3;
  --border-focus: #888;
  --text: #1a1a1a;
  --text-secondary: #666;
  --text-tertiary: #999;
  --accent: #1a73e8;
  --accent-hover: #1557b0;
  --accent-bg: #e8f0fe;
  --success: #188038;
  --success-bg: #e6f4ea;
  --error: #c5221f;
  --error-bg: #fce8e6;
  --shadow: 0 1px 2px rgba(0,0,0,0.06);
}

[data-theme="dark"] {
  --bg: #121212;
  --bg-card: #1e1e1e;
  --bg-input: #292929;
  --bg-hover: #2c2c2c;
  --bg-accent: #2a2a2e;
  --border: #3c3c3c;
  --border-focus: #777;
  --text: #e0e0e0;
  --text-secondary: #999;
  --text-tertiary: #666;
  --accent: #8ab4f8;
  --accent-hover: #aecbfa;
  --accent-bg: #1a2744;
  --success: #81c995;
  --success-bg: #1a2e1f;
  --error: #f28b82;
  --error-bg: #3c1f1e;
  --shadow: 0 1px 2px rgba(0,0,0,0.2);
}

html { font-size: 13px; }
body {
  font-family: var(--sans);
  background: var(--bg);
  color: var(--text);
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

.shell {
  max-width: 880px;
  margin: 0 auto;
  padding: 20px 16px 48px;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border);
}

.header h1 {
  font-size: 1.15rem;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

/* --- Cards --- */
.card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 16px;
  margin-bottom: 12px;
}

.card-title {
  font-size: 0.77rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-secondary);
  margin-bottom: 10px;
}

/* --- Buttons --- */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  color: var(--text);
  font-family: var(--sans);
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  transition: background var(--transition);
  white-space: nowrap;
  line-height: 1.4;
}
.btn:hover { background: var(--bg-hover); }
.btn:active { opacity: 0.85; }

.btn.primary {
  background: var(--accent);
  border-color: transparent;
  color: #fff;
}
.btn.primary:hover { background: var(--accent-hover); }
.btn.primary:disabled { opacity: 0.4; cursor: default; }

.btn.sm { padding: 3px 8px; font-size: 0.8rem; }

.btn-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: background var(--transition);
  font-size: 0.95rem;
}
.btn-icon:hover { background: var(--bg-hover); color: var(--text); }

/* --- Inputs --- */
textarea {
  width: 100%;
  min-height: 160px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-input);
  color: var(--text);
  font-family: var(--mono);
  font-size: 0.8rem;
  line-height: 1.5;
  resize: vertical;
  transition: border-color var(--transition);
}
textarea:focus { outline: none; border-color: var(--border-focus); }
textarea::placeholder { color: var(--text-tertiary); }

select {
  padding: 3px 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-input);
  color: var(--text);
  font-family: var(--sans);
  font-size: 0.8rem;
  cursor: pointer;
}
select:focus { outline: none; border-color: var(--border-focus); }

input[type="text"] {
  padding: 3px 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-input);
  color: var(--text);
  font-family: var(--sans);
  font-size: 0.8rem;
}
input[type="text"]:focus { outline: none; border-color: var(--border-focus); }

/* --- Drop zone --- */
.drop-zone {
  border: 1px dashed var(--border);
  border-radius: var(--radius);
  padding: 16px;
  text-align: center;
  color: var(--text-tertiary);
  font-size: 0.85rem;
  transition: all var(--transition);
  cursor: pointer;
}
.drop-zone:hover, .drop-zone.dragging {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-bg);
}
.drop-zone input[type="file"] { display: none; }

/* --- Preview table --- */
.preview-table {
  width: 100%;
  overflow-x: auto;
  margin-top: 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}
.preview-table table {
  width: 100%;
  border-collapse: collapse;
  font-family: var(--mono);
  font-size: 0.75rem;
}
.preview-table th, .preview-table td {
  padding: 4px 8px;
  text-align: left;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.preview-table th {
  background: var(--bg-accent);
  font-weight: 600;
  position: sticky;
  top: 0;
}
.preview-table tr:last-child td { border-bottom: none; }
.preview-table .truncated { color: var(--text-tertiary); font-style: italic; }

/* --- Column config --- */
.col-list { display: flex; flex-direction: column; gap: 3px; }

.col-row {
  display: grid;
  grid-template-columns: 170px 1fr auto;
  gap: 10px;
  align-items: center;
  padding: 5px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  font-size: 0.8rem;
}
.col-row:hover { background: var(--bg-hover); }
.col-row.json-parent {
  background: var(--bg-accent);
  border-style: dashed;
  grid-template-columns: 1fr;
  padding: 4px 10px;
  font-size: 0.77rem;
  color: var(--text-secondary);
}

.col-name {
  font-family: var(--mono);
  font-size: 0.8rem;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.col-name .json-prefix { color: var(--text-tertiary); }

.col-samples {
  font-family: var(--mono);
  font-size: 0.72rem;
  color: var(--text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.col-role { display: flex; gap: 2px; }

.role-btn {
  padding: 2px 7px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-tertiary);
  font-family: var(--sans);
  font-size: 0.72rem;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition);
}
.role-btn:hover { background: var(--bg-hover); color: var(--text-secondary); }
.role-btn.active {
  background: var(--accent-bg);
  border-color: var(--accent);
  color: var(--accent);
}

/* --- Frame order --- */
.frame-order { display: flex; flex-direction: column; gap: 2px; margin-top: 6px; }

.frame-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  font-family: var(--mono);
  font-size: 0.8rem;
}
.frame-item .frame-idx { color: var(--text-tertiary); font-size: 0.72rem; min-width: 18px; }
.frame-item .frame-name { flex: 1; }
.frame-item .frame-label { font-size: 0.7rem; color: var(--text-tertiary); font-family: var(--sans); }

.frame-arrows { display: flex; gap: 1px; }
.frame-arrows button {
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 0.65rem;
  transition: background var(--transition);
}
.frame-arrows button:hover { background: var(--bg-hover); }
.frame-arrows button:disabled { opacity: 0.25; cursor: default; }

.json-array-config {
  margin-left: 14px;
  padding: 5px 10px;
  border-left: 2px solid var(--accent);
  margin-top: 2px;
  font-size: 0.8rem;
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-secondary);
}

/* --- Metrics --- */
.metric-list { display: flex; flex-direction: column; gap: 2px; margin-top: 6px; }
.metric-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-family: var(--mono);
  font-size: 0.8rem;
}
.metric-item .metric-name { flex: 1; }
.metric-item .rows-badge { font-size: 0.72rem; color: var(--success); font-family: var(--sans); font-weight: 500; }

/* --- Results --- */
.profile-list { display: flex; flex-direction: column; gap: 6px; }

.profile-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-card);
}
.profile-card:hover { background: var(--bg-hover); }

.profile-info { flex: 1; min-width: 0; }
.profile-name { font-weight: 600; font-size: 0.9rem; }
.profile-meta { font-size: 0.75rem; color: var(--text-secondary); margin-top: 1px; }
.profile-file { font-family: var(--mono); font-size: 0.72rem; color: var(--text-tertiary); }

/* --- Steps --- */
.steps {
  display: flex;
  gap: 1px;
  margin-bottom: 20px;
  background: var(--border);
  border-radius: var(--radius-sm);
  overflow: hidden;
}
.step-btn {
  flex: 1;
  padding: 6px 12px;
  border: none;
  background: var(--bg-card);
  color: var(--text-secondary);
  font-family: var(--sans);
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition);
}
.step-btn:hover { background: var(--bg-hover); }
.step-btn.active { background: var(--accent-bg); color: var(--accent); }
.step-btn:disabled { opacity: 0.35; cursor: default; }

/* --- Messages --- */
.msg-error {
  padding: 8px 12px;
  border: 1px solid var(--error);
  border-radius: var(--radius-sm);
  background: var(--error-bg);
  color: var(--error);
  font-size: 0.85rem;
  margin-top: 10px;
}

.msg-success {
  padding: 8px 12px;
  border: 1px solid var(--success);
  border-radius: var(--radius-sm);
  background: var(--success-bg);
  color: var(--success);
  font-size: 0.85rem;
  margin-top: 10px;
}

/* --- Stats --- */
.stats { display: flex; gap: 14px; flex-wrap: wrap; margin-bottom: 12px; }
.stat { font-size: 0.8rem; color: var(--text-secondary); }
.stat strong { color: var(--text); font-weight: 600; }

.section-gap { margin-top: 16px; }

/* --- Actions --- */
.actions {
  display: flex;
  gap: 6px;
  align-items: center;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}
.actions .spacer { flex: 1; }

/* --- Spinner --- */
.spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.5s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* --- Responsive --- */
@media (max-width: 600px) {
  .shell { padding: 12px 8px 36px; }
  .col-row { grid-template-columns: 1fr; gap: 4px; }
  .profile-card { flex-direction: column; align-items: stretch; gap: 6px; }
}
`
