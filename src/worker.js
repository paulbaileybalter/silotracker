// Silo Grain Tracker: one Worker that (1) asks for the password, (2) stores shared data in KV,
// and (3) serves the website files from /public.
// Secrets (Worker > Settings > Variables and secrets, type "Secret"):
//   SITE_PASSWORD  the shared password
//   AUTH_SECRET    a long random string used to sign the login cookie
// KV binding: SILO_KV (declared in wrangler.jsonc)
const COOKIE = 'balter_session';
const MAX_AGE = 60 * 60 * 24 * 30; // stay signed in for 30 days
const enc = s => new TextEncoder().encode(s);

function b64url(buf) {
  let s = ''; new Uint8Array(buf).forEach(b => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc(msg)));
}
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
async function makeToken(env) {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
  return exp + '.' + await hmac(env.AUTH_SECRET, String(exp));
}
async function validToken(env, token) {
  if (!token) return false;
  const [exp, sig] = token.split('.');
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  return safeEqual(sig, await hmac(env.AUTH_SECRET, exp));
}
function getCookie(request, name) {
  const m = (request.headers.get('Cookie') || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? m[1] : null;
}
const cookieStr = (val, age) => `${COOKIE}=${val}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;
const safeNext = n => (n && n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/_auth') ? n : '/');
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const html = (body, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });

function loginPage(error, next) {
  const logo = '<svg viewBox="0 0 161 161" fill="#47D7AC" aria-hidden="true" width="64" height="64"><path d="M136.3,70.4l-9.4-9.4c-1.6-1.6-4.3-1.6-6,0-1.6,1.6-1.6,4.3,0,6l2.3,2.3c-9.6,13.2-25.2,21.7-42.7,21.7s-33.1-8.6-42.7-21.8l2.3-2.3c1.6-1.6,1.6-4.3,0-6-1.6-1.6-4.3-1.6-6,0l-9.4,9.4c-1.6,1.6-1.6,4.3,0,6,.8.8,1.9,1.2,3,1.2s2.2-.4,3-1.2l1.1-1.1c11.2,14.7,28.9,24.2,48.7,24.2s37.5-9.5,48.7-24.2l1.1,1.1c.8.8,1.9,1.2,3,1.2s2.2-.4,3-1.2c1.6-1.6,1.6-4.3,0-6"/><path d="M152.5,8.5v144H8.5V8.5h144M161,0H0v161h161V0h0Z"/></svg>';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Sign in · Silo Grain Tracker</title>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@700&family=Inter:wght@400;600&display=swap" rel="stylesheet">
<style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#fff;font:15px/1.5 Inter,system-ui,sans-serif;color:#14161a}
.box{width:min(380px,92vw);padding:34px 30px;border:1px solid rgba(0,0,0,.08);border-left:4px solid #47D7AC;border-radius:18px;box-shadow:0 8px 30px -14px rgba(20,22,26,.2)}
h1{font:700 22px 'Space Grotesk',system-ui,sans-serif;margin:14px 0 2px}p{margin:0 0 20px;color:#55585F;font-size:13.5px}
label{display:block;font-weight:600;font-size:13px;margin-bottom:6px}input{width:100%;padding:11px 12px;border:1.5px solid rgba(0,0,0,.14);border-radius:10px;font:inherit}
input:focus{outline:none;border-color:#47D7AC;box-shadow:0 0 0 3px rgba(71,215,172,.25)}
button{margin-top:16px;width:100%;padding:12px;border:0;border-radius:999px;background:#14161a;color:#fff;font:600 15px Inter,sans-serif;cursor:pointer}
.err{background:#fdeceb;color:#b3382c;border-radius:10px;padding:9px 12px;font-size:13px;margin-bottom:14px}</style></head>
<body><form class="box" method="POST" action="/_auth/login">${logo}<h1>Silo Grain Tracker</h1><p>Balter Brewing. Enter the password to continue.</p>
${error ? '<div class="err" role="alert">That password isn\'t right. Try again.</div>' : ''}
<input type="hidden" name="next" value="${next.replace(/"/g, '&quot;')}">
<label for="pw">Password</label><input id="pw" name="password" type="password" autocomplete="current-password" autofocus required>
<button type="submit">Sign in</button></form></body></html>`;
}

/* ---------- shared storage API ---------- */
async function stateApi(request, env) {
  if (!env.SILO_KV) return json({ error: 'Storage not configured' }, 501);
  if (request.method === 'GET') {
    const raw = await env.SILO_KV.get('state');
    return json({ state: raw ? JSON.parse(raw) : null });
  }
  if (request.method === 'PUT') {
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
  return json({ error: 'Method not allowed' }, 405);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!env.SITE_PASSWORD || !env.AUTH_SECRET) {
      return new Response('This site is not configured yet. In Cloudflare, open the Worker > Settings > Variables and secrets and add the secrets SITE_PASSWORD and AUTH_SECRET, then redeploy.', { status: 500 });
    }
    const authed = await validToken(env, getCookie(request, COOKIE));

    if (url.pathname === '/_auth/logout') {
      return new Response(null, { status: 302, headers: { Location: '/_auth/login', 'Set-Cookie': cookieStr('', 0), 'Cache-Control': 'no-store' } });
    }
    if (url.pathname === '/_auth/login') {
      if (request.method === 'POST') {
        const form = await request.formData();
        const given = String(form.get('password') || ''), target = safeNext(String(form.get('next') || '/'));
        // compare signed digests so the check is constant-time and length-independent
        const ok = safeEqual(await hmac(env.AUTH_SECRET, 'pw:' + given), await hmac(env.AUTH_SECRET, 'pw:' + env.SITE_PASSWORD));
        if (ok) return new Response(null, { status: 302, headers: { Location: target, 'Set-Cookie': cookieStr(await makeToken(env), MAX_AGE), 'Cache-Control': 'no-store' } });
        await new Promise(r => setTimeout(r, 900));          // slow down guessing
        return html(loginPage(true, target), 401);
      }
      if (authed) return new Response(null, { status: 302, headers: { Location: '/' } });
      return html(loginPage(false, safeNext(url.searchParams.get('next') || '/')));
    }

    if (!authed) {
      if (url.pathname.startsWith('/api/')) return json({ error: 'Not signed in' }, 401);
      return new Response(null, { status: 302, headers: { Location: '/_auth/login?next=' + encodeURIComponent(url.pathname + url.search), 'Cache-Control': 'no-store' } });
    }

    if (url.pathname === '/api/state') return stateApi(request, env);

    const res = await env.ASSETS.fetch(request);          // signed in: serve the website files
    const out = new Response(res.body, res);
    out.headers.set('Cache-Control', 'private, no-store');
    out.headers.set('X-Robots-Tag', 'noindex, nofollow');
    return out;
  }
};
