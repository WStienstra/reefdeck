// Scheduled hourly. For every stored subscription: if it's the user's chosen
// notify-hour in their timezone, and they have task(s) due/overdue, send ONE
// Web Push summarising them. Runs server-side so it works with the app closed.
import { getStore } from '@netlify/blobs';
import webpush from 'web-push';

// ---- Pure, unit-testable helpers ----
export function localParts(tz, now) {
  // Returns { date: 'YYYY-MM-DD', hour: 0-23 } in the given IANA timezone.
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
  });
  const p = Object.fromEntries(fmt.formatToParts(now).map((x) => [x.type, x.value]));
  let hour = parseInt(p.hour, 10);
  if (hour === 24) hour = 0; // some engines render midnight as "24"
  return { date: `${p.year}-${p.month}-${p.day}`, hour };
}

export function plan(record, now) {
  // Decide whether to send and which tasks, without any I/O.
  let tz = record.tz || 'UTC';
  let parts;
  try { parts = localParts(tz, now); }
  catch { parts = localParts('UTC', now); }
  if (parts.hour !== clampHour(record.notifyHour)) return { send: false, localDate: parts.date };
  if (record.lastSent === parts.date) return { send: false, localDate: parts.date };
  const due = (record.tasks || []).filter((t) => t.nextDue && t.nextDue <= parts.date);
  return { send: due.length > 0, localDate: parts.date, due };
}

export function buildPayload(due) {
  const first = due[0];
  const more = due.length - 1;
  const title = 'ReefDeck — maintenance due';
  let body;
  if (due.length === 1) body = `${first.name}${first.tankName ? ' · ' + first.tankName : ''}`;
  else body = `${first.name} and ${more} more task${more > 1 ? 's' : ''} due`;
  return { title, body, url: '/app/#schedule', tag: 'reefdeck-due' };
}

function clampHour(h) { h = Math.floor(Number(h)); return (h >= 0 && h <= 23) ? h : 9; }

// ---- Scheduled entrypoint ----
export default async () => {
  const subject = process.env.VAPID_SUBJECT || 'mailto:hello@reefdecks.com';
  const pub = process.env.VAPID_PUBLIC;
  const priv = process.env.VAPID_PRIVATE;
  if (!pub || !priv) {
    console.error('send-reminders: VAPID keys not configured');
    return new Response('not configured', { status: 200 });
  }
  webpush.setVapidDetails(subject, pub, priv);

  const store = getStore('reefdeck-push');
  const now = new Date();
  let sent = 0, cleaned = 0, scanned = 0;

  const { blobs } = await store.list();
  for (const b of blobs) {
    let record;
    try { record = await store.get(b.key, { type: 'json' }); }
    catch (err) { console.error('unreadable push record', b.key, err && err.message); continue; }
    if (!record) continue;
    scanned++;
    let decision;
    try { decision = plan(record, now); }
    catch (err) { console.error('bad push record', b.key, err && err.message); continue; }
    if (!decision.send) continue;
    const payload = JSON.stringify(buildPayload(decision.due));
    try {
      await webpush.sendNotification(record.subscription, payload, { TTL: 6 * 3600 });
      record.lastSent = decision.localDate;
      await store.setJSON(b.key, record);
      sent++;
    } catch (err) {
      const code = err && err.statusCode;
      if (code === 404 || code === 410) { await store.delete(b.key); cleaned++; }
      else console.error('push send failed', code, err && err.body);
    }
  }
  console.log(`send-reminders: scanned ${scanned}, sent ${sent}, cleaned ${cleaned}`);
  return new Response('ok', { status: 200 });
};
