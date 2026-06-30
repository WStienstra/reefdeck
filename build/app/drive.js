// ============================================================
// GOOGLE DRIVE BACKUP  (ReefDeck Pro) — per-user, decentralised.
// ------------------------------------------------------------
// Backups are written to the user's OWN Google Drive, into the hidden
// per-app "appDataFolder". ReefDeck runs NO sync server, never receives a
// copy, and (thanks to the drive.appdata scope) literally cannot see any
// other file in the user's Drive. Disconnecting revokes our access; the
// backup file stays in the user's Drive, under their control.
//
// ONE-TIME OWNER SETUP (only the site owner can do this — needs a Google acct):
//   1. console.cloud.google.com → create / pick a project.
//   2. APIs & Services → Library → enable "Google Drive API".
//   3. OAuth consent screen → External → add the scope
//        .../auth/drive.appdata
//      While unverified, add tester emails (or submit for verification once
//      usage grows past 100 users).
//   4. Credentials → Create credentials → OAuth client ID → "Web application".
//      Authorised JavaScript origins:
//        https://reefdecks.com
//        http://localhost:8080   (only if you test locally)
//   5. Paste the generated Client ID into DRIVE_CLIENT_ID below and redeploy.
//      No client secret is needed — this is the browser token flow.
// ============================================================

const DRIVE_CLIENT_ID = '';  // <-- PASTE GOOGLE OAUTH CLIENT ID (….apps.googleusercontent.com)
const DRIVE_SCOPE     = 'https://www.googleapis.com/auth/drive.appdata';
const DRIVE_FILENAME  = 'reefdeck-backup.json';
const GIS_SRC         = 'https://accounts.google.com/gsi/client';

let _gisPromise        = null;
let _driveTokenClient  = null;
let _driveAccessToken  = null;
let _driveTokenExpiry  = 0;

// Has the owner pasted a real client ID yet?
function driveConfigured() {
  return typeof DRIVE_CLIENT_ID === 'string' && DRIVE_CLIENT_ID.indexOf('apps.googleusercontent.com') !== -1;
}

// Per-device Drive connection state, kept inside prefs (so it travels with prefs, never to a server).
function getDrivePrefs() {
  const p = getPrefs();
  if (!p.drive) p.drive = { connected: false, lastBackup: null, lastBackupSize: 0 };
  return p.drive;
}

// Lazily load Google Identity Services — only when the user actually uses Drive,
// so the app stays fully offline / zero-third-party-call until then.
function loadGisScript() {
  if (window.google && window.google.accounts && window.google.accounts.oauth2) return Promise.resolve();
  if (_gisPromise) return _gisPromise;
  _gisPromise = new Promise(function(resolve, reject) {
    const s = document.createElement('script');
    s.src = GIS_SRC; s.async = true; s.defer = true;
    s.onload = function() { resolve(); };
    s.onerror = function() { _gisPromise = null; reject(new Error('Could not reach Google sign-in. Check your connection.')); };
    document.head.appendChild(s);
  });
  return _gisPromise;
}

// Resolve a Drive access token. interactive=true forces the consent screen
// (first connect); otherwise we reuse a live token or refresh silently.
function driveGetToken(interactive) {
  return loadGisScript().then(function() {
    return new Promise(function(resolve, reject) {
      if (_driveAccessToken && Date.now() < _driveTokenExpiry - 60000) { resolve(_driveAccessToken); return; }
      if (!_driveTokenClient) {
        _driveTokenClient = google.accounts.oauth2.initTokenClient({
          client_id: DRIVE_CLIENT_ID,
          scope: DRIVE_SCOPE,
          callback: function() {},  // replaced per request below
        });
      }
      _driveTokenClient.callback = function(resp) {
        if (resp && resp.access_token) {
          _driveAccessToken = resp.access_token;
          _driveTokenExpiry = Date.now() + ((resp.expires_in || 3600) * 1000);
          resolve(_driveAccessToken);
        } else {
          reject(new Error(resp && resp.error ? String(resp.error) : 'Google authorisation was cancelled.'));
        }
      };
      try {
        _driveTokenClient.requestAccessToken({ prompt: interactive ? 'consent' : '' });
      } catch (e) { reject(e); }
    });
  });
}

