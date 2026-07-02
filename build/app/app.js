/**
 * ReefDeck App — v1.6.0
 * Client-side reef tank logbook. All data stored in localStorage on the user's device.
 * No data is transmitted to any server (free tier).
 *
 * Architecture: pure vanilla JS, no frameworks, no build step.
 * Data schema: see SCHEMA section below.
 */

'use strict';

// ============================================================
// SCHEMA
// ============================================================
// tanks: [{ id, name, type, volume, volumeUnit, notes, createdAt }]
// logs: [{ id, tankId, date, params: {alk, ca, mg, sal, ph, temp, no3, po4, ...}, notes }]
// inventory: [{ id, tankId, type, name, placedDate, price, notes, photoDataUrl }]
// journal: [{ id, tankId, date, text, tags }]
// thresholds: { [tankId]: { [paramKey]: { min, max } } }
// maintenance: [{ id, tankId, name, category, intervalDays, lastDone, enabled, notes }]
// prefs: { theme: 'dark'|'light', reminders: bool, lastNotified: { [taskId]: 'YYYY-MM-DD' } }
// photos: { [logId]: dataUrl }  — stored separately to avoid bloating the logs array
// corals: [{ id, tankId, name, species, source, dateAdded, placement, photos: [], growth: [{ id, date, note, photoId }] }]
//   — per-colony growth tracker (Phase 4). Distinct from the flat `inventory` list.
//   Coral photos reuse reefdeck_photos (dataURL by id). growth entries are dated,
//   date-sorted, observational only (never advice). See coral.js for pure helpers.

// ============================================================
// DEFAULT PARAMETERS
// ============================================================
const DEFAULT_PARAMS = [
  { key: 'alk',  label: 'Alkalinity',  unit: 'dKH',  defaultMin: 7.5, defaultMax: 9.0,  step: 0.1, color: '#4da6ff' },
  { key: 'ca',   label: 'Calcium',     unit: 'ppm',  defaultMin: 400, defaultMax: 450,   step: 1,   color: '#2dce89' },
  { key: 'mg',   label: 'Magnesium',   unit: 'ppm',  defaultMin: 1250, defaultMax: 1400, step: 5,   color: '#a855f7' },
  { key: 'sal',  label: 'Salinity',    unit: 'SG',   defaultMin: 1.023, defaultMax: 1.026, step: 0.001, color: '#06b6d4' },
  { key: 'ph',   label: 'pH',          unit: '',     defaultMin: 7.9, defaultMax: 8.4,   step: 0.01, color: '#f59e0b' },
  { key: 'temp', label: 'Temperature', unit: '°F',   defaultMin: 76, defaultMax: 80,     step: 0.1, color: '#f47c5e' },
  { key: 'no3',  label: 'Nitrate',     unit: 'ppm',  defaultMin: 0,  defaultMax: 10,     step: 0.1, color: '#ec4899' },
  { key: 'po4',  label: 'Phosphate',   unit: 'ppm',  defaultMin: 0,  defaultMax: 0.1,   step: 0.01, color: '#84cc16' },
];

// ============================================================
// MAINTENANCE TASK CATEGORIES & PRESETS
// ============================================================
const TASK_CATEGORIES = {
  water:     { label: 'Water Change', icon: 'waterChange' },
  dose:      { label: 'Dosing',       icon: 'beaker' },
  test:      { label: 'Test Water',   icon: 'dropletPlus' },
  clean:     { label: 'Cleaning',     icon: 'wrench' },
  topoff:    { label: 'Top-Off / ATO', icon: 'droplet' },
  filter:    { label: 'Filter / Media', icon: 'repeat' },
  other:     { label: 'Other',        icon: 'checkCircle' },
};
// Common reef-keeping routines users can add with one tap. Intervals are
// typical starting points the user can edit — ReefDeck does not prescribe a schedule.
const TASK_PRESETS = [
  { name: 'Water change',            category: 'water',  intervalDays: 7 },
  { name: 'Test full parameters',    category: 'test',   intervalDays: 7 },
  { name: 'Dose two-part (Alk/Ca)',  category: 'dose',   intervalDays: 1 },
  { name: 'Dose magnesium',          category: 'dose',   intervalDays: 7 },
  { name: 'Clean skimmer cup',       category: 'clean',  intervalDays: 7 },
  { name: 'Clean glass / scrape',    category: 'clean',  intervalDays: 3 },
  { name: 'Refill ATO reservoir',    category: 'topoff', intervalDays: 5 },
  { name: 'Replace filter floss',    category: 'filter', intervalDays: 4 },
  { name: 'Rinse / swap carbon-GFO', category: 'filter', intervalDays: 30 },
  { name: 'Clean pumps / powerheads',category: 'clean',  intervalDays: 60 },
  { name: 'Replace RODI filters',    category: 'filter', intervalDays: 180 },
  { name: 'Calibrate probes',        category: 'test',   intervalDays: 30 },
];

// ============================================================
// STORAGE
// ============================================================
const DB = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem('reefdeck_' + key)) ?? fallback; }
    catch(e) { return fallback; }
  },
  set(key, val) {
    try { localStorage.setItem('reefdeck_' + key, JSON.stringify(val)); } catch(e) {}
  },
  load() {
    return {
      tanks:       DB.get('tanks', []),
      logs:        DB.get('logs', []),
      inventory:   DB.get('inventory', []),
      journal:     DB.get('journal', []),
      thresholds:  DB.get('thresholds', {}),
      maintenance: DB.get('maintenance', []),
      prefs:       DB.get('prefs', { theme: 'dark', reminders: false, lastNotified: {} }),
      photos:      DB.get('photos', {}),
      corals:      DB.get('corals', []),
    };
  },
  save(data) {
    DB.set('tanks',       data.tanks);
    DB.set('logs',        data.logs);
    DB.set('inventory',   data.inventory);
    DB.set('journal',     data.journal);
    DB.set('thresholds',  data.thresholds);
    DB.set('maintenance', data.maintenance);
    DB.set('prefs',       data.prefs);
    DB.set('corals',      data.corals);
    // photos saved independently via saveLogPhoto(); skip here to avoid frequent large writes
  }
};

// ============================================================
// APP STATE
// ============================================================
let state = {
  activeTankId: null,
  activePanel: 'dashboard',
  chartParam: 'alk',
  chartRange: 30,
  chartOverlayParam: null,
  editingLogId: null,
  ...DB.load(),
};

function save() { DB.save(state); }

function getActiveTank() {
  return state.tanks.find(t => t.id === state.activeTankId) || state.tanks[0] || null;
}

function getThresholds(tankId) {
  if (!state.thresholds[tankId]) state.thresholds[tankId] = {};
  // Merge defaults for any missing params
  DEFAULT_PARAMS.forEach(p => {
    if (!state.thresholds[tankId][p.key]) {
      state.thresholds[tankId][p.key] = { min: p.defaultMin, max: p.defaultMax };
    }
  });
  return state.thresholds[tankId];
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ============================================================
// PHOTO STORE  (reefdeck_photos: {logId: dataUrl})
// ============================================================
function getPhotos() { return state.photos || (state.photos = {}); }

function saveLogPhoto(logId, dataUrl) {
  getPhotos()[logId] = dataUrl;
  DB.set('photos', state.photos);
}

function deleteLogPhoto(logId) {
  delete getPhotos()[logId];
  DB.set('photos', state.photos);
}

// Coral photos reuse the same reefdeck_photos store (dataURL by id).
function saveCoralPhoto(photoId, dataUrl) {
  getPhotos()[photoId] = dataUrl;
  DB.set('photos', state.photos);
}
function getCoralPhotoUrl(photoId) {
  return photoId ? (getPhotos()[photoId] || null) : null;
}

function openPhotoLightbox(dataUrl, caption) {
  if (!dataUrl) return;
  const overlay = document.getElementById('modal-overlay');
  const body = document.getElementById('modal-body');
  overlay.classList.add('open');
  // dataUrl is a base64 string — no HTML chars, safe to use directly in src
  const img = document.createElement('img');
  img.src = dataUrl;
  img.alt = caption || 'Log photo';
  img.style.cssText = 'max-width:100%;max-height:65vh;border-radius:10px;display:block;margin:0 auto;object-fit:contain';
  body.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.style.textAlign = 'center';
  wrap.appendChild(img);
  if (caption) {
    const cap = document.createElement('div');
    cap.style.cssText = 'margin-top:10px;color:var(--text-muted);font-size:0.85rem';
    cap.textContent = caption;
    wrap.appendChild(cap);
  }
  body.appendChild(wrap);
  const actions = document.createElement('div');
  actions.className = 'modal-actions';
  actions.style.cssText = 'margin-top:16px;justify-content:center';
  actions.innerHTML = '<button class="btn-modal-cancel" onclick="closeModal()">Close</button>';
  body.appendChild(actions);
}

// ============================================================
// DATE HELPERS (local-day based, no time component)
// ============================================================
// Local calendar date (YYYY-MM-DD). NOT toISOString() — that's UTC and lands a
// day behind for users in positive timezones logging late in the evening.
function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
// Local calendar date `daysAgo` days back — same local-day rule as todayStr(), for chart-range cutoffs.
function localCutoffStr(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function daysBetween(a, b) {
  // whole days from a -> b (b - a)
  const da = new Date(a + 'T12:00:00'), db = new Date(b + 'T12:00:00');
  return Math.round((db - da) / 86400000);
}

// ============================================================
// PREFERENCES / THEME
// ============================================================
function getPrefs() {
  if (!state.prefs) state.prefs = { theme: 'dark', reminders: false, lastNotified: {} };
  if (!state.prefs.lastNotified) state.prefs.lastNotified = {};
  if (!state.prefs.theme) state.prefs.theme = 'dark';
  return state.prefs;
}
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#eef4f8' : '#0e4f6e');
}

// ============================================================
// MAINTENANCE HELPERS
// ============================================================
function getMaintenance(tankId) {
  return state.maintenance.filter(m => m.tankId === tankId);
}
// A task's next-due date: lastDone + interval, or today if never done.
function taskNextDue(task) {
  if (!task.lastDone) return todayStr();
  return addDays(task.lastDone, task.intervalDays);
}
// status: 'overdue' | 'today' | 'soon' (<=3d) | 'upcoming' | 'disabled'
function taskStatus(task) {
  if (task.enabled === false) return 'disabled';
  const due = taskNextDue(task);
  const d = daysBetween(todayStr(), due); // <0 overdue, 0 today, >0 future
  if (d < 0) return 'overdue';
  if (d === 0) return 'today';
  if (d <= 3) return 'soon';
  return 'upcoming';
}
const STATUS_ORDER = { overdue: 0, today: 1, soon: 2, upcoming: 3, disabled: 4 };
function dueLabel(task) {
  if (task.enabled === false) return 'Paused';
  const due = taskNextDue(task);
  const d = daysBetween(todayStr(), due);
  if (d < 0)  return d === -1 ? '1 day overdue' : Math.abs(d) + ' days overdue';
  if (d === 0) return 'Due today';
  if (d === 1) return 'Due tomorrow';
  return 'Due in ' + d + ' days';
}
function markTaskDone(id) {
  const task = state.maintenance.find(m => m.id === id);
  if (!task) return;
  task.lastDone = todayStr();
  save();
  if (typeof syncPushSchedule === 'function') syncPushSchedule();
  showToast(task.name + ' marked done — next due ' + fmtDate(taskNextDue(task)) + '.');
  renderPanel(state.activePanel);
}

function snoozeTask(id) {
  const task = state.maintenance.find(m => m.id === id);
  if (!task) return;
  // Push the due date 1 day forward: newLastDone = currentDue + 1 - interval
  const newDue = addDays(taskNextDue(task), 1);
  task.lastDone = addDays(newDue, -task.intervalDays);
  save();
  if (typeof syncPushSchedule === 'function') syncPushSchedule();
  showToast(task.name + ' snoozed — due tomorrow.');
  renderPanel(state.activePanel);
}

// ============================================================
// TODAY VIEW
// ============================================================
function renderToday() {
  const tank = getActiveTank();
  const panelEl = document.getElementById('panel-today');
  if (!tank) { panelEl.innerHTML = renderEmptyState('No tank yet', 'Add your first tank to get started.', 'add-tank'); return; }

  const today = todayStr();
  const tasks = getMaintenance(tank.id).filter(t => t.enabled !== false);
  const overdueTasks = tasks
    .filter(t => taskStatus(t) === 'overdue')
    .sort((a, b) => daysBetween(today, taskNextDue(a)) - daysBetween(today, taskNextDue(b)));
  const dueTodayTasks = tasks.filter(t => taskStatus(t) === 'today');

  const todayLog = state.logs.find(l => l.tankId === tank.id && l.date === today);
  const loggedToday = todayLog && Object.keys(todayLog.params || {}).length > 0;

  const logStatusHtml = `
    <div class="today-log-status ${loggedToday ? 'ok' : 'pending'}">
      ${svgIcon(loggedToday ? 'checkCircle' : 'dropletPlus', 18)}
      <div class="today-log-text">
        <strong>${loggedToday ? "Today's parameters logged ✓" : "Today's parameters — not logged yet"}</strong>
        ${!loggedToday ? `<button onclick="setPanel('log')" style="margin-left:8px;background:none;border:none;color:var(--brand-bright);cursor:pointer;text-decoration:underline;font-size:0.82rem">Quick Log →</button>` : ''}
      </div>
    </div>`;

  const renderTodayRow = (t) => {
    const st = taskStatus(t);
    const cat = TASK_CATEGORIES[t.category] || TASK_CATEGORIES.other;
    return `
      <div class="sched-row ${st}">
        <span class="due-cat ${st}">${svgIcon(cat.icon, 17)}</span>
        <div class="sched-main">
          <div class="sched-name">${escHtml(t.name)}</div>
          <div class="sched-meta">${cat.label}&nbsp;·&nbsp;${t.lastDone ? 'last done ' + fmtDate(t.lastDone) : 'never logged'}</div>
        </div>
        <div class="sched-due ${st}">${dueLabel(t)}</div>
        <div class="sched-actions">
          <button class="btn-done" onclick="markTaskDone('${t.id}')" title="Mark done">${svgIcon('check', 15)} Done</button>
          <button class="btn-inv" onclick="snoozeTask('${t.id}')" title="Snooze 1 day">${svgIcon('repeat', 14)}</button>
        </div>
      </div>`;
  };

  const allClear = overdueTasks.length === 0 && dueTodayTasks.length === 0;

  const tasksHtml = allClear
    ? `<div class="today-empty">
        ${svgIcon('checkCircle', 40)}
        <div class="today-empty-title">All caught up for today ✓</div>
        <div class="today-empty-sub">No maintenance tasks overdue or due today.</div>
       </div>`
    : `${overdueTasks.length > 0 ? `
        <div class="sched-group">
          <div class="sched-group-label overdue">Overdue <span class="sched-count">${overdueTasks.length}</span></div>
          <div class="sched-list">${overdueTasks.map(renderTodayRow).join('')}</div>
        </div>` : ''}
      ${dueTodayTasks.length > 0 ? `
        <div class="sched-group">
          <div class="sched-group-label today">Due today <span class="sched-count">${dueTodayTasks.length}</span></div>
          <div class="sched-list">${dueTodayTasks.map(renderTodayRow).join('')}</div>
        </div>` : ''}`;

  panelEl.innerHTML = `
    ${logStatusHtml}
    ${tasksHtml}
    <p class="panel-foot-note">${svgIcon('info', 13)} "Due today" is calculated from the intervals you set — ReefDeck tracks timing, not husbandry.</p>
  `;
}

// ============================================================
// ONBOARDING: first-run demo data
// ============================================================
function seedDemoData() {
  if (state.tanks.length > 0) return;
  const tankId = uid();
  state.tanks = [{
    id: tankId, name: 'Main Display Tank', type: 'Mixed Reef',
    volume: 90, volumeUnit: 'gal', notes: 'SPS dominant, EcoTech MP40s', createdAt: new Date().toISOString()
  }];
  state.activeTankId = tankId;
  // Seed 14 days of parameter logs
  const now = Date.now();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now - i * 86400000);
    state.logs.push({
      id: uid(), tankId,
      date: d.toISOString().slice(0, 10),
      params: {
        alk:  +(8.0 + (Math.random() - 0.3) * 0.8).toFixed(2),
        ca:   Math.round(425 + (Math.random() - 0.5) * 30),
        mg:   Math.round(1310 + (Math.random() - 0.5) * 40),
        sal:  +(1.025 + (Math.random() - 0.5) * 0.001).toFixed(4),
        ph:   +(8.1 + (Math.random() - 0.5) * 0.3).toFixed(2),
        temp: +(78 + (Math.random() - 0.5) * 1.5).toFixed(1),
        no3:  +(2 + Math.random() * 3).toFixed(1),
        po4:  +(0.04 + Math.random() * 0.03).toFixed(3),
      },
      notes: i === 0 ? 'Water change day — 15 gal.' : '',
    });
  }
  // Seed inventory
  [
    { type: 'coral', name: 'Rainbow Montipora', notes: 'Back left, good PE', placedDate: '2026-01-15', price: 35 },
    { type: 'coral', name: 'Purple Tip Hammer', notes: 'Center rock, expanding', placedDate: '2026-02-03', price: 55 },
    { type: 'coral', name: 'OG Bounce Mushroom', notes: 'Isolated on rubble', placedDate: '2026-03-10', price: 120 },
    { type: 'fish',  name: 'Ocellaris Clownfish (pair)', notes: 'Hosted in hammer', placedDate: '2025-11-20', price: 40 },
    { type: 'fish',  name: 'Royal Gramma',      notes: 'Hides in cave, healthy', placedDate: '2025-12-01', price: 18 },
    { type: 'invert',name: 'Cleaner Shrimp',    notes: 'Active, molted last week', placedDate: '2026-01-05', price: 22 },
  ].forEach(item => {
    state.inventory.push({ id: uid(), tankId, ...item, photoDataUrl: null });
  });
  // Seed coral colonies (Phase 4 — per-colony growth tracker)
  // Observational entries only: dated notes + optional photoId. No advice.
  state.corals.push({
    id: uid(), tankId, name: 'Rainbow Montipora', species: 'Montipora spp.',
    source: 'LFS — ReefKoi', dateAdded: '2026-01-15', placement: 'Back left, high rock',
    photos: [], growth: [
      { id: uid(), date: '2026-02-15', note: 'First growth photo — encrusting base well.', photoId: null },
      { id: uid(), date: '2026-04-10', note: 'Color deepening, new branch starting.', photoId: null },
      { id: uid(), date: '2026-06-20', note: 'Good polyp extension in evenings.', photoId: null },
    ],
  });
  state.corals.push({
    id: uid(), tankId, name: 'Purple Tip Hammer', species: 'Euphyllia ancora',
    source: 'Local frag swap', dateAdded: '2026-02-03', placement: 'Center, mid-height',
    photos: [], growth: [
      { id: uid(), date: '2026-03-15', note: 'Tentacles extending fully at lights-on.', photoId: null },
      { id: uid(), date: '2026-05-22', note: 'Head split starting — two mouths visible.', photoId: null },
    ],
  });
  state.corals.push({
    id: uid(), tankId, name: 'OG Bounce Mushroom', species: 'Rhodactis sp.',
    source: 'ReefKoi', dateAdded: '2026-03-10', placement: 'Isolated on rubble island',
    photos: [], growth: [
      { id: uid(), date: '2026-04-18', note: 'Bubbles forming on first tentacle.', photoId: null },
    ],
  });
  // Seed journal
  [
    { date: '2026-06-20', text: 'Noticed a small patch of cyano on the sand bed near the powerhead shadow. Increased flow slightly and target-fed less. Will monitor.' },
    { date: '2026-06-15', text: '15 gallon water change with Red Sea Coral Pro salt. Mixed to 1.025. Parameters look stable.' },
    { date: '2026-06-10', text: 'Hammer coral retracted for 2 days — traced it to a clownfish harassing it. Moved the hammer to right side.' },
  ].forEach(j => state.journal.push({ id: uid(), tankId, ...j, tags: [] }));

  // Seed maintenance schedule — mix of overdue / due / upcoming for a live demo
  [
    { name: 'Water change',           category: 'water',  intervalDays: 7,  lastDone: addDays(todayStr(), -8) },  // overdue
    { name: 'Dose two-part (Alk/Ca)', category: 'dose',   intervalDays: 1,  lastDone: addDays(todayStr(), -1) },  // due today
    { name: 'Test full parameters',   category: 'test',   intervalDays: 7,  lastDone: addDays(todayStr(), -5) },  // soon (2d)
    { name: 'Clean skimmer cup',      category: 'clean',  intervalDays: 7,  lastDone: addDays(todayStr(), -2) },  // upcoming
    { name: 'Replace filter floss',   category: 'filter', intervalDays: 4,  lastDone: addDays(todayStr(), -4) },  // due today
    { name: 'Replace RODI filters',   category: 'filter', intervalDays: 180, lastDone: addDays(todayStr(), -120) }, // upcoming
  ].forEach(m => state.maintenance.push({ id: uid(), tankId, enabled: true, notes: '', ...m }));

  save();
}

// Opt-in: load the sample data set from the empty state (explore without committing real data).
function loadSampleData() {
  seedDemoData();
  renderTankSwitcher();
  setPanel('dashboard');
  showToast('Sample data loaded — clear it anytime in Export / Import → Delete All My Data.');
}

// ============================================================
// UI HELPERS
// ============================================================
function showToast(msg, type = 'success') {
  const c = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.innerHTML = svgIcon(type === 'success' ? 'check' : 'alert', 17) + '<span>' + msg + '</span>';
  c.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity 0.3s'; setTimeout(() => t.remove(), 350); }, 3000);
}

