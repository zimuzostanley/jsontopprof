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
  --bg: #f8f8f8;
  --bg-card: #ffffff;
  --bg-input: #ffffff;
  --bg-hover: #f3f3f4;
  --bg-accent: #eef1f5;
  --border: #dcdee2;
  --border-focus: #888;
  --text: #1a1a1a;
  --text-secondary: #5f6368;
  --text-tertiary: #9aa0a6;
  --accent: #1a73e8;
  --accent-hover: #1557b0;
  --accent-bg: #e8f0fe;
  --success: #188038;
  --success-bg: #e6f4ea;
  --error: #c5221f;
  --error-bg: #fce8e6;
  --shadow: 0 1px 3px rgba(0,0,0,0.06);
}

[data-theme="dark"] {
  --bg: #111113;
  --bg-card: #1c1c1f;
  --bg-input: #27272b;
  --bg-hover: #2a2a2f;
  --bg-accent: #22252b;
  --border: #38383e;
  --border-focus: #777;
  --text: #e0e0e4;
  --text-secondary: #9a9aa4;
  --text-tertiary: #606068;
  --accent: #8ab4f8;
  --accent-hover: #aecbfa;
  --accent-bg: #1a2744;
  --success: #81c995;
  --success-bg: #1a2e1f;
  --error: #f28b82;
  --error-bg: #3c1f1e;
  --shadow: 0 1px 3px rgba(0,0,0,0.2);
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
  max-width: 680px;
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
.header h1 { font-size: 1.1rem; font-weight: 600; letter-spacing: -0.01em; }
.header-actions { display: flex; align-items: center; gap: 6px; }

/* --- Cards --- */
.card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 14px 16px;
  margin-bottom: 10px;
}
.card-title {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-tertiary);
  margin-bottom: 8px;
}
.card-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.card-title-row .card-title { margin-bottom: 0; }

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
.btn.primary { background: var(--accent); border-color: transparent; color: #fff; }
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

select, input[type="text"] {
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-input);
  color: var(--text);
  font-family: var(--sans);
  font-size: 0.8rem;
  height: 26px;
}
select:focus, input[type="text"]:focus { outline: none; border-color: var(--border-focus); }
select { cursor: pointer; }

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

/* --- Configure: add column dropdown --- */
.add-col-select {
  width: 120px;
  font-family: var(--mono);
  font-size: 0.75rem;
  color: var(--text-secondary);
}

/* --- Configure: empty state --- */
.empty-hint {
  font-size: 0.8rem;
  color: var(--text-tertiary);
  padding: 2px 0;
}

/* --- Configure: tag list (labels, partitions) --- */
.tag-list { display: flex; flex-wrap: wrap; gap: 6px; }
.tag-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-family: var(--mono);
  font-size: 0.8rem;
  background: var(--bg-accent);
}

/* --- Configure: remove button --- */
.remove-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 0.85rem;
  line-height: 1;
  transition: color var(--transition);
}
.remove-btn:hover { color: var(--error); }

/* --- Configure: frame order --- */
.frame-order { display: flex; flex-direction: column; gap: 3px; }
.frame-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-accent);
  font-family: var(--mono);
  font-size: 0.8rem;
}
.frame-item .frame-idx {
  color: var(--accent);
  font-size: 0.72rem;
  font-weight: 600;
  min-width: 18px;
}
.frame-item .frame-name { flex: 1; }
.frame-item .frame-label {
  font-size: 0.68rem;
  color: var(--text-tertiary);
  font-family: var(--sans);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.frame-arrows { display: flex; gap: 1px; }
.frame-arrows button {
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 0.65rem;
  transition: background var(--transition);
}
.frame-arrows button:hover { background: var(--bg-hover); }
.frame-arrows button:disabled { opacity: 0.25; cursor: default; }

/* --- Configure: metric list --- */
.metric-list { display: flex; flex-direction: column; gap: 3px; }
.metric-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-accent);
  font-family: var(--mono);
  font-size: 0.8rem;
}
.metric-item .metric-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.metric-item .rows-badge { font-size: 0.72rem; color: var(--success); font-family: var(--sans); font-weight: 500; }
.metric-controls { display: flex; align-items: center; gap: 4px; }
.unit-input { width: 120px; font-family: var(--mono) !important; font-size: 0.75rem !important; }

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
.profile-actions { display: flex; gap: 4px; flex-shrink: 0; }
.checkbox-accent { cursor: pointer; accent-color: var(--accent); }

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
  padding: 7px 12px;
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
.step-btn.active { background: var(--accent-bg); color: var(--accent); font-weight: 600; }
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

/* --- Stats --- */
.stats { display: flex; gap: 14px; flex-wrap: wrap; margin-bottom: 10px; }
.stat { font-size: 0.8rem; color: var(--text-secondary); }
.stat strong { color: var(--text); font-weight: 600; }

.section-gap { margin-top: 14px; }

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
.actions-flush { border-top: none; padding-top: 0; margin-top: 8px; }
.actions-flush-sm { border-top: none; padding-top: 0; margin-top: 4px; }

/* --- Progress --- */
.progress-bar {
  height: 3px;
  background: var(--border);
  border-radius: 2px;
  overflow: hidden;
  margin-top: 8px;
}
.progress-fill {
  height: 100%;
  background: var(--accent);
  transition: width 200ms ease;
}

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

/* --- View toggle --- */
.view-toggle {
  display: inline-flex;
  gap: 1px;
  background: var(--border);
  border-radius: var(--radius-sm);
  overflow: hidden;
}
.view-toggle button {
  padding: 3px 12px;
  border: none;
  background: var(--bg-card);
  color: var(--text-secondary);
  font-family: var(--sans);
  font-size: 0.75rem;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition);
}
.view-toggle button:hover { background: var(--bg-hover); }
.view-toggle button.active { background: var(--accent-bg); color: var(--accent); }

/* --- Text view --- */
.text-view-pre {
  font-family: var(--mono);
  font-size: 0.72rem;
  line-height: 1.6;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 12px;
  overflow-x: auto;
  white-space: pre;
  max-height: 500px;
  overflow-y: auto;
  margin-bottom: 8px;
  tab-size: 2;
}
.text-profile-header {
  font-weight: 600;
  font-size: 0.85rem;
  margin: 14px 0 4px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.text-profile-meta { font-weight: 400; font-size: 0.75rem; color: var(--text-secondary); }
.copy-feedback { font-size: 0.8rem; color: var(--success); font-weight: 500; }

/* --- Text view: metric toggles --- */
.metric-toggles { display: flex; flex-wrap: wrap; gap: 5px; }
.role-btn {
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-tertiary);
  font-family: var(--mono);
  font-size: 0.75rem;
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

/* --- Hint card --- */
.hint-card { background: var(--accent-bg); border-color: var(--accent); }
.hint-card .card-title { color: var(--accent); }
.hint-text { font-size: 0.8rem; color: var(--text-secondary); line-height: 1.6; }
.code-inline {
  font-family: var(--mono);
  background: var(--bg-accent);
  padding: 1px 5px;
  border-radius: var(--radius-sm);
  font-size: 0.8rem;
}

/* --- Responsive --- */
@media (max-width: 600px) {
  .shell { padding: 12px 8px 36px; }
  .profile-card { flex-direction: column; align-items: stretch; gap: 6px; }
  .add-col-select { width: 100px; }
}
`
