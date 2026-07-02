// Remove a stored push subscription (user turned closed-app push off, or we
// detected an expired endpoint).
import { getStore } from '@netlify/blobs';
import { createHash } from 'node:crypto';

const keyFor = (endpoint) => createHash('sha256').update(endpoint).digest('hex');

export default async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  let body;
  try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
  const endpoint = body && body.endpoint;
  if (!endpoint) return json({ error: 'no endpoint' }, 400);
  try {
    const store = getStore('reefdeck-push');
    await store.delete(keyFor(endpoint));
  } catch (err) {
    console.error('delete-push: blob delete failed', err && err.message);
    return json({ error: 'storage unavailable' }, 503);
  }
  return json({ ok: true });
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
}