function fmtDate(d) {
  if (!d) return '';
  try {
    const dt = d.indexOf('T') !== -1 ? new Date(d) : new Date(d + 'T12:00:00');
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch(e) { return d; }
}

function fmtDateTime(d) {
  if (!d) return '';
  try {
    return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch(e) { return d; }
}

// ============================================================
// NAVIGATION
// ============================================================
function setPanel(name) {
  if (name !== 'log') state.editingLogId = null;
  state.activePanel = name;
  if (name === 'calculator') {
    const prefs = getPrefs();
    prefs.lastCalcVisit = Date.now();
    DB.set('prefs', prefs);
  }
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const panel = document.getElementById('panel-' + name);
  if (panel) panel.classList.add('active');
  const navItem = document.querySelector('.nav-item[data-panel="' + name + '"]');
  if (navItem) navItem.classList.add('active');
  // Update topbar title
  const titles = {
    dashboard:  ['dashboard', 'Dashboard'],
    today:      ['clock', 'Today'],
    log:        ['dropletPlus', 'Log Parameters'],
    history:    ['history', 'Parameter History'],
    charts:     ['chart', 'Trend Charts'],
    schedule:   ['calendar', 'Maintenance & Dosing'],
    calculator: ['calculator', 'Dose Calculator'],
    insights:   ['gauge', 'Insights'],
    inventory:  ['fish', 'Coral & Livestock'],
    corals:     ['coral', 'Coral Growth Tracker'],
    journal:    ['journal', 'Tank Journal'],
    thresholds: ['sliders', 'Threshold Settings'],
    settings:   ['sun', 'Settings'],
    export:               ['download', 'Export / Import'],
    'icp-import':         ['beaker', 'ICP Import'],
    'controller-import':  ['chip', 'Controller Import'],
    upgrade:              ['crown', 'ReefDeck Pro'],
    about:                ['info', 'About ReefDeck'],
  };
  const t = titles[name];
  document.getElementById('topbar-title').innerHTML = t ? svgIcon(t[0], 20) + ' ' + t[1] : 'ReefDeck';
  renderPanel(name);
  // Close sidebar on mobile
  if (window.innerWidth < 768) {
    document.querySelector('.sidebar').classList.remove('open');
  }
}

// ============================================================
// TANK SWITCHER
// ============================================================
function renderTankSwitcher() {
  const sel = document.getElementById('tank-select');
  sel.innerHTML = state.tanks.map(t =>
    `<option value="${t.id}" ${t.id === state.activeTankId ? 'selected' : ''}>${t.name}</option>`
  ).join('');
}

function promptAddTank() {
  openModal('add-tank');
}

function promptDeleteTank() {
  const tank = getActiveTank();
  if (!tank) return;
  const logCount = state.logs.filter(l => l.tankId === tank.id).length;
  if (!confirm('Delete tank "' + tank.name + '" and all its logs (' + logCount + '), inventory, corals, journal entries, maintenance tasks and thresholds? This cannot be undone.')) return;
  state.logs.filter(l => l.tankId === tank.id).forEach(l => deleteLogPhoto(l.id));
  getCorals().filter(c => c.tankId === tank.id).forEach(c => {
    (c.growth || []).forEach(e => { if (e.photoId) delete getPhotos()[e.photoId]; });
    (c.photos || []).forEach(pid => delete getPhotos()[pid]);
  });
  state.tanks = state.tanks.filter(t => t.id !== tank.id);
  state.logs = state.logs.filter(l => l.tankId !== tank.id);
  state.inventory = state.inventory.filter(i => i.tankId !== tank.id);
  state.corals = getCorals().filter(c => c.tankId !== tank.id);
  state.journal = state.journal.filter(j => j.tankId !== tank.id);
  state.maintenance = state.maintenance.filter(m => m.tankId !== tank.id);
  delete state.thresholds[tank.id];
  state.activeTankId = state.tanks.length ? state.tanks[0].id : null;
  save();
  renderTankSwitcher();
  setPanel('dashboard');
  showToast('Tank "' + tank.name + '" deleted.');
}

// ============================================================
// PANEL ROUTER
// ============================================================
function renderPanel(name) {
  switch(name) {
    case 'dashboard':  renderDashboard(); break;
    case 'today':      renderToday(); break;
    case 'log':        renderLogForm(); break;
    case 'history':    renderHistory(); break;
    case 'charts':     renderCharts(); break;
    case 'schedule':   renderSchedule(); break;
    case 'calculator': renderCalculator(); break;
    case 'inventory':  renderInventory(); break;
    case 'corals':     renderCorals(); break;
    case 'journal':    renderJournal(); break;
    case 'thresholds': renderThresholds(); break;
    case 'insights':   renderInsights(); break;
    case 'settings':   renderSettings(); break;
    case 'export':             renderExport(); break;
    case 'icp-import':         renderICPImport(); break;
    case 'controller-import':  renderControllerImport(); break;
    case 'upgrade':            renderUpgrade(); break;
    case 'about':       break; // static
  }
}

// ============================================================
// DASHBOARD
// ============================================================
function renderDashboard() {
  const tank = getActiveTank();
  if (!tank) { document.getElementById('panel-dashboard').innerHTML = renderEmptyState('No tank yet', 'Add your first tank to get started.', 'add-tank', null, '<button class="btn-inv" onclick="loadSampleData()" style="margin-top:12px;font-size:0.83rem">Or load sample data to explore</button>'); return; }

  const tankLogs = state.logs.filter(l => l.tankId === tank.id).sort((a,b) => a.date > b.date ? 1 : -1);
  const latest = tankLogs[tankLogs.length - 1];
  const thresholds = getThresholds(tank.id);

  // Build alerts
  let alerts = [];
  if (latest) {
    DEFAULT_PARAMS.forEach(p => {
      const v = latest.params[p.key];
      if (v == null) return;
      const t = thresholds[p.key];
      if (t && t.min != null && v < t.min) alerts.push({ param: p, value: v, type: 'low', threshold: t.min });
      if (t && t.max != null && v > t.max) alerts.push({ param: p, value: v, type: 'high', threshold: t.max });
    });
  }

  const alertsHtml = alerts.length > 0 ? `
    <div class="card">
      <div class="card-title">${svgIcon('alert', 15)} Outside Your Ranges</div>
      <div class="alerts-summary">
        ${alerts.map(a => `
          <div class="alert-item ${a.type === 'low' ? 'warn' : 'out'}">
            ${svgIcon('alert', 16)}
            <div><strong>${a.param.label}</strong> — ${a.value} ${a.param.unit} is ${a.type === 'low' ? 'below' : 'above'} your range (${a.type === 'low' ? 'min: ' + a.threshold : 'max: ' + a.threshold}).
            This is not advice — it's the range you set. You decide what to do.</div>
          </div>
        `).join('')}
      </div>
    </div>
  ` : '';

  // Overall safe-range status chip (factual, based on the user's own ranges)
  const reportedCount = latest ? DEFAULT_PARAMS.filter(p => latest.params[p.key] != null).length : 0;
  let statusChip;
  if (!latest || reportedCount === 0) {
    statusChip = `<span class="status-chip neutral">${svgIcon('flat', 13)} No readings yet</span>`;
  } else if (alerts.length === 0) {
    statusChip = `<span class="status-chip ok">${svgIcon('checkCircle', 14)} All ${reportedCount} readings in your ranges</span>`;
  } else {
    statusChip = `<span class="status-chip out">${svgIcon('alert', 13)} ${alerts.length} outside your range${alerts.length > 1 ? 's' : ''}</span>`;
  }

  // Today card — overdue + due today, log status, links to Today panel
  const tasks = getMaintenance(tank.id).filter(t => t.enabled !== false);
  const dueTodayTasks = tasks
    .filter(t => ['overdue', 'today'].includes(taskStatus(t)))
    .sort((a, b) => daysBetween(todayStr(), taskNextDue(a)) - daysBetween(todayStr(), taskNextDue(b)));
  const overdueN = tasks.filter(t => taskStatus(t) === 'overdue').length;
  const todayLogEntry = state.logs.find(l => l.tankId === tank.id && l.date === todayStr());
  const loggedToday = todayLogEntry && Object.keys(todayLogEntry.params || {}).length > 0;
  const logStatusRow = `
    <div class="today-log-status ${loggedToday ? 'ok' : 'pending'}">
      ${svgIcon(loggedToday ? 'checkCircle' : 'dropletPlus', 16)}
      <div class="today-log-text">
        <strong>${loggedToday ? "Today's parameters logged ✓" : "Today's parameters — not logged yet"}</strong>
        ${!loggedToday ? `<button onclick="setPanel('log')" style="margin-left:6px;background:none;border:none;color:var(--brand-bright);cursor:pointer;text-decoration:underline;font-size:0.8rem">Quick Log →</button>` : ''}
      </div>
    </div>`;
  const upNextHtml = `
    <div class="card">
      <div class="card-title" style="justify-content:space-between">
        <span style="display:inline-flex;align-items:center;gap:8px">${svgIcon('clock', 15)} Today${overdueN ? ` <span class="status-chip out" style="margin-left:4px">${overdueN} overdue</span>` : ''}</span>
        <button class="quick-action-btn" style="padding:5px 11px;font-size:0.74rem" onclick="setPanel('today')">Open Today ${svgIcon('arrowRight', 13)}</button>
      </div>
      ${logStatusRow}
      ${dueTodayTasks.length === 0
        ? `<p style="color:var(--text-dim);font-size:0.85rem;padding:6px 0;margin-top:8px">No tasks overdue or due today.${tasks.length === 0 ? ' <button onclick="setPanel(\'schedule\')" style="background:none;border:none;color:var(--brand-bright);cursor:pointer;text-decoration:underline;font-size:0.85rem">Set up a schedule →</button>' : ''}</p>`
        : `<div class="due-list" style="margin-top:10px">${dueTodayTasks.slice(0, 5).map(t => {
            const st = taskStatus(t);
            const cat = TASK_CATEGORIES[t.category] || TASK_CATEGORIES.other;
            return `<div class="due-row">
              <span class="due-cat ${st}">${svgIcon(cat.icon, 16)}</span>
              <div class="due-main"><div class="due-name">${escHtml(t.name)}</div><div class="due-when ${st}">${dueLabel(t)}</div></div>
              <div class="sched-actions">
                <button class="btn-done" onclick="markTaskDone('${t.id}')" title="Mark done">${svgIcon('check', 15)} Done</button>
                <button class="btn-inv" onclick="snoozeTask('${t.id}')" title="Snooze 1 day">${svgIcon('repeat', 14)}</button>
              </div>
            </div>`;
          }).join('')}</div>`}
    </div>`;

  // Parameter tiles — status dot, trend delta vs previous reading, sparkline
  const paramTilesHtml = DEFAULT_PARAMS.map(p => {
    const v = latest ? latest.params[p.key] : null;
    const t = thresholds[p.key];
    let statusClass = '';
    if (v != null && t) {
      statusClass = ((t.min != null && v < t.min) || (t.max != null && v > t.max)) ? 'out' : 'ok';
    }
    // previous non-null value for delta
    let prev = null;
    for (let i = tankLogs.length - 2; i >= 0; i--) {
      if (tankLogs[i].params[p.key] != null) { prev = tankLogs[i].params[p.key]; break; }
    }
    let deltaHtml = `<span class="tile-delta flat">${svgIcon('flat', 12)}</span>`;
    if (v != null && prev != null) {
      const d = v - prev, ad = Math.abs(d);
      const ds = ad >= 100 ? ad.toFixed(0) : ad >= 1 ? ad.toFixed(1) : ad.toFixed(p.step < 0.01 ? 3 : 2);
      if (d > 0)      deltaHtml = `<span class="tile-delta up">${svgIcon('caretUp', 12)}${ds}</span>`;
      else if (d < 0) deltaHtml = `<span class="tile-delta down">${svgIcon('caretDown', 12)}${ds}</span>`;
      else            deltaHtml = `<span class="tile-delta flat">${svgIcon('flat', 12)}0</span>`;
    }
    return `
      <div class="param-tile ${statusClass ? 'alert-' + statusClass : ''}" tabindex="0" onclick="goToChart('${p.key}', 30)" title="Click to view ${p.label} trend (last 30 days)">
        <div class="tile-head">
          <span class="param-tile-name">${p.label}</span>
          <span class="tile-dot ${statusClass}"></span>
        </div>
        <div class="tile-value-row">
          <span class="param-tile-val ${statusClass}">${v != null ? v : '—'}</span>
          <span class="param-tile-unit">${p.unit}</span>
        </div>
        <div class="tile-foot">
          ${deltaHtml}
          <canvas class="tile-spark" id="spark-${p.key}"></canvas>
        </div>
      </div>
    `;
  }).join('');

  // Recent photos strip (last 3 log entries with photos, most recent first)
  const allPhotos = getPhotos();
  const recentPhotoLogs = state.logs
    .filter(l => l.tankId === tank.id && allPhotos[l.id])
    .sort((a, b) => a.date > b.date ? -1 : 1)
    .slice(0, 3);
  const recentPhotosHtml = recentPhotoLogs.length > 0 ? `
    <div class="card">
      <div class="card-title">${svgIcon('camera', 15)} Recent Photos</div>
      <div class="recent-photos-strip" id="recent-photos-strip"></div>
      <div style="margin-top:10px"><button class="quick-action-btn" onclick="setPanel('history')" style="font-size:0.8rem">View All Logs ${svgIcon('arrowRight', 14)}</button></div>
    </div>` : '';

  // Recent journal
  const recentJournal = state.journal.filter(j => j.tankId === tank.id).sort((a,b) => a.date > b.date ? -1 : 1).slice(0, 3);
  const journalHtml = recentJournal.length > 0 ? recentJournal.map(j => `
    <div class="journal-entry">
      <div class="journal-dot"></div>
      <div><div class="journal-date">${fmtDate(j.date)}</div><div class="journal-text">${escHtml(j.text)}</div></div>
    </div>
  `).join('') : '<p style="color:var(--text-dim);font-size:0.85rem;padding:8px 0">No journal entries yet.</p>';

  const safeBannerDismissed = DB.get('safeBannerDismissed', false);
  const safeBannerHtml = safeBannerDismissed ? '' : `
    <div class="safety-banner" id="safety-banner">
      ${svgIcon('lock', 16)}
      <span class="safety-banner-text">Your logbook is stored on this device — your readings never leave it.
        <button onclick="setPanel('export')" style="background:none;border:none;cursor:pointer;padding:0;font-size:inherit">Export anytime</button>
        &nbsp;·&nbsp; <a href="/legal/privacy.html" target="_blank">Privacy policy</a>
      </span>
      <button class="safety-banner-dismiss" onclick="dismissSafetyBanner()" aria-label="Dismiss">&times;</button>
    </div>`;

  const lastExportTs = DB.get('lastExport', null);
  const exportAgo = lastExportTs
    ? (() => { const d = Math.floor((Date.now() - new Date(lastExportTs).getTime()) / 86400000); return d === 0 ? 'today' : d === 1 ? '1 day ago' : d + ' days ago'; })()
    : null;
  const backupReminderHtml = `
    <div class="backup-reminder ${lastExportTs ? 'ok' : 'warn'}" onclick="setPanel('export')" title="Go to Export / Import">
      ${svgIcon(lastExportTs ? 'download' : 'alert', 14)}
      <span>${lastExportTs ? 'Last exported: ' + exportAgo : 'Never backed up ⚠️'}</span>
      ${svgIcon('arrowRight', 13)}
    </div>`;

  document.getElementById('panel-dashboard').innerHTML = `
    <div class="dashboard-header">
      <div>
        <h1>${svgIcon('fish', 24)} ${escHtml(tank.name)}</h1>
        <div class="last-logged">${tank.type || ''} &nbsp;·&nbsp; ${tank.volume ? tank.volume + ' ' + (tank.volumeUnit || 'gal') : ''} &nbsp;·&nbsp; Last log: ${latest ? fmtDate(latest.date) : 'Never'}</div>
      </div>
      <div class="dashboard-status">${statusChip}</div>
    </div>
    ${safeBannerHtml}
    ${alertsHtml}
    ${upNextHtml}
    <div class="card">
      <div class="card-title">Latest Readings</div>
      <div class="params-grid">${paramTilesHtml}</div>
      <div class="quick-actions">
        <button class="quick-action-btn" onclick="setPanel('log')">${svgIcon('dropletPlus', 17)} Log Parameters</button>
        <button class="quick-action-btn" onclick="setPanel('calculator')">${svgIcon('calculator', 17)} Dose Calculator</button>
        <button class="quick-action-btn" onclick="setPanel('inventory')">${svgIcon('fish', 17)} Livestock</button>
        <button class="quick-action-btn" onclick="setPanel('corals')">${svgIcon('coral', 17)} Coral Tracker</button>
        <button class="quick-action-btn" onclick="setPanel('schedule')">${svgIcon('calendar', 17)} Maintenance</button>
        <button class="quick-action-btn" onclick="setPanel('charts')">${svgIcon('chart', 17)} View Trends</button>
      </div>
    </div>
    ${recentPhotosHtml}
    <div class="card">
      <div class="card-title">${svgIcon('journal', 15)} Recent Journal</div>
      ${journalHtml}
      <div style="margin-top:12px"><button class="quick-action-btn" onclick="setPanel('journal')" style="font-size:0.8rem">View All Journal Entries ${svgIcon('arrowRight', 14)}</button></div>
    </div>
    <div class="card">
      <div class="card-title">Tank Stats</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:16px">
        <div><div class="param-tile-name">Total Logs</div><div class="stat-num">${tankLogs.length}</div></div>
        <div><div class="param-tile-name">Coral/Livestock</div><div class="stat-num">${state.inventory.filter(i=>i.tankId===tank.id).length}</div></div>
        <div><div class="param-tile-name">Coral Colonies</div><div class="stat-num">${getCorals().filter(c=>c.tankId===tank.id).length}</div></div>
        <div><div class="param-tile-name">Journal Entries</div><div class="stat-num">${state.journal.filter(j=>j.tankId===tank.id).length}</div></div>
        <div><div class="param-tile-name">Logbook Since</div><div class="stat-num" style="font-size:1.05rem">${fmtDate(tank.createdAt)}</div></div>
      </div>
      <div style="margin-top:14px">${backupReminderHtml}</div>
    </div>
  `;

  // Draw tile sparklines (last ~12 readings per parameter)
  setTimeout(() => {
    DEFAULT_PARAMS.forEach(p => {
      const c = document.getElementById('spark-' + p.key);
      if (!c) return;
      const sd = tankLogs.filter(l => l.params[p.key] != null).slice(-12).map(l => ({ date: l.date, value: l.params[p.key] }));
      if (sd.length >= 2) window.ReefCharts.drawSparkline(c, sd, p.color);
    });
    // Populate recent photos strip via DOM (avoids base64 in innerHTML)
    const strip = document.getElementById('recent-photos-strip');
    if (strip && recentPhotoLogs.length > 0) {
      recentPhotoLogs.forEach(function(l) {
        const btn = document.createElement('button');
        btn.className = 'recent-photos-thumb';
        btn.title = fmtDate(l.date);
        btn.onclick = function() { openHistoryPhoto(l.id); };
        const img = document.createElement('img');
        img.src = allPhotos[l.id];
        img.alt = fmtDate(l.date);
        const dateSpan = document.createElement('span');
        dateSpan.className = 'recent-photos-date';
        dateSpan.textContent = fmtDate(l.date);
        btn.appendChild(img);
        btn.appendChild(dateSpan);
        strip.appendChild(btn);
      });
    }
  }, 0);
}

function dismissSafetyBanner() {
  DB.set('safeBannerDismissed', true);
  const el = document.getElementById('safety-banner');
  if (el) el.remove();
}

// ============================================================
// LOG FORM
// ============================================================
// ============================================================
// QUICK LOG — sub-5-second one-param entry (the moat)
// Tap a parameter chip -> big numpad -> save. Merges into today's
// entry so several quick-logs collapse to one dated test.
// ============================================================
let qlBuffer = '';      // current numpad input as a string
let qlKey_ = null;      // param key being edited
let _qlCurrentPhotoDataUrl = null;  // photo attached to today's log (for DOM population)
let _qlCurrentLogId = '';           // today's log id
let _qlCalcNudge = null;            // set after quick-logging Alk/Ca/Mg when calc not visited in 24h

// Order params by what the user actually tests: most-recently-logged first.
function quickParamOrder(tank) {
  const logs = state.logs.filter(l => l.tankId === tank.id).sort((a,b) => a.date > b.date ? -1 : 1);
  const seen = [];
  for (const log of logs) {
    for (const k of Object.keys(log.params || {})) {
      if (!seen.includes(k)) seen.push(k);
    }
  }
  DEFAULT_PARAMS.forEach(p => { if (!seen.includes(p.key)) seen.push(p.key); });
  return seen.map(k => DEFAULT_PARAMS.find(p => p.key === k)).filter(Boolean);
}

// Most recent logged value for a param on this tank (for prefill + chip subtitle).
function lastValueFor(tank, key) {
  const logs = state.logs.filter(l => l.tankId === tank.id).sort((a,b) => a.date > b.date ? -1 : 1);
  for (const log of logs) {
    if (log.params && log.params[key] != null) return log.params[key];
  }
  return null;
}

function renderQuickLogCard(tank) {
  const order = quickParamOrder(tank);
  const today = todayStr();
  const todayLog = state.logs.find(l => l.tankId === tank.id && l.date === today);
  const chips = order.map(p => {
    const loggedToday = todayLog && todayLog.params[p.key] != null;
    const last = lastValueFor(tank, p.key);
    const sub = loggedToday
      ? `<span style="color:var(--accent-green);font-weight:700">${todayLog.params[p.key]} ${p.unit} ✓</span>`
      : (last != null ? `<span style="color:var(--text-dim)">last ${last} ${p.unit}</span>` : `<span style="color:var(--text-dim)">tap to log</span>`);
    return `<button class="ql-chip" onclick="openNumpad('${p.key}')"
        style="display:flex;flex-direction:column;align-items:flex-start;gap:2px;padding:11px 14px;border-radius:12px;border:1px solid ${loggedToday ? 'var(--accent-green)' : 'var(--border)'};background:${loggedToday ? 'rgba(45,206,137,0.08)' : 'var(--surface-2)'};cursor:pointer;text-align:left;min-width:118px;transition:transform .08s">
        <span style="font-weight:700;color:var(--text-primary);font-size:0.92rem">${p.label}</span>
        <span style="font-size:0.74rem">${sub}</span>
      </button>`;
  }).join('');

  // Photo attach for today's log — store in module-level vars for DOM population in renderLogForm
  _qlCurrentPhotoDataUrl = todayLog ? (getPhotos()[todayLog.id] || null) : null;
  _qlCurrentLogId = todayLog ? todayLog.id : '';
  const qlHasPhoto = !!_qlCurrentPhotoDataUrl;

  return `
    <div class="card" style="margin-bottom:16px">
      <div class="card-title" style="display:flex;align-items:center;flex-wrap:wrap;gap:8px">${svgIcon('dropletPlus', 18)} Quick Log <span style="font-size:0.7rem;font-weight:600;letter-spacing:0.3px;color:var(--brand-bright);background:rgba(70,214,230,0.1);padding:3px 9px;border-radius:20px;white-space:nowrap">FASTEST ENTRY</span></div>
      <p style="color:var(--text-muted);font-size:0.82rem;margin:-4px 0 12px">Tap a parameter, type the value, done. Several taps roll into one test for today.</p>
      <div style="display:flex;flex-wrap:wrap;gap:9px">${chips}</div>
      <div class="photo-attach-row" style="margin-top:14px">
        <button class="ql-photo-btn" onclick="qlAttachPhoto()">${svgIcon('camera', 16)}&nbsp;Attach photo</button>
        ${qlHasPhoto ? `<span style="font-size:0.78rem;color:var(--text-muted)">Photo attached ✓</span><span id="ql-photo-thumb-wrap"></span>` : ''}
        <input type="file" id="ql-photo-input" accept="image/*" capture="environment" style="display:none" onchange="qlPhotoSelected(this)">
      </div>
    </div>`;
}

// Open the big numpad for one parameter, prefilled with the last value.
function openNumpad(key) {
  const tank = getActiveTank();
  if (!tank) return;
  const p = DEFAULT_PARAMS.find(x => x.key === key);
  if (!p) return;
  qlKey_ = key;
  const today = todayStr();
  const todayLog = state.logs.find(l => l.tankId === tank.id && l.date === today);
  const prefill = (todayLog && todayLog.params[key] != null) ? todayLog.params[key] : lastValueFor(tank, key);
  qlBuffer = prefill != null ? String(prefill) : '';

  const overlay = document.getElementById('modal-overlay');
  const body = document.getElementById('modal-body');
  overlay.classList.add('open');
  const keyBtn = (label, onclick, extra = '') =>
    `<button class="ql-key" onclick="${onclick}" style="font-size:1.45rem;font-weight:600;padding:16px 0;border-radius:12px;border:1px solid var(--border);background:var(--surface-2);color:var(--text-primary);cursor:pointer;${extra}">${label}</button>`;
  body.innerHTML = `
    <div class="modal-title">${svgIcon('dropletPlus', 19)} ${p.label} <span style="color:var(--text-dim);font-weight:500;font-size:0.85rem">${p.unit}</span></div>
    <div id="ql-display" style="font-size:2.6rem;font-weight:800;text-align:center;padding:14px 0;letter-spacing:1px;color:var(--text-primary);font-variant-numeric:tabular-nums;min-height:54px">${qlBuffer || '<span style="color:var(--text-dim)">0</span>'}</div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:9px">
      ${['7','8','9','4','5','6','1','2','3'].map(n => keyBtn(n, `qlPress('${n}')`)).join('')}
      ${keyBtn('.', `qlPress('.')`)}
      ${keyBtn('0', `qlPress('0')`)}
      ${keyBtn('⌫', 'qlBack()')}
    </div>
    <div class="modal-actions" style="margin-top:14px">
      <button class="btn-modal-cancel" onclick="closeModal()">Cancel</button>
      <button class="btn-modal-save" onclick="qlSave()">Save ${p.label}</button>
    </div>`;
}

function qlRefreshDisplay() {
  const d = document.getElementById('ql-display');
  if (d) d.innerHTML = qlBuffer || '<span style="color:var(--text-dim)">0</span>';
}
function qlPress(ch) {
  if (ch === '.' && qlBuffer.includes('.')) return;
  if (qlBuffer.length >= 9) return;
  qlBuffer += ch;
  qlRefreshDisplay();
}
function qlBack() { qlBuffer = qlBuffer.slice(0, -1); qlRefreshDisplay(); }

// Save one quick-logged value, merging into today's entry for the tank.
function qlSave() {
  const tank = getActiveTank();
  if (!tank || !qlKey_) return;
  if (qlBuffer === '' || qlBuffer === '.') { showToast('Enter a value first.', 'error'); return; }
  const val = parseFloat(qlBuffer);
  if (isNaN(val)) { showToast('That\'s not a number.', 'error'); return; }
  const p = DEFAULT_PARAMS.find(x => x.key === qlKey_);
  const today = todayStr();
  let log = state.logs.find(l => l.tankId === tank.id && l.date === today);
  if (!log) { log = { id: uid(), tankId: tank.id, date: today, params: {}, notes: '' }; state.logs.push(log); }
  log.params[qlKey_] = val;
  save();
  closeModal();
  showToast(`${p.label} saved: ${val} ${p.unit}`);
  const CALC_QL_KEYS = ['alk', 'ca', 'mg'];
  if (CALC_QL_KEYS.includes(qlKey_)) {
    const prefs_ = getPrefs();
    if (Date.now() - (prefs_.lastCalcVisit || 0) > 86400000) {
      _qlCalcNudge = { paramLabel: p.label };
    }
  }
  renderLogForm();
}

function qlAttachPhoto() {
  const input = document.getElementById('ql-photo-input');
  if (input) input.click();
}

function qlPhotoSelected(input) {
  const file = input.files[0];
  if (!file) return;
  const tank = getActiveTank();
  if (!tank) return;
  const today = todayStr();
  let log = state.logs.find(function(l) { return l.tankId === tank.id && l.date === today; });
  if (!log) {
    log = { id: uid(), tankId: tank.id, date: today, params: {}, notes: '' };
    state.logs.push(log);
    save();
  }
  const reader = new FileReader();
  reader.onload = function(e) {
    saveLogPhoto(log.id, e.target.result);
    showToast('Photo attached to today\'s log.');
    renderLogForm();
  };
  reader.readAsDataURL(file);
  input.value = '';
}

let _pendingPhotoDataUrl = null;

function renderLogForm() {
  const tank = getActiveTank();
  if (!tank) { document.getElementById('panel-log').innerHTML = renderEmptyState('No tank', 'Add a tank first.'); return; }
  const today = todayStr();
  let editingLog = state.editingLogId ? state.logs.find(l => l.id === state.editingLogId) : null;
  if (state.editingLogId && !editingLog) state.editingLogId = null;

  const paramFields = DEFAULT_PARAMS.map(p => {
    const v = editingLog && editingLog.params[p.key] != null ? editingLog.params[p.key] : '';
    return `
    <div class="form-field">
      <label class="form-label">${p.label} <span style="color:var(--text-dim)">${p.unit}</span></label>
      <input class="form-input" type="number" id="log-${p.key}" name="${p.key}" placeholder="${p.defaultMin}" step="${p.step}" value="${v}" />
    </div>
  `;
  }).join('');

  const calcNudgeHtml = _qlCalcNudge
    ? `<div class="ql-calc-nudge">${svgIcon('calculator', 13)} Want to calculate a dose based on this ${escHtml(_qlCalcNudge.paramLabel)} reading? <button onclick="setPanel('calculator')" style="background:none;border:none;color:var(--brand-bright);cursor:pointer;text-decoration:underline;font-size:inherit;padding:0">Open Calculator →</button></div>`
    : '';
  _qlCalcNudge = null;
  document.getElementById('panel-log').innerHTML = `
    ${renderQuickLogCard(tank)}
    ${calcNudgeHtml}
    <div class="card">
      <div class="card-title">${editingLog ? 'Editing Log Entry — ' + fmtDate(editingLog.date) : 'Full Test Entry — ' + escHtml(tank.name)}</div>
      <p style="color:var(--text-muted);font-size:0.82rem;margin:-4px 0 14px">${editingLog ? 'Update the values below and save, or cancel to leave this entry unchanged.' : 'Entering a whole test at once? Fill the grid below. For a single value, use Quick Log above.'}</p>
      <div class="log-form">
        <div class="form-field" style="margin-bottom:16px;max-width:240px">
          <label class="form-label">Date</label>
          <input class="form-input" type="date" id="log-date" value="${editingLog ? editingLog.date : today}" />
        </div>
        <div class="form-grid">${paramFields}</div>
        <div class="form-field" style="margin-bottom:16px">
          <label class="form-label">Notes (optional)</label>
          <textarea class="journal-textarea" id="log-notes" placeholder="Water change, test kit used, anything worth recording..." style="min-height:70px">${editingLog ? escHtml(editingLog.notes || '') : ''}</textarea>
        </div>
        <div class="form-field" style="margin-bottom:20px">
          <label class="form-label">Test kit photo (optional)</label>
          <div class="photo-attach-row">
            <button type="button" class="ql-photo-btn" onclick="logFormAttachPhoto()">${svgIcon('camera', 16)}&nbsp;Attach photo</button>
            <input type="file" id="log-photo-input" accept="image/*" capture="environment" style="display:none" onchange="logFormPhotoSelected(this)">
          </div>
          <div id="log-photo-preview"></div>
        </div>
        <button class="btn-primary-sm" onclick="submitLog()" style="padding:12px 32px;font-size:1rem">${editingLog ? 'Update Log Entry' : 'Save Log Entry'}</button>
        ${editingLog ? `<button class="btn-modal-cancel" onclick="state.editingLogId=null;renderLogForm()" style="padding:12px 20px;font-size:1rem;margin-left:8px">Cancel Edit</button>` : ''}
      </div>
    </div>
    <div class="card" style="background:var(--surface-2);margin-top:16px">
      <div class="card-title">Your Current Thresholds</div>
      <p style="color:var(--text-muted);font-size:0.82rem;margin-bottom:12px">Values outside these ranges will be flagged on the dashboard. <button onclick="setPanel('thresholds')" style="background:none;border:none;color:var(--ocean-light);cursor:pointer;font-size:0.82rem;text-decoration:underline">Edit thresholds →</button></p>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px">
        ${DEFAULT_PARAMS.map(p => {
          const t = getThresholds(tank.id)[p.key] || {};
          return `<div style="font-size:0.8rem;color:var(--text-muted);padding:6px 0;border-bottom:1px solid var(--border)">
            <span style="color:var(--text-primary);font-weight:600">${p.label}</span> — ${t.min ?? '—'} to ${t.max ?? '—'} ${p.unit}
          </div>`;
        }).join('')}
      </div>
    </div>
  `;

  // Populate QL photo thumbnail via DOM (avoids base64 in innerHTML)
  if (_qlCurrentPhotoDataUrl) {
    setTimeout(function() {
      const wrap = document.getElementById('ql-photo-thumb-wrap');
      if (!wrap) return;
      const btn = document.createElement('button');
      btn.className = 'photo-thumb-btn';
      btn.title = 'View attached photo';
      const capturedLogId = _qlCurrentLogId;
      btn.onclick = function() { openHistoryPhoto(capturedLogId); };
      btn.innerHTML = svgIcon('camera', 15) + '&nbsp;';
      const img = document.createElement('img');
      img.src = _qlCurrentPhotoDataUrl;
      img.className = 'photo-thumb-inline';
      img.alt = 'log photo';
      btn.appendChild(img);
      wrap.appendChild(btn);
    }, 0);
  }
}

function logFormAttachPhoto() {
  _pendingPhotoDataUrl = null;
  const input = document.getElementById('log-photo-input');
  if (input) input.click();
}

function logFormPhotoSelected(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    _pendingPhotoDataUrl = e.target.result;
    const preview = document.getElementById('log-photo-preview');
    if (preview) {
      preview.innerHTML = `<div class="photo-preview-wrap" style="margin-top:8px">
        <img src="${escHtml(_pendingPhotoDataUrl)}" class="photo-thumb-lg" alt="Test kit photo" onclick="openPhotoLightbox(_pendingPhotoDataUrl,'Test kit photo')">
        <button class="photo-remove-btn" onclick="_pendingPhotoDataUrl=null;document.getElementById('log-photo-preview').innerHTML=''" title="Remove photo">&times;</button>
      </div>`;
    }
  };
  reader.readAsDataURL(file);
  input.value = '';
}

function submitLog() {
  const tank = getActiveTank();
  if (!tank) return;
  const date = document.getElementById('log-date').value;
  if (!date) { showToast('Please select a date.', 'error'); return; }
  const params = {};
  let hasAny = false;
  DEFAULT_PARAMS.forEach(p => {
    const val = document.getElementById('log-' + p.key).value;
    if (val !== '') { params[p.key] = parseFloat(val); hasAny = true; }
  });
  if (!hasAny) { showToast('Enter at least one parameter value.', 'error'); return; }
  const notes = document.getElementById('log-notes').value.trim();
  const editId = state.editingLogId;
  let log = editId
    ? state.logs.find(l => l.id === editId)
    : state.logs.find(l => l.tankId === tank.id && l.date === date);
  if (log) {
    log.date = date;
    if (editId) {
      log.params = params;
      log.notes = notes;
    } else {
      Object.assign(log.params, params);
      if (notes) log.notes = notes;
    }
  } else {
    log = { id: uid(), tankId: tank.id, date, params, notes };
    state.logs.push(log);
  }
  if (_pendingPhotoDataUrl) {
    saveLogPhoto(log.id, _pendingPhotoDataUrl);
    _pendingPhotoDataUrl = null;
  }
  state.editingLogId = null;
  save();
  showToast(editId ? 'Log entry updated!' : 'Log entry saved!');
  setPanel('dashboard');
}

function startEditLog(id) {
  const log = state.logs.find(l => l.id === id);
  if (!log) return;
  state.editingLogId = id;
  setPanel('log');
}

// ============================================================
// HISTORY
// ============================================================
function renderHistory() {
  const tank = getActiveTank();
  if (!tank) { document.getElementById('panel-history').innerHTML = renderEmptyState('No tank', 'Add a tank first.'); return; }
  const tankLogs = state.logs.filter(l => l.tankId === tank.id).sort((a,b) => a.date > b.date ? -1 : 1);
  const thresholds = getThresholds(tank.id);

  if (tankLogs.length === 0) {
    document.getElementById('panel-history').innerHTML = renderEmptyState('No logs yet', 'Log your first water parameter test to start your history.', null, () => setPanel('log'));
    return;
  }

  const photos = getPhotos();
  const rows = tankLogs.map(log => {
    const cells = DEFAULT_PARAMS.map(p => {
      const v = log.params[p.key];
      if (v == null) return '<td>—</td>';
      const t = thresholds[p.key] || {};
      let cls = '';
      if (t.min != null && v < t.min) cls = 'val-warn';
      else if (t.max != null && v > t.max) cls = 'val-out';
      else cls = 'val-ok';
      return `<td class="${cls}">${v}</td>`;
    }).join('');
    const photoDataUrl = photos[log.id];
    const photoCell = photoDataUrl
      ? `<td><button class="btn-photo-icon" onclick="openHistoryPhoto('${escHtml(log.id)}')" title="View attached photo">${svgIcon('camera', 16)}</button></td>`
      : '<td></td>';
    return `<tr>
      <td>${fmtDate(log.date)}</td>
      ${cells}
      <td title="${escHtml(log.notes || '')}" style="color:var(--brand-bright)">${log.notes ? svgIcon('note', 15) : ''}</td>
      ${photoCell}
      <td><button class="btn-delete-row" onclick="startEditLog('${log.id}')" title="Edit this log entry">${svgIcon('edit', 16)}</button></td>
      <td><button class="btn-delete-row" onclick="deleteLog('${log.id}')" title="Delete this log entry">${svgIcon('trash', 16)}</button></td>
    </tr>`;
  }).join('');

  const headerCells = DEFAULT_PARAMS.map(p => `<th>${p.label}<br><span style="font-size:0.65rem;font-weight:400">${p.unit}</span></th>`).join('');

  document.getElementById('panel-history').innerHTML = `
    <div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:center;justify-content:space-between">
      <div style="font-size:0.85rem;color:var(--text-muted)">${tankLogs.length} log entries — <span style="color:var(--accent-green)">green = in range</span>, <span style="color:var(--accent-yellow)">yellow = below min</span>, <span style="color:var(--accent-red)">red = above max</span></div>
      <button class="btn-icon" onclick="setPanel('log')">${svgIcon('plus', 16)} New Log</button>
    </div>
    <div class="scroll-hint">${svgIcon('arrowRight', 13)} Swipe the table sideways to see every parameter</div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Date</th>${headerCells}<th>Notes</th><th>${svgIcon('camera', 14)}</th><th></th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function deleteLog(id) {
  if (!confirm('Delete this log entry? This cannot be undone.')) return;
  state.logs = state.logs.filter(l => l.id !== id);
  deleteLogPhoto(id);
  save();
  renderPanel('history');
  showToast('Log entry deleted.');
}

function openHistoryPhoto(logId) {
  const dataUrl = getPhotos()[logId];
  if (!dataUrl) return;
  const log = state.logs.find(function(l) { return l.id === logId; });
  const caption = log ? fmtDate(log.date) : '';
  openPhotoLightbox(dataUrl, caption);
}

// ============================================================
// CHARTS
// ============================================================

// Navigate to charts panel, pre-select param + range, clear overlay.
function goToChart(key, range) {
  state.chartParam = key || state.chartParam;
  state.chartRange = range != null ? range : state.chartRange;
  state.chartOverlayParam = null;
  setPanel('charts');
}

// Parse "#charts?param=alk&range=30" style hash — return panel name.
function parseHashNav() {
  var full = (location.hash || '').replace('#', '');
  var qIdx = full.indexOf('?');
  var panel = qIdx !== -1 ? full.slice(0, qIdx) : full;
  if (qIdx !== -1) {
    try {
      var qp = new URLSearchParams(full.slice(qIdx + 1));
      var pKey = qp.get('param');
      if (pKey && DEFAULT_PARAMS.find(function(p) { return p.key === pKey; })) state.chartParam = pKey;
      var r = qp.get('range');
      if (r !== null) { var ri = parseInt(r, 10); if (!isNaN(ri)) state.chartRange = ri; }
    } catch(e) {}
  }
  return panel;
}

// Returns filtered log series for a param key within the current chart range.
function chartLogsFor(tankId, paramKey) {
  if (state.chartRange === 0) {
    return state.logs
      .filter(function(l) { return l.tankId === tankId && l.params[paramKey] != null; })
      .sort(function(a,b) { return a.date > b.date ? 1 : -1; })
      .map(function(l) { return { date: l.date, value: l.params[paramKey] }; });
  }
  const cutoff = localCutoffStr(state.chartRange);
  return state.logs
    .filter(function(l) { return l.tankId === tankId && l.date >= cutoff && l.params[paramKey] != null; })
    .sort(function(a,b) { return a.date > b.date ? 1 : -1; })
    .map(function(l) { return { date: l.date, value: l.params[paramKey] }; });
}

// Drift analysis card — descriptive slope over last 30d (or all data if <30d).
function renderDriftCard(tank) {
  const thresholds = getThresholds(tank.id);
  const cutoff30T = Date.now() - 30 * 86400000;

  const rows = DEFAULT_PARAMS.map(p => {
    const allPts = state.logs
      .filter(l => l.tankId === tank.id && l.params[p.key] != null)
      .map(l => ({ t: new Date(l.date + 'T12:00:00').getTime(), v: +l.params[p.key] }))
      .sort((a, b) => a.t - b.t);

    const recentPts = allPts.filter(pt => pt.t >= cutoff30T);
    const series = recentPts.length >= 7 ? recentPts : allPts;

    if (series.length < 7) {
      return `<div class="drift-row">
        <span class="drift-icon drift-dim">·</span>
        <span class="drift-param" style="color:${p.color}">${p.label}</span>
        <span class="drift-desc drift-dim">Not enough data yet</span>
      </div>`;
    }

    const slopeWk = slopePerDay(series) * 7;
    const absSlope = Math.abs(slopeWk);
    const spanDays = Math.round((series[series.length - 1].t - series[0].t) / 86400000);
    const periodLabel = series === recentPts ? '30 days' : (spanDays + ' days');

    let icon, cls;
    if (absSlope < 0.5)      { icon = '▲'; cls = 'drift-stable'; }
    else if (absSlope < 2.0) { icon = '⚠'; cls = 'drift-warn'; }
    else                     { icon = '●'; cls = 'drift-sharp'; }

    let desc;
    if (absSlope < 0.5) {
      desc = `Steady over the last ${periodLabel}`;
    } else {
      const fmt = absSlope >= 10 ? absSlope.toFixed(0) : absSlope >= 1 ? absSlope.toFixed(1) : absSlope.toFixed(2);
      const dir = slopeWk > 0 ? 'up' : 'down';
      desc = `Trending ${dir} ${fmt} ${p.unit}/week (${periodLabel})`;
    }

    return `<div class="drift-row">
      <span class="drift-icon ${cls}">${icon}</span>
      <span class="drift-param" style="color:${p.color}">${p.label}</span>
      <span class="drift-desc">${desc}</span>
    </div>`;
  }).join('');

  return `
    <div class="card drift-card">
      <div class="card-title">${svgIcon('gauge', 15)} Drift Analysis</div>
      <p class="drift-note">Least-squares slope of your readings over the last 30 days (or all logged data if less). Descriptive only — ReefDeck does not advise.</p>
      <div class="drift-list">${rows}</div>
    </div>`;
}

function renderCharts() {
  const tank = getActiveTank();
  const panelEl = document.getElementById('panel-charts');
  if (!tank) { panelEl.innerHTML = renderEmptyState('No tank', 'Add a tank first.'); return; }

  const param = DEFAULT_PARAMS.find(p => p.key === state.chartParam) || DEFAULT_PARAMS[0];
  const overlayParam = state.chartOverlayParam ? DEFAULT_PARAMS.find(p => p.key === state.chartOverlayParam) : null;

  const paramOptions = DEFAULT_PARAMS.map(p =>
    `<option value="${p.key}" ${p.key === state.chartParam ? 'selected' : ''}>${p.label}${p.unit ? ` (${p.unit})` : ''}</option>`
  ).join('');

  const overlayOptions = `<option value="">— none —</option>` + DEFAULT_PARAMS
    .filter(p => p.key !== state.chartParam)
    .map(p => `<option value="${p.key}" ${p.key === (state.chartOverlayParam || '') ? 'selected' : ''}>${p.label}${p.unit ? ` (${p.unit})` : ''}</option>`)
    .join('');

  const RANGES = [{v: 7, l: '7d'}, {v: 30, l: '30d'}, {v: 90, l: '90d'}, {v: 365, l: '365d'}, {v: 0, l: 'All'}];
  const rangeButtons = RANGES.map(r =>
    `<button class="range-btn ${r.v === state.chartRange ? 'active' : ''}" onclick="state.chartRange=${r.v}; renderPanel('charts')">${r.l}</button>`
  ).join('');

  const rangeLabel = state.chartRange === 0 ? 'all data' : `last ${state.chartRange}d`;

  panelEl.innerHTML = `
    <div class="card">
      <div class="card-title">Trend Charts — ${escHtml(tank.name)}</div>
      <div class="chart-controls">
        <select onchange="state.chartParam=this.value; if(state.chartOverlayParam===this.value)state.chartOverlayParam=null; renderPanel('charts')">${paramOptions}</select>
        <div class="overlay-control">
          <span class="overlay-label">+ overlay</span>
          <select class="overlay-select" onchange="state.chartOverlayParam=this.value||null; renderPanel('charts')">${overlayOptions}</select>
        </div>
        <div class="range-group">${rangeButtons}</div>
      </div>
      <div class="chart-canvas-wrap" id="chart-wrap-main">
        <canvas id="main-chart" aria-label="Parameter trend chart"></canvas>
      </div>
      <div id="chart-stats" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;font-size:0.82rem;color:var(--text-muted)"></div>
      <div id="chart-photo-filmstrip" style="display:none"></div>
    </div>
    <div id="drift-section"></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px;margin-top:4px" id="mini-charts-grid"></div>
  `;

  const tankLogs = chartLogsFor(tank.id, param.key);
  const overlayLogs = overlayParam ? chartLogsFor(tank.id, overlayParam.key) : null;
  const thresholds = getThresholds(tank.id)[param.key] || {};

  // Build photo index for logs in range: date → dataUrl
  const photos = getPhotos();
  const allLogsInRange = state.chartRange === 0
    ? state.logs.filter(l => l.tankId === tank.id)
    : (() => { const cutoff = localCutoffStr(state.chartRange); return state.logs.filter(l => l.tankId === tank.id && l.date >= cutoff); })();
  const chartPhotosMap = {};
  allLogsInRange.forEach(l => { if (photos[l.id]) chartPhotosMap[l.date] = photos[l.id]; });
  const chartPhotoDates = Object.keys(chartPhotosMap);

  // Dose markers — journal entries tagged with 'dose' + current param key
  const doseMarkers = state.journal.filter(function(j) {
    return j.tankId === tank.id && j.tags && j.tags.includes('dose') && j.tags.includes(param.key);
  }).map(function(j) { return { date: j.date, text: j.text }; });

  if (tankLogs.length < 1) {
    const hint = state.chartRange === 0 ? '' : ` in the last ${state.chartRange} days`;
    document.getElementById('chart-wrap-main').innerHTML = `<div class="chart-no-data">No ${param.label} data${hint}.<br><button onclick="setPanel('log')" style="background:none;border:none;color:var(--ocean-light);cursor:pointer;text-decoration:underline;font-size:0.9rem">Log some now →</button></div>`;
  } else {
    setTimeout(() => {
      const c = document.getElementById('main-chart');
      if (!c) return;
      if (overlayParam && overlayLogs && overlayLogs.length >= 1) {
        window.ReefCharts.drawDualLineChart(c, {
          data: tankLogs, label: param.label, unit: param.unit, color: param.color,
          data2: overlayLogs, label2: overlayParam.label, unit2: overlayParam.unit, color2: overlayParam.color,
          thresholdMin: thresholds.min, thresholdMax: thresholds.max,
          photoDates: chartPhotoDates, photosMap: chartPhotosMap,
          doseDates: doseMarkers,
        });
      } else {
        window.ReefCharts.drawLineChart(c, {
          data: tankLogs, label: param.label, unit: param.unit,
          thresholdMin: thresholds.min, thresholdMax: thresholds.max,
          color: param.color,
          photoDates: chartPhotoDates, photosMap: chartPhotosMap,
          doseDates: doseMarkers,
        });
      }
      const vals = tankLogs.map(d => d.value);
      const avg = (vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(2);
      const mn = Math.min(...vals).toFixed(2);
      const mx = Math.max(...vals).toFixed(2);
      const statsEl = document.getElementById('chart-stats');
      if (statsEl) statsEl.innerHTML = `
        <span class="chart-stat-pill">Avg <strong>${avg} ${param.unit}</strong></span>
        <span class="chart-stat-pill">Min <strong>${mn} ${param.unit}</strong></span>
        <span class="chart-stat-pill">Max <strong>${mx} ${param.unit}</strong></span>
        <span class="chart-stat-pill">Readings <strong>${vals.length}</strong></span>
        ${thresholds.min != null ? `<span class="chart-stat-pill">Your range <strong style="color:var(--accent-green)">${thresholds.min}–${thresholds.max} ${param.unit}</strong></span>` : ''}
        ${overlayParam ? `<span class="chart-stat-pill" style="border-color:${overlayParam.color}40">${overlayParam.label} overlay <strong style="color:${overlayParam.color}">${overlayLogs.length} pts</strong></span>` : ''}
      `;

      // Photo filmstrip — show tiny thumbnails for any photos in this chart period
      const filmstripEl = document.getElementById('chart-photo-filmstrip');
      if (filmstripEl && chartPhotoDates.length > 0) {
        filmstripEl.innerHTML = '';
        const strip = document.createElement('div');
        strip.className = 'photo-filmstrip';
        const label = document.createElement('span');
        label.className = 'photo-filmstrip-label';
        label.innerHTML = svgIcon('camera', 13) + ' Photos in this period:';
        strip.appendChild(label);
        chartPhotoDates.slice().sort().forEach(function(d) {
          const btn = document.createElement('button');
          btn.className = 'photo-filmstrip-thumb';
          btn.title = fmtDate(d);
          const capturedDataUrl = chartPhotosMap[d];
          const capturedDate = fmtDate(d);
          btn.onclick = function() { openPhotoLightbox(capturedDataUrl, capturedDate); };
          const img = document.createElement('img');
          img.src = capturedDataUrl;
          img.alt = capturedDate;
          const span = document.createElement('span');
          span.textContent = capturedDate;
          btn.appendChild(img);
          btn.appendChild(span);
          strip.appendChild(btn);
        });
        filmstripEl.appendChild(strip);
        filmstripEl.style.display = '';
      } else if (filmstripEl) {
        filmstripEl.style.display = 'none';
      }
    }, 0);
  }

  // Drift analysis card
  document.getElementById('drift-section').innerHTML = renderDriftCard(tank);

  // Mini sparklines for other params
  const grid = document.getElementById('mini-charts-grid');
  DEFAULT_PARAMS.filter(p => p.key !== param.key).forEach(p => {
    const miniData = chartLogsFor(tank.id, p.key);
    const card = document.createElement('div');
    card.className = 'card';
    card.style.cursor = 'pointer';
    card.title = 'Click to expand ' + p.label + ' (' + rangeLabel + ')';
    card.onclick = () => { state.chartParam = p.key; state.chartOverlayParam = null; renderPanel('charts'); };
    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px">
        <span class="card-title" style="margin:0">${p.label}</span>
        <span style="font-size:0.8rem;color:var(--text-muted)">${miniData.length > 0 ? miniData[miniData.length-1].value + ' ' + p.unit : 'No data'}</span>
      </div>
      <div id="mini-wrap-${p.key}" style="height:44px;overflow:hidden">
        ${miniData.length < 2 ? '<div style="height:44px;display:flex;align-items:center;justify-content:center;color:var(--text-dim);font-size:0.75rem">Not enough data</div>' : '<canvas id="mini-' + p.key + '"></canvas>'}
      </div>
    `;
    grid.appendChild(card);
    if (miniData.length >= 2) {
      setTimeout(() => {
        const mc = document.getElementById('mini-' + p.key);
        if (mc) window.ReefCharts.drawSparkline(mc, miniData, p.color);
      }, 0);
    }
  });
}

