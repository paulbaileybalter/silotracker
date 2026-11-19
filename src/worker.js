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
  return `<!DOCTYPE html><html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta name="theme-color" content="#47D7AC">
<title>Sign in · Silo Grain Tracker</title>
<link rel="icon" type="image/svg+xml" href="/assets/favicon.svg">
<link rel="preload" href="/fonts/lexend-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<style>
@font-face{font-family:'Lexend';src:url('/fonts/lexend-latin-wght-normal.woff2') format('woff2');font-weight:100 900;font-display:swap}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#fff;font:15px/1.45 'Lexend','Segoe UI',system-ui,sans-serif;color:#000;border-top:5px solid;border-image:linear-gradient(90deg,#47D7AC 0 25%,#FDAA63 25% 50%,#7566A0 50% 75%,#99D6EA 75% 100%) 1;overflow:hidden}
.bubbles{position:fixed;inset:0;pointer-events:none;overflow:hidden}
.bubbles span{position:absolute;bottom:-40px;border-radius:50%;background:radial-gradient(circle at 30% 30%,rgba(255,255,255,.95),rgba(71,215,172,.12));border:1px solid rgba(71,215,172,.28);animation:rise linear infinite}
@keyframes rise{0%{transform:translateY(0) scale(1);opacity:0}10%{opacity:.7}100%{transform:translateY(-115vh) scale(1.15);opacity:0}}
@media (prefers-reduced-motion:reduce){.bubbles{display:none}}
.box{position:relative;width:min(380px,92vw);padding:28px 26px;border:1px solid #E7E5DE;border-top:4px solid #47D7AC;border-radius:14px;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.04),0 6px 16px rgba(0,0,0,.05)}
.logo{width:56px;height:56px;display:block}
.kicker{display:block;margin-top:14px;font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:#7566A0;font-weight:600}
h1{font-size:22px;font-weight:700;letter-spacing:-.01em;margin:3px 0 4px}
p{margin:0 0 18px;color:#6B685D;font-size:13px}
label{display:block;font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:#6B685D;font-weight:600;margin-bottom:6px}
input[type=password]{width:100%;padding:10px 12px;border:1px solid #E7E5DE;border-radius:9px;font:inherit}
input:focus{outline:none;border-color:#47D7AC;box-shadow:0 0 0 3px rgba(71,215,172,.25)}
button{margin-top:16px;width:100%;padding:11px;border:1px solid #47D7AC;border-radius:10px;background:#47D7AC;color:#000;font:600 14px 'Lexend',system-ui,sans-serif;cursor:pointer;transition:background .12s,color .12s}
button:hover{background:#000;color:#fff;border-color:#000}
.err{background:#FFF1E4;border:1px solid #FDAA63;border-radius:12px;padding:9px 12px;font-size:13px;margin-bottom:14px}
</style></head>
<body><div class="bubbles" id="bubbles" aria-hidden="true"></div>
<form class="box" method="POST" action="/_auth/login"><img class="logo" src="/assets/logo.svg" alt="Balter Brewing" width="56" height="56"><span class="kicker">Balter Brewing · Supply Planning</span><h1>Silo Grain Tracker</h1><p>Enter the password to continue.</p>
${error ? '<div class="err" role="alert">That password isn\'t right. Try again.</div>' : ''}
<input type="hidden" name="next" value="${next.replace(/"/g, '&quot;')}">
<label for="pw">Password</label><input id="pw" name="password" type="password" autocomplete="current-password" autofocus required>
<button type="submit">Sign in</button></form>
<script>(function(){var h=document.getElementById('bubbles');for(var i=0;i<14;i++){var s=document.createElement('span'),z=8+Math.random()*26;s.style.cssText='left:'+Math.random()*100+'%;width:'+z+'px;height:'+z+'px;animation-duration:'+(14+Math.random()*16)+'s;animation-delay:'+(-Math.random()*24)+'s';h.appendChild(s);}})();</script>
</body></html>`;
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
    if (!incoming || incoming.v !== 1 || !Array.isArray(incoming.readings)) return json({ error: 'Not a valid state' }, 400);
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
    // fonts and logo are public so the sign-in page can use them (no data in them)
    if (request.method === 'GET' && (url.pathname.startsWith('/fonts/') || url.pathname === '/assets/logo.svg' || url.pathname === '/assets/favicon.svg')) return env.ASSETS.fetch(request);
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