function driveApi(token, url, opts) {
  opts = opts || {};
  opts.headers = Object.assign({ Authorization: 'Bearer ' + token }, opts.headers || {});
  return fetch(url, opts).then(function(r) {
    if (!r.ok) return r.text().then(function(t) { throw new Error('Drive ' + r.status + ' — ' + t.slice(0, 160)); });
    return r;
  });
}

// Find our single backup file in appDataFolder (null if none yet).
function driveFindFile(token) {
  const q = encodeURIComponent("name='" + DRIVE_FILENAME + "'");
  const url = 'https://www.googleapis.com/drive/v3/files'
    + '?spaces=appDataFolder&fields=files(id,modifiedTime,size)&q=' + q;
  return driveApi(token, url).then(function(r) { return r.json(); })
    .then(function(d) { return (d.files && d.files[0]) || null; });
}

// Create (no fileId) or overwrite (fileId) the backup as a multipart upload.
function driveUpload(token, fileId, jsonStr) {
  const boundary = '----reefdeck' + Date.now();
  const metadata = fileId ? { name: DRIVE_FILENAME } : { name: DRIVE_FILENAME, parents: ['appDataFolder'] };
  const body =
    '--' + boundary + '\r\n' +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) + '\r\n' +
    '--' + boundary + '\r\n' +
    'Content-Type: application/json\r\n\r\n' +
    jsonStr + '\r\n' +
    '--' + boundary + '--';
  const base = 'https://www.googleapis.com/upload/drive/v3/files' + (fileId ? '/' + fileId : '');
  const url = base + '?uploadType=multipart&fields=id,modifiedTime,size';
  return driveApi(token, url, {
    method: fileId ? 'PATCH' : 'POST',
    headers: { 'Content-Type': 'multipart/related; boundary=' + boundary },
    body: body,
  }).then(function(r) { return r.json(); });
}

function driveDownload(token, fileId) {
  return driveApi(token, 'https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media')
    .then(function(r) { return r.json(); });
}

// ---- User-facing actions (wired to the buttons in the Export panel) ----

function driveBackupNow() {
  if (!isPro()) { showPaywall('Google Drive backup'); return; }
  if (!driveConfigured()) { showToast('Google Drive backup is being finalised — coming very soon.', 'error'); return; }
  showToast('Backing up to your Google Drive…');
  const wasConnected = getDrivePrefs().connected;
  driveGetToken(!wasConnected)
    .then(function(token) {
      return driveFindFile(token).then(function(existing) {
        const payload = JSON.stringify(Object.assign(
          { version: 1, exportedAt: new Date().toISOString(), app: 'reefdeck' },
          DB.load()
        ));
        return driveUpload(token, existing && existing.id, payload).then(function() { return payload.length; });
      });
    })
    .then(function(size) {
      const d = getDrivePrefs();
      d.connected = true;
      d.lastBackup = new Date().toISOString();
      d.lastBackupSize = size;
      save();
      if (state.activePanel === 'export') renderPanel('export');
      showToast('Backed up to your Google Drive ✓');
    })
    .catch(function(err) { showToast('Backup failed: ' + err.message, 'error'); });
}