// ============================================================
// MAINTENANCE & DOSING SCHEDULER
// ============================================================
function renderSchedule() {
  const tank = getActiveTank();
  const panelEl = document.getElementById('panel-schedule');
  if (!tank) { panelEl.innerHTML = renderEmptyState('No tank', 'Add a tank first.'); return; }

  const tasks = getMaintenance(tank.id).slice().sort((a, b) => {
    const sa = STATUS_ORDER[taskStatus(a)], sb = STATUS_ORDER[taskStatus(b)];
    if (sa !== sb) return sa - sb;
    return daysBetween(todayStr(), taskNextDue(a)) - daysBetween(todayStr(), taskNextDue(b));
  });
  const prefs = getPrefs();

  const reminderBanner = (() => {
    const supported = ('Notification' in window);
    if (!prefs.reminders) {
      return `<div class="schedule-reminder">
        ${svgIcon('bell', 16)}
        <span>Want a nudge when something's due? Turn on <strong>browser reminders</strong> in Settings.</span>
        <button class="btn-icon" style="margin-left:auto;padding:6px 11px" onclick="setPanel('settings')">${svgIcon('sun', 14)} Settings</button>
      </div>`;
    }
    if (supported && Notification.permission === 'denied') {
      return `<div class="schedule-reminder warn">${svgIcon('alert', 16)}<span>Reminders are on in ReefDeck, but your browser is blocking notifications for this site. Allow notifications in your browser settings.</span></div>`;
    }
    return `<div class="schedule-reminder ok">${svgIcon('bell', 16)}<span>Browser reminders are on. ReefDeck will nudge you about due tasks while the app is open or installed.</span></div>`;
  })();

  let body;
  if (tasks.length === 0) {
    body = renderEmptyState('No tasks yet', 'Add water changes, dosing, testing and cleaning routines — ReefDeck tracks when each is next due.', null, () => openTaskModal());
  } else {
    const groups = [
      { key: 'overdue',  label: 'Overdue' },
      { key: 'today',    label: 'Due today' },
      { key: 'soon',     label: 'Next 3 days' },
      { key: 'upcoming', label: 'Upcoming' },
      { key: 'disabled', label: 'Paused' },
    ];
    body = groups.map(g => {
      const inGroup = tasks.filter(t => taskStatus(t) === g.key);
      if (inGroup.length === 0) return '';
      return `<div class="sched-group">
        <div class="sched-group-label ${g.key}">${g.label} <span class="sched-count">${inGroup.length}</span></div>
        <div class="sched-list">${inGroup.map(scheduleRow).join('')}</div>
      </div>`;
    }).join('');
  }

  panelEl.innerHTML = `
    <div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:center;justify-content:space-between">
      <div style="font-size:0.9rem;color:var(--text-muted)">${tasks.length} task${tasks.length === 1 ? '' : 's'} for ${escHtml(tank.name)}</div>
      <button class="btn-primary-sm" onclick="openTaskModal()">${svgIcon('plus', 16)} Add Task</button>
    </div>
    ${reminderBanner}
    ${body}
    <p class="panel-foot-note">${svgIcon('info', 13)} Intervals and reminders are set by you. ReefDeck tracks timing — it does not tell you how to keep your tank.</p>
  `;
}

