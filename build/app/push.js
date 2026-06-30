// ============================================================
// CLOSED-APP PUSH REMINDERS (ReefDeck Pro)
// ------------------------------------------------------------
// Subscribes the device to Web Push and sends the backend the MINIMAL schedule
// (task names, due dates, tank name, a notify hour + timezone) so a scheduled
// Netlify function can push a maintenance reminder even when the app is closed.
// Water chemistry / corals / logs NEVER leave the device.
// ============================================================

// Public half of the VAPID key pair (safe to ship). Private half is a Netlify
// env var (VAPID_PRIVATE) used only by the send-reminders function.
const VAPID_PUBLIC = 'BLIpCo0Xs0rm_wu2gpPqEXtCt6j0PjCa6qA8_YrnyVcg5Rm3I9sgbm9NwvuwAK8EdLXYQLt-dD6bZIcmtbN4ntI';

function pushSupported() {
  return ('serviceWorker' in navigator) && ('PushManager' in window) && ('Notification' in window);
}

function getPushPrefs() {
  const p = getPrefs();
  if (!p.push) p.push = { closed: false, notifyHour: 9 };
  if (p.push.notifyHour == null) p.push.notifyHour = 9;
  return p.push;
}

function urlB64ToUint8(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const base = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

// Minimal schedule for the server — labels + due dates only.
function collectScheduleForPush() {
  const tankName = {};
  (state.tanks || []).forEach((t) => { tankName[t.id] = t.name; });
  return (state.maintenance || [])
    .filter((t) => t.enabled !== false)
    .map((t) => ({
      name: t.name,
      nextDue: taskNextDue(t),
      intervalDays: t.intervalDays || 0,
      tankName: tankName[t.tankId] || '',
    }));
}

function pushPayload() {
  const pp = getPushPrefs();
  return JSON.stringify({
    tasks: collectScheduleForPush(),
    notifyHour: pp.notifyHour,
    tz: (Intl.DateTimeFormat().resolvedOptions().timeZone) || 'UTC',
    license: getPrefs().license || '',
  });
}

async function enableClosedAppPush() {
  if (!isPro()) { showPaywall('Push reminders when the app is closed'); return; }
  if (!pushSupported()) { showToast("This browser can't do background push.", 'error'); return; }
  // iOS only allows web push from an INSTALLED PWA.
  if (typeof isIOSDevice === 'function' && isIOSDevice() && typeof isStandalone === 'function' && !isStandalone()) {
    showToast('On iPhone, add ReefDeck to your Home Screen first, then turn this on.', 'error');
    if (typeof showInstallHelp === 'function') showInstallHelp();
    return;
  }
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { showToast('Allow notifications to get closed-app reminders.', 'error'); return; }
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(VAPID_PUBLIC) });
    }
    const resp = await fetch('/.netlify/functions/save-push', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(Object.assign({ subscription: sub.toJSON() }, JSON.parse(pushPayload()))),
    });
    if (!resp.ok) throw new Error('server ' + resp.status);
    getPushPrefs().closed = true; save();
    if (state.activePanel === 'settings') renderPanel('settings');
    showToast("Closed-app reminders on — we'll nudge you even when ReefDeck is closed ✓");
  } catch (e) {
    showToast('Could not enable push: ' + (e.message || e), 'error');
  }
}

async function disableClosedAppPush() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      const endpoint = sub.endpoint;
      await sub.unsubscribe().catch(() => {});
      await fetch('/.netlify/functions/delete-push', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint }),
      }).catch(() => {});
    }
  } catch (e) { /* ignore */ }
  getPushPrefs().closed = false; save();
  if (state.activePanel === 'settings') renderPanel('settings');
  showToast('Closed-app reminders turned off.');
}

// Re-sync the schedule to the server whenever tasks change (best-effort).
function syncPushSchedule() {
  const pp = getPushPrefs();
  if (!pp.closed) return;
  navigator.serviceWorker.ready
    .then((reg) => reg.pushManager.getSubscription())
    .then((sub) => {
      if (!sub) return;
      return fetch('/.netlify/functions/save-push', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(Object.assign({ subscription: sub.toJSON() }, JSON.parse(pushPayload()))),
      });
    })
    .catch(() => {});
}

function setPushHour(h) {
  getPushPrefs().notifyHour = Math.max(0, Math.min(23, parseInt(h, 10) || 9));
  save();
  syncPushSchedule();
}

function togglePush() {
  if (getPushPrefs().closed) disableClosedAppPush();
  else enableClosedAppPush();
}

// Card rendered inside the Settings panel.
function renderPushCard() {
  const pro = isPro();
  const pp = getPushPrefs();
  const on = !!pp.closed;
  const supported = pushSupported();
  const proTag = pro ? '' : ' <span class="perk-soon" style="background:var(--brand);color:#fff">Pro</span>';

  let control;
  if (!supported) {
    control = '<p class="form-help">' + svgIcon('alert', 13) + " This browser can't do background push.</p>";
  } else if (!pro) {
    control = '<button class="btn-export" onclick="showPaywall(\'Push reminders when the app is closed\')">' + svgIcon('crown', 16) + ' Unlock with Pro</button>';
  } else {
    let hours = '';
    for (let h = 0; h < 24; h++) {
      const label = (h < 10 ? '0' + h : h) + ':00';
      hours += '<option value="' + h + '"' + (h === pp.notifyHour ? ' selected' : '') + '>' + label + '</option>';
    }
    control =
      '<label class="toggle-row"><span>Push even when ReefDeck is closed</span>' +
      '<span class="switch ' + (on ? 'on' : '') + '" onclick="togglePush()"><span class="switch-knob"></span></span></label>' +
      (on
        ? ('<label class="toggle-row" style="margin-top:8px"><span>Daily reminder time</span>' +
           '<select onchange="setPushHour(this.value)" style="background:var(--surface-1);color:var(--text-primary);border:1px solid var(--border,rgba(120,160,200,0.2));border-radius:8px;padding:6px 10px">' + hours + '</select></label>' +
           '<p class="form-help" style="color:var(--ok)">' + svgIcon('checkCircle', 13) + ' On — a server sends your due tasks at this time, no app needed.</p>')
        : '<p class="form-help">Get a maintenance reminder at a set time each day even if the app isn\'t open. Only your task names + due dates are stored on our server — never your readings.</p>');
  }

  return ''
    + '<div class="card" style="max-width:640px">'
    + '  <div class="settings-section" style="margin-bottom:0">'
    + '    <h3>' + svgIcon('bell', 15) + ' Closed-App Push Reminders' + proTag + '</h3>'
    + '    <p style="color:var(--text-muted);font-size:0.85rem;margin-bottom:12px;line-height:1.6">Unlike the browser reminders above (which need the app open), these are sent by our server so they reach you with ReefDeck fully closed.</p>'
    +      control
    + '  </div>'
    + '</div>';
}