function driveRestoreNow() {
  if (!isPro()) { showPaywall('Google Drive backup'); return; }
  if (!driveConfigured()) { showToast('Google Drive backup is being finalised — coming very soon.', 'error'); return; }
  const wasConnected = getDrivePrefs().connected;
  driveGetToken(!wasConnected)
    .then(function(token) {
      return driveFindFile(token).then(function(existing) {
        if (!existing) { showToast('No backup found in your Google Drive yet — run a backup first.', 'error'); return null; }
        return driveDownload(token, existing.id);
      });
    })
    .then(function(data) {
      if (!data) return;
      if (!data.tanks && !data.logs) { showToast('That backup looks empty or invalid.', 'error'); return; }
      const ok = confirm('Restore from your Google Drive backup?\n\nThis MERGES the backup into your current logbook — nothing on this device is deleted.');
      if (!ok) return;
      mergeBackupData(data);
      const d = getDrivePrefs(); d.connected = true; save();
      showToast('Restored from your Google Drive ✓');
    })
    .catch(function(err) { showToast('Restore failed: ' + err.message, 'error'); });
}

function driveDisconnect() {
  const t = _driveAccessToken;
  _driveAccessToken = null; _driveTokenExpiry = 0;
  if (t && window.google && google.accounts && google.accounts.oauth2) {
    try { google.accounts.oauth2.revoke(t, function() {}); } catch (e) {}
  }
  const d = getDrivePrefs(); d.connected = false; save();
  if (state.activePanel === 'export') renderPanel('export');
  showToast('Disconnected from Google Drive on this device. Your backup file stays in your Drive.');
}

// ---- Card rendered inside the Export / Import panel ----
function renderDriveBackupCard() {
  const pro = isPro();
  const ready = driveConfigured();
  const d = getDrivePrefs();
  const last = d.lastBackup ? new Date(d.lastBackup).toLocaleString() : null;
  const tag = !ready
    ? ' <span class="perk-soon">Coming soon</span>'
    : (pro ? '' : ' <span class="perk-soon" style="background:var(--brand);color:#fff">Pro</span>');

  let statusLine, actions;
  if (!ready) {
    // Owner hasn't wired the Google OAuth client ID yet — show honest "coming soon".
    statusLine = 'Coming very soon: one-tap backup and restore through your own Google account.';
    actions = '';
  } else if (!pro) {
    statusLine = 'Available on ReefDeck Pro. Back up and restore your whole logbook through your own Google account.';
    actions = '<div class="export-btns" style="margin-top:4px">'
      + '<button class="btn-export" onclick="showPaywall(\'Google Drive backup\')">' + svgIcon('crown', 17) + ' Unlock with Pro</button>'
      + '</div>';
  } else {
    statusLine = d.connected
      ? (last ? ('Connected. Last backup: <strong>' + escHtml(last) + '</strong>.') : 'Connected to your Google Drive.')
      : 'Not connected yet. Your first backup will ask Google for permission — once.';
    actions = '<div class="export-btns" style="margin-top:4px">'
      + '<button class="btn-export" onclick="driveBackupNow()">' + svgIcon('cloud', 17) + ' Back up to Google Drive</button>'
      + '<button class="btn-export" onclick="driveRestoreNow()">' + svgIcon('download', 17) + ' Restore from Google Drive</button>'
      + (d.connected ? '<button class="btn-inv" onclick="driveDisconnect()" style="font-size:0.82rem">Disconnect</button>' : '')
      + '</div>';
  }

  return ''
    + '<div class="card">'
    + '  <div class="settings-section" style="margin-bottom:0">'
    + '    <h3>' + svgIcon('cloud', 15) + ' Back up to your own Google Drive' + tag + '</h3>'
    + '    <p style="color:var(--text-muted);font-size:0.85rem;margin-bottom:8px;line-height:1.6">'
    + '      Your logbook is backed up to <strong>your own</strong> Google Drive — restore it on any device. '
    + '      ReefDeck never runs a sync server and never holds a copy; the backup lives in a private app folder '
    + '      only ReefDeck on your account can see. Disconnect anytime; revoking access leaves your file in your Drive.'
    + '    </p>'
    + '    <p style="color:var(--text-muted);font-size:0.82rem;margin-bottom:12px">' + statusLine + '</p>'
    +      actions
    + '  </div>'
    + '</div>';
}