function scheduleRow(t) {
  const st = taskStatus(t);
  const cat = TASK_CATEGORIES[t.category] || TASK_CATEGORIES.other;
  const everyTxt = t.intervalDays === 1 ? 'Every day' : 'Every ' + t.intervalDays + ' days';
  const lastTxt = t.lastDone ? 'last done ' + fmtDate(t.lastDone) : 'never logged';
  return `
    <div class="sched-row ${st}">
      <span class="due-cat ${st}">${svgIcon(cat.icon, 17)}</span>
      <div class="sched-main">
        <div class="sched-name">${escHtml(t.name)} ${t.enabled === false ? '<span class="sched-paused">paused</span>' : ''}</div>
        <div class="sched-meta">${cat.label} &nbsp;·&nbsp; ${everyTxt} &nbsp;·&nbsp; ${lastTxt}${t.notes ? ' &nbsp;·&nbsp; ' + escHtml(t.notes) : ''}</div>
      </div>
      <div class="sched-due ${st}">${dueLabel(t)}<div class="sched-nextdate">${t.enabled === false ? '' : fmtDate(taskNextDue(t))}</div></div>
      <div class="sched-actions">
        ${t.enabled === false
          ? `<button class="btn-inv" onclick="toggleTaskEnabled('${t.id}')" title="Resume">${svgIcon('repeat', 14)}</button>`
          : `<button class="btn-done" onclick="markTaskDone('${t.id}')" title="Mark done now">${svgIcon('check', 15)} Done</button>`}
        <button class="btn-inv" onclick="openTaskModal('${t.id}')" title="Edit">${svgIcon('edit', 14)}</button>
        <button class="btn-inv danger" onclick="deleteTask('${t.id}')" title="Delete">${svgIcon('trash', 14)}</button>
      </div>
    </div>`;
}

function toggleTaskEnabled(id) {
  const t = state.maintenance.find(m => m.id === id);
  if (!t) return;
  t.enabled = t.enabled === false;
  save();
  if (typeof syncPushSchedule === 'function') syncPushSchedule();
  renderPanel(state.activePanel);
  showToast(t.enabled ? t.name + ' resumed.' : t.name + ' paused.');
}

function deleteTask(id) {
  if (!confirm('Delete this maintenance task?')) return;
  state.maintenance = state.maintenance.filter(m => m.id !== id);
  save();
  if (typeof syncPushSchedule === 'function') syncPushSchedule();
  renderPanel(state.activePanel);
  showToast('Task deleted.');
}

let editingTaskId = null;
function openTaskModal(id) {
  editingTaskId = id || null;
  const t = id ? state.maintenance.find(m => m.id === id) : null;
  const overlay = document.getElementById('modal-overlay');
  const body = document.getElementById('modal-body');
  const catOptions = Object.keys(TASK_CATEGORIES).map(k =>
    `<option value="${k}" ${t && t.category === k ? 'selected' : ''}>${TASK_CATEGORIES[k].label}</option>`).join('');
  const presetChips = t ? '' : `
    <div class="form-field" style="grid-column:span 2;margin-bottom:4px">
      <label class="form-label">Quick add a common routine</label>
      <div class="preset-chips">
        ${TASK_PRESETS.map((p, i) => `<button type="button" class="preset-chip" onclick="fillTaskPreset(${i})">${svgIcon((TASK_CATEGORIES[p.category]||{}).icon || 'checkCircle', 13)} ${escHtml(p.name)}</button>`).join('')}
      </div>
    </div>`;
  body.innerHTML = `
    <div class="modal-title">${svgIcon('calendar', 19)} ${t ? 'Edit Task' : 'Add Maintenance Task'}</div>
    ${presetChips}
    <div class="form-grid" style="grid-template-columns:1fr 1fr">
      <div class="form-field" style="grid-column:span 2">
        <label class="form-label">Task name *</label>
        <input class="form-input" id="m-task-name" placeholder="Water change, dose two-part, clean skimmer..." value="${t ? escHtml(t.name) : ''}" />
      </div>
      <div class="form-field">
        <label class="form-label">Category</label>
        <select class="form-input" id="m-task-cat">${catOptions}</select>
      </div>
      <div class="form-field">
        <label class="form-label">Repeat every (days) *</label>
        <input class="form-input" type="number" min="1" step="1" id="m-task-interval" placeholder="7" value="${t ? t.intervalDays : ''}" />
      </div>
      <div class="form-field">
        <label class="form-label">Last done</label>
        <input class="form-input" type="date" id="m-task-last" value="${t && t.lastDone ? t.lastDone : todayStr()}" />
      </div>
      <div class="form-field">
        <label class="form-label">&nbsp;</label>
        <label class="checkbox-line"><input type="checkbox" id="m-task-enabled" ${!t || t.enabled !== false ? 'checked' : ''} /> Active (track this task)</label>
      </div>
      <div class="form-field" style="grid-column:span 2">
        <label class="form-label">Notes (optional)</label>
        <input class="form-input" id="m-task-notes" placeholder="Product, amount, reservoir size..." value="${t ? escHtml(t.notes || '') : ''}" />
      </div>
    </div>
    <p class="form-help">Next-due is calculated from "last done" + the repeat interval. Leave "last done" as today to start the clock now.</p>
    <div class="modal-actions">
      <button class="btn-modal-cancel" onclick="closeModal()">Cancel</button>
      <button class="btn-modal-save" onclick="saveMaintenanceTask()">${t ? 'Save Changes' : 'Add Task'}</button>
    </div>`;
  overlay.classList.add('open');
}

function fillTaskPreset(i) {
  const p = TASK_PRESETS[i];
  if (!p) return;
  document.getElementById('m-task-name').value = p.name;
  document.getElementById('m-task-cat').value = p.category;
  document.getElementById('m-task-interval').value = p.intervalDays;
}

function saveMaintenanceTask() {
  const tank = getActiveTank();
  if (!tank) return;
  const name = document.getElementById('m-task-name').value.trim();
  const interval = parseInt(document.getElementById('m-task-interval').value, 10);
  if (!name) { showToast('Task name is required.', 'error'); return; }
  if (!interval || interval < 1) { showToast('Enter a repeat interval of at least 1 day.', 'error'); return; }
  const fields = {
    name,
    category: document.getElementById('m-task-cat').value,
    intervalDays: interval,
    lastDone: document.getElementById('m-task-last').value || null,
    enabled: document.getElementById('m-task-enabled').checked,
    notes: document.getElementById('m-task-notes').value.trim(),
  };
  if (editingTaskId) {
    const t = state.maintenance.find(m => m.id === editingTaskId);
    if (t) Object.assign(t, fields);
  } else {
    state.maintenance.push({ id: uid(), tankId: tank.id, ...fields });
  }
  save();
  closeModal();
  editingTaskId = null;
  if (typeof syncPushSchedule === 'function') syncPushSchedule();
  renderPanel('schedule');
  showToast('Task saved!');
}

// Browser reminders — fire a local notification for overdue/due tasks, once per task per day.
function checkReminders() {
  const prefs = getPrefs();
  if (!prefs.reminders || !('Notification' in window) || Notification.permission !== 'granted') return;
  const tank = getActiveTank();
  if (!tank) return;
  const due = getMaintenance(tank.id).filter(t => t.enabled !== false && ['overdue', 'today'].includes(taskStatus(t)));
  const today = todayStr();
  let fired = 0;
  due.forEach(t => {
    if (prefs.lastNotified[t.id] === today || fired >= 3) return; // avoid spamming
    try {
      new Notification('ReefDeck — ' + tank.name, { body: t.name + ' · ' + dueLabel(t), tag: 'reefdeck-' + t.id });
      prefs.lastNotified[t.id] = today;
      fired++;
    } catch (e) {}
  });
  if (fired) save();
}

// ============================================================
// DOSE CALCULATOR  (pure arithmetic on the user's own inputs)
// ============================================================
const CALC_PARAMS = [
  { key: 'alk', label: 'Alkalinity', unit: 'dKH', rateUnit: 'dKH', step: 0.1,  exampleRate: 0.1 },
  { key: 'ca',  label: 'Calcium',    unit: 'ppm', rateUnit: 'ppm', step: 1,    exampleRate: 2 },
  { key: 'mg',  label: 'Magnesium',  unit: 'ppm', rateUnit: 'ppm', step: 5,    exampleRate: 1 },
];
let calcState = { param: 'alk', volUnit: 'gal', rateVolUnit: 'gal' };

function renderCalculator() {
  const tank = getActiveTank();
  const panelEl = document.getElementById('panel-calculator');
  const p = CALC_PARAMS.find(x => x.key === calcState.param) || CALC_PARAMS[0];

  // Prefills from active tank: volume, latest reading (current), threshold mid (target)
  let prefillVol = '', prefillCurrent = '', prefillTarget = '';
  if (tank) {
    if (tank.volume) { prefillVol = tank.volume; calcState.volUnit = tank.volumeUnit || 'gal'; }
    const tankLogs = state.logs.filter(l => l.tankId === tank.id).sort((a, b) => a.date > b.date ? 1 : -1);
    const latest = tankLogs[tankLogs.length - 1];
    if (latest && latest.params[p.key] != null) prefillCurrent = latest.params[p.key];
    const th = getThresholds(tank.id)[p.key];
    if (th && th.min != null && th.max != null) prefillTarget = +(((th.min + th.max) / 2)).toFixed(p.step < 1 ? 1 : 0);
  }

  const paramTabs = CALC_PARAMS.map(x =>
    `<button class="range-btn ${x.key === calcState.param ? 'active' : ''}" onclick="calcState.param='${x.key}'; renderPanel('calculator')">${x.label}</button>`).join('');

  panelEl.innerHTML = `
    <div class="card calc-card">
      <div class="card-title">${svgIcon('calculator', 15)} Dose Calculator</div>
      <p class="calc-intro">Work out how much of a supplement to add to move a parameter to your target — scaled to your tank's water volume. ReefDeck only does the arithmetic on the numbers <strong>you</strong> enter; it holds no dosing recipes of its own.</p>

      <div class="range-group" style="margin-bottom:18px">${paramTabs}</div>

      <div class="form-grid calc-grid">
        <div class="form-field">
          <label class="form-label">Tank water volume *</label>
          <div style="display:flex;gap:8px">
            <input class="form-input" type="number" min="0" step="0.1" id="calc-vol" placeholder="90" value="${prefillVol}" oninput="computeDose()" style="flex:1" />
            <select class="form-input" id="calc-vol-unit" style="width:74px" onchange="computeDose()">
              <option value="gal" ${calcState.volUnit === 'gal' ? 'selected' : ''}>gal</option>
              <option value="L" ${calcState.volUnit === 'L' ? 'selected' : ''}>L</option>
            </select>
          </div>
        </div>
        <div class="form-field">
          <label class="form-label">Current ${p.label} (${p.unit})</label>
          <input class="form-input" type="number" step="${p.step}" id="calc-current" placeholder="e.g. 7.4" value="${prefillCurrent}" oninput="computeDose()" />
        </div>
        <div class="form-field">
          <label class="form-label">Target ${p.label} (${p.unit})</label>
          <input class="form-input" type="number" step="${p.step}" id="calc-target" placeholder="e.g. 8.5" value="${prefillTarget}" oninput="computeDose()" />
        </div>
      </div>

      <div class="calc-rate-box">
        <div class="form-field" style="margin-bottom:14px">
          <label class="form-label">Supplement / product name <span style="color:var(--text-dim);font-weight:400">(optional — logged to your journal)</span></label>
          <input class="form-input" type="text" id="calc-product-name" placeholder="e.g. Red Sea Reef Foundation A, BRS 2-Part…" style="max-width:420px" />
        </div>
        <div class="form-label" style="margin-bottom:10px">Your product's dose rate <span style="color:var(--text-dim);font-weight:400">— read this off your supplement's label</span></div>
        <div class="calc-rate-line">
          <span>1&nbsp;mL raises ${p.label} by</span>
          <input class="form-input calc-inline" type="number" step="0.001" id="calc-rate" placeholder="${p.exampleRate}" value="" oninput="computeDose()" />
          <span>${p.rateUnit} per</span>
          <input class="form-input calc-inline" type="number" step="1" id="calc-rate-vol" placeholder="1" value="1" oninput="computeDose()" />
          <select class="form-input calc-inline-sel" id="calc-rate-vol-unit" onchange="computeDose()">
            <option value="gal" ${calcState.rateVolUnit === 'gal' ? 'selected' : ''}>gal</option>
            <option value="L" ${calcState.rateVolUnit === 'L' ? 'selected' : ''}>L</option>
          </select>
        </div>
        <p class="form-help" style="margin-top:9px">Most supplements print this, e.g. "1&nbsp;mL per 25&nbsp;L raises KH by ~0.1&nbsp;dKH", or give a dosing table you can divide out. Two-part, all-in-ones, and DIY mixes all work — just enter their rate.</p>
      </div>

      <div id="calc-result" class="calc-result"></div>

      <div class="calc-disclaimer">
        ${svgIcon('info', 15)}
        <div>This is a calculator, not advice. It multiplies out the numbers you entered and nothing more. <strong>Always follow your product's own instructions</strong>, dose gradually, and confirm with a test kit. Many reefers raise alkalinity slowly — commonly cited hobby guidance is around ≤1&nbsp;dKH per day — but that is general hobbyist information, not a recommendation from ReefDeck.</div>
      </div>
    </div>`;

  setTimeout(computeDose, 0);
}

function computeDose() {
  const p = CALC_PARAMS.find(x => x.key === calcState.param) || CALC_PARAMS[0];
  const el = document.getElementById('calc-result');
  if (!el) return;
  const vol = parseFloat((document.getElementById('calc-vol') || {}).value);
  const volUnit = (document.getElementById('calc-vol-unit') || {}).value;
  const current = parseFloat((document.getElementById('calc-current') || {}).value);
  const target = parseFloat((document.getElementById('calc-target') || {}).value);
  const rate = parseFloat((document.getElementById('calc-rate') || {}).value);
  const rateVol = parseFloat((document.getElementById('calc-rate-vol') || {}).value);
  const rateVolUnit = (document.getElementById('calc-rate-vol-unit') || {}).value;
  calcState.volUnit = volUnit; calcState.rateVolUnit = rateVolUnit;

  if ([vol, current, target, rate, rateVol].some(v => isNaN(v)) || vol <= 0 || rate <= 0 || rateVol <= 0) {
    el.className = 'calc-result';
    el.innerHTML = `<div class="calc-result-empty">${svgIcon('calculator', 22)}<span>Fill in your tank volume, current &amp; target values, and your product's dose rate to see the amount.</span></div>`;
    return;
  }

  const delta = target - current;
  if (Math.abs(delta) < 1e-9) {
    el.className = 'calc-result';
    el.innerHTML = `<div class="calc-result-empty">${svgIcon('checkCircle', 22)}<span>Current already equals target — no dose needed.</span></div>`;
    return;
  }

  // Normalise everything to litres so volume units can differ.
  const GAL_L = 3.78541;
  const tankL = volUnit === 'gal' ? vol * GAL_L : vol;
  const rateRefL = rateVolUnit === 'gal' ? rateVol * GAL_L : rateVol;
  // 1 mL raises `rate` units per `rateRefL` litres  ->  per-mL effect in this tank:
  const perMlEffect = rate * (rateRefL / tankL); // units raised per mL in THIS tank
  const doseMl = delta / perMlEffect;

  const down = delta < 0;
  const ml = Math.abs(doseMl);
  const mlTxt = ml >= 100 ? ml.toFixed(0) : ml >= 10 ? ml.toFixed(1) : ml.toFixed(2);

  el.className = 'calc-result filled';
  el.innerHTML = `
    <div class="calc-figure">
      <div class="calc-figure-label">${down ? 'To LOWER by ' + Math.abs(delta).toFixed(p.step < 1 ? 2 : 0) + ' ' + p.unit : 'Add approximately'}</div>
      ${down
        ? `<div class="calc-down">${svgIcon('info', 16)} A supplement raises a value — it can't lower one. To bring ${p.label} down, a water change or specific reducer is needed. ReefDeck doesn't calculate reductions.</div>`
        : `<div class="calc-figure-value">${mlTxt}<span class="calc-figure-unit">mL</span></div>
           <div class="calc-figure-sub">of your supplement, to raise ${p.label} from <strong>${current} → ${target} ${p.unit}</strong> (Δ ${delta > 0 ? '+' : ''}${(+delta.toFixed(3))} ${p.unit}) across <strong>${vol} ${volUnit}</strong>.</div>`}
    </div>
    ${down ? '' : `<button class="btn-icon" style="margin-top:14px" onclick="logDoseToJournal('${p.key}', ${(+ml.toFixed(2))}, ${current}, ${target})">${svgIcon('journal', 15)} Log this dose to journal</button>`}
  `;
}

function logDoseToJournal(paramKey, ml, current, target) {
  const tank = getActiveTank();
  if (!tank) return;
  const p = CALC_PARAMS.find(x => x.key === paramKey);
  const label = p ? p.label : paramKey;
  const unit = p ? p.unit : '';
  const nameEl = document.getElementById('calc-product-name');
  const product = nameEl && nameEl.value.trim() ? nameEl.value.trim() : 'supplement';
  const dateStr = todayStr();
  const text = `Dose: ${label} — added ${ml} mL of ${product} on ${fmtDate(dateStr)}. Target: ${target} ${unit}. Pre-dose reading: ${current} ${unit}.`;
  state.journal.push({ id: uid(), tankId: tank.id, date: dateStr, text, tags: ['dose', paramKey] });
  save();
  showToast('Dose logged to journal.');
}

// ============================================================
// INVENTORY
// ============================================================
function renderInventory() {
  const tank = getActiveTank();
  const panelEl = document.getElementById('panel-inventory');
  if (!tank) { panelEl.innerHTML = renderEmptyState('No tank', 'Add a tank first.'); return; }

  const items = state.inventory.filter(i => i.tankId === tank.id);
  const types = ['coral', 'fish', 'invert', 'equipment', 'other'];

  const byType = {};
  types.forEach(t => { byType[t] = items.filter(i => i.type === t); });

  const typeIconName = { coral: 'coral', fish: 'fish', invert: 'invert', equipment: 'equipment', other: 'other' };
  const typeLabels = { coral: 'Corals', fish: 'Fish', invert: 'Invertebrates', equipment: 'Equipment', other: 'Other' };

  let html = `
    <div style="display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap;align-items:center;justify-content:space-between">
      <div style="font-size:0.9rem;color:var(--text-muted)">${items.length} items in inventory</div>
      <button class="btn-primary-sm" onclick="openModal('add-inventory')">${svgIcon('plus', 16)} Add Item</button>
    </div>
  `;

  if (items.length === 0) {
    html += renderEmptyState('Empty tank', 'Add your first coral, fish, or invert to the inventory.', null, () => openModal('add-inventory'));
  } else {
    types.forEach(type => {
      const group = byType[type];
      if (group.length === 0) return;
      html += `<div style="margin-bottom:24px"><h3 class="inv-group-title">${svgIcon(typeIconName[type], 17)} ${typeLabels[type]} (${group.length})</h3>
      <div class="inventory-grid">`;
      group.forEach(item => {
        const photo = item.photoDataUrl
          ? `<img src="${item.photoDataUrl}" alt="${escHtml(item.name)}" style="width:100%;height:100%;object-fit:cover">`
          : svgIcon(typeIconName[type], 44);
        html += `
          <div class="inventory-card">
            <div class="inv-photo">${photo}</div>
            <div class="inv-body">
              <div class="inv-type">${typeLabels[type]}</div>
              <div class="inv-name">${escHtml(item.name)}</div>
              <div class="inv-meta">
                ${item.placedDate ? `Added: ${fmtDate(item.placedDate)}<br>` : ''}
                ${item.price ? `Cost: $${item.price}<br>` : ''}
                ${item.notes ? escHtml(item.notes) : ''}
              </div>
              <div class="inv-actions">
                <button class="btn-inv danger" onclick="deleteInventoryItem('${item.id}')">${svgIcon('trash', 15)} Remove</button>
              </div>
            </div>
          </div>`;
      });
      html += `</div></div>`;
    });
  }

  panelEl.innerHTML = html;
}

