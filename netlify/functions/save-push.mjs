// Store a user's push subscription + the MINIMAL schedule needed to remind them
// when the app is closed: task names, due dates, their tank name, a notify hour
// and timezone. NO water chemistry, corals, or logs ever reach the server.
import { getStore } from '@netlify/blobs';
import { createHash } from 'node:crypto';

const keyFor = (endpoint) => createHash('sha256').update(endpoint).digest('hex');

// Only accept subscription endpoints belonging to real browser push services.
// Without this, save-push accepts any attacker-chosen https:// URL and
// send-reminders will happily POST to it on a schedule (SSRF/outbound relay).
const ALLOWED_PUSH_HOSTS = [
  /(^|\.)googleapis\.com$/,           // Chrome/Edge/Android (FCM)
  /(^|\.)push\.services\.mozilla\.com$/, // Firefox
  /(^|\.)notify\.windows\.com$/,      // Windows/Edge legacy (WNS)
  /^web\.push\.apple\.com$/,          // Safari
];

function isAllowedPushEndpoint(endpoint) {
  let u;
  try { u = new URL(endpoint); } catch { return false; }
  if (u.protocol !== 'https:') return false;
  return ALLOWED_PUSH_HOSTS.some((re) => re.test(u.hostname));
}

// Cheap per-caller write throttle so the blob store can't be grown unbounded
// by repeated POSTs with distinct fake-but-allowlisted endpoints.
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60 * 60 * 1000;
async function rateLimited(store, ip) {
  if (!ip) return false; // can't identify caller — the endpoint allowlist is the primary gate
  const key = 'ratelimit:' + createHash('sha256').update(ip).digest('hex');
  const now = Date.now();
  let hits = [];
  try { hits = (await store.get(key, { type: 'json' })) || []; } catch { hits = []; }
  hits = hits.filter((t) => now - t < RATE_WINDOW_MS);
  if (hits.length >= RATE_LIMIT) return true;
  hits.push(now);
  await store.setJSON(key, hits);
  return false;
}

export default async (req, context) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  let body;
  try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }

  const sub = body && body.subscription;
  if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth || !isAllowedPushEndpoint(sub.endpoint)) {
    return json({ error: 'invalid subscription' }, 400);
  }

  const store = getStore('reefdeck-push');
  if (await rateLimited(store, context && context.ip)) {
    return json({ error: 'rate limited' }, 429);
  }

  const tasks = Array.isArray(body.tasks) ? body.tasks.slice(0, 100).filter((t) => t && typeof t === 'object').map((t) => ({
    name: String(t.name || '').slice(0, 80),
    nextDue: String(t.nextDue || '').slice(0, 10),       // YYYY-MM-DD
    intervalDays: Number(t.intervalDays) || 0,
    tankName: String(t.tankName || '').slice(0, 60),
  })) : [];

  const record = {
    subscription: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } },
    tasks,
    notifyHour: clampHour(body.notifyHour),
    tz: String(body.tz || 'UTC').slice(0, 64),
    license: String(body.license || '').slice(0, 40),
    lastSent: null,
    updatedAt: new Date().toISOString(),
  };

  try {
    await store.setJSON(keyFor(sub.endpoint), record);
  } catch (err) {
    console.error('save-push: blob write failed', err && err.message);
    return json({ error: 'storage unavailable' }, 503);
  }
  return json({ ok: true });
};

function clampHour(h) { h = Math.floor(Number(h)); return (h >= 0 && h <= 23) ? h : 9; }
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
}
