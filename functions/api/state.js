// Shared storage so silo estimates, bookings and stocktakes follow you between devices.
// Needs a Workers KV namespace bound to the Pages project with the variable name SILO_KV.
// Without it the site still works and simply keeps data on the device.
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export async function onRequestGet({ env }) {
  if (!env.SILO_KV) return json({ error: 'Storage not configured' }, 501);
  const raw = await env.SILO_KV.get('state');
  return json({ state: raw ? JSON.parse(raw) : null });
}

export async function onRequestPut({ request, env }) {
  if (!env.SILO_KV) return json({ error: 'Storage not configured' }, 501);
  const body = await request.text();
  if (body.length > 2_000_000) return json({ error: 'Too large' }, 413);
  let incoming;
  try { incoming = JSON.parse(body); } catch (e) { return json({ error: 'Bad JSON' }, 400); }
  if (!incoming || incoming.v !== 1 || !Array.isArray(incoming.readings) || !Array.isArray(incoming.stocktakes)) return json({ error: 'Not a valid state' }, 400);
  const raw = await env.SILO_KV.get('state');
  if (raw) { const cur = JSON.parse(raw); if ((cur.updatedAt || 0) > (incoming.updatedAt || 0)) return json({ error: 'A newer version exists' }, 409); }
  await env.SILO_KV.put('state', body);
  return json({ ok: true });
}