function deleteInventoryItem(id) {
  if (!confirm('Remove this item from inventory?')) return;
  state.inventory = state.inventory.filter(i => i.id !== id);
  save();
  renderPanel('inventory');
  showToast('Item removed.');
}

// ============================================================
// CORAL GROWTH TRACKER (Phase 4)
// Per-colony growth timeline — observational only, never advice.
// Pure data ops use CoralLib (coral.js); rendering + persistence here.
// ============================================================
function getCorals() {
  if (!Array.isArray(state.corals)) state.corals = [];
  return state.corals;
}

function renderCorals() {
  const tank = getActiveTank();
  const panelEl = document.getElementById('panel-corals');
  if (!tank) { panelEl.innerHTML = renderEmptyState('No tank', 'Add a tank first.'); return; }

  const corals = getCorals().filter(c => c.tankId === tank.id);

  let html = `
    <div style="display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap;align-items:center;justify-content:space-between">
      <div style="font-size:0.9rem;color:var(--text-muted)">${corals.length} colon${corals.length !== 1 ? 'ies' : 'y'} tracked</div>
      <button class="btn-primary-sm" onclick="openModal('add-coral')">${svgIcon('plus', 16)} Add Colony</button>
    </div>
  `;

  if (corals.length === 0) {
    html += '<div class="empty-state" style="padding:40px 0"><div class="empty-icon">' + svgIcon('coral', 34) + '</div>' +
      '<h3>Track your corals</h3><p>Add a colony to start logging dated growth observations. Photos optional.</p>' +
      '<button class="btn-primary-sm" onclick="openModal(\'add-coral\')" style="padding:11px 24px">' + svgIcon('plus', 16) + ' Add Colony</button></div>';
  } else {
    html += '<div class="coral-grid">';
    corals.forEach(coral => {
      const sum = CoralLib.coralSummary(coral);
      // thumbnail: latest entry photo, else first photo, else icon
      const tl = CoralLib.growthTimeline(coral);
      let thumbUrl = null;
      for (let i = tl.length - 1; i >= 0; i--) {
        if (tl[i].photoId) { thumbUrl = getCoralPhotoUrl(tl[i].photoId); if (thumbUrl) break; }
      }
      if (!thumbUrl && coral.photos && coral.photos[0]) thumbUrl = getCoralPhotoUrl(coral.photos[0]);
      const thumb = thumbUrl
        ? '<img src="' + thumbUrl + '" alt="' + escHtml(coral.name) + '" style="width:100%;height:100%;object-fit:cover">'
        : svgIcon('coral', 40);
      const trackedDays = sum.daysTracked;
      html += `
        <div class="coral-card" onclick="viewCoral('${coral.id}')">
          <div class="coral-thumb">${thumb}</div>
          <div class="coral-body">
            <div class="coral-name">${escHtml(coral.name)}</div>
            <div class="coral-species">${escHtml(coral.species || '—')}</div>
            <div class="coral-stats">
              ${svgIcon('note', 13)} ${sum.entryCount} entr${sum.entryCount !== 1 ? 'ies' : 'y'}
              ${trackedDays > 0 ? ' · ' + trackedDays + 'd tracked' : ''}
            </div>
          </div>
          ${svgIcon('arrowRight', 18)}
        </div>`;
    });
    html += '</div>';
  }

  panelEl.innerHTML = html;
}

function viewCoral(id) {
  const coral = getCorals().find(c => c.id === id);
  if (!coral) return;
  state._coralViewId = id;
  renderCoralDetail();
}

function renderCoralDetail() {
  const tank = getActiveTank();
  const panelEl = document.getElementById('panel-corals');
  if (!tank) { panelEl.innerHTML = renderEmptyState('No tank', 'Add a tank first.'); return; }
  const coral = getCorals().find(c => c.id === state._coralViewId);
  if (!coral) { renderCorals(); return; }

  const tl = CoralLib.growthTimeline(coral);
  const sum = CoralLib.coralSummary(coral);

  // First-vs-latest photo compare (needs >=2 entries with photos)
  const photoEntries = tl.filter(e => e.photoId && getCoralPhotoUrl(e.photoId));
  const compareHtml = photoEntries.length >= 2 ? (() => {
    const first = photoEntries[0];
    const latest = photoEntries[photoEntries.length - 1];
    const daysSpan = daysBetween(first.date, latest.date);
    return `
      <div class="card coral-compare">
        <div class="card-title">${svgIcon('camera', 17)} First vs Latest</div>
        <div class="coral-compare-grid">
          <div class="coral-compare-cell">
            <img src="${getCoralPhotoUrl(first.photoId)}" alt="First photo" onclick="openPhotoLightbox('${getCoralPhotoUrl(first.photoId)}','${escHtml(coral.name)} — ${fmtDate(first.date)}')">
            <div class="coral-compare-label">${fmtDate(first.date)}</div>
            <div class="coral-compare-sub">Day ${first.daysSinceAdded}</div>
          </div>
          <div class="coral-compare-arrow">${svgIcon('arrowRight', 22)}</div>
          <div class="coral-compare-cell">
            <img src="${getCoralPhotoUrl(latest.photoId)}" alt="Latest photo" onclick="openPhotoLightbox('${getCoralPhotoUrl(latest.photoId)}','${escHtml(coral.name)} — ${fmtDate(latest.date)}')">
            <div class="coral-compare-label">${fmtDate(latest.date)}</div>
            <div class="coral-compare-sub">Day ${latest.daysSinceAdded}</div>
          </div>
        </div>
        <div class="coral-compare-span">${daysSpan} days between first and latest photo</div>
      </div>`;
  })() : '';

  // Timeline
  const timelineHtml = tl.length > 0 ? tl.map(e => {
    const photoUrl = e.photoId ? getCoralPhotoUrl(e.photoId) : null;
    const photoThumb = photoUrl
      ? '<img src="' + photoUrl + '" alt="Growth photo" class="growth-entry-photo" onclick="openPhotoLightbox(\'' + photoUrl + '\',\'' + escHtml(coral.name) + ' — ' + fmtDate(e.date) + '\')">'
      : '';
    return `
      <div class="growth-entry">
        <div class="growth-entry-marker">${svgIcon('coral', 14)}</div>
        <div class="growth-entry-content">
          <div class="growth-entry-header">
            <span class="growth-entry-date">${fmtDate(e.date)}</span>
            <span class="growth-entry-days">Day ${e.daysSinceAdded}</span>
            <button class="btn-delete-row" onclick="deleteGrowthEntry('${coral.id}','${e.id}')" title="Delete entry">${svgIcon('trash', 15)}</button>
          </div>
          ${e.note ? '<div class="growth-entry-note">' + escHtml(e.note) + '</div>' : ''}
          ${photoThumb}
        </div>
      </div>`;
  }).join('') : '<div class="empty-state" style="padding:30px 0"><div class="empty-icon">' + svgIcon('coral', 28) + '</div><p>No growth entries yet. Log your first observation above.</p></div>';

  panelEl.innerHTML = `
    <div style="display:flex;gap:10px;align-items:center;margin-bottom:18px">
      <button class="btn-back" onclick="setPanel('corals')" title="Back to corals">${svgIcon('arrowRight', 16)}</button>
      <div style="flex:1">
        <div style="font-size:1.15rem;font-weight:700;color:var(--text-primary)">${escHtml(coral.name)}</div>
        <div style="font-size:0.82rem;color:var(--text-muted)">${escHtml(coral.species || '—')} · since ${fmtDate(coral.dateAdded)}</div>
      </div>
      <button class="btn-primary-sm" onclick="openModal('add-growth','${coral.id}')">${svgIcon('plus', 16)} Add Growth Entry</button>
    </div>
    <div class="coral-meta-grid">
      <div class="coral-meta-cell"><span class="coral-meta-label">Source</span><span class="coral-meta-value">${escHtml(coral.source || '—')}</span></div>
      <div class="coral-meta-cell"><span class="coral-meta-label">Placement</span><span class="coral-meta-value">${escHtml(coral.placement || '—')}</span></div>
      <div class="coral-meta-cell"><span class="coral-meta-label">Entries</span><span class="coral-meta-value">${sum.entryCount}</span></div>
      <div class="coral-meta-cell"><span class="coral-meta-label">Days tracked</span><span class="coral-meta-value">${sum.daysTracked}</span></div>
    </div>
    ${compareHtml}
    <div class="card coral-timeline-card">
      <div class="card-title">${svgIcon('history', 17)} Growth Timeline</div>
      <div class="growth-timeline">${timelineHtml}</div>
    </div>
    <div style="margin-top:20px">
      <button class="btn-inv danger" onclick="deleteCoralColony('${coral.id}')">${svgIcon('trash', 15)} Delete Colony</button>
    </div>
  `;
}

function saveCoralColony() {
  const tank = getActiveTank();
  if (!tank) return;
  const name = document.getElementById('m-coral-name').value.trim();
  if (!name) { showToast('Coral name is required.', 'error'); return; }
  const coral = {
    id: uid(), tankId: tank.id,
    name,
    species: document.getElementById('m-coral-species').value.trim(),
    source: document.getElementById('m-coral-source').value.trim(),
    dateAdded: document.getElementById('m-coral-date').value || todayStr(),
    placement: document.getElementById('m-coral-placement').value.trim(),
    photos: [],
    growth: [],
  };
  getCorals().push(coral);
  save();
  closeModal();
  showToast('Coral colony added!');
  renderPanel('corals');
}

function saveGrowthEntry() {
  const coralId = document.getElementById('m-growth-coralId').value;
  const coral = getCorals().find(c => c.id === coralId);
  if (!coral) { showToast('Coral not found.', 'error'); return; }
  const date = document.getElementById('m-growth-date').value || todayStr();
  const note = document.getElementById('m-growth-note').value.trim();
  const photoInput = document.getElementById('m-growth-photo');
  const file = photoInput.files[0];
  const finish = (photoId) => {
    const updated = CoralLib.addGrowthEntry(coral, { date, note, photoId });
    // replace coral in state
    const idx = getCorals().findIndex(c => c.id === coralId);
    if (idx !== -1) getCorals()[idx] = updated;
    save();
    closeModal();
    showToast('Growth entry saved!');
    renderCoralDetail();
  };
  if (file) {
    const photoId = uid();
    const reader = new FileReader();
    reader.onload = (e) => { saveCoralPhoto(photoId, e.target.result); finish(photoId); };
    reader.readAsDataURL(file);
  } else {
    finish(null);
  }
}

function deleteGrowthEntry(coralId, entryId) {
  if (!confirm('Delete this growth entry?')) return;
  const coral = getCorals().find(c => c.id === coralId);
  if (!coral) return;
  const entry = (coral.growth || []).find(e => e.id === entryId);
  coral.growth = (coral.growth || []).filter(e => e.id !== entryId);
  // clean up orphaned photo from shared store
  if (entry && entry.photoId) {
    const stillUsed = getCorals().some(c => (c.growth || []).some(e => e.photoId === entry.photoId) || (c.photos || []).indexOf(entry.photoId) !== -1);
    if (!stillUsed) delete getPhotos()[entry.photoId];
  }
  save();
  showToast('Entry deleted.');
  renderCoralDetail();
}

function deleteCoralColony(id) {
  if (!confirm('Delete this coral colony and all its growth entries?')) return;
  const coral = getCorals().find(c => c.id === id);
  if (coral) {
    // clean up photos only used by this colony
    (coral.growth || []).forEach(e => {
      if (e.photoId) {
        const stillUsed = getCorals().some(c => c.id !== id && ((c.growth || []).some(g => g.photoId === e.photoId) || (c.photos || []).indexOf(e.photoId) !== -1));
        if (!stillUsed) delete getPhotos()[e.photoId];
      }
    });
  }
  state.corals = getCorals().filter(c => c.id !== id);
  delete state._coralViewId;
  save();
  showToast('Colony deleted.');
  renderPanel('corals');
}

// ============================================================
// JOURNAL
// ============================================================
function renderJournal() {
  const tank = getActiveTank();
  const panelEl = document.getElementById('panel-journal');
  if (!tank) { panelEl.innerHTML = renderEmptyState('No tank', 'Add a tank first.'); return; }

  const entries = state.journal.filter(j => j.tankId === tank.id).sort((a,b) => a.date > b.date ? -1 : 1);
  const today = todayStr();

  const entriesHtml = entries.length > 0 ? entries.map(j => {
    const isDose = j.tags && j.tags.includes('dose');
    const daysOld = daysBetween(j.date, today);
    const showCheck = isDose && daysOld >= 3;
    const dosePill = isDose ? `<span class="journal-dose-pill">${svgIcon('beaker', 11)} dose</span>` : '';
    const effectCheck = showCheck
      ? `<div class="journal-effect-check">${svgIcon('dropletPlus', 12)} Did you log a reading after this dose? <button onclick="setPanel('log')" style="background:none;border:none;color:var(--brand-bright);cursor:pointer;text-decoration:underline;font-size:inherit;padding:0">Go to Log →</button></div>`
      : '';
    return `<div class="journal-item">
      <div class="journal-item-header">
        <span class="journal-item-date">${fmtDate(j.date)}</span>
        ${dosePill}
        <button class="btn-delete-row" onclick="deleteJournalEntry('${j.id}')" title="Delete">${svgIcon('trash', 16)}</button>
      </div>
      <div class="journal-item-text">${escHtml(j.text)}</div>
      ${effectCheck}
    </div>`;
  }).join('') : '<div class="empty-state" style="padding:30px 0"><div class="empty-icon">' + svgIcon('journal', 30) + '</div><p>No journal entries yet. Write your first observation below.</p></div>';

  panelEl.innerHTML = `
    <div class="card journal-add-form">
      <div class="card-title">New Journal Entry</div>
      <div class="form-row" style="margin-bottom:12px">
        <div class="form-field" style="max-width:200px">
          <label class="form-label">Date</label>
          <input class="form-input" type="date" id="journal-date" value="${today}" />
        </div>
      </div>
      <textarea class="journal-textarea" id="journal-text" placeholder="What did you observe today? Water change, coral behavior, new addition, equipment issue..."></textarea>
      <div style="margin-top:12px">
        <button class="btn-primary-sm" onclick="submitJournal()">Save Entry</button>
      </div>
    </div>
    <div class="journal-list">${entriesHtml}</div>
  `;
}

function submitJournal() {
  const tank = getActiveTank();
  if (!tank) return;
  const date = document.getElementById('journal-date').value;
  const text = document.getElementById('journal-text').value.trim();
  if (!text) { showToast('Write something first.', 'error'); return; }
  state.journal.push({ id: uid(), tankId: tank.id, date, text, tags: [] });
  save();
  showToast('Journal entry saved!');
  renderPanel('journal');
}

function deleteJournalEntry(id) {
  if (!confirm('Delete this journal entry?')) return;
  state.journal = state.journal.filter(j => j.id !== id);
  save();
  renderPanel('journal');
  showToast('Entry deleted.');
}

// ============================================================
// THRESHOLDS
// ============================================================
function renderThresholds() {
  const tank = getActiveTank();
  const panelEl = document.getElementById('panel-thresholds');
  if (!tank) { panelEl.innerHTML = renderEmptyState('No tank', 'Add a tank first.'); return; }
  const thresholds = getThresholds(tank.id);

  const rows = DEFAULT_PARAMS.map(p => {
    const t = thresholds[p.key] || {};
    return `
      <div class="threshold-row-item">
        <div class="threshold-param-name" style="color:${p.color}">${p.label}${p.unit ? ` <span style="color:var(--text-dim);font-weight:400">(${p.unit})</span>` : ''}</div>
        <div class="threshold-input-group">
          Min:
          <input type="number" step="${p.step}" value="${t.min ?? p.defaultMin}" id="tmin-${p.key}" />
          Max:
          <input type="number" step="${p.step}" value="${t.max ?? p.defaultMax}" id="tmax-${p.key}" />
        </div>
      </div>
    `;
  }).join('');

  panelEl.innerHTML = `
    <div class="card">
      <div class="card-title">Your Alert Thresholds — ${escHtml(tank.name)}</div>
      <p style="color:var(--text-muted);font-size:0.85rem;margin-bottom:16px;line-height:1.6">
        Set the acceptable range for each parameter. When a logged value falls outside your range, it will be flagged on the dashboard.
        <strong style="color:var(--text-primary)">This is not advice</strong> — ReefDeck simply shows you when readings are outside the ranges YOU set. You decide what to do.
      </p>
      <div class="threshold-list">${rows}</div>
      <div style="margin-top:20px;display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn-primary-sm" onclick="saveThresholds()">Save Thresholds</button>
        <button class="btn-icon" onclick="resetThresholds()">Reset to Defaults</button>
      </div>
    </div>
  `;
}

function saveThresholds() {
  const tank = getActiveTank();
  if (!tank) return;
  if (!state.thresholds[tank.id]) state.thresholds[tank.id] = {};
  DEFAULT_PARAMS.forEach(p => {
    const mn = parseFloat(document.getElementById('tmin-' + p.key).value);
    const mx = parseFloat(document.getElementById('tmax-' + p.key).value);
    state.thresholds[tank.id][p.key] = {
      min: isNaN(mn) ? null : mn,
      max: isNaN(mx) ? null : mx
    };
  });
  save();
  showToast('Thresholds saved!');
}

function resetThresholds() {
  if (!confirm('Reset all thresholds to defaults?')) return;
  const tank = getActiveTank();
  if (!tank) return;
  state.thresholds[tank.id] = {};
  DEFAULT_PARAMS.forEach(p => {
    state.thresholds[tank.id][p.key] = { min: p.defaultMin, max: p.defaultMax };
  });
  save();
  renderPanel('thresholds');
  showToast('Thresholds reset to defaults.');
}

// ============================================================
// SETTINGS  (appearance + reminders)
// ============================================================
function renderSettings() {
  const prefs = getPrefs();
  const supported = ('Notification' in window);
  const perm = supported ? Notification.permission : 'unsupported';
  const panelEl = document.getElementById('panel-settings');

  let reminderStatus = '';
  if (!supported) reminderStatus = `<p class="form-help">${svgIcon('alert', 13)} This browser does not support notifications.</p>`;
  else if (prefs.reminders && perm === 'granted') reminderStatus = `<p class="form-help" style="color:var(--ok)">${svgIcon('checkCircle', 13)} On — ReefDeck will nudge you about due tasks while open or installed.</p>`;
  else if (prefs.reminders && perm === 'denied') reminderStatus = `<p class="form-help" style="color:var(--bad)">${svgIcon('alert', 13)} Your browser is blocking notifications for this site. Allow them in browser settings.</p>`;
  else reminderStatus = `<p class="form-help">Get a local browser notification when a maintenance task is overdue or due today. Works while ReefDeck is open or installed to your home screen — no account, no server.</p>`;

  panelEl.innerHTML = `
    <div class="card" style="max-width:640px">
      <div class="settings-section">
        <h3>${svgIcon('sun', 15)} Appearance</h3>
        <p style="color:var(--text-muted);font-size:0.85rem;margin-bottom:14px">Choose how ReefDeck looks. Dark is the default.</p>
        <div class="theme-picker">
          <button class="theme-option ${prefs.theme !== 'light' ? 'active' : ''}" onclick="setTheme('dark')">
            <span class="theme-swatch dark">${svgIcon('moon', 18)}</span>
            <span class="theme-name">Abyssal Green<br><em>Dark</em></span>
          </button>
          <button class="theme-option ${prefs.theme === 'light' ? 'active' : ''}" onclick="setTheme('light')">
            <span class="theme-swatch light">${svgIcon('sun', 18)}</span>
            <span class="theme-name">Ocean Mist<br><em>Light</em></span>
          </button>
        </div>
      </div>
      <div class="settings-section" style="margin-bottom:0">
        <h3>${svgIcon('bell', 15)} Maintenance Reminders</h3>
        <label class="toggle-row">
          <span>Browser reminders for due tasks</span>
          <span class="switch ${prefs.reminders ? 'on' : ''}" onclick="toggleReminders()"><span class="switch-knob"></span></span>
        </label>
        ${reminderStatus}
      </div>
    </div>
    ${typeof renderPushCard === 'function' ? renderPushCard() : ''}
    <div class="card" style="max-width:640px;background:var(--surface-2)">
      <div class="card-title">${svgIcon('info', 14)} Privacy</div>
      <p style="color:var(--text-muted);font-size:0.85rem;line-height:1.6">Your theme and reminder preferences are saved on this device only, alongside your logbook data. The only exception is closed-app push (above): if you turn it on, your task names + due dates are stored on our server so reminders can reach you with the app closed — never your readings. Manage or wipe your data anytime in <button onclick="setPanel('export')" style="background:none;border:none;color:var(--brand-bright);cursor:pointer;text-decoration:underline;font-size:0.85rem">Export / Import</button>.</p>
    </div>
  `;
}

function setTheme(theme) {
  const prefs = getPrefs();
  prefs.theme = theme;
  save();
  applyTheme(theme);
  renderPanel('settings');
  showToast(theme === 'light' ? 'Ocean Mist (light) enabled.' : 'Abyssal Green (dark) enabled.');
}

function toggleReminders() {
  const prefs = getPrefs();
  if (!prefs.reminders) {
    // turning on — request permission
    if (!('Notification' in window)) { showToast('Notifications are not supported in this browser.', 'error'); return; }
    if (Notification.permission === 'granted') {
      prefs.reminders = true; save(); renderPanel('settings'); checkReminders();
      showToast('Reminders enabled.');
    } else if (Notification.permission === 'denied') {
      prefs.reminders = true; save(); renderPanel('settings');
      showToast('Enabled in ReefDeck, but your browser is blocking notifications.', 'error');
    } else {
      Notification.requestPermission().then(res => {
        prefs.reminders = true; save(); renderPanel('settings');
        if (res === 'granted') { showToast('Reminders enabled.'); checkReminders(); }
        else showToast('Enabled in ReefDeck — allow notifications in your browser to receive them.', 'error');
      });
    }
  } else {
    prefs.reminders = false; save(); renderPanel('settings');
    showToast('Reminders turned off.');
  }
}

