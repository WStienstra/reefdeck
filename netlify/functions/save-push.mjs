// Store a user's push subscription + the MINIMAL schedule needed to remind them
// when the app is closed: task names, due dates, their tank name, a notify hour
// and timezone. NO water chemistry, corals, or logs ever reach the server.
import { getStore } from '@netlify/blobs';
import { createHash } from 'node:crypto';

const keyFor = (endpoint) => createHash('sha256').update(endpoint).digest('hex');

export default async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  let body;
  try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }

  const sub = body && body.subscription;
  if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
    return json({ error: 'invalid subscription' }, 400);
  }

  const tasks = Array.isArray(body.tasks) ? body.tasks.slice(0, 100).map((t) => ({
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

  const store = getStore('reefdeck-push');
  await store.setJSON(keyFor(sub.endpoint), record);
  return json({ ok: true });
};

function clampHour(h) { h = Math.floor(Number(h)); return (h >= 0 && h <= 23) ? h : 9; }
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
}