// ============================================================
// EXPORT / IMPORT
// ============================================================
function renderExport() {
  document.getElementById('panel-export').innerHTML = `
    ${typeof renderDriveBackupCard === 'function' ? renderDriveBackupCard() : ''}
    <div class="card">
      <div class="export-why">
        ${svgIcon('lock', 15)}
        <span>Your reef data lives on this device. Export regularly to keep a backup — if you clear your browser or switch devices, exported files are your safety net.</span>
      </div>
      <div class="settings-section">
        <h3>Export Your Data</h3>
        <p style="color:var(--text-muted);font-size:0.85rem;margin-bottom:14px">Your data belongs to you. Export everything at any time in open formats.</p>
        <div class="export-btns">
          <button class="btn-export" onclick="exportJSON()">${svgIcon('download', 17)} Export as JSON (full backup)</button>
          <button class="btn-export" onclick="exportCSV()">${svgIcon('history', 17)} Export Parameter Logs as CSV</button>
        </div>
      </div>
      <div class="settings-section">
        <h3>Import Data</h3>
        <p style="color:var(--text-muted);font-size:0.85rem;margin-bottom:14px">Import a previously exported ReefDeck JSON backup.</p>
        <div class="import-zone" onclick="document.getElementById('import-file').click()">
          ${svgIcon('download', 26)}
          <span>Click to select a ReefDeck JSON file</span>
          <span style="font-size:0.78rem;color:var(--text-dim)">Importing will merge data with your current logbook.</span>
        </div>
        <input type="file" id="import-file" accept=".json" style="display:none" onchange="importJSON(this)" />
        <div style="margin-top:16px;padding:12px 16px;background:rgba(31,184,204,0.07);border:1px solid rgba(31,184,204,0.18);border-radius:var(--radius-sm);display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          ${svgIcon('beaker', 18)}
          <span style="font-size:0.85rem;color:var(--text-muted)">Have Triton or ATI ICP results?</span>
          <button class="btn-inv" onclick="setPanel('icp-import')" style="font-size:0.82rem;padding:6px 14px">${svgIcon('arrowRight', 14)} Import ICP results →</button>
        </div>
        <div style="margin-top:10px;padding:12px 16px;background:rgba(31,184,204,0.07);border:1px solid rgba(31,184,204,0.18);border-radius:var(--radius-sm);display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          ${svgIcon('chip', 18)}
          <span style="font-size:0.85rem;color:var(--text-muted)">Have Apex or GHL controller data?</span>
          <button class="btn-inv" onclick="setPanel('controller-import')" style="font-size:0.82rem;padding:6px 14px">${svgIcon('arrowRight', 14)} Import CSV →</button>
        </div>
      </div>
      <div class="settings-section danger-zone">
        <h3 style="color:var(--accent-red)">Danger Zone</h3>
        <p style="color:var(--text-muted);font-size:0.85rem;margin-bottom:14px">Permanently delete all ReefDeck data on this device. <strong>This cannot be undone.</strong></p>
        <button class="btn-danger" onclick="wipeAllData()">${svgIcon('trash', 16)} Delete All My Data</button>
      </div>
    </div>
    <div class="card" style="background:var(--surface-2)">
      <div class="card-title">Data Summary</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px">
        <div><div class="param-tile-name">Tanks</div><div style="font-size:1.3rem;font-weight:700">${state.tanks.length}</div></div>
        <div><div class="param-tile-name">Log Entries</div><div style="font-size:1.3rem;font-weight:700">${state.logs.length}</div></div>
        <div><div class="param-tile-name">Inventory Items</div><div style="font-size:1.3rem;font-weight:700">${state.inventory.length}</div></div>
        <div><div class="param-tile-name">Coral Colonies</div><div style="font-size:1.3rem;font-weight:700">${getCorals().length}</div></div>
        <div><div class="param-tile-name">Journal Entries</div><div style="font-size:1.3rem;font-weight:700">${state.journal.length}</div></div>
      </div>
    </div>
  `;
}

function exportJSON() {
  const data = { version: 1, exportedAt: new Date().toISOString(), ...DB.load() };
  download('reefdeck-backup-' + new Date().toISOString().slice(0,10) + '.json', JSON.stringify(data, null, 2), 'application/json');
  DB.set('lastExport', new Date().toISOString());
  showToast('JSON backup downloaded!');
}

function exportCSV() {
  const tank = getActiveTank();
  if (!tank) return;
  const logs = state.logs.filter(l => l.tankId === tank.id).sort((a,b) => a.date > b.date ? 1 : -1);
  const headers = ['date', ...DEFAULT_PARAMS.map(p => p.key + '_' + p.unit.replace(/[^a-zA-Z0-9]/g,'_')), 'notes'];
  const rows = logs.map(l => [
    l.date,
    ...DEFAULT_PARAMS.map(p => l.params[p.key] ?? ''),
    '"' + (l.notes || '').replace(/"/g, '""') + '"'
  ]);
  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  download('reefdeck-' + tank.name.replace(/[^a-zA-Z0-9]/g,'-') + '-' + new Date().toISOString().slice(0,10) + '.csv', csv, 'text/csv');
  DB.set('lastExport', new Date().toISOString());
  showToast('CSV downloaded!');
}

// Shared merge for both file Import and Google Drive Restore. Non-destructive:
// adds records whose id isn't already present; never deletes local data.
function mergeBackupData(data) {
  if (data.tanks)       state.tanks       = [...state.tanks,       ...data.tanks.filter(t => !state.tanks.find(x => x.id === t.id))];
  if (data.logs)        state.logs        = [...state.logs,        ...data.logs.filter(l => !state.logs.find(x => x.id === l.id))];
  if (data.inventory)   state.inventory   = [...state.inventory,   ...data.inventory.filter(i => !state.inventory.find(x => x.id === i.id))];
  if (data.journal)     state.journal     = [...state.journal,     ...data.journal.filter(j => !state.journal.find(x => x.id === j.id))];
  if (data.maintenance) state.maintenance = [...state.maintenance, ...data.maintenance.filter(m => !state.maintenance.find(x => x.id === m.id))];
  if (data.corals)      state.corals      = [...state.corals,      ...data.corals.filter(c => !state.corals.find(x => x.id === c.id))];
  if (data.thresholds)  Object.assign(state.thresholds, data.thresholds);
  if (data.photos) { Object.assign(getPhotos(), data.photos); DB.set('photos', state.photos); }
  save();
  renderTankSwitcher();
  if (state.activePanel === 'export') renderPanel('export');
}

function importJSON(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.tanks && !data.logs) { showToast('Invalid ReefDeck backup file.', 'error'); return; }
      const logCount = state.logs.length;
      const taskCount = state.maintenance.length;
      const invCount = state.inventory.length;
      const coralCount = getCorals().length;
      const msg = 'Import will MERGE with your existing data. Your current ' +
        logCount + ' log' + (logCount !== 1 ? 's' : '') + ', ' +
        taskCount + ' task' + (taskCount !== 1 ? 's' : '') + ', ' +
        invCount + ' inventory item' + (invCount !== 1 ? 's' : '') + ', and ' +
        coralCount + ' coral colon' + (coralCount !== 1 ? 'ies' : 'y') + ' will be kept.';
      if (!confirm(msg)) return;
      mergeBackupData(data);
      showToast('Data imported successfully!');
    } catch(err) {
      showToast('Failed to parse file: ' + err.message, 'error');
    }
  };
  reader.readAsText(file);
  input.value = '';
}

function wipeAllData() {
  const logs = state.logs.length;
  const tasks = state.maintenance.length;
  const inv = state.inventory.length;
  const journal = state.journal.length;
  const corals = state.corals.length;
  const overlay = document.getElementById('modal-overlay');
  const body = document.getElementById('modal-body');
  overlay.classList.add('open');
  body.innerHTML = `
    <div class="modal-title" style="color:var(--accent-red)">${svgIcon('trash', 19)} Delete All Data</div>
    <div style="padding:4px 0 14px;color:var(--text-muted);font-size:0.88rem;line-height:1.65">
      <p>This will permanently delete:</p>
      <ul style="margin:10px 0 10px 18px;color:var(--text-primary)">
        <li>${logs} log entr${logs !== 1 ? 'ies' : 'y'}</li>
        <li>${tasks} maintenance task${tasks !== 1 ? 's' : ''}</li>
        <li>${inv} inventory item${inv !== 1 ? 's' : ''}</li>
        <li>${corals} coral colon${corals !== 1 ? 'ies' : 'y'}</li>
        <li>${journal} journal entr${journal !== 1 ? 'ies' : 'y'}</li>
      </ul>
      <p><strong style="color:var(--text-primary)">This cannot be undone.</strong></p>
    </div>
    <div class="modal-actions">
      <button class="btn-modal-cancel" onclick="closeModal()">Cancel</button>
      <button style="background:var(--accent-red);color:#fff;border:none;padding:10px 22px;border-radius:var(--radius-sm);font-weight:700;cursor:pointer;font-size:0.9rem" onclick="confirmWipe()">Delete Everything</button>
    </div>`;
}

function confirmWipe() {
  closeModal();
  localStorage.removeItem('reefdeck_tanks');
  localStorage.removeItem('reefdeck_logs');
  localStorage.removeItem('reefdeck_inventory');
  localStorage.removeItem('reefdeck_corals');
  localStorage.removeItem('reefdeck_journal');
  localStorage.removeItem('reefdeck_thresholds');
  localStorage.removeItem('reefdeck_maintenance');
  localStorage.removeItem('reefdeck_prefs');
  localStorage.removeItem('reefdeck_lastExport');
  localStorage.removeItem('reefdeck_safeBannerDismissed');
  localStorage.removeItem('reefdeck_photos');
  localStorage.removeItem('reefdeck_pwaInstallDismissed');
  localStorage.removeItem('reefdeck_disclaimerDismissed');
  showToast('All data deleted. Reloading...');
  setTimeout(() => location.reload(), 1500);
}

function download(filename, content, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ============================================================
// MODALS
// ============================================================
function openModal(name) {
  const overlay = document.getElementById('modal-overlay');
  const body = document.getElementById('modal-body');
  overlay.classList.add('open');

  if (name === 'add-tank') {
    body.innerHTML = `
      <div class="modal-title">${svgIcon('layers', 19)} Add New Tank</div>
      <div class="form-grid" style="grid-template-columns:1fr 1fr">
        <div class="form-field" style="grid-column:span 2">
          <label class="form-label">Tank Name *</label>
          <input class="form-input" id="m-tank-name" placeholder="Main Display Tank, Frag Tank..." />
        </div>
        <div class="form-field">
          <label class="form-label">Tank Type</label>
          <select class="form-input" id="m-tank-type">
            <option value="Mixed Reef">Mixed Reef</option>
            <option value="SPS Dominant">SPS Dominant</option>
            <option value="LPS/Soft Coral">LPS/Soft Coral</option>
            <option value="FOWLR">FOWLR (Fish Only)</option>
            <option value="Frag Tank">Frag Tank</option>
            <option value="QT / Hospital">QT / Hospital</option>
            <option value="Other">Other</option>
          </select>
        </div>
        <div class="form-field">
          <label class="form-label">Volume</label>
          <div style="display:flex;gap:8px">
            <input class="form-input" type="number" id="m-tank-vol" placeholder="90" style="flex:1" />
            <select class="form-input" id="m-tank-vol-unit" style="width:70px">
              <option>gal</option><option>L</option>
            </select>
          </div>
        </div>
        <div class="form-field" style="grid-column:span 2">
          <label class="form-label">Notes (optional)</label>
          <input class="form-input" id="m-tank-notes" placeholder="Equipment, coral type, anything useful..." />
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn-modal-cancel" onclick="closeModal()">Cancel</button>
        <button class="btn-modal-save" onclick="saveTank()">Add Tank</button>
      </div>
    `;
  } else if (name === 'add-inventory') {
    body.innerHTML = `
      <div class="modal-title">${svgIcon('fish', 19)} Add to Inventory</div>
      <div class="form-grid" style="grid-template-columns:1fr 1fr">
        <div class="form-field">
          <label class="form-label">Type *</label>
          <select class="form-input" id="m-inv-type">
            <option value="coral">Coral</option>
            <option value="fish">Fish</option>
            <option value="invert">Invertebrate</option>
            <option value="equipment">Equipment</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div class="form-field">
          <label class="form-label">Date Added</label>
          <input class="form-input" type="date" id="m-inv-date" value="${todayStr()}" />
        </div>
        <div class="form-field" style="grid-column:span 2">
          <label class="form-label">Name *</label>
          <input class="form-input" id="m-inv-name" placeholder="OG Bounce Mushroom, Ocellaris Clownfish..." />
        </div>
        <div class="form-field">
          <label class="form-label">Cost ($)</label>
          <input class="form-input" type="number" step="0.01" id="m-inv-price" placeholder="35.00" />
        </div>
        <div class="form-field">
          <label class="form-label">Photo (optional)</label>
          <input type="file" accept="image/*" id="m-inv-photo" class="form-input" style="padding:6px;font-size:0.8rem" />
        </div>
        <div class="form-field" style="grid-column:span 2">
          <label class="form-label">Notes</label>
          <input class="form-input" id="m-inv-notes" placeholder="Placement, health notes, vendor..." />
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn-modal-cancel" onclick="closeModal()">Cancel</button>
        <button class="btn-modal-save" onclick="saveInventoryItem()">Add Item</button>
      </div>
    `;
  } else if (name === 'add-coral') {
    body.innerHTML = `
      <div class="modal-title">${svgIcon('coral', 19)} Add Coral Colony</div>
      <div class="form-grid" style="grid-template-columns:1fr 1fr">
        <div class="form-field" style="grid-column:span 2">
          <label class="form-label">Name *</label>
          <input class="form-input" id="m-coral-name" placeholder="Rainbow Montipora, Purple Tip Hammer..." />
        </div>
        <div class="form-field">
          <label class="form-label">Species</label>
          <input class="form-input" id="m-coral-species" placeholder="Montipora spp., Euphyllia ancora..." />
        </div>
        <div class="form-field">
          <label class="form-label">Date Added</label>
          <input class="form-input" type="date" id="m-coral-date" value="${todayStr()}" />
        </div>
        <div class="form-field">
          <label class="form-label">Source</label>
          <input class="form-input" id="m-coral-source" placeholder="LFS, frag swap, ReefKoi..." />
        </div>
        <div class="form-field">
          <label class="form-label">Placement</label>
          <input class="form-input" id="m-coral-placement" placeholder="Back left high, center mid..." />
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn-modal-cancel" onclick="closeModal()">Cancel</button>
        <button class="btn-modal-save" onclick="saveCoralColony()">Add Colony</button>
      </div>
    `;
  } else if (name === 'add-growth') {
    const coralId = arguments[1] || '';
    const coral = state.corals.find(c => c.id === coralId);
    const coralName = coral ? escHtml(coral.name) : '';
    body.innerHTML = `
      <div class="modal-title">${svgIcon('coral', 19)} Add Growth Entry — ${coralName}</div>
      <input type="hidden" id="m-growth-coralId" value="${coralId}" />
      <div class="form-grid" style="grid-template-columns:1fr 1fr">
        <div class="form-field">
          <label class="form-label">Date *</label>
          <input class="form-input" type="date" id="m-growth-date" value="${todayStr()}" />
        </div>
        <div class="form-field">
          <label class="form-label">Photo (optional)</label>
          <input type="file" accept="image/*" id="m-growth-photo" class="form-input" style="padding:6px;font-size:0.8rem" />
        </div>
        <div class="form-field" style="grid-column:span 2">
          <label class="form-label">Observation Note</label>
          <textarea class="form-input" id="m-growth-note" rows="3" style="resize:vertical;font-family:inherit" placeholder="What did you observe? Encrusting, branching, color change, polyp extension..."></textarea>
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn-modal-cancel" onclick="closeModal()">Cancel</button>
        <button class="btn-modal-save" onclick="saveGrowthEntry()">Save Entry</button>
      </div>
    `;
  }
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
}

function saveTank() {
  const name = document.getElementById('m-tank-name').value.trim();
  if (!name) { showToast('Tank name is required.', 'error'); return; }
  if (!isPro() && state.tanks.length >= FREE_TANK_LIMIT) {
    closeModal();
    showPaywall('Tracking more than ' + FREE_TANK_LIMIT + ' tanks');
    return;
  }
  const tank = {
    id: uid(), name,
    type: document.getElementById('m-tank-type').value,
    volume: parseFloat(document.getElementById('m-tank-vol').value) || null,
    volumeUnit: document.getElementById('m-tank-vol-unit').value,
    notes: document.getElementById('m-tank-notes').value.trim(),
    createdAt: new Date().toISOString(),
  };
  state.tanks.push(tank);
  state.activeTankId = tank.id;
  save();
  renderTankSwitcher();
  closeModal();
  showToast('Tank "' + name + '" created!');
  setPanel('dashboard');
}

function saveInventoryItem() {
  const tank = getActiveTank();
  if (!tank) return;
  const name = document.getElementById('m-inv-name').value.trim();
  if (!name) { showToast('Name is required.', 'error'); return; }
  const photoInput = document.getElementById('m-inv-photo');
  const file = photoInput.files[0];
  const save_ = (photoDataUrl) => {
    state.inventory.push({
      id: uid(), tankId: tank.id,
      type: document.getElementById('m-inv-type').value,
      name,
      placedDate: document.getElementById('m-inv-date').value,
      price: parseFloat(document.getElementById('m-inv-price').value) || null,
      notes: document.getElementById('m-inv-notes').value.trim(),
      photoDataUrl: photoDataUrl || null,
    });
    save();
    closeModal();
    renderPanel('inventory');
    showToast('Item added to inventory!');
  };
  if (file) {
    const reader = new FileReader();
    reader.onload = (e) => save_(e.target.result);
    reader.readAsDataURL(file);
  } else {
    save_();
  }
}

// ============================================================
// ICP IMPORT — Triton / ATI ICP-OES
// ============================================================

// Ion table: element symbol, full name, and mapping to standard log param (null = trace only).
const ICP_IONS = [
  { sym: 'Li',  name: 'Lithium',    std: null  },
  { sym: 'B',   name: 'Boron',      std: null  },
  { sym: 'Al',  name: 'Aluminum',   std: null  },
  { sym: 'Si',  name: 'Silicon',    std: null  },
  { sym: 'V',   name: 'Vanadium',   std: null  },
  { sym: 'Cr',  name: 'Chromium',   std: null  },
  { sym: 'Mn',  name: 'Manganese',  std: null  },
  { sym: 'Fe',  name: 'Iron',       std: null  },
  { sym: 'Co',  name: 'Cobalt',     std: null  },
  { sym: 'Ni',  name: 'Nickel',     std: null  },
  { sym: 'Cu',  name: 'Copper',     std: null  },
  { sym: 'Zn',  name: 'Zinc',       std: null  },
  { sym: 'As',  name: 'Arsenic',    std: null  },
  { sym: 'Se',  name: 'Selenium',   std: null  },
  { sym: 'Mo',  name: 'Molybdenum', std: null  },
  { sym: 'Sn',  name: 'Tin',        std: null  },
  { sym: 'Sb',  name: 'Antimony',   std: null  },
  { sym: 'Ba',  name: 'Barium',     std: null  },
  { sym: 'Pb',  name: 'Lead',       std: null  },
  { sym: 'Mg',  name: 'Magnesium',  std: 'mg'  },
  { sym: 'Ca',  name: 'Calcium',    std: 'ca'  },
  { sym: 'K',   name: 'Potassium',  std: null  },
  { sym: 'S',   name: 'Sulfur',     std: null  },
  { sym: 'Sr',  name: 'Strontium',  std: null  },
  { sym: 'I',   name: 'Iodine',     std: null  },
  { sym: 'F',   name: 'Fluorine',   std: null  },
  { sym: 'Br',  name: 'Bromine',    std: null  },
  { sym: 'Na',  name: 'Sodium',     std: null  },
  { sym: 'Cl',  name: 'Chlorine',   std: null  },
  { sym: 'P',   name: 'Phosphorus', std: 'po4' }, // P → PO4 in reef context
  { sym: 'N',   name: 'Nitrogen',   std: 'no3' }, // N → NO3 in reef context
  { sym: 'NO3', name: 'Nitrate',    std: 'no3' },
  { sym: 'PO4', name: 'Phosphate',  std: 'po4' },
];

// Build fast lookup: lowercase key → ion entry
const _ICP_MAP = (function() {
  const m = {};
  ICP_IONS.forEach(function(ion) {
    m[ion.sym.toLowerCase()] = ion;
    m[ion.name.toLowerCase()] = ion;
  });
  return m;
})();

function parseICPText(text) {
  var results = [];
  var seen = {};
  var lines = text.split(/\r?\n/);

  for (var li = 0; li < lines.length; li++) {
    var line = lines[li].trim();
    if (!line || !/\d/.test(line)) continue; // skip non-numeric lines

    // Extract numeric value (first number in line, support comma decimal)
    var numMatch = line.match(/(\d+(?:[.,]\d+)?)/);
    if (!numMatch) continue;
    var numVal = parseFloat(numMatch[1].replace(',', '.'));
    if (isNaN(numVal) || numVal < 0) continue;

    // Extract unit
    var unitMatch = line.match(/\b(mg\/L|ppm|μg\/L|ug\/L|ppb)\b/i);
    var unitStr = unitMatch ? unitMatch[1].toLowerCase() : 'ppm';

    // Normalize to ppm: μg/L or ppb → ÷1000; mg/L == ppm
    var valuePpm = (unitStr === 'μg/l' || unitStr === 'ug/l' || unitStr === 'ppb')
      ? numVal / 1000
      : numVal;

    // Identify ion — three strategies, first match wins
    var matchedIon = null;

    // 1. Symbol inside parentheses: "(Ca)" or "(NO3)"
    var parenMatch = line.match(/\(([A-Za-z]{1,3}\d*)\)/);
    if (parenMatch) {
      matchedIon = _ICP_MAP[parenMatch[1].toLowerCase()] || null;
    }

    // 2. Word at start of line (name or symbol)
    if (!matchedIon) {
      var ll = line.toLowerCase();
      for (var k = 0; k < ICP_IONS.length; k++) {
        var ion = ICP_IONS[k];
        var nm = ion.name.toLowerCase();
        var sm = ion.sym.toLowerCase();
        if (ll.indexOf(nm) === 0 || ll === sm ||
            ll.indexOf(sm + ' ') === 0 || ll.indexOf(sm + '\t') === 0 ||
            ll.indexOf(sm + ':') === 0 || ll.indexOf(sm + ',') === 0) {
          matchedIon = ion;
          break;
        }
      }
    }

    // 3. Any word token matching a symbol or name
    if (!matchedIon) {
      var tokens = line.split(/[\s,;:\t\(\)]+/);
      for (var ti = 0; ti < tokens.length; ti++) {
        var tok = tokens[ti].replace(/[^a-zA-Z0-9]/g, '');
        if (!tok) continue;
        var candidate = _ICP_MAP[tok.toLowerCase()];
        if (candidate) { matchedIon = candidate; break; }
      }
    }

    if (!matchedIon || seen[matchedIon.sym]) continue;
    seen[matchedIon.sym] = true;

    results.push({
      sym: matchedIon.sym,
      name: matchedIon.name,
      value: Math.round(valuePpm * 10000) / 10000,
      std: matchedIon.std,
    });
  }

  return results;
}

function renderICPImport() {
  var tank = getActiveTank();
  var panelEl = document.getElementById('panel-icp-import');

  if (!isPro()) {
    panelEl.innerHTML = `
      <div class="card">
        <div class="card-title">${svgIcon('beaker', 15)} ICP Import — Triton / ATI</div>
        <p style="color:var(--text-muted);font-size:0.85rem;margin-bottom:16px">Paste your Triton or ATI ICP-OES result and log all ions in one shot — calcium, magnesium, nitrate, phosphate, and all trace elements.</p>
        <div class="icp-locked-wrap">
          <div class="icp-locked-blur" aria-hidden="true">
            <textarea class="icp-textarea" disabled placeholder="Paste your Triton or ATI ICP result here…
Lithium (Li)     0.18    ppm
Boron (B)        4.32    ppm
Magnesium (Mg)   1350    ppm
Calcium (Ca)     430     ppm
Strontium (Sr)   8.20    ppm
Iron (Fe)        0.008   ppm"></textarea>
            <table class="icp-preview-table" style="margin-top:14px">
              <thead><tr><th>Element</th><th>Value</th><th>Maps to</th></tr></thead>
              <tbody>
                <tr><td>Calcium (Ca)</td><td>430 ppm</td><td>Ca ✓</td></tr>
                <tr><td>Magnesium (Mg)</td><td>1350 ppm</td><td>Mg ✓</td></tr>
                <tr><td>Lithium (Li)</td><td>0.18 ppm</td><td>trace ion</td></tr>
                <tr><td>Boron (B)</td><td>4.32 ppm</td><td>trace ion</td></tr>
                <tr><td>Strontium (Sr)</td><td>8.20 ppm</td><td>trace ion</td></tr>
              </tbody>
            </table>
          </div>
          <div class="icp-paywall-overlay">
            ${svgIcon('crown', 32)}
            <div class="icp-paywall-title">ICP Import is a Pro feature</div>
            <p style="color:var(--text-muted);font-size:0.85rem;margin:8px 0 18px;max-width:320px;text-align:center">Upgrade to log all ions from Triton and ATI ICP results in one tap — no hand-keying 30+ values.</p>
            <button class="btn-primary-sm" onclick="showPaywall('ICP Import')" style="padding:12px 32px">${svgIcon('crown', 15)} Get ReefDeck Pro</button>
          </div>
        </div>
      </div>`;
    return;
  }

  if (!tank) { panelEl.innerHTML = renderEmptyState('No tank', 'Add a tank first.'); return; }

  panelEl.innerHTML = `
    <div class="card">
      <div class="card-title">${svgIcon('beaker', 15)} ICP Import — Triton / ATI</div>
      <p style="color:var(--text-muted);font-size:0.85rem;margin-bottom:14px">Paste your Triton or ATI ICP-OES result, or upload a .txt/.csv file. All ions will be logged to <strong style="color:var(--text-primary)">${escHtml(tank.name)}</strong>.</p>
      <div class="icp-upload-row">
        <label class="btn-inv" style="cursor:pointer;font-size:0.82rem;padding:7px 14px" for="icp-file-input">${svgIcon('download', 14)} Upload file (.txt / .csv)</label>
        <input type="file" id="icp-file-input" accept=".txt,.csv" style="display:none" onchange="icpFileUpload(this)" />
        <span style="font-size:0.78rem;color:var(--text-dim)">— or paste directly below</span>
      </div>
      <textarea class="icp-textarea" id="icp-paste-area" placeholder="Lithium (Li)     0.18    ppm&#10;Boron (B)        4.32    ppm&#10;Magnesium (Mg)   1350    ppm&#10;Calcium (Ca)     430     ppm&#10;…"></textarea>
      <div style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn-primary-sm" onclick="icpParse()">${svgIcon('chart', 15)} Parse &amp; Preview</button>
        <button class="btn-inv" onclick="document.getElementById('icp-paste-area').value='';document.getElementById('icp-preview-area').innerHTML=''" style="font-size:0.82rem">Clear</button>
      </div>
      <p style="margin-top:14px;font-size:0.78rem;color:var(--text-dim)">${svgIcon('info', 13)} Supports Triton and ATI text/CSV formats. Units ppm, mg/L, μg/L all handled. ICP does not include salinity, pH, alkalinity, or temperature — those remain blank in this log entry.</p>
    </div>
    <div id="icp-preview-area"></div>`;
}

function icpFileUpload(input) {
  var file = input.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(e) {
    var el = document.getElementById('icp-paste-area');
    if (el) el.value = e.target.result;
  };
  reader.readAsText(file);
  input.value = '';
}

function icpParse() {
  var el = document.getElementById('icp-paste-area');
  var text = el ? el.value.trim() : '';
  if (!text) { showToast('Paste your ICP result first.', 'error'); return; }

  var ions = parseICPText(text);
  if (ions.length === 0) {
    showToast('No ions recognised — check the pasted format.', 'error');
    return;
  }

  var standardIons = ions.filter(function(i) { return i.std; });
  var traceIons    = ions.filter(function(i) { return !i.std; });

  var stdRows = standardIons.map(function(i) {
    var param = DEFAULT_PARAMS.find(function(p) { return p.key === i.std; });
    return '<tr><td><strong>' + escHtml(param ? param.label : i.std) + '</strong></td>' +
           '<td>' + i.value + ' ppm</td></tr>';
  }).join('');

  var stdHtml = standardIons.length > 0
    ? '<div style="margin-bottom:16px"><div class="param-tile-name" style="margin-bottom:6px">Standard parameters found</div>' +
      '<table class="icp-preview-table"><tbody>' + stdRows + '</tbody></table></div>'
    : '<p style="color:var(--text-muted);font-size:0.85rem;margin-bottom:12px">No standard parameters (Ca / Mg / NO3 / PO4) identified — all ions go to journal as trace.</p>';

  var traceHtml = traceIons.length > 0
    ? '<div><div class="param-tile-name" style="margin-bottom:6px">Trace ions → journal <span style="color:var(--brand-bright)">(' + traceIons.length + ')</span></div>' +
      '<div style="font-size:0.82rem;color:var(--text-muted);line-height:1.7">' +
      traceIons.map(function(i) { return i.sym + ': ' + i.value + ' ppm'; }).join(' &middot; ') +
      '</div></div>'
    : '';

  var previewEl = document.getElementById('icp-preview-area');
  previewEl.innerHTML = `
    <div class="card">
      <div class="card-title">${svgIcon('note', 15)} Preview — ${ions.length} ion${ions.length !== 1 ? 's' : ''} found</div>
      <p style="color:var(--text-muted);font-size:0.82rem;margin-bottom:16px">Review before committing. ReefDeck records values only — no interpretation.</p>
      ${stdHtml}
      ${traceHtml}
      <div style="margin-top:20px;display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn-primary-sm" onclick="icpCommit()" style="padding:12px 28px">${svgIcon('checkCircle', 16)} Log ICP Results</button>
        <button class="btn-inv" onclick="document.getElementById('icp-preview-area').innerHTML=''">Cancel</button>
      </div>
    </div>`;

  window._icpParsed = ions;
}

function icpCommit() {
  var ions = window._icpParsed;
  if (!ions || !ions.length) return;
  var tank = getActiveTank();
  if (!tank) return;

  var today = todayStr();
  var standardIons = ions.filter(function(i) { return i.std; });
  var traceIons    = ions.filter(function(i) { return !i.std; });

  // Build params object from standard ions
  var params = {};
  standardIons.forEach(function(i) { params[i.std] = i.value; });

  // Trace ions stored as notes JSON blob
  var notesText = 'ICP import';
  if (traceIons.length > 0) {
    var traceObj = {};
    traceIons.forEach(function(i) { traceObj[i.sym] = i.value; });
    notesText = 'ICP trace ions: ' + JSON.stringify(traceObj);
  }

  state.logs.push({ id: uid(), tankId: tank.id, date: today, params: params, notes: notesText });

  // Journal entry: summary line (max 500 chars)
  var ionList = ions.map(function(i) { return i.sym + ' ' + i.value + ' ppm'; }).join(', ');
  var journalText = 'ICP import — ' + today + ' — ' + ions.length + ' ions: ' + ionList;
  if (journalText.length > 500) journalText = journalText.slice(0, 497) + '…';
  state.journal.push({ id: uid(), tankId: tank.id, date: today, text: journalText, tags: ['icp'] });

  save();
  window._icpParsed = null;

  var sc = standardIons.length, tc = traceIons.length;
  document.getElementById('icp-preview-area').innerHTML = `
    <div class="card" style="border-color:rgba(31,184,204,0.4)">
      <div style="display:flex;align-items:center;gap:10px;font-weight:600;font-size:1rem;color:var(--brand-bright)">
        ${svgIcon('checkCircle', 20)} ${sc} standard param${sc !== 1 ? 's' : ''} + ${tc} trace ion${tc !== 1 ? 's' : ''} logged.
      </div>
      <div style="margin-top:14px;display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn-inv" onclick="setPanel('history')">${svgIcon('history', 15)} View in History →</button>
        <button class="btn-inv" onclick="setPanel('journal')">${svgIcon('journal', 15)} View in Journal →</button>
      </div>
    </div>`;

  showToast(sc + ' standard param' + (sc !== 1 ? 's' : '') + ' + ' + tc + ' trace ion' + (tc !== 1 ? 's' : '') + ' logged!');
}

// ============================================================
// CONTROLLER CSV IMPORT (Apex / GHL)
// ============================================================

function renderControllerImport() {
  var tank = getActiveTank();
  var panelEl = document.getElementById('panel-controller-import');
  if (!tank) { panelEl.innerHTML = renderEmptyState('No tank', 'Add a tank first.'); return; }

  panelEl.innerHTML = `
    <div class="card">
      <div class="card-title">${svgIcon('chip', 15)} Controller Import — Apex / GHL</div>
      <p style="color:var(--text-muted);font-size:0.85rem;margin-bottom:12px">Upload a CSV exported from Neptune Apex or GHL ProfiLux to log historical readings into <strong style="color:var(--text-primary)">${escHtml(tank.name)}</strong>.</p>
      <div class="import-zone" onclick="document.getElementById('ctrl-csv-input').click()">
        ${svgIcon('chip', 26)}
        <span>Click to select an Apex or GHL CSV file</span>
        <span style="font-size:0.78rem;color:var(--text-dim)">Accepts .csv exports from Neptune Apex and GHL ProfiLux</span>
      </div>
      <input type="file" id="ctrl-csv-input" accept=".csv" style="display:none" onchange="controllerCSVSelected(this)" />
      <p style="margin-top:14px;font-size:0.78rem;color:var(--text-dim)">${svgIcon('info', 13)} Controllers log automatically — you may have hundreds of rows. ReefDeck imports one reading per day (the first reading found for each date).</p>
    </div>
    <div id="ctrl-import-preview"></div>`;
}

// Parse a timestamp cell into YYYY-MM-DD. Returns null if unrecognised.
// european=true parses slash dates as DD/MM/YYYY (GHL ProfiLux); otherwise MM/DD/YYYY (US, e.g. Apex).
function parseCSVDate(dateStr, european) {
  if (!dateStr) return null;
  // ISO: "2026-06-01" or "2026-06-01 08:00"
  var isoM = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoM) return isoM[1] + '-' + isoM[2] + '-' + isoM[3];
  // Slash date: "06/01/2026" — US is MM/DD, European (GHL) is DD/MM
  var slashM = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slashM) {
    var month = european ? slashM[2] : slashM[1];
    var day = european ? slashM[1] : slashM[2];
    if (Number(month) > 12 && Number(day) <= 12) { var t = month; month = day; day = t; }
    return slashM[3] + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
  }
  return null;
}

// Split one CSV line respecting double-quoted fields.
function splitCSVLine(line) {
  var result = [];
  var cur = '';
  var inQ = false;
  for (var i = 0; i < line.length; i++) {
    var c = line[i];
    if (c === '"') { inQ = !inQ; }
    else if (c === ',' && !inQ) { result.push(cur); cur = ''; }
    else { cur += c; }
  }
  result.push(cur);
  return result;
}

function parseControllerCSV(text) {
  var lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(function(l) { return l.trim() !== ''; });
  if (lines.length < 2) return [];

  var headerLine = lines[0];

  // Detect delimiter: if header has more semicolons than commas, use semicolons (European GHL).
  var useSemi = (headerLine.split(';').length - 1) > (headerLine.split(',').length - 1);

  function splitLine(l) {
    if (useSemi) return l.split(';').map(function(c) { return c.trim(); });
    return splitCSVLine(l).map(function(c) { return c.trim(); });
  }

  var headers = splitLine(headerLine);

  // Normalise a header: lowercase, strip units in parens/brackets, trim.
  function normHdr(h) {
    return h.toLowerCase().replace(/\(.*?\)/g, '').replace(/\[.*?\]/g, '').trim();
  }

  // Map from normalised header to ReefDeck param key (or 'date').
  var COL_MAP = {
    'date/time': 'date', 'datetime': 'date', 'date': 'date', 'time': 'date',
    'alk': 'alk', 'alkalinity': 'alk', 'kh': 'alk',
    'ca': 'ca', 'calcium': 'ca',
    'mg': 'mg', 'magnesium': 'mg',
    'temp': 'temp', 'temperature': 'temp',
    'ph': 'ph',
    'sal': 'sal', 'salinity': 'sal', 'salt': 'sal',
    'no3': 'no3', 'nitrate': 'no3',
    'po4': 'po4', 'phosphate': 'po4',
  };

  var colMap = headers.map(function(h) { return COL_MAP[normHdr(h)] || null; });
  var dateColIdx = colMap.indexOf('date');

  var results = [];
  var seenDates = {};

  for (var i = 1; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;
    var cells = splitLine(line);

    var dateCell = dateColIdx !== -1 ? (cells[dateColIdx] || '') : '';
    var dateStr = parseCSVDate(dateCell.trim(), useSemi);
    if (!dateStr) continue;

    // First reading per date only
    if (seenDates[dateStr]) continue;
    seenDates[dateStr] = true;

    var params = {};
    var hasAny = false;
    for (var j = 0; j < headers.length; j++) {
      var mk = colMap[j];
      if (!mk || mk === 'date') continue;
      var cellVal = (cells[j] || '').trim();
      if (!cellVal || cellVal === '-' || cellVal.toLowerCase() === 'n/a') continue;
      // European decimal: replace comma with dot (safe after splitting)
      var numVal = parseFloat(cellVal.replace(',', '.'));
      if (isNaN(numVal)) continue;
      params[mk] = numVal;
      hasAny = true;
    }
    if (!hasAny) continue;
    results.push({ date: dateStr, params: params });
  }

  return results;
}

function controllerCSVSelected(input) {
  var file = input.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(e) {
    var parsed = parseControllerCSV(e.target.result);
    controllerCSVShowPreview(parsed);
  };
  reader.readAsText(file);
  input.value = '';
}

function controllerCSVShowPreview(parsed) {
  var previewEl = document.getElementById('ctrl-import-preview');
  if (!previewEl) return;

  if (!parsed || parsed.length === 0) {
    previewEl.innerHTML = `<div class="card">
      <p style="color:var(--accent-red);font-size:0.88rem">${svgIcon('alert', 15)} No readings recognised. Check that the file is a valid Apex or GHL CSV export with a recognised header row.</p>
    </div>`;
    return;
  }

  var tank = getActiveTank();
  var existingDates = {};
  state.logs.filter(function(l) { return l.tankId === tank.id; }).forEach(function(l) { existingDates[l.date] = true; });

  var toImport = parsed.filter(function(r) { return !existingDates[r.date]; });
  var skipCount = parsed.length - toImport.length;

  var allDates = parsed.map(function(r) { return r.date; }).sort();
  var startDate = allDates[0];
  var endDate = allDates[allDates.length - 1];

  window._ctrlCSVParsed = toImport;

  previewEl.innerHTML = `
    <div class="card">
      <div class="card-title">${svgIcon('note', 15)} Preview</div>
      <p style="color:var(--text-muted);font-size:0.88rem;margin-bottom:16px">
        Found <strong style="color:var(--text-primary)">${parsed.length}</strong> reading${parsed.length !== 1 ? 's' : ''} from
        <strong style="color:var(--text-primary)">${fmtDate(startDate)}</strong> to
        <strong style="color:var(--text-primary)">${fmtDate(endDate)}</strong>.<br>
        <span style="color:var(--accent-green)">${toImport.length} will be NEW (no existing log on that date)</span>${skipCount > 0 ? ' &middot; <span style="color:var(--text-dim)">' + skipCount + ' will be SKIPPED (date already has a log)</span>' : ''}.
      </p>
      ${toImport.length === 0
        ? '<p style="color:var(--text-dim);font-size:0.85rem">All dates in this file already have a log entry — nothing to import.</p>'
        : `<div style="margin-top:20px;display:flex;gap:10px;flex-wrap:wrap">
             <button class="btn-primary-sm" onclick="controllerCSVCommit()" style="padding:12px 28px">${svgIcon('checkCircle', 16)} Import ${toImport.length} Reading${toImport.length !== 1 ? 's' : ''}</button>
             <button class="btn-inv" onclick="document.getElementById('ctrl-import-preview').innerHTML=''" style="font-size:0.82rem">Cancel</button>
           </div>`}
    </div>`;
}

function controllerCSVCommit() {
  var tank = getActiveTank();
  if (!tank) return;
  var rows = window._ctrlCSVParsed;
  if (!rows || !rows.length) return;

  rows.forEach(function(r) {
    state.logs.push({ id: uid(), tankId: tank.id, date: r.date, params: r.params, notes: 'Controller import' });
  });
  save();
  window._ctrlCSVParsed = null;

  var n = rows.length;
  document.getElementById('ctrl-import-preview').innerHTML = `
    <div class="card" style="border-color:rgba(31,184,204,0.4)">
      <div style="display:flex;align-items:center;gap:10px;font-weight:600;font-size:1rem;color:var(--brand-bright)">
        ${svgIcon('checkCircle', 20)} ${n} reading${n !== 1 ? 's' : ''} imported.
      </div>
      <div style="margin-top:14px">
        <button class="btn-inv" onclick="setPanel('history')">${svgIcon('history', 15)} View in History →</button>
      </div>
    </div>`;
  showToast(n + ' reading' + (n !== 1 ? 's' : '') + ' imported!');
}

// ============================================================
// UTILITY
// ============================================================
function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function renderEmptyState(title, msg, modalName, btnFn, extraHtml) {
  const btnHtml = (modalName || btnFn) ? `
    <button class="btn-primary-sm" onclick="${modalName ? "openModal('" + modalName + "')" : '('+btnFn.toString()+')()'}" style="padding:11px 24px">
      ${svgIcon('plus', 16)} ${modalName === 'add-tank' ? 'Add Tank' : 'Get Started'}
    </button>` : '';
  return `<div class="empty-state"><div class="empty-icon">${svgIcon('fish', 30)}</div><h3>${escHtml(title)}</h3><p>${escHtml(msg)}</p>${btnHtml}${extraHtml || ''}</div>`;
}

// ============================================================
// PRO / ENTITLEMENTS
// ============================================================
// ReefDeck is client-side-first: entitlement is stored locally. After a Pro
// purchase the user is returned with ?upgrade=success (or enters a license key),
// which flips the local flag. Cross-device continuity comes from per-user Google
// Drive backup/restore (no central sync server) — until then this honest local
// unlock keeps the app 100% offline and the liability architecture intact
// (still never advises).
const FREE_TANK_LIMIT = 2;                                  // free keeps display + frag/QT
const STRIPE_LINK = 'https://buy.stripe.com/3cI14n0TNeD9acIcPk7Zu00';  // LIVE €9.99/year Pro Payment Link — integrated 2026-06-29
const PRO_PRICE = { yearly: '€9.99', cur: 'EUR' };  // annual-only, auto-renewing; LOCKED 2026-06-27. No monthly, no lifetime.
const LICENSE_PREFIX = 'REEF-';                             // any REEF-XXXX key unlocks locally for now

function isPro() { const p = getPrefs(); return !!p.pro; }

function setPro(on, opts) {
  opts = opts || {};
  const p = getPrefs();
  p.pro = !!on;
  if (on && !p.proSince) p.proSince = todayStr();
  if (!on) delete p.proSince;
  save();
  renderProStatus();
  if (state.activePanel) renderPanel(state.activePanel);
  if (!opts.silent) showToast(on ? 'ReefDeck Pro unlocked. Thank you!' : 'Reverted to the free plan.');
}

// Pro perks list — single source of truth for paywall, upgrade page, landing parity.
const PRO_PERKS = [
  { icon: 'gauge',   t: 'Insights & Stability Scores',  d: 'Per-parameter stability scoring, drift trends, consumption rate and time-in-range — computed from your own logs.' },
  { icon: 'layers',  t: 'Unlimited tanks',              d: 'Track every system — display, frag, QT, multiple builds. Free covers up to ' + FREE_TANK_LIMIT + '.' },
  { icon: 'printer', t: 'Printable PDF tank reports',   d: 'One-tap shareable report of parameters, ranges and trends — for your LFS, a vet, or a build thread.' },
  { icon: 'cloud',   t: 'Backup to your own Google Drive', d: 'One-tap encrypted backup to your personal Google Drive, restore on any device. Your data lives in your account — we never run a sync server or hold a copy.', soon: true },
  { icon: 'bell',    t: 'Push reminders anywhere',      d: 'Maintenance nudges pushed to your device even when ReefDeck is fully closed — set your own daily time, no app needed.' },
  { icon: 'sparkle', t: 'Priority features & themes',   d: 'Extra accent themes, early access to new tools, and a direct line for feature requests.' },
];

function showPaywall(featureLabel) {
  const overlay = document.getElementById('modal-overlay');
  const body = document.getElementById('modal-body');
  overlay.classList.add('open');
  const lead = featureLabel
    ? `<p style="color:var(--text-muted);font-size:0.9rem;margin:-4px 0 16px">${escHtml(featureLabel)} is a <strong style="color:var(--brand-bright)">ReefDeck Pro</strong> feature.</p>`
    : '';
  body.innerHTML = `
    <div class="modal-title">${svgIcon('crown', 19)} Upgrade to ReefDeck Pro</div>
    ${lead}
    <div class="paywall-perks">
      ${PRO_PERKS.map(p => `<div class="paywall-perk">${svgIcon(p.icon, 16)}<div><strong>${p.t}${p.soon ? ' <span class="perk-soon">Coming soon</span>' : ''}</strong><span>${p.d}</span></div></div>`).join('')}
    </div>
    <div class="paywall-price">${PRO_PRICE.yearly}<span>/year</span></div>
    <div class="modal-actions" style="flex-direction:column;gap:10px">
      <button class="btn-modal-save" style="width:100%" onclick="goPro()">${svgIcon('crown', 16)} Get ReefDeck Pro</button>
      <button class="btn-modal-cancel" style="width:100%" onclick="closeModal();setPanel('upgrade')">See full comparison & enter a license key</button>
    </div>`;
}

// Open the Stripe checkout (or the upgrade page if not wired yet).
function goPro() {
  if (STRIPE_LINK && STRIPE_LINK.indexOf('http') === 0) {
    window.open(STRIPE_LINK, '_blank');
  } else {
    closeModal();
    setPanel('upgrade');
    showToast('Checkout link not configured yet — enter a license key below.', 'error');
  }
}

function applyLicense(inputId) {
  const el = document.getElementById(inputId);
  const key = (el ? el.value : '').trim().toUpperCase();
  if (!key) { showToast('Enter your license key.', 'error'); return; }
  if (key.indexOf(LICENSE_PREFIX) === 0 && key.length >= 9) {
    const p = getPrefs(); p.license = key; save();
    setPro(true);
  } else {
    showToast('That key doesn’t look right. Keys start with ' + LICENSE_PREFIX, 'error');
  }
}

// Sidebar footer reflects current plan.
function renderProStatus() {
  const el = document.getElementById('pro-status');
  if (!el) return;
  if (isPro()) {
    el.innerHTML = `<div class="pro-badge-active">${svgIcon('crown', 15)} <strong>ReefDeck Pro</strong><span>Active${getPrefs().proSince ? ' · since ' + getPrefs().proSince : ''}</span></div>`;
  } else {
    el.innerHTML = `<div class="pro-upsell">
      <strong>${svgIcon('crown', 15)} ReefDeck Pro</strong>
      Unlimited tanks, Insights, PDF reports & more.
      <button class="btn-pro-link" onclick="setPanel('upgrade')">Upgrade ${svgIcon('arrowRight', 14)}</button>
    </div>`;
  }
}

// ============================================================
// UPGRADE / PRICING PANEL
// ============================================================
const FREE_FEATURES = [
  'Unlimited parameter logging & history',
  'Trend charts with your safe-range bands',
  'Custom thresholds & at-a-glance status',
  'Maintenance & dosing scheduler',
  'Dose calculator (your own product rates)',
  'Coral & livestock inventory + journal',
  'Light / dark themes',
  'Local browser reminders',
  'Full JSON + CSV export — your data, always',
  'Up to ' + FREE_TANK_LIMIT + ' tanks',
];

function renderUpgrade() {
  const pro = isPro();
  const yes = svgIcon('check', 15);
  const no = '<span style="color:var(--text-dim)">—</span>';
  const rows = [
    ['Parameter logbook, charts & thresholds', true, true],
    ['Scheduler, dose calculator, inventory, journal', true, true],
    ['JSON / CSV export', true, true],
    ['Number of tanks', FREE_TANK_LIMIT + '', 'Unlimited'],
    ['Insights — stability scores, drift & consumption', false, true],
    ['Printable PDF tank reports', false, true],
    ['Backup & restore via your own Google Drive', false, 'Coming soon'],
    ['Push reminders when app is closed', false, true],
    ['Extra accent themes & priority features', false, true],
  ];
  const cell = (v) => v === true ? yes : (v === false ? no : `<span style="font-weight:600">${escHtml(v)}</span>`);
  document.getElementById('panel-upgrade').innerHTML = `
    <div class="card upgrade-hero">
      <div class="card-title">${svgIcon('crown', 15)} ReefDeck Pro</div>
      <h2 style="font-size:1.35rem;margin:4px 0 8px">Everything in free, everywhere — plus deeper insight.</h2>
      <p style="color:var(--text-muted);font-size:0.9rem;line-height:1.6;max-width:560px">
        The free logbook stays free, forever. Pro adds the power-user analytics and shareable reports today, with
        one-tap backup to <em>your own</em> Google Drive coming soon — so your logbook survives a phone swap and restores
        anywhere, while staying in your account. We never run a sync server or hold a copy. ReefDeck still never advises —
        Pro just shows your own data in more ways.</p>
      <div class="upgrade-price-row" style="display:flex;gap:20px;flex-wrap:wrap;align-items:flex-start;margin-top:16px">
        <div style="flex:1;min-width:220px;max-width:320px;padding:16px;border:2px solid var(--brand-bright,var(--ocean-light));border-radius:10px;background:var(--surface-1)">
          <div style="font-size:0.75rem;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted);margin-bottom:6px">Pro — Annual</div>
          <div class="price-big" style="font-size:1.8rem;font-weight:800">${PRO_PRICE.yearly}<span style="font-size:0.9rem;font-weight:400;color:var(--text-muted)">/year</span></div>
          <div style="font-size:0.8rem;color:var(--text-muted);margin:6px 0 14px">Less than a bag of fish food. Renews yearly, cancel anytime.</div>
          ${pro
            ? `<div class="pro-badge-active">${svgIcon('checkCircle', 15)} Active${getPrefs().proSince ? ' since ' + getPrefs().proSince : ''}</div>`
            : `<button class="btn-primary-lg" style="width:100%;margin-top:4px" onclick="goPro()">${svgIcon('crown', 16)} Get Pro</button>`}
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">${svgIcon('layers', 14)} Free vs Pro</div>
      <table class="compare-table">
        <thead><tr><th>Feature</th><th>Free</th><th>${svgIcon('crown', 13)} Pro</th></tr></thead>
        <tbody>${rows.map(r => `<tr><td>${r[0]}</td><td>${cell(r[1])}</td><td class="pro-col">${cell(r[2])}</td></tr>`).join('')}</tbody>
      </table>
    </div>

    <div class="card" style="background:var(--surface-2)">
      <div class="card-title">${svgIcon('check', 14)} Already have a license key?</div>
      <p style="color:var(--text-muted);font-size:0.85rem;margin-bottom:12px">Enter the key from your purchase confirmation to unlock Pro on this device.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <input class="form-input" id="license-input" placeholder="${LICENSE_PREFIX}XXXX-XXXX" style="flex:1;min-width:200px;text-transform:uppercase" />
        <button class="btn-modal-save" onclick="applyLicense('license-input')">Unlock</button>
      </div>
      ${pro ? `<button class="btn-text-muted" style="margin-top:14px" onclick="setPro(false)">Deactivate Pro on this device</button>` : ''}
    </div>`;
}

// ============================================================
// INSIGHTS (Pro) — descriptive analytics on the user's own logs
// ============================================================
function logsAsc(tankId) {
  return state.logs.filter(l => l.tankId === tankId).sort((a,b) => a.date > b.date ? 1 : -1);
}
function mean(a) { return a.reduce((s,x) => s+x, 0) / a.length; }
function stddev(a) { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(mean(a.map(x => (x-m)*(x-m)))); }
// Least-squares slope of value vs day-offset → units per day.
function slopePerDay(points) {
  if (points.length < 2) return 0;
  const t0 = points[0].t;
  const xs = points.map(p => (p.t - t0) / 86400000);
  const ys = points.map(p => p.v);
  const mx = mean(xs), my = mean(ys);
  let num = 0, den = 0;
  for (let i = 0; i < xs.length; i++) { num += (xs[i]-mx)*(ys[i]-my); den += (xs[i]-mx)*(xs[i]-mx); }
  return den === 0 ? 0 : num/den;
}

function renderInsights() {
  const tank = getActiveTank();
  const panel = document.getElementById('panel-insights');
  if (!tank) { panel.innerHTML = renderEmptyState('No tank yet', 'Add a tank and log a few readings to unlock Insights.', 'add-tank'); return; }

  if (!isPro()) {
    panel.innerHTML = `
      <div class="card pro-locked-hero">
        <div class="locked-badge">${svgIcon('lock', 14)} Pro</div>
        <div class="card-title">${svgIcon('gauge', 15)} Insights</div>
        <h2 style="font-size:1.25rem;margin:4px 0 10px">See how stable your tank really is.</h2>
        <p style="color:var(--text-muted);font-size:0.9rem;line-height:1.6;max-width:540px;margin-bottom:18px">
          Insights reads your existing logs and surfaces a <strong>stability score</strong>, <strong>drift direction</strong>,
          <strong>daily consumption rate</strong> and <strong>time-in-range</strong> for every parameter — no new data entry, no advice, just your numbers seen clearly.</p>
        <div class="insight-preview-grid" aria-hidden="true">
          ${DEFAULT_PARAMS.slice(0,4).map(p => `<div class="insight-card blur"><div class="insight-head">${p.label}</div><div class="insight-score">87</div><div class="insight-sub">Very stable</div></div>`).join('')}
        </div>
        <button class="btn-primary-lg" style="margin-top:20px" onclick="setPanel('upgrade')">${svgIcon('crown', 17)} Unlock Insights with Pro</button>
      </div>`;
    return;
  }

  const logs = logsAsc(tank.id);
  if (logs.length < 3) {
    panel.innerHTML = renderEmptyState('Not enough data yet', 'Log at least 3 sets of readings and your Insights will appear here.', null);
    return;
  }
  const th = getThresholds(tank.id);
  const cards = DEFAULT_PARAMS.map(p => {
    const pts = logs.filter(l => l.params[p.key] != null)
      .map(l => ({ t: new Date(l.date + 'T00:00:00').getTime(), v: +l.params[p.key] }));
    if (pts.length < 2) return '';
    const vals = pts.map(p => p.v);
    const m = mean(vals), sd = stddev(vals);
    const cv = m !== 0 ? sd / Math.abs(m) : 0;            // coefficient of variation
    const score = Math.max(0, Math.min(100, Math.round(100 - cv * 100 * 6)));
    const label = score >= 85 ? 'Very stable' : score >= 65 ? 'Stable' : score >= 45 ? 'Some swing' : 'High swing';
    const slope = slopePerDay(pts) * 7;                  // per week
    const dir = Math.abs(slope) < (p.step || 0.01) * 0.5 ? 'flat' : (slope > 0 ? 'caretUp' : 'caretDown');
    const t = th[p.key] || {};
    const inRange = (t.min != null && t.max != null) ? Math.round(100 * vals.filter(v => v >= t.min && v <= t.max).length / vals.length) : null;
    const fmt = (v) => (p.step && p.step < 1) ? v.toFixed(p.step < 0.01 ? 3 : 2) : Math.round(v);
    return `
      <div class="insight-card">
        <div class="insight-head">${p.label} <span class="insight-unit">${p.unit}</span></div>
        <div class="insight-score" style="color:${score>=65?'var(--ok)':score>=45?'var(--warn,#f59e0b)':'var(--bad)'}">${score}</div>
        <div class="insight-sub">${label}</div>
        <div class="insight-rows">
          <div><span>Latest</span><b>${fmt(vals[vals.length-1])}</b></div>
          <div><span>Average</span><b>${fmt(m)}</b></div>
          <div><span>Range</span><b>${fmt(Math.min(...vals))}–${fmt(Math.max(...vals))}</b></div>
          <div><span>Trend / wk</span><b>${svgIcon(dir,12)} ${slope>0?'+':''}${fmt(slope)}</b></div>
          ${inRange != null ? `<div><span>In range</span><b>${inRange}%</b></div>` : ''}
          <div><span>Readings</span><b>${vals.length}</b></div>
        </div>
      </div>`;
  }).filter(Boolean).join('');

  const spanDays = Math.round((new Date(logs[logs.length-1].date) - new Date(logs[0].date)) / 86400000);

  // Consumption Forecast — forward projection (days-until-a-param-crosses-your-band).
  // Companion to Drift Analysis (which is descriptive slope only). ReefForecast is a
  // pure module loaded via <script> in index.html; it returns a plain ARRAY of
  // per-param result objects (iterate directly — NOT a .params wrapper).
  // Built defensively BEFORE the innerHTML assignment so a thrown/missing module
  // never blanks the panel (render-safety footgun).
  let forecastHtml = '';
  try {
    if (window.ReefForecast && typeof window.ReefForecast.computeForecast === 'function') {
      const results = window.ReefForecast.computeForecast(logs, DEFAULT_PARAMS, th);
      if (Array.isArray(results)) {
        forecastHtml = window.ReefForecast.renderForecastCard(results, DEFAULT_PARAMS);
      }
    }
  } catch (e) { forecastHtml = ''; /* never blank the panel over a forecast error */ }

  panel.innerHTML = `
    <div class="card" style="background:var(--surface-2);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
      <div><div class="card-title" style="margin:0">${svgIcon('gauge', 15)} Insights — ${escHtml(tank.name)}</div>
      <p style="color:var(--text-muted);font-size:0.82rem;margin:6px 0 0">${logs.length} readings over ${spanDays} days. Descriptive stats on your own data — ReefDeck does not advise.</p></div>
      <button class="btn-icon" onclick="printReport()">${svgIcon('printer', 15)} PDF report</button>
    </div>
    <div class="insight-grid">${cards}</div>
    <div id="forecast-section">${forecastHtml}</div>`;
}

// ============================================================
// PRINTABLE PDF REPORT (Pro)
// ============================================================
function printReport() {
  if (!isPro()) { showPaywall('Printable PDF reports'); return; }
  const tank = getActiveTank();
  if (!tank) { showToast('Add a tank first.', 'error'); return; }
  const logs = logsAsc(tank.id);
  const area = document.getElementById('print-area');
  const today = todayStr();
  const recent = logs.slice(-12).reverse();
  const paramCols = DEFAULT_PARAMS;
  area.innerHTML = `
    <div class="print-head">
      <div class="print-brand">ReefDeck</div>
      <div class="print-meta">Tank Report · ${escHtml(tank.name)}${tank.volume ? ' · ' + escHtml(tank.volume + ' ' + (tank.volumeUnit||'')) : ''}<br>Generated ${today}</div>
    </div>
    <table class="print-table"><thead><tr><th>Date</th>${paramCols.map(p => `<th>${p.label}<br><small>${p.unit}</small></th>`).join('')}</tr></thead>
      <tbody>${recent.map(l => `<tr><td>${l.date}</td>${paramCols.map(p => `<td>${l.params[p.key] != null ? l.params[p.key] : '·'}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>
    <p class="print-note">ReefDeck is a logbook, not an advisor. This report shows the data you entered. All decisions about your tank are yours.</p>`;
  document.body.classList.add('printing');
  window.print();
  setTimeout(() => document.body.classList.remove('printing'), 500);
}

// ============================================================
// PWA INSTALL PROMPT
// ============================================================
let _deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', function(e) {
  e.preventDefault();
  _deferredInstallPrompt = e;
  if (!DB.get('pwaInstallDismissed', false)) showPWABanner();
});

function showPWABanner() {
  if (document.getElementById('pwa-install-banner')) return;
  const banner = document.createElement('div');
  banner.id = 'pwa-install-banner';
  banner.className = 'pwa-install-banner';
  banner.innerHTML =
    svgIcon('wifi', 15) +
    '<span style="flex:1">Install ReefDeck on your device for offline use</span>' +
    '<button onclick="installPWA()" style="background:var(--brand);color:#fff;border:none;padding:5px 14px;border-radius:20px;font-size:0.79rem;font-weight:600;cursor:pointer;white-space:nowrap">Install</button>' +
    '<button onclick="dismissPWABanner()" aria-label="Dismiss" style="background:none;border:none;color:var(--text-dim);cursor:pointer;font-size:1.15rem;line-height:1;padding:0 4px">×</button>';
  const topbar = document.querySelector('.topbar');
  if (topbar) topbar.before(banner);
}

function installPWA() {
  if (!_deferredInstallPrompt) return;
  _deferredInstallPrompt.prompt();
  _deferredInstallPrompt.userChoice.then(function() {
    _deferredInstallPrompt = null;
    var b = document.getElementById('pwa-install-banner');
    if (b) b.remove();
  });
}

function dismissPWABanner() {
  DB.set('pwaInstallDismissed', true);
  var b = document.getElementById('pwa-install-banner');
  if (b) b.remove();
}

// ============================================================
// SERVICE WORKER UPDATES — auto-detect a new deploy, offer a Refresh.
// The installed app (incl. on phones) checks /sw.js on each launch; when a new
// version is found it installs quietly and we surface a non-intrusive prompt.
// No reload happens until the user taps Refresh, so an in-progress log is safe.
// ============================================================
let _swReg = null;
let _swUpdateRequested = false;
let _swReloading = false;

function initServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js').then(function(reg) {
    _swReg = reg;
    // Update already downloaded while the app was closed last time.
    if (reg.waiting && navigator.serviceWorker.controller) showUpdateBanner();
    reg.addEventListener('updatefound', function() {
      var nw = reg.installing;
      if (!nw) return;
      nw.addEventListener('statechange', function() {
        // "installed" + an existing controller = an UPDATE (not first install).
        if (nw.state === 'installed' && navigator.serviceWorker.controller) showUpdateBanner();
      });
    });
  }).catch(function() {});

  // Reload once the new worker takes control — but only when the user asked.
  navigator.serviceWorker.addEventListener('controllerchange', function() {
    if (!_swUpdateRequested || _swReloading) return;
    _swReloading = true;
    location.reload();
  });
}

function showUpdateBanner() {
  if (document.getElementById('sw-update-banner')) return;
  var b = document.createElement('div');
  b.id = 'sw-update-banner';
  b.className = 'pwa-install-banner';
  b.innerHTML =
    svgIcon('sparkle', 15) +
    '<span style="flex:1">A new version of ReefDeck is ready.</span>' +
    '<button onclick="applyUpdate()" style="background:var(--brand);color:#fff;border:none;padding:5px 14px;border-radius:20px;font-size:0.79rem;font-weight:600;cursor:pointer;white-space:nowrap">Refresh</button>';
  var topbar = document.querySelector('.topbar');
  if (topbar) topbar.before(b);
}

function applyUpdate() {
  var b = document.getElementById('sw-update-banner');
  if (b) b.remove();
  _swUpdateRequested = true;
  if (_swReg && _swReg.waiting) {
    _swReg.waiting.postMessage('SKIP_WAITING');  // triggers controllerchange → reload
  } else {
    location.reload();
  }
}

// ---- Platform-aware "Add to Home Screen" guidance ----
// iOS Safari NEVER fires beforeinstallprompt, so the native banner above can't
// help iPhone users. detect + show step-by-step instructions instead.
function isStandalone() {
  return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
    || window.navigator.standalone === true;
}
function isIOSDevice() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent || '') && !window.MSStream;
}
function installPlatform() {
  if (isStandalone()) return 'standalone';
  if (isIOSDevice()) return 'ios';
  if (/Android/.test(navigator.userAgent || '')) return 'android';
  return 'desktop';
}

// iOS gets a proactive banner (no native prompt exists there).
function maybeShowIOSInstallBanner() {
  if (installPlatform() !== 'ios') return;
  if (DB.get('pwaInstallDismissed', false)) return;
  if (document.getElementById('pwa-install-banner')) return;
  var banner = document.createElement('div');
  banner.id = 'pwa-install-banner';
  banner.className = 'pwa-install-banner';
  banner.innerHTML =
    svgIcon('wifi', 15) +
    '<span style="flex:1">Add ReefDeck to your Home Screen to use it like an app</span>' +
    '<button onclick="showInstallHelp()" style="background:var(--brand);color:#fff;border:none;padding:5px 14px;border-radius:20px;font-size:0.79rem;font-weight:600;cursor:pointer;white-space:nowrap">How</button>' +
    '<button onclick="dismissPWABanner()" aria-label="Dismiss" style="background:none;border:none;color:var(--text-dim);cursor:pointer;font-size:1.15rem;line-height:1;padding:0 4px">×</button>';
  var topbar = document.querySelector('.topbar');
  if (topbar) topbar.before(banner);
}

function showInstallHelp() {
  var plat = installPlatform();
  var overlay = document.getElementById('modal-overlay');
  var body = document.getElementById('modal-body');
  overlay.classList.add('open');

  if (plat === 'standalone') {
    body.innerHTML =
      '<div class="modal-title">' + svgIcon('checkCircle', 19) + ' Already installed</div>' +
      '<p style="color:var(--text-muted);font-size:0.9rem;line-height:1.6;padding:4px 0 12px">You\'re running ReefDeck as an installed app — you\'re all set. It works offline and opens straight from your home screen.</p>' +
      '<div class="modal-actions"><button class="btn-modal-cancel" onclick="closeModal()">Close</button></div>';
    return;
  }

  // Native install available (Chrome/Edge/Android) → offer the one-tap button too.
  var oneTap = (plat === 'android' || plat === 'desktop') && _deferredInstallPrompt
    ? '<button class="btn-modal-save" style="width:100%;margin-bottom:10px" onclick="closeModal();installPWA()">' + svgIcon('download', 16) + ' Install ReefDeck now</button>'
    : '';

  var step = function(n, html) {
    return '<li style="margin-bottom:8px"><strong style="color:var(--brand-bright)">' + n + '.</strong> ' + html + '</li>';
  };
  var blocks = {
    ios:
      '<h4 style="margin:6px 0 6px;font-size:0.95rem">' + svgIcon('download', 15) + ' iPhone &amp; iPad (Safari)</h4>' +
      '<ol style="list-style:none;padding:0;margin:0 0 8px;color:var(--text-muted);font-size:0.88rem;line-height:1.55">' +
      step(1, 'Tap the <strong>Share</strong> button (the square with an arrow ↑) at the bottom of Safari.') +
      step(2, 'Scroll down and tap <strong>Add to Home Screen</strong>.') +
      step(3, 'Tap <strong>Add</strong> in the top-right. ReefDeck now lives on your home screen like a normal app.') +
      '</ol><p style="font-size:0.8rem;color:var(--text-dim);margin:0">Must be done in <strong>Safari</strong> — Chrome on iPhone can\'t add to the home screen.</p>',
    android:
      '<h4 style="margin:6px 0 6px;font-size:0.95rem">' + svgIcon('download', 15) + ' Android (Chrome)</h4>' +
      '<ol style="list-style:none;padding:0;margin:0;color:var(--text-muted);font-size:0.88rem;line-height:1.55">' +
      step(1, 'Tap the <strong>⋮</strong> menu (top-right of Chrome).') +
      step(2, 'Tap <strong>Install app</strong> (or <strong>Add to Home screen</strong>).') +
      step(3, 'Confirm <strong>Install</strong>. ReefDeck opens from your app drawer / home screen.') +
      '</ol>',
    desktop:
      '<h4 style="margin:6px 0 6px;font-size:0.95rem">' + svgIcon('chip', 15) + ' Desktop (Chrome / Edge)</h4>' +
      '<ol style="list-style:none;padding:0;margin:0;color:var(--text-muted);font-size:0.88rem;line-height:1.55">' +
      step(1, 'Look for the <strong>install icon</strong> (a monitor with a ↓) at the right end of the address bar.') +
      step(2, 'Click it, then click <strong>Install</strong>.') +
      step(3, 'ReefDeck opens in its own window and pins to your taskbar / dock.') +
      '</ol>',
  };

  // Lead with the detected platform; tuck the rest behind a details toggle.
  var order = plat === 'ios' ? ['ios', 'android', 'desktop']
            : plat === 'android' ? ['android', 'ios', 'desktop']
            : ['desktop', 'ios', 'android'];
  var primary = blocks[order[0]];
  var rest = '<details style="margin-top:10px"><summary style="cursor:pointer;color:var(--brand-bright);font-size:0.85rem">Other devices</summary><div style="margin-top:10px">' +
    blocks[order[1]] + '<div style="height:10px"></div>' + blocks[order[2]] + '</div></details>';

  body.innerHTML =
    '<div class="modal-title">' + svgIcon('wifi', 19) + ' Install ReefDeck</div>' +
    '<p style="color:var(--text-muted);font-size:0.88rem;line-height:1.6;padding:2px 0 12px">Installing adds a ReefDeck icon to your device and lets it run full-screen and offline — no app store needed.</p>' +
    oneTap +
    primary +
    rest +
    '<div class="modal-actions" style="margin-top:16px"><button class="btn-modal-cancel" onclick="closeModal()">Got it</button></div>';
}

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', function() {
  // Register service worker + watch for updates (auto-update with a Refresh prompt)
  initServiceWorker();

  // Inject the static SVG icons (sidebar nav, brand, topbar)
  if (window.injectIcons) injectIcons();

  // Apply saved theme (dark default) before first paint of content
  applyTheme(getPrefs().theme);

  // New users start CLEAN — no auto-seeded demo data. They can optionally load
  // sample data from the empty dashboard ("load sample data to explore").

  // Set active tank
  if (!state.activeTankId && state.tanks.length > 0) {
    state.activeTankId = state.tanks[0].id;
  }

  // Pro entitlement: honor ?pro=1/0 and the post-checkout ?upgrade=success return.
  try {
    const qs = new URLSearchParams(location.search);
    if (qs.get('upgrade') === 'success' || qs.get('pro') === '1') setPro(true, { silent: qs.get('pro') === '1' });
    else if (qs.get('pro') === '0') setPro(false, { silent: true });
    if (qs.has('pro') || qs.has('upgrade')) history.replaceState(null, '', location.pathname + location.hash);
  } catch (e) {}
  renderProStatus();

  // Render tank switcher
  renderTankSwitcher();

  // Nav items
  document.querySelectorAll('.nav-item[data-panel]').forEach(item => {
    item.addEventListener('click', () => setPanel(item.dataset.panel));
  });

  // Tank switcher change
  document.getElementById('tank-select').addEventListener('change', function() {
    state.activeTankId = this.value;
    renderPanel(state.activePanel);
    renderTankSwitcher();
  });

  // Add tank button
  document.getElementById('btn-add-tank').addEventListener('click', promptAddTank);
  document.getElementById('btn-delete-tank').addEventListener('click', promptDeleteTank);

  // Modal overlay close on backdrop
  document.getElementById('modal-overlay').addEventListener('click', function(e) {
    if (e.target === this) closeModal();
  });

  // Hamburger menu
  document.getElementById('hamburger-btn').addEventListener('click', function() {
    document.querySelector('.sidebar').classList.toggle('open');
  });

  // Disclaimer banner — dismissible, remembered. (Full disclaimer still lives in
  // About + the legal page, so dismissing only reclaims screen space.)
  var banner = document.getElementById('disclaimer-banner');
  if (banner) {
    if (DB.get('disclaimerDismissed', false)) banner.classList.add('dismissed');
    document.getElementById('disclaimer-dismiss').addEventListener('click', function() {
      banner.classList.add('dismissed');
      DB.set('disclaimerDismissed', true);
    });
  }

  // Initial panel — honor #panel and #charts?param=alk&range=30 deep-links
  var valid = ['dashboard','today','log','history','charts','schedule','calculator','insights','inventory','corals','journal','thresholds','settings','export','icp-import','controller-import','upgrade','about'];
  var hash = parseHashNav();
  setPanel(valid.indexOf(hash) !== -1 ? hash : 'dashboard');
  window.addEventListener('hashchange', function () {
    var h = parseHashNav();
    if (valid.indexOf(h) !== -1 && h !== state.activePanel) setPanel(h);
  });

  // Maintenance reminders — check on load and hourly while open
  checkReminders();
  setInterval(checkReminders, 3600000);

  // iOS Safari has no beforeinstallprompt — offer Add-to-Home-Screen guidance.
  setTimeout(maybeShowIOSInstallBanner, 1200);
});
