'use strict';
/* Declination – front end (vanilla JS single-page app, hash routing) */
(() => {
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = $('#app');
const state = { me: null, ready: false, timers: [] };

/* ---------- api ---------- */
async function api(method, url, body) {
  let res;
  try { res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' }); }
  catch { const e = new Error('Cannot reach the server. Check your connection and try again.'); e.network = true; throw e; }
  let data = null; try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) { const e = new Error(data?.error || 'Something went wrong.'); e.status = res.status; e.field = data?.field; throw e; }
  return data;
}
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 3200); }
function clearTimers() { state.timers.forEach(clearInterval); state.timers = []; }

/* ---------- formatting ---------- */
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const parseD = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const fmtLong = (s) => { const d = parseD(s); return `${DOW[d.getDay()]}, ${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`; };
const fmtShort = (s) => { const d = parseD(s); return `${MON[d.getMonth()]} ${d.getDate()}`; };
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayStr = () => ymd(new Date());
const fmtWhen = (iso) => { const d = new Date(iso); return `${DOW[d.getDay()]}, ${d.getDate()} ${MON[d.getMonth()]} · ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const ago = (ms) => { const m = Math.max(0, Math.round((Date.now() - ms) / 60000)); if (m < 1) return 'just now'; if (m < 60) return `${m} min ago`; const h = Math.round(m / 60); if (h < 24) return `${h} h ago`; return `${Math.round(h / 24)} d ago`; };
const compact = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '')}k` : String(n));
const hms = (s) => [Math.floor(s / 3600), Math.floor(s / 60) % 60, Math.floor(s % 60)].map((n) => String(n).padStart(2, '0')).join(':');
const hoursText = (h) => (h % 1 === 0 ? `${h} h` : `${h.toFixed(1)} h`);
const bg = (u) => `style="background-image:url('${esc(u || '/assets/trail.svg')}')"`;
const avHtml = (u, extra = '') => u && u.avatar ? `<span class="av photo" ${extra} style="background-image:url('${esc(u.avatar)}')" role="img" aria-label="${esc(u.name || '')}"></span>` : `<span class="av" ${extra}>${esc(u ? u.initials : '?')}</span>`;
const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;

/* ---------- icons ---------- */
const I = {
  sun: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2f7fd8" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  left: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
  right: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>',
  arrow: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  heart: (on) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="${on ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 21s-7.5-4.6-9.5-9.2C1.2 8.6 3.2 5 6.7 5c2 0 3.5 1.1 5.3 3 1.8-1.9 3.3-3 5.3-3 3.5 0 5.5 3.6 4.2 6.8C19.5 16.4 12 21 12 21z"/></svg>`,
  star: '<svg width="16" height="16" viewBox="0 0 24 24" fill="#e0a100"><path d="M12 2l3 6.6 7.2.7-5.4 4.8 1.6 7.1L12 17.6 5.6 21.2l1.6-7.1L1.8 9.3 9 8.6z"/></svg>',
  search: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5f6155" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
  check: '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>',
  chat: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 5h16v11H9l-5 4z"/></svg>',
  google: '<svg width="30" height="30" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z"/></svg>',
};

/* ---------- layout ---------- */
const NAV_OUT = [['Trails', '#/trails'], ['Groups', '#/groups'], ['Book', '#/book'], ['Profile', '#/profile']];
const NAV_IN = [['Trails', '#/trails'], ['Groups', '#/groups'], ['Book', '#/book'], ['Saved', '#/saved'], ['History', '#/history'], ['Profile', '#/profile']];
function header(route) {
  const items = (state.me ? NAV_IN : NAV_OUT).map(([l, h]) => `<a href="${h}" ${route.startsWith(h.slice(1)) && h !== '#/' ? 'aria-current="page"' : ''}>${l}</a>`).join('');
  const cta = state.me ? `<button class="pill sm" id="logout" type="button">Log out</button>` : `<a class="pill" href="#/login">Log in</a>`;
  return `<header class="hdr"><div class="hdr__in">
    <a class="brand" href="#/" aria-label="Declination home"><img src="/assets/logo.png" alt=""><span class="wordmark">Declination</span></a>
    <button class="burger" id="burger" type="button" aria-label="Menu" aria-expanded="false" aria-controls="nav"><span></span><span></span><span></span></button>
    <nav class="nav" id="nav" aria-label="Main">${items}</nav>
    <div class="hdr__cta">${cta}</div></div></header>`;
}
function footer(variant) {
  const right = variant === 'cta'
    ? `<div class="cta-box" aria-hidden="true">YOUR NEXT ADVENTURE
STARTS HERE

Every summit conquered.
Every trail explored.
Every challenge completed.

"The mountains are calling.
 Will you answer?"<i class="l"></i><i class="r"></i></div>`
    : `<div class="ftr__cols">
      <div><h4>Explore</h4><ul><li><a href="#/trails">Trails</a></li><li><a href="#/book">Stays and tables</a></li><li><a href="#/trails/lake-kari-loop">Weather</a></li></ul></div>
      <div><h4>Community</h4><ul><li><a href="#/groups">Group hikes</a></li><li><a href="#/groups">Stories</a></li><li><a href="#/groups">Rewards</a></li></ul></div>
      <div><h4>Company</h4><ul><li><a href="#/">About</a></li><li><a href="#/terms">Terms of Use</a></li><li><a href="#/privacy">Privacy Policy</a></li></ul></div></div>
      <div class="copy">© ${new Date().getFullYear()} Declination. All rights reserved.</div>`;
  return `<footer class="ftr"><div class="ftr__in">
    <img class="logo-lg" src="/assets/logo.png" alt=""><span class="wordmark">Declination</span>
    <p class="quote">"Join thousands of adventurers exploring the world's greatest trails. Share your journey, earn rewards, and discover your next summit."</p>
    <p class="tagline">Every peak has a story. What's yours?</p>${right}</div></footer>`;
}
function render(route, html, { foot = 'links', after } = {}) {
  clearTimers();
  app.innerHTML = `${header(route)}<main id="main" tabindex="-1">${html}</main>${footer(foot)}`;
  const bg2 = $('#burger'), hd = $('.hdr');
  if (bg2) { bg2.onclick = () => { const o = hd.classList.toggle('open'); bg2.setAttribute('aria-expanded', o); }; $$('#nav a').forEach((a) => { a.onclick = () => { hd.classList.remove('open'); bg2.setAttribute('aria-expanded', 'false'); }; }); }
  const lo = $('#logout'); if (lo) lo.onclick = async () => { try { await api('POST', '/api/auth/logout'); } catch { /* ignore */ } state.me = null; toast('You are logged out.'); location.hash = '#/'; render404Guard(); };
  window.scrollTo(0, 0); document.title = 'Declination – ' + (route === '/' ? 'Every peak has a story' : route.split('/')[1].replace(/^./, (c) => c.toUpperCase()));
  if (after) after();
}
const render404Guard = () => route();
const loading = () => `<div class="page"><div class="wrap"><div class="skel"></div><div class="skel" style="margin-top:20px"></div></div></div>`;
const errBox = (e) => `<div class="page"><div class="wrap"><div class="card empty">${esc(e.message || 'Something went wrong.')}<br><br><a class="btn btn--sm" href="#/trails">Back to trails</a></div></div></div>`;
function needLogin(next) { location.hash = `#/login?next=${encodeURIComponent(next)}`; }

/* ---------- home ---------- */
async function pageHome() {
  render('/', `<section class="hero"><div class="hero__in">
    <div class="hero__l glass"><h1>The mountains are calling, and I must go.</h1>
      <div class="hero__btns"><a class="btn" href="#/${state.me ? 'groups' : 'signup'}" style="width:182px">Get started</a><a class="btn btn--fill" href="#/trails" style="width:167px">Find a trail</a></div></div>
    <div class="feat glass" id="feat" aria-live="polite"></div>
    <div class="chips3"><div class="chip3 glass"><b>12,000+</b><span>Trails</span></div><div class="chip3 glass"><b>50k</b><span>Adventurers</span></div><div class="chip3 glass"><b>Earn rewards</b><span>at every summit</span></div></div>
  </div></section>`);
  let list = [], i = 0;
  const draw = () => {
    const t = list[i]; const el = $('#feat'); if (!el) return;
    if (!t) { el.innerHTML = '<p style="padding:30px">No featured trails right now.</p>'; return; }
    el.innerHTML = `<div class="feat__img" role="img" aria-label="${esc(t.name)}" ${bg(t.image)}></div>
      <div class="feat__b"><div class="chips"><span class="chip chip--dark">Featured trail</span><span class="chip">${esc(t.difficulty)}</span></div>
      <div class="dots" aria-hidden="true">${list.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('')}</div>
      <h2>${esc(t.name)}</h2><p class="loc">${esc(t.location)}</p>
      <p class="wx">${I.sun}<span>${t.weather.temp}°C</span><span>·</span><span>${esc(t.weather.cond)}</span></p>
      <div class="stats"><div><b>${t.distanceKm} km</b><span>Distance</span></div><div><b>+${t.elevationM} m</b><span>Elevation</span></div><div><b>${hoursText(t.durationH).replace(' h', ' h')}</b><span>Time</span></div></div></div>
      <div class="feat__act"><a class="btn" href="#/trails/${esc(t.slug)}">View trail&nbsp;${I.arrow}</a>
      <div><button class="round" id="prev" type="button" aria-label="Previous trail">${I.left}</button><button class="round" id="next" type="button" aria-label="Next trail">${I.right}</button></div></div>`;
    $('#prev').onclick = () => { i = (i - 1 + list.length) % list.length; draw(); };
    $('#next').onclick = () => { i = (i + 1) % list.length; draw(); };
  };
  try { list = (await api('GET', '/api/featured')).trails; } catch { /* leave empty */ }
  draw();
  if (list.length > 1) state.timers.push(setInterval(() => { if (document.hidden) return; i = (i + 1) % list.length; draw(); }, 8000));
}

/* ---------- auth ---------- */
const nextUrl = (q) => { const n = q.get('next'); return n && /^#\/[a-z]/i.test(n) ? n : '#/trails'; };
function authShell(route, card) { render(route, `<section class="auth"><div class="auth__in">${card}</div></section>`, { foot: 'cta' }); }
const legalLine = `<p class="legal">By continuing using Declination, you agree to our <a href="#/terms">Terms of service</a> and <a href="#/privacy">Privacy policy</a></p>`;
const googleBtn = `<button class="wbtn wbtn--google" id="google" type="button">${I.google}<span>Continue with Google</span></button>`;
function fieldErr(form, e) {
  $$('.f', form).forEach((f) => f.classList.remove('err')); $$('.em', form).forEach((n) => (n.textContent = ''));
  const inp = e.field && form.elements[e.field];
  if (inp) { const f = inp.closest('.f'); f.classList.add('err'); $('.em', f).textContent = e.message; inp.focus(); return true; }
  return false;
}
const fld = (name, label, type = 'text', extra = '') => `<label class="f"><span class="sr">${label}</span><input name="${name}" type="${type}" placeholder="${label}*" ${extra}><span class="em" role="alert"></span></label>`;
async function googleClick() { try { await api('GET', '/api/auth/google'); } catch (e) { toast(e.message); } }

function pageLogin(q) {
  authShell('/login', `<div class="acard"><h1>Welcome back.<br>Log in and start exploring</h1>
    <form id="f" novalidate>${fld('email', 'Email address', 'email', 'autocomplete="email" required')}${fld('password', 'Password', 'password', 'autocomplete="current-password" required')}
    <div id="m"></div><button class="wbtn wbtn--dark" type="submit">Log in</button></form>
    <a class="wbtn wbtn--gray" href="#/forgot">Forgot password?</a>${googleBtn}
    <p class="alt">Don’t have an account? <a href="#/signup">Sign up for free</a></p>${legalLine}</div>`);
  $('#google').onclick = googleClick;
  const f = $('#f'); f.onsubmit = async (ev) => {
    ev.preventDefault(); const b = $('button[type=submit]', f); const email = f.email.value.trim(), password = f.password.value;
    $('#m').innerHTML = ''; fieldErr(f, {});
    if (!email) return fieldErr(f, { field: 'email', message: 'Please enter your email address.' });
    if (!password) return fieldErr(f, { field: 'password', message: 'Please enter your password.' });
    b.disabled = true;
    try { state.me = (await api('POST', '/api/auth/login', { email, password })).user; toast(`Welcome back, ${state.me.name}!`); location.hash = nextUrl(q); }
    catch (e) { if (!fieldErr(f, e)) $('#m').innerHTML = `<div class="msg msg--err" role="alert">${esc(e.message)}</div>`; }
    finally { b.disabled = false; }
  };
}
function pageSignup(q) {
  const step1 = () => authShell('/signup', `<div class="acard" style="padding-top:80px"><h1 class="big">Create your free account</h1>
    <a class="wbtn wbtn--dark" id="go" href="#/signup?form=1" style="margin-top:64px;font-size:24px;font-weight:400">Create a free account</a>
    <p class="or">or</p>${googleBtn}<p class="alt" style="margin-top:34px">Already have an account ? <a href="#/login">Log in</a></p>${legalLine}</div>`);
  const step2 = () => authShell('/signup', `<div class="acard" style="padding-top:40px"><h1 class="big">Sign up today to start planning your next adventure</h1>
    <form id="f" novalidate>${fld('name', 'Name', 'text', 'autocomplete="given-name" maxlength="60" required')}${fld('surname', 'Surname', 'text', 'autocomplete="family-name" maxlength="60" required')}
    ${fld('email', 'Email address', 'email', 'autocomplete="email" required')}${fld('password', 'Password', 'password', 'autocomplete="new-password" minlength="8" required')}
    <p class="help" style="text-align:left">At least 8 characters, with a letter and a number.</p><div id="m"></div>
    <button class="wbtn wbtn--dark" type="submit">Sign up</button></form>
    <p class="alt">Already have an account ? <a href="#/login">Log in</a></p>${legalLine}</div>`);
  if (!q.get('form')) { step1(); $('#google').onclick = googleClick; return; }
  step2();
  const f = $('#f'); f.onsubmit = async (ev) => {
    ev.preventDefault(); $('#m').innerHTML = ''; fieldErr(f, {});
    const v = { name: f.name.value.trim(), surname: f.surname.value.trim(), email: f.email.value.trim(), password: f.password.value };
    const local = !v.name ? ['name', 'Please enter your name.'] : !v.surname ? ['surname', 'Please enter your surname.'] : !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.email) ? ['email', 'Please enter a valid email address.']
      : v.password.length < 8 ? ['password', 'Password must be at least 8 characters.'] : !/[A-Za-z]/.test(v.password) || !/\d/.test(v.password) ? ['password', 'Password needs at least one letter and one number.'] : null;
    if (local) return fieldErr(f, { field: local[0], message: local[1] });
    const b = $('button[type=submit]', f); b.disabled = true;
    try { state.me = (await api('POST', '/api/auth/signup', v)).user; toast(`Welcome to Declination, ${state.me.name}!`); location.hash = nextUrl(q); }
    catch (e) { if (!fieldErr(f, e)) $('#m').innerHTML = `<div class="msg msg--err" role="alert">${esc(e.message)}</div>`; }
    finally { b.disabled = false; }
  };
}
function pageForgot() {
  authShell('/forgot', `<div class="acard"><h1 class="big" style="font-size:34px">Forgot your password</h1><p class="sub" style="font-size:18px">enter your email to get help logging in</p>
    <form id="f" novalidate>${fld('email', 'Email address', 'email', 'autocomplete="email" required')}<div id="m"></div>
    <button class="wbtn wbtn--dark" type="submit">Send email</button></form><a class="wbtn wbtn--gray" href="#/login">Back to sign in</a>
    <p class="note">Note: The password reset email may take a few minutes. If you don't see it then, please check your spam or junk folder.</p></div>`);
  const f = $('#f'); f.onsubmit = async (ev) => {
    ev.preventDefault(); fieldErr(f, {}); $('#m').innerHTML = ''; const b = $('button[type=submit]', f); b.disabled = true;
    try { const r = await api('POST', '/api/auth/forgot', { email: f.email.value.trim() }); $('#m').innerHTML = `<div class="msg msg--ok" role="status">${esc(r.message)}</div>`; }
    catch (e) { if (!fieldErr(f, e)) $('#m').innerHTML = `<div class="msg msg--err" role="alert">${esc(e.message)}</div>`; }
    finally { b.disabled = false; }
  };
}
function pageReset(q) {
  const token = q.get('token') || '';
  authShell('/reset', `<div class="acard"><h1 class="big" style="font-size:34px">Choose a new password</h1>
    <form id="f" novalidate>${fld('password', 'New password', 'password', 'autocomplete="new-password" minlength="8" required')}<div id="m"></div>
    <button class="wbtn wbtn--dark" type="submit">Save password</button></form><a class="wbtn wbtn--gray" href="#/login">Back to sign in</a></div>`);
  const f = $('#f'); f.onsubmit = async (ev) => {
    ev.preventDefault(); fieldErr(f, {}); $('#m').innerHTML = '';
    try { await api('POST', '/api/auth/reset', { token, password: f.password.value }); toast('Password updated. Log in with your new password.'); location.hash = '#/login'; }
    catch (e) { if (!fieldErr(f, e)) $('#m').innerHTML = `<div class="msg msg--err" role="alert">${esc(e.message)}</div>`; }
  };
}

/* ---------- trails ---------- */
function trailCard(t) {
  const stay = { 'Stays available': 'ok', 'Few rooms left': 'warn', 'Sold out': 'bad' }[t.stayStatus] || 'muted';
  const grp = t.groupsHiking ? ` · ${plural(t.groupsHiking, 'group', 'groups')} hiking` : '';
  const stayTxt = t.stayStatus === 'No stays listed' ? '' : `<span class="${stay}">${esc(t.stayStatus)}</span>`;
  const extra = t.mine || t.isNew ? `<div class="avl"><span class="ok">Saved to your trails</span>${t.shared ? ' · Shared with the community' : ' · Only you can see this'}</div>`
    : `<div class="avl">${stayTxt}${stayTxt ? grp : grp.replace(/^ · /, '')}</div>`;
  const wx = t.isNew ? '' : `<span>${I.sun.replace('width="18" height="18"', 'width="15" height="15"')}</span><span style="font-size:13px;font-weight:600">${t.weather.temp}°C ${esc(t.weather.cond)}</span>`;
  return `<a class="card tc" href="#/trails/${esc(t.slug)}" aria-label="${esc(t.name)}, ${esc(t.difficulty)}">
    <div class="ph" role="img" aria-label="" ${bg(t.image)}></div>
    <div><h3>${esc(t.name)}</h3><p class="loc">${esc(t.location)}</p>
    <div class="meta"><span class="diff ${esc(t.difficulty)}">${esc(t.difficulty)}</span>${t.isNew ? '<span class="badge">New</span>' : ''}${wx}</div>
    <p class="st"><b>${t.distanceKm} km</b> · +${t.elevationM} m · ${hoursText(t.durationH)}</p>${extra}</div>
    <button class="heart" type="button" data-save="${t.id}" aria-pressed="${t.saved}" aria-label="${t.saved ? 'Remove from saved' : 'Save trail'}">${I.heart(t.saved)}</button></a>`;
}
function bindSave(root, onChange) {
  $$('[data-save]', root).forEach((b) => b.addEventListener('click', async (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    if (!state.me) return needLogin(location.hash.slice(0));
    const on = b.getAttribute('aria-pressed') !== 'true'; b.disabled = true;
    try { await api(on ? 'POST' : 'DELETE', `/api/trails/${b.dataset.save}/save`); b.setAttribute('aria-pressed', on); b.innerHTML = I.heart(on); b.setAttribute('aria-label', on ? 'Remove from saved' : 'Save trail'); toast(on ? 'Saved to your trails' : 'Removed from saved'); if (onChange) onChange(); }
    catch (e) { toast(e.message); } finally { b.disabled = false; }
  }));
}
const FILTERS = [['under5', 'Under 5 km'], ['lakes', 'Lakes'], ['waterfalls', 'Waterfalls'], ['family', 'Family friendly'], ['stays', 'Stays nearby']];
async function pageTrails(q) {
  const st = { q: q.get('q') || '', difficulty: q.get('difficulty') || '', tags: new Set((q.get('tags') || '').split(',').filter(Boolean)), sort: q.get('sort') || 'popular' };
  render('/trails', `<div class="page"><div class="wrap">
    <h1>Explore trails</h1><p class="lead">Search by name, region or difficulty. Every trail shows the weather and nearby stays.</p>
    <form class="search card" id="sf" role="search"><label class="box">${I.search}<span class="sr">Search trails</span><input id="qi" type="search" placeholder="Search trails, regions or difficulty" value="${esc(st.q)}" maxlength="80" autocomplete="off"></label>
    <button class="btn btn--fill btn--sm" style="height:54px;padding:0 34px;font-size:18px;border-radius:27px" type="submit">Search</button></form>
    <div class="filters" id="flt"></div>
    <div class="count"><b id="cnt" aria-live="polite">&nbsp;</b><span class="sp"></span><label class="muted" style="font-size:14px">Sort by: <select id="sort"><option value="popular">Most popular</option><option value="distance">Shortest distance</option><option value="difficulty">Easiest first</option><option value="name">Name</option></select></label></div>
    <div class="grid2" id="grid"><div class="skel"></div><div class="skel"></div></div></div></div>`);
  const drawF = () => { $('#flt').innerHTML = `<span class="lab">Difficulty</span>` + ['', 'Easy', 'Moderate', 'Hard'].map((d) => `<button class="tag" type="button" data-d="${d}" aria-pressed="${st.difficulty === d}">${d || 'All'}</button>`).join('') + `<span class="div"></span>` + FILTERS.map(([k, l]) => `<button class="tag" type="button" data-t="${k}" aria-pressed="${st.tags.has(k)}">${l}</button>`).join(''); 
    $$('[data-d]').forEach((b) => (b.onclick = () => { st.difficulty = b.dataset.d; drawF(); load(); }));
    $$('[data-t]').forEach((b) => (b.onclick = () => { st.tags.has(b.dataset.t) ? st.tags.delete(b.dataset.t) : st.tags.add(b.dataset.t); drawF(); load(); })); };
  let seq = 0;
  async function load() {
    const my = ++seq; const p = new URLSearchParams(); if (st.q) p.set('q', st.q); if (st.difficulty) p.set('difficulty', st.difficulty); if (st.tags.size) p.set('tags', [...st.tags].join(',')); p.set('sort', st.sort);
    try {
      const r = await api('GET', '/api/trails?' + p); if (my !== seq || !$('#grid')) return;
      $('#cnt').textContent = `${plural(r.count, 'trail', 'trails')} found`;
      $('#grid').innerHTML = r.trails.length ? r.trails.map(trailCard).join('') : `<div class="card empty" style="grid-column:1/-1">No trails match your search. Try removing a filter.</div>`;
      bindSave($('#grid'));
    } catch (e) { if (my === seq && $('#grid')) $('#grid').innerHTML = `<div class="card empty" style="grid-column:1/-1">${esc(e.message)}</div>`; }
  }
  $('#sort').value = st.sort; $('#sort').onchange = (e) => { st.sort = e.target.value; load(); };
  $('#sf').onsubmit = (e) => { e.preventDefault(); st.q = $('#qi').value.trim(); load(); };
  let deb; $('#qi').oninput = (e) => { clearTimeout(deb); deb = setTimeout(() => { st.q = e.target.value.trim(); load(); }, 250); };
  drawF(); load();
}

async function pageTrail(id) {
  render('/trails/' + id, loading());
  let d; try { d = await api('GET', '/api/trails/' + encodeURIComponent(id)); } catch (e) { return render('/trails', errBox(e)); }
  const { trail: t, weather: w, plan, community } = d;
  const dr = plan.defaultRange;
  render('/trails/' + id, `<div class="page"><div class="wrap">
    <div class="crumbs"><a href="#/trails">${I.left}&nbsp;All trails</a></div>
    <div class="row"><div><h1>${esc(t.name)}</h1><p class="lead" style="margin-top:4px">${esc(t.location)}</p></div><span class="sp"></span>
    <button class="btn btn--sm" id="sv" type="button" aria-pressed="${t.saved}">${I.heart(t.saved)}&nbsp;<span>${t.saved ? 'Saved' : 'Save trail'}</span></button></div>
    <div class="td"><div>
      <div class="td__hero" role="img" aria-label="${esc(t.name)}" ${bg(t.image)}><div class="chips"><span class="chip chip--dark">${t.featured ? 'Featured trail' : 'Trail'}</span><span class="chip" style="background:#fff">${esc(t.difficulty)}</span></div></div>
      <div class="kpis"><div class="card kpi"><span>Distance</span><b>${t.distanceKm} km</b></div><div class="card kpi"><span>Elevation gain</span><b>+${t.elevationM} m</b></div><div class="card kpi"><span>Duration</span><b>${hoursText(t.durationH)}</b></div><div class="card kpi"><span>Difficulty</span><b>${esc(t.difficulty)}</b></div></div>
      <section class="card sec"><h2>About this trail</h2><p>${esc(t.description)}</p></section>
      <section class="card sec"><div class="row"><h2 style="margin:0">Weather on the trail</h2><span class="sp"></span><span class="muted" style="font-size:13px">Updated ${w.updatedMinAgo} min ago</span></div>
        <div class="wx2" style="margin-top:18px"><div class="t">${w.temp}°</div><div class="c"><b>${esc(w.cond)}</b><span>Feels like ${w.feels}°C · Low ${w.low}°C tonight</span></div></div>
        <div class="mini"><div><span>Wind</span><b>${w.wind} km/h</b></div><div><span>Humidity</span><b>${w.humidity}%</b></div><div><span>UV index</span><b>${esc(w.uv)}</b></div><div><span>Sunset</span><b>${esc(w.sunset)}</b></div></div>
        ${w.forecast.length ? `<div class="fc">${w.forecast.map((f) => `<div><span>${esc(f.label)}</span><b>${f.hi}° / ${f.lo}°</b></div>`).join('')}</div>` : '<p class="muted" style="margin-top:14px">No forecast available for this trail.</p>'}</section>
    </div>
    <aside class="side">
      <section class="card"><h3>Plan your trip</h3>
        <label class="fld"><span class="sr">Date</span><input type="date" id="pd" value="${dr.start}" min="${todayStr()}"></label>
        <label class="fld"><span class="sr">Hikers</span><select id="ph">${[1, 2, 3, 4, 5, 6, 8, 10].map((n) => `<option value="${n}" ${n === 2 ? 'selected' : ''}>${plural(n, 'hiker', 'hikers')}</option>`).join('')}</select></label>
        <div class="line"><span class="${plan.hotels ? '' : 'muted'}">${plan.hotels ? `${plan.hotels} hotels available · from $${plan.fromPrice} / night` : 'No hotels listed yet'}</span><a class="btn btn--sm" id="bs" href="#/book">Find stays</a></div>
        <div class="line"><span class="${plan.restaurants ? '' : 'muted'}">${plural(plan.restaurants, 'restaurant', 'restaurants')} near the trail</span><a class="btn btn--sm" id="bt" href="#/book">Book a table</a></div></section>
      <section class="card"><h3>Hike with others</h3><p style="font-size:15px;line-height:1.55;color:#3c3d30">${community.groups ? `${plural(community.groups, 'group is', 'groups are')} heading up this trail in the next two weeks. Meet fellow hikers and share the climb.` : 'No groups are heading up this trail yet. Start one and invite fellow hikers.'}</p>
        ${community.avatars.length ? `<div class="avs">${community.avatars.map((a) => `<span class="av">${esc(a)}</span>`).join('')}${community.more ? `<span>+${community.more} hikers joined</span>` : ''}</div>` : ''}
        <div class="row" style="gap:10px"><a class="btn btn--fill btn--sm" href="#/groups">${community.groups ? 'See groups' : 'Start a group'}</a></div></section>
    </aside></div></div></div>`);
  const upd = () => { const q = new URLSearchParams({ trail: t.id, start: $('#pd').value, guests: $('#ph').value }); $('#bs').href = '#/book?' + q; $('#bt').href = '#/book?' + q + '&tab=restaurants'; };
  $('#pd').onchange = upd; $('#ph').onchange = upd; upd();
  $('#sv').onclick = async () => {
    if (!state.me) return needLogin(location.hash);
    const b = $('#sv'); const on = b.getAttribute('aria-pressed') !== 'true'; b.disabled = true;
    try { await api(on ? 'POST' : 'DELETE', `/api/trails/${t.id}/save`); b.setAttribute('aria-pressed', on); b.innerHTML = `${I.heart(on)}&nbsp;<span>${on ? 'Saved' : 'Save trail'}</span>`; toast(on ? 'Saved to your trails' : 'Removed from saved'); } catch (e) { toast(e.message); } finally { b.disabled = false; }
  };
}

/* ---------- book stay & table ---------- */
const stars = (r, n) => `<span class="rt">${I.star}<b>${r.toFixed(1)}</b><span class="muted">(${n} reviews)</span></span>`;
async function pageBook(q) {
  render('/book', loading());
  let trails; try { trails = (await api('GET', '/api/trails?sort=name')).trails; } catch (e) { return render('/book', errBox(e)); }
  const withStays = trails; if (!withStays.length) return render('/book', errBox({ message: 'No trails available yet.' }));
  const def = Number(q.get('trail')) || (withStays.find((t) => t.slug === 'lake-kari-loop') || withStays[0]).id;
  const cur = { trail: def, start: q.get('start') && q.get('start') >= todayStr() ? q.get('start') : '', end: '', guests: Math.min(12, Math.max(1, Number(q.get('guests')) || 2)), tab: q.get('tab') || 'hotels', slot: {} };
  const shell = () => `<div class="page"><div class="wrap">
    <h1>Book stay and table</h1><p class="lead" id="bl">&nbsp;</p>
    <div class="tabs bk-tabs" role="tablist">${['hotels', 'restaurants', 'churches'].map((k) => `<button class="tab" role="tab" data-tab="${k}" aria-selected="${cur.tab === k}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}</div>
    <form class="bar card" id="bar"><div class="cell"><label for="bt">Location</label><select id="bt">${withStays.map((t) => `<option value="${t.id}" ${t.id === cur.trail ? 'selected' : ''}>${esc(t.name)} — ${esc(t.location.split(',')[0])}</option>`).join('')}</select></div>
      <div class="cell"><label for="bs">Check-in / table date</label><input type="date" id="bs" min="${todayStr()}"></div><div class="cell"><label for="be">Check-out</label><input type="date" id="be" min="${todayStr()}"></div>
      <div class="cell" style="border:0;min-width:130px"><label for="bg">Guests</label><select id="bg">${[1, 2, 3, 4, 5, 6, 8, 10, 12].map((n) => `<option value="${n}" ${n === cur.guests ? 'selected' : ''}>${plural(n, 'guest', 'guests')}</option>`).join('')}</select></div></form>
    <div id="res"><div class="skel" style="margin-top:24px"></div></div></div></div>`;
  render('/book', shell());
  const setLead = (r) => { const t = trails.find((x) => x.id === cur.trail); $('#bl').textContent = `Hotels, restaurants and churches near ${t.name}. See what is available for your dates.`; void r; };
  let seq = 0;
  async function load() {
    const my = ++seq; const p = new URLSearchParams({ guests: cur.guests }); if (cur.start) p.set('start', cur.start); if (cur.end) p.set('end', cur.end); if (cur.start) p.set('date', cur.start);
    try {
      const r = await api('GET', `/api/trails/${cur.trail}/places?` + p); if (my !== seq || !$('#res')) return;
      cur.start = r.start; cur.end = r.end; $('#bs').value = r.start; $('#be').value = r.end; $('#be').min = r.start; setLead(r);
      const nn = Math.round((Date.parse(r.end) - Date.parse(r.start)) / 864e5);
      const avail = r.hotels.filter((h) => h.roomsLeft > 0).length;
      const hotel = (h) => { const msg = h.status === 'soldout' ? '<span class="bad"><b>Sold out for your dates</b></span>' : h.status === 'few' ? `<span class="warn"><b>Only ${h.roomsLeft} ${h.roomsLeft === 1 ? 'room' : 'rooms'} left</b></span>` : `<span class="ok"><b>Available · ${h.roomsLeft} rooms</b></span>`;
        return `<article class="card pc"><div class="ph" role="img" aria-label="${esc(h.name)}" ${bg(h.image)}></div><div><h3>${esc(h.name)}</h3><p class="muted" style="font-size:14px;margin-top:2px">${h.distanceKm} km from the trail start</p>${stars(h.rating, h.reviews)}
          <div class="am">${h.amenities.map((a) => `<i>${esc(a)}</i>`).join('')}</div><p style="margin-top:10px;font-size:14px">${msg}</p></div>
          <div class="pr"><b>$${h.price}</b> <small>/ night</small><br><button class="btn btn--fill btn--sm" style="margin-top:12px" data-hotel="${h.id}" ${h.status === 'soldout' ? 'disabled' : ''}>${h.status === 'soldout' ? 'Unavailable' : 'Book now'}</button></div></article>`; };
      const rest = (x) => `<article class="card pc pc--r"><div class="ph" role="img" aria-label="${esc(x.name)}" ${bg(x.image)}></div><div><h3>${esc(x.name)}</h3><p class="muted" style="font-size:14px;margin-top:2px">${esc(x.cuisine)} · ${esc(x.priceLevel)} · ${x.distanceKm} km</p>${stars(x.rating, x.reviews)}
          <div class="slots"><span style="font-size:14px;font-weight:600">Available times</span>${x.slots.map((s) => `<button class="slot" type="button" data-r="${x.id}" data-time="${s.time}" aria-pressed="${cur.slot[x.id] === s.time}" ${s.available ? '' : 'disabled'}>${s.time}</button>`).join('')}</div></div>
          <div class="pr"><button class="btn btn--fill btn--sm" data-reserve="${x.id}" ${cur.slot[x.id] ? '' : 'disabled'}>Reserve table</button></div></article>`;
      const ch = (x) => `<article class="card pc pc--r pc--c"><div class="ph" role="img" aria-label="${esc(x.name)}" ${bg(x.image)}></div><div><h3>${esc(x.name)}</h3><p class="muted" style="font-size:14px;margin-top:2px">${esc(x.denomination)} · ${x.distanceKm} km from the trail</p>${stars(x.rating, x.reviews)}
          <div class="slots"><span style="font-size:14px;font-weight:600">Visiting hours</span><span class="chip">Open today</span><span class="chip">${esc(x.hours)}</span><span class="chip">${esc(x.notes)}</span></div></div></article>`;
      $('#res').innerHTML = `<section class="blk" id="s-hotels"><h2>Hotels near the trail</h2><p>${avail} of ${r.hotels.length} properties have rooms for ${fmtShort(r.start)} – ${fmtShort(r.end)} (${plural(nn, 'night', 'nights')})</p>${r.hotels.map(hotel).join('') || '<div class="card empty">No hotels listed for this trail yet.</div>'}</section>
        <section class="blk" id="s-restaurants"><h2>Restaurants near the trail</h2><p>Tables for ${cur.guests} on ${fmtLong(r.start)}. Pick a time to reserve.</p>${r.restaurants.map(rest).join('') || '<div class="card empty">No restaurants listed for this trail yet.</div>'}</section>
        <section class="blk" id="s-churches"><h2>Churches near the trail</h2><p>Open to visitors. Modest dress is appreciated.</p>${r.churches.map(ch).join('') || '<div class="card empty">No churches listed for this trail yet.</div>'}</section>`;
      $$('[data-r]').forEach((b) => (b.onclick = () => { cur.slot[b.dataset.r] = cur.slot[b.dataset.r] === b.dataset.time ? null : b.dataset.time; $$(`[data-r="${b.dataset.r}"]`).forEach((x) => x.setAttribute('aria-pressed', x.dataset.time === cur.slot[b.dataset.r])); $(`[data-reserve="${b.dataset.r}"]`).disabled = !cur.slot[b.dataset.r]; }));
      $$('[data-hotel]').forEach((b) => (b.onclick = () => book(b, { placeId: Number(b.dataset.hotel), start: cur.start, end: cur.end, guests: cur.guests, rooms: 1 })));
      $$('[data-reserve]').forEach((b) => (b.onclick = () => book(b, { placeId: Number(b.dataset.reserve), date: cur.start, time: cur.slot[b.dataset.reserve], guests: cur.guests })));
      if (load.first !== false) { load.first = false; if (cur.tab !== 'hotels') $('#s-' + cur.tab)?.scrollIntoView({ block: 'start' }); }
    } catch (e) { if (my === seq && $('#res')) $('#res').innerHTML = `<div class="card empty" style="margin-top:24px">${esc(e.message)}</div>`; }
  }
  async function book(btn, body) {
    if (!state.me) return needLogin(location.hash);
    btn.disabled = true; const label = btn.textContent; btn.textContent = 'Booking…';
    try { const { booking: b } = await api('POST', '/api/bookings', body); confirmModal(b); load(); }
    catch (e) { toast(e.message); btn.disabled = false; btn.textContent = label; if (e.status === 409) load(); }
  }
  $('#bt').onchange = (e) => { cur.trail = Number(e.target.value); cur.slot = {}; load(); };
  $('#bs').onchange = (e) => { if (!e.target.value) return; cur.start = e.target.value; if (cur.end <= cur.start) { const d = parseD(cur.start); d.setDate(d.getDate() + 2); cur.end = ymd(d); } load(); };
  $('#be').onchange = (e) => { if (!e.target.value) return; if (e.target.value <= cur.start) { toast('Check-out must be after check-in.'); e.target.value = cur.end; return; } cur.end = e.target.value; load(); };
  $('#bg').onchange = (e) => { cur.guests = Number(e.target.value); load(); };
  $$('[data-tab]').forEach((b) => (b.onclick = () => { cur.tab = b.dataset.tab; $$('[data-tab]').forEach((x) => x.setAttribute('aria-selected', x === b)); $('#s-' + cur.tab)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
  load();
}
function confirmModal(b) {
  const el = document.createElement('div'); el.className = 'modal'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'mt');
  const detail = b.kind === 'hotel' ? `${fmtShort(b.startDate)} – ${fmtShort(b.endDate)} · ${plural(b.guests, 'guest', 'guests')} · ${plural(b.nights, 'night', 'nights')}` : `${fmtLong(b.startDate)} · ${esc(b.timeSlot)} · ${plural(b.guests, 'guest', 'guests')}`;
  el.innerHTML = `<div class="mbox"><div class="ck">${I.check}</div><h2 id="mt">You are all set!</h2><p>Your ${b.kind === 'hotel' ? 'booking' : 'reservation'} has been confirmed. You can find it under History.</p>
    <div class="sumry"><b>${esc(b.place)}</b>${detail}${b.kind === 'hotel' ? `<br><b>Total $${b.total}</b>` : ''}</div><button class="btn btn--fill" style="width:100%" id="mc" type="button">Done</button></div>`;
  document.body.appendChild(el); const close = () => { el.remove(); document.removeEventListener('keydown', esc_); }; const esc_ = (e) => e.key === 'Escape' && close();
  document.addEventListener('keydown', esc_); $('#mc', el).onclick = close; el.onclick = (e) => e.target === el && close(); $('#mc', el).focus();
}

/* ---------- groups ---------- */
const avatarRow = (members, cls = '') => `<span class="avs ${cls}" style="margin:0;display:inline-flex">${members.map((m) => `<span class="av" title="${esc(m.name)}">${esc(m.initials)}</span>`).join('')}</span>`;
function groupCard(g) {
  const status = g.full ? `${g.joined} of ${g.capacity} joined · Full` : `${g.joined} of ${g.capacity} joined · ${plural(g.spotsLeft, 'spot', 'spots')} left`;
  const act = g.isMember ? `<a class="btn btn--fill btn--sm" href="#/groups/${g.id}">${I.chat}&nbsp;Open chat</a>` : g.full ? `<button class="btn btn--sm" disabled>Full</button>` : `<button class="btn btn--fill btn--sm" data-join="${g.id}">Join group</button>`;
  return `<article class="card gcard"><div><div class="row" style="gap:8px"><span class="diff ${esc(g.trail.difficulty)}">${esc(g.trail.difficulty)}</span><span class="when">${esc(fmtWhen(g.startsAt))}</span></div>
    <h3>${esc(g.name)}</h3><p class="sub"><a href="#/trails/${esc(g.trail.slug)}">${esc(g.trail.name)}</a> · Meet at ${esc(g.meetingPoint)}</p>
    <div class="host"><span class="av" style="margin:0;width:28px;height:28px;font-size:11px">${esc(g.host.initials)}</span><span>Hosted by ${esc(g.host.name)}</span>${avatarRow(g.members, 's')}<span class="muted">${status}</span></div></div><div>${act}</div></article>`;
}
async function pageGroups() {
  render('/groups', loading());
  const st = { filter: 'all' }; let data;
  const load = async () => { data = await api('GET', '/api/groups?filter=' + st.filter); };
  try { await load(); } catch (e) { return render('/groups', errBox(e)); }
  const draw = () => {
    const c = data.challenge;
    $('#gl').innerHTML = data.groups.length ? data.groups.map(groupCard).join('') : '<div class="card empty" style="margin-top:16px">No group hikes match this filter yet.</div>';
    $$('[data-join]').forEach((b) => (b.onclick = async () => { if (!state.me) return needLogin('#/groups'); b.disabled = true; try { await api('POST', `/api/groups/${b.dataset.join}/join`); toast('You joined the group!'); await load(); draw(); } catch (e) { toast(e.message); await load().catch(() => {}); draw(); } }));
    $('#gp').innerHTML = data.posts.map(postCard).join('') || '<div class="card empty" style="margin-top:14px">No posts yet. Be the first to share a hike.</div>';
    bindLike($('#gp'));
    $('#ch').innerHTML = `<h3>${esc(c.title)}</h3><p>${esc(c.text)}</p><div class="bar2"><i style="width:${(c.done / c.goal) * 100}%"></i></div><div class="row" style="margin-top:12px"><span style="font-size:14px;font-weight:600">${c.done} of ${c.goal} trails done</span><span class="sp"></span><span class="badge">+${c.points} points</span></div>${state.me ? '' : '<p class="help">Log in to track your progress.</p>'}`;
  };
  render('/groups', `<div class="page"><div class="wrap"><div class="row"><div><h1>Group hikes</h1><p class="lead">Join a group, meet fellow hikers and share the climb.</p></div><span class="sp"></span><button class="btn btn--fill btn--sm" id="ng" type="button" style="height:46px;padding:0 26px;font-size:17px">Create a group</button></div>
    <div class="gtop"><div>
      <form class="card compose" id="cf">${avHtml(state.me, 'style="margin:0"')}<label class="sr" for="ci">Share your hike</label><input id="ci" placeholder="Share your hike with the community…" maxlength="600" autocomplete="off"><button class="btn btn--fill btn--sm" type="submit">Post</button></form>
      <div class="row" style="margin-top:34px;gap:8px;flex-wrap:wrap"><h2 style="font-size:24px;margin-right:12px">Upcoming group hikes</h2>${[['all', 'All'], ['weekend', 'This weekend'], ['Easy', 'Easy'], ['Moderate', 'Moderate'], ['Hard', 'Hard']].map(([k, l]) => `<button class="tag" data-f="${k}" aria-pressed="${k === 'all'}">${l}</button>`).join('')}</div>
      <div id="gl"></div><h2 style="font-size:24px;margin-top:40px">Community posts</h2><div id="gp"></div></div>
      <aside><section class="card chal" id="ch"></section></aside></div></div></div>`);
  draw();
  $$('[data-f]').forEach((b) => (b.onclick = async () => { st.filter = b.dataset.f; $$('[data-f]').forEach((x) => x.setAttribute('aria-pressed', x === b)); try { await load(); draw(); } catch (e) { toast(e.message); } }));
  $('#cf').onsubmit = async (ev) => { ev.preventDefault(); if (!state.me) return needLogin('#/groups'); const v = $('#ci').value.trim(); if (!v) return toast('Write something to share first.');
    try { await api('POST', '/api/posts', { body: v }); $('#ci').value = ''; toast('Posted to the community'); await load(); draw(); } catch (e) { toast(e.message); } };
  $('#ng').onclick = () => { if (!state.me) return needLogin('#/groups'); createGroupModal(async () => { await load(); draw(); }); };
}
function postCard(p) {
  return `<article class="card post"><div class="h">${avHtml(p.author)}<div><b>${esc(p.author.name)}</b><span>${p.group ? esc(p.group) + ' · ' : ''}${ago(p.createdAt)}</span></div></div><p>${esc(p.body)}</p>${p.image ? `<div class="pimg" role="img" aria-label="${esc(p.body)}" style="background-image:url('${esc(p.image)}')"></div>` : ''}
    <div class="ac"><button type="button" data-like="${p.id}" aria-pressed="${p.liked}">${I.heart(p.liked)}<span>${p.likes}</span></button><button type="button" disabled style="opacity:.7">${I.chat}<span>${p.comments}</span></button></div></article>`;
}
function bindLike(root) {
  $$('[data-like]', root).forEach((b) => (b.onclick = async () => {
    if (!state.me) return needLogin(location.hash); b.disabled = true;
    try { const { post } = await api('POST', `/api/posts/${b.dataset.like}/like`); b.setAttribute('aria-pressed', post.liked); b.innerHTML = `${I.heart(post.liked)}<span>${post.likes}</span>`; } catch (e) { toast(e.message); } finally { b.disabled = false; }
  }));
}
async function createGroupModal(done) {
  let trails = []; try { trails = (await api('GET', '/api/trails?sort=name')).trails; } catch (e) { return toast(e.message); }
  const d = new Date(Date.now() + 3 * 864e5); d.setHours(7, 0, 0, 0); const dv = `${ymd(d)}T07:00`;
  const el = document.createElement('div'); el.className = 'modal'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'gt');
  el.innerHTML = `<form class="mbox" style="text-align:left" novalidate><h2 id="gt" style="text-align:left">Create a group hike</h2>
    <label class="lbl" for="gn">Group name</label><input class="inp" id="gn" maxlength="80" placeholder="Sunrise Squad" required>
    <label class="lbl" for="gtr">Trail</label><select class="inp" id="gtr">${trails.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select>
    <label class="lbl" for="gw">Start</label><input class="inp" id="gw" type="datetime-local" value="${dv}" min="${ymd(new Date())}T00:00">
    <label class="lbl" for="gm">Meeting point</label><input class="inp" id="gm" maxlength="120" placeholder="Republic Square" required>
    <label class="lbl" for="gc">Capacity</label><input class="inp" id="gc" type="number" min="2" max="50" value="8">
    <div id="ge" class="msg msg--err" role="alert" style="display:none"></div>
    <div class="row" style="gap:10px;margin-top:22px"><button class="btn" type="button" id="gx" style="flex:1">Cancel</button><button class="btn btn--fill" type="submit" style="flex:1">Create group</button></div></form>`;
  document.body.appendChild(el); const close = () => { el.remove(); document.removeEventListener('keydown', k); }; const k = (e) => e.key === 'Escape' && close(); document.addEventListener('keydown', k);
  $('#gx', el).onclick = close; el.onclick = (e) => e.target === el && close(); $('#gn', el).focus();
  $('form', el).onsubmit = async (ev) => { ev.preventDefault(); const er = $('#ge', el); er.style.display = 'none';
    try { await api('POST', '/api/groups', { name: $('#gn', el).value, trailId: Number($('#gtr', el).value), startsAt: new Date($('#gw', el).value).toISOString(), meetingPoint: $('#gm', el).value, capacity: Number($('#gc', el).value) });
      close(); toast('Group created'); await done(); } catch (e) { er.textContent = e.message.includes('Invalid') ? 'Choose a valid start time.' : e.message; er.style.display = 'block'; } };
}

async function pageChat(id) {
  if (!state.me) return needLogin('#/groups/' + id);
  render('/groups/' + id, loading());
  let g; try { g = (await api('GET', '/api/groups/' + id)).group; } catch (e) { return render('/groups', errBox(e)); }
  if (!g.isMember) {
    return render('/groups/' + id, `<div class="page"><div class="wrap"><div class="crumbs"><a href="#/groups">${I.left}&nbsp;Back to groups</a></div><h1>${esc(g.name)}</h1>
      <div class="card empty" style="margin-top:24px">Join this group to read and send messages.<br><br>${g.full ? '<b>This group is full.</b>' : `<button class="btn btn--fill btn--sm" id="jg">Join group</button>`}</div></div></div>`, { after: () => { const b = $('#jg'); if (b) b.onclick = async () => { try { await api('POST', `/api/groups/${id}/join`); pageChat(id); } catch (e) { toast(e.message); } }; } });
  }
  render('/groups/' + id, `<div class="page"><div class="wrap"><div class="crumbs"><a href="#/groups">${I.left}&nbsp;Back to groups</a></div>
    <h1>Group chat</h1><p class="lead">${esc(g.trail.name)} · ${esc(fmtWhen(g.startsAt))}</p>
    <div class="chat"><section class="card chat__main"><div class="chat__h"><div><h3>${esc(g.name)}</h3><span class="muted" style="font-size:14px">${plural(g.joined, 'member', 'members')} · ${g.full ? 'Full' : plural(g.spotsLeft, 'spot', 'spots') + ' left'}</span></div></div>
      <div class="msgs" id="msgs" role="log" aria-live="polite" tabindex="0"></div>
      <form class="chat__f" id="mf"><label class="sr" for="mi">Message</label><input id="mi" placeholder="Write a message…" maxlength="1000" autocomplete="off"><button class="btn btn--fill btn--sm" type="submit" style="height:46px">Send</button></form></section>
    <aside class="card pad"><h3 style="font-size:20px">${esc(g.name)}</h3><p class="muted" style="margin-top:4px;font-size:14px"><a href="#/trails/${esc(g.trail.slug)}">${esc(g.trail.name)}</a> · ${esc(g.meetingPoint)}</p>
      <div class="row" style="margin-top:16px"><b style="font-size:16px">Members</b><span class="sp"></span><span class="muted" style="font-size:14px">${g.joined} of ${g.capacity}</span></div>
      <div class="mem"><span class="av" style="background:#1b3a6b;color:#fff">${esc(g.host.initials)}</span><span>${esc(g.host.name)} <span class="chip" style="margin-left:4px">Host</span></span></div>
      ${g.members.filter((m) => m.id !== g.host.id).map((m) => `<div class="mem"><span class="av">${esc(m.initials)}</span><span>${m.isYou ? 'You' : esc(m.name)}</span></div>`).join('')}
      ${g.moreMembers ? `<p class="muted" style="margin-top:14px;font-size:14px">+${g.moreMembers} more members</p>` : ''}
      ${g.host.id === state.me.id ? '' : `<button class="btn btn--sm" id="lv" style="margin-top:20px;width:100%">Leave group</button>`}</aside></div></div></div>`);
  let last = 0; const box = $('#msgs'); const seen = new Set();
  const add = (m) => { if (seen.has(m.id)) return; seen.add(m.id); last = Math.max(last, m.id);
    const el = document.createElement('div'); el.className = 'm' + (m.mine ? ' me' : ''); el.innerHTML = `<small>${m.mine ? 'You' : esc(m.from.name)} · ${new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small><p>${esc(m.body)}</p>`; box.appendChild(el); };
  const pull = async () => { try { const r = await api('GET', `/api/groups/${id}/messages?after=${last}`); const near = box.scrollHeight - box.scrollTop - box.clientHeight < 80; r.messages.forEach(add); if (r.messages.length && (near || last === r.messages.at(-1).id && seen.size === r.messages.length)) box.scrollTop = box.scrollHeight; } catch (e) { if (e.status === 403 || e.status === 401) location.hash = '#/groups'; } };
  await pull(); box.scrollTop = box.scrollHeight;
  state.timers.push(setInterval(() => { if (!document.hidden) pull(); }, 3500));
  $('#mf').onsubmit = async (ev) => { ev.preventDefault(); const inp = $('#mi'); const v = inp.value.trim(); if (!v) return; inp.disabled = true;
    try { const r = await api('POST', `/api/groups/${id}/messages`, { body: v }); inp.value = ''; add(r.message); box.scrollTop = box.scrollHeight; } catch (e) { toast(e.message); } finally { inp.disabled = false; inp.focus(); } };
  const lv = $('#lv'); if (lv) lv.onclick = async () => { if (!confirm('Leave this group?')) return; try { await api('POST', `/api/groups/${id}/leave`); toast('You left the group'); location.hash = '#/groups'; } catch (e) { toast(e.message); } };
}

/* ---------- saved ---------- */
async function pageSaved(q) {
  if (!state.me) return needLogin('#/saved');
  const tab = q.get('tab') === 'bookings' ? 'bookings' : 'trails';
  render('/saved', loading());
  try {
    const [s, b] = await Promise.all([api('GET', '/api/saved'), api('GET', '/api/bookings')]);
    render('/saved', `<div class="page"><div class="wrap"><h1>Saved</h1><p class="lead">Your saved trails and bookings, all in one place.</p>
      <div class="tabs" role="tablist"><a class="tab" style="display:inline-flex;align-items:center;text-decoration:none" role="tab" href="#/saved" aria-selected="${tab === 'trails'}">Saved trails</a><a class="tab" style="display:inline-flex;align-items:center;text-decoration:none" role="tab" href="#/saved?tab=bookings" aria-selected="${tab === 'bookings'}">Bookings</a></div>
      ${tab === 'trails' ? `<div class="count"><b>${plural(s.trails.length, 'saved trail', 'saved trails')}</b><span class="sp"></span><span class="muted" style="font-size:14px">Sort by: Recently saved</span></div>
        <div class="grid2" id="sg">${s.trails.map(trailCard).join('') || '<div class="card empty" style="grid-column:1/-1">Nothing saved yet. Tap the heart on any trail to keep it here.<br><br><a class="btn btn--fill btn--sm" href="#/trails">Explore trails</a></div>'}</div>`
      : `<div class="count"><b>${plural(b.bookings.length, 'booking', 'bookings')}</b></div><div class="list">${bookingRows(b.bookings)}</div>`}</div></div>`, { after: () => { bindSave($('#sg') || document.body, () => pageSaved(q)); bindCancel(() => pageSaved(q)); } });
  } catch (e) { render('/saved', errBox(e)); }
}
function bookingRows(list) {
  return list.map((b) => `<div class="card bkrow"><div><h3>${esc(b.place)}</h3><p>${b.kind === 'hotel' ? `${fmtShort(b.startDate)} – ${fmtShort(b.endDate)} · ${plural(b.guests, 'guest', 'guests')} · ${plural(b.nights, 'night', 'nights')} · Total $${b.total}` : `${fmtLong(b.startDate)} · ${esc(b.timeSlot)} · ${plural(b.guests, 'guest', 'guests')}`}</p></div><span class="sp"></span><span class="badge">${b.kind === 'hotel' ? 'Stay' : 'Table'}</span><button class="btn btn--sm" data-cancel="${b.id}" type="button">Cancel</button></div>`).join('') || '<div class="card empty">No bookings yet. <a href="#/book">Find a stay or a table</a>.</div>';
}
function bindCancel(done) { $$('[data-cancel]').forEach((b) => (b.onclick = async () => { if (!confirm('Cancel this booking?')) return; b.disabled = true; try { await api('DELETE', `/api/bookings/${b.dataset.cancel}`); toast('Booking cancelled'); done(); } catch (e) { toast(e.message); b.disabled = false; } })); }

/* ---------- history ---------- */
async function pageHistory() {
  if (!state.me) return needLogin('#/history');
  render('/history', loading());
  try {
    const [p, b] = await Promise.all([api('GET', '/api/profile'), api('GET', '/api/bookings')]);
    render('/history', `<div class="page"><div class="wrap"><div class="row"><div><h1>History</h1><p class="lead">Your recorded hikes and reservations.</p></div><span class="sp"></span><a class="btn btn--fill btn--sm" href="#/record" style="height:46px;padding:0 26px;font-size:17px">Record a trail</a></div>
      <h2 style="font-size:24px;margin-top:34px">Recorded hikes</h2><div class="list">${p.hikes.map((h) => `<div class="card bkrow"><div><h3>${esc(h.name)}</h3><p>${new Date(h.completedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} · ${h.distanceKm} km · +${h.elevationM} m · ${hms(h.durationS)}</p></div></div>`).join('') || '<div class="card empty">No hikes recorded yet. Hit record on your next walk.</div>'}</div>
      <h2 style="font-size:24px;margin-top:40px">Bookings</h2><div class="list">${bookingRows(b.bookings)}</div></div></div>`, { after: () => bindCancel(pageHistory) });
  } catch (e) { render('/history', errBox(e)); }
}

/* ---------- profile ---------- */
async function pageProfile(q) {
  if (!state.me) return needLogin('#/profile');
  const tab = ['posts', 'saved', 'groups', 'badges'].includes(q.get('tab')) ? q.get('tab') : 'posts';
  render('/profile', loading());
  try {
    const d = await api('GET', '/api/profile'); const p = d.profile;
    const panel = { posts: d.posts.length ? `<div class="pgrid">${d.posts.map((x) => `<div class="pcell ${x.image ? 'has' : ''}" ${x.image ? `style="background-image:linear-gradient(180deg,rgba(0,0,0,.05) 40%,rgba(0,0,0,.6)),url('${esc(x.image)}')" role="img" aria-label="${esc(x.body)}"` : ''}><b>${I.heart(true).replace('width="18" height="18"', 'width="14" height="14"')}&nbsp;${compact(x.likes)}</b><span>${esc(x.body)}</span></div>`).join('')}</div>` : '<div class="card empty" style="margin-top:20px">No posts yet. Share your first hike from the Groups page.</div>',
      saved: `<div class="grid2">${d.saved.map(trailCard).join('') || '<div class="card empty" style="grid-column:1/-1">No saved trails yet.</div>'}</div>`,
      groups: `<div>${d.groups.map(groupCard).join('') || '<div class="card empty" style="margin-top:20px">You have not joined any groups yet.</div>'}</div>`,
      badges: `<div class="chips-row" style="margin-top:24px">${p.badges.map((b) => `<span class="badge" style="height:34px;padding:0 18px;font-size:15px">${esc(b.label)}</span>`).join('')}</div>` }[tab];
    render('/profile', `<div class="page"><div class="wrap"><section class="card ph-prof"><div class="avatar" ${p.avatar ? `style="background-image:url('${esc(p.avatar)}')" role="img" aria-label="${esc(p.name)}"` : 'aria-hidden="true"'}>${p.avatar ? '' : esc(p.initials)}</div>
      <div><div class="pn">${esc(p.name)} ${esc(p.surname)}<small>@${esc(p.handle)}</small></div>
      <div class="nums"><div><b>${p.postsCount}</b><span>posts</span></div><div><b>${compact(p.followers)}</b><span>followers</span></div><div><b>${compact(p.following)}</b><span>following</span></div></div>
      <p class="bio" id="bio">${esc(p.bio) || '<span class="muted">Add a short bio to tell hikers about you.</span>'}</p>
      <div class="chips-row">${p.badges.map((b) => `<span class="badge">${esc(b.label)}</span>`).join('')}</div>
      ${p.visited.length ? `<div class="chips-row">${p.visited.map((v) => `<span class="chip">${esc(v)}</span>`).join('')}</div>` : ''}</div>
      <div><button class="btn btn--sm" id="eb" type="button">Edit bio</button></div></section>
      <div class="tabs" role="tablist">${[['posts', 'Posts'], ['saved', 'Saved trails'], ['groups', 'Groups'], ['badges', 'Badges']].map(([k, l]) => `<a class="tab" style="display:inline-flex;align-items:center;text-decoration:none" role="tab" href="#/profile?tab=${k}" aria-selected="${tab === k}">${l}</a>`).join('')}</div>${panel}</div></div>`,
      { after: () => { bindSave(app, () => pageProfile(q)); $$('[data-join]').forEach((b) => b.remove()); bindLike(app);
        $('#eb').onclick = () => { const cur = p.bio; const v = prompt('Your bio (max 300 characters)', cur); if (v === null) return; api('PATCH', '/api/profile', { bio: v }).then(() => { toast('Bio updated'); pageProfile(q); }).catch((e) => toast(e.message)); }; } });
  } catch (e) { render('/profile', errBox(e)); }
}

/* ---------- record & save ---------- */
let memDraft = null;
const saveDraft = (d) => { memDraft = d; try { sessionStorage.setItem('dcl_draft', JSON.stringify(d)); } catch { /* storage blocked */ } };
const loadDraft = () => { try { return JSON.parse(sessionStorage.getItem('dcl_draft')) || memDraft; } catch { return memDraft; } };
const hav = (a, b) => { const R = 6371, r = (x) => (x * Math.PI) / 180, dLa = r(b.lat - a.lat), dLo = r(b.lon - a.lon); const h = Math.sin(dLa / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
function pageRecord() {
  if (!state.me) return needLogin('#/record');
  const r = { status: 'idle', accum: 0, seg: 0, dist: 0, gain: 0, pts: [], last: null, lastAlt: null, demo: false };
  const ticks = Array.from({ length: 72 }, (_, k) => { const major = k % 9 === 0, mid = k % 3 === 0; const len = major ? 22 : mid ? 14 : 8; return `<line x1="200" y1="${22}" x2="200" y2="${22 + len}" transform="rotate(${k * 5} 200 200)" stroke="${major ? '#33351f' : '#8b8d7c'}" stroke-width="${major ? 3 : 1.5}" stroke-linecap="round"/>`; }).join('');
  const card = [['N', 0], ['E', 90], ['S', 180], ['W', 270]].map(([l, d]) => `<text x="200" y="76" transform="rotate(${d} 200 200)" text-anchor="middle" font-size="30" font-weight="700" fill="${l === 'N' ? '#c0322a' : '#33351f'}">${l}</text>`).join('')
    + [['NE', 45], ['SE', 135], ['SW', 225], ['NW', 315]].map(([l, d]) => `<text x="200" y="74" transform="rotate(${d} 200 200)" text-anchor="middle" font-size="16" font-weight="600" fill="#6b6d5c">${l}</text>`).join('');
  render('/record', `<div class="page"><div class="wrap"><h1>Record trail</h1><p class="lead">Hit start and we'll track your route, distance and elevation as you walk.</p>
    <div class="rec"><section class="card compass" aria-label="Compass"><div class="row" style="width:100%"><span class="chip chip--dark" id="gs">GPS ready</span><span class="sp"></span><span class="chip" id="src">No heading yet</span></div>
      <div class="cwrap"><svg viewBox="0 0 400 400" role="img" aria-label="Compass dial" id="csvg"><circle cx="200" cy="200" r="190" fill="#f6f8f4" stroke="#33351f" stroke-width="4"/><circle cx="200" cy="200" r="150" fill="none" stroke="rgba(51,53,31,.25)" stroke-width="1.5"/>
        <g id="dial">${ticks}${card}<path d="M200 128 L214 200 L200 272 L186 200Z" fill="rgba(51,53,31,.07)"/></g>
        <path d="M200 8 L188 -2 L212 -2Z" fill="#c0322a" transform="translate(0 6)"/>
        <g id="needle"><path d="M200 96 L218 200 L200 214 L182 200Z" fill="#c0322a"/><path d="M200 304 L218 200 L200 186 L182 200Z" fill="#33351f"/></g><circle cx="200" cy="200" r="9" fill="#fff" stroke="#33351f" stroke-width="3"/></svg></div>
      <div class="hd"><b id="hv">–</b><span id="hc">Facing</span></div><p class="help" id="hh" style="text-align:center;min-height:38px"></p><button class="btn btn--sm" id="ec" type="button" style="display:none">Enable compass</button></section>
    <div><section class="card timer"><div class="big" id="el" aria-live="off">00:00:00</div><div class="st" id="stt">Ready when you are</div>
      <div class="vals"><div><b id="vd">0.00</b><span>km</span></div><div><b id="ve">0</b><span>m climbed</span></div><div><b id="vp">–</b><span>min / km</span></div></div>
      <div class="ctrls"><button class="btn btn--fill" id="go" type="button" style="min-width:150px">Start</button><button class="btn" id="fin" type="button" disabled>Finish</button></div>
      <p class="help" style="margin-top:16px"><button type="button" id="demo" style="border:0;background:none;text-decoration:underline;padding:0;color:inherit;cursor:pointer;font-size:13px">No GPS? Try a demo walk</button></p></section>
      <section class="card tip"><div><b>Keep this tab open</b><br>Tracking uses your device’s GPS and compass. Allow location access when your browser asks, and keep the screen on for the best accuracy.</div></section></div></div></div></div>`);
  /* ----- compass ----- */
  const cp = { sensor: null, sensorAt: 0, gps: null, shown: 0, any: false };
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const paint = () => {
    const fresh = cp.sensor != null && Date.now() - cp.sensorAt < 2500;
    const h = fresh ? cp.sensor : cp.gps;
    const src = fresh ? 'Device compass' : cp.gps != null ? 'GPS direction' : 'No heading yet';
    $('#src').textContent = src;
    if (h == null) { $('#hv').textContent = '–'; $('#hc').textContent = 'Facing'; return; }
    let d = ((h - cp.shown) % 360 + 540) % 360 - 180; cp.shown += d;   // shortest way round, no spinning at 359→0
    $('#dial').style.transform = `rotate(${-cp.shown}deg)`;
    $('#hv').textContent = `${Math.round(h) % 360}°`; $('#hc').textContent = `Facing ${dirs[Math.round(h / 45) % 8]}`;
  };
  const onOri = (e) => {
    let h = null;
    if (typeof e.webkitCompassHeading === 'number' && !Number.isNaN(e.webkitCompassHeading)) h = e.webkitCompassHeading;   // iPhone / iPad
    else if (e.absolute && typeof e.alpha === 'number') h = (360 - e.alpha) % 360;                                          // Android
    if (h == null) return; cp.sensor = h; cp.sensorAt = Date.now(); cp.any = true; $('#hh').textContent = 'Hold your phone flat for the best reading.'; paint();
  };
  const startSensor = () => { window.addEventListener('deviceorientationabsolute', onOri, true); window.addEventListener('deviceorientation', onOri, true); };
  const stopSensor = () => { window.removeEventListener('deviceorientationabsolute', onOri, true); window.removeEventListener('deviceorientation', onOri, true); };
  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
    $('#ec').style.display = ''; $('#hh').textContent = 'Tap “Enable compass” to use your phone’s compass.';
    $('#ec').onclick = async () => { try { if ((await DeviceOrientationEvent.requestPermission()) === 'granted') { startSensor(); $('#ec').style.display = 'none'; } else toast('Compass access was denied.'); } catch { toast('Could not enable the compass.'); } };
  } else startSensor();
  state.timers.push(setInterval(() => { paint(); if (!cp.any && cp.gps == null) $('#hh').textContent = 'No compass sensor found on this device. Start recording and walk: your direction will come from GPS.'; }, 1000));
  /* ----- recording ----- */
  const elapsed = () => r.accum + (r.status === 'running' ? (Date.now() - r.seg) / 1000 : 0);
  const draw = () => {
    $('#el').textContent = hms(elapsed()); $('#vd').textContent = r.dist.toFixed(2); $('#ve').textContent = Math.round(r.gain);
    $('#vp').textContent = r.dist > 0.05 ? (() => { const m = elapsed() / 60 / r.dist; let mm = Math.floor(m), ss = Math.round((m % 1) * 60); if (ss === 60) { mm += 1; ss = 0; } return `${mm}:${String(ss).padStart(2, '0')}`; })() : '–';
  };
  const bearing = (a, b) => { const q = (x) => (x * Math.PI) / 180, y = Math.sin(q(b.lon - a.lon)) * Math.cos(q(b.lat)), x = Math.cos(q(a.lat)) * Math.sin(q(b.lat)) - Math.sin(q(a.lat)) * Math.cos(q(b.lat)) * Math.cos(q(b.lon - a.lon)); return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360; };
  const addPt = (p) => {
    if (r.last) { const d = hav(r.last, p); if (d < 0.004) return; r.dist += d; cp.gps = bearing(r.last, p); paint(); }
    if (p.alt != null) { if (r.lastAlt != null && p.alt - r.lastAlt >= 3) { r.gain += p.alt - r.lastAlt; r.lastAlt = p.alt; } else if (r.lastAlt == null || p.alt < r.lastAlt) r.lastAlt = p.alt; }
    r.last = p; r.pts.push(p); draw();
  };
  const stopWatch = () => { if (r.watch != null && navigator.geolocation) navigator.geolocation.clearWatch(r.watch); r.watch = null; clearInterval(r.sim); };
  const startWatch = () => {
    if (r.demo) { r.sim = setInterval(() => { const n = r.pts.length; const base = r.last || { lat: 40.4, lon: 44.26 }; addPt({ lat: base.lat + 0.00055 + Math.sin(n / 4) * 0.00012, lon: base.lon + 0.00042 + Math.cos(n / 5) * 0.0001, alt: 2100 + n * 4 }); }, 1000); return; }
    if (!navigator.geolocation) { $('#gs').textContent = 'GPS not available'; toast('GPS is not available here. Try the demo walk.'); return pause(); }
    r.watch = navigator.geolocation.watchPosition((pos) => { $('#gs').textContent = `GPS ±${Math.round(pos.coords.accuracy)} m`; if (pos.coords.accuracy <= 50) addPt({ lat: pos.coords.latitude, lon: pos.coords.longitude, alt: pos.coords.altitude }); },
      (err) => { $('#gs').textContent = 'GPS blocked'; toast(err.code === 1 ? 'Location access was denied. Allow it in your browser, or try the demo walk.' : 'Could not get your location.'); pause(); }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
  };
  function pause() { if (r.status !== 'running') return; r.accum = elapsed(); r.status = 'paused'; stopWatch(); ui(); }
  function ui() { const run = r.status === 'running'; $('#go').textContent = run ? 'Pause' : r.status === 'paused' ? 'Resume' : 'Start'; $('#fin').disabled = r.status === 'idle'; $('#stt').textContent = run ? (r.demo ? 'Recording (demo walk)' : 'Recording…') : r.status === 'paused' ? 'Paused' : 'Ready when you are'; $('#demo').parentElement.style.display = r.status === 'idle' ? '' : 'none'; }
  $('#go').onclick = () => { if (r.status === 'running') return pause(); r.status = 'running'; r.seg = Date.now(); startWatch(); ui(); };
  $('#demo').onclick = () => { r.demo = true; $('#gs').textContent = 'Demo mode'; $('#go').click(); };
  $('#fin').onclick = () => {
    const secs = Math.round(elapsed()); if (r.status === 'running') pause();
    if (secs < 30 || r.dist < 0.05) return toast('Walk a little further (at least 30 seconds and 50 m) before finishing.');
    stopWatch(); saveDraft({ distanceKm: Math.round(r.dist * 100) / 100, elevationM: Math.round(r.gain), durationS: secs, demo: r.demo }); location.hash = '#/record/save';
  };
  state.timers.push(setInterval(() => { if (r.status === 'running') draw(); }, 500));
  state.watch = () => { stopWatch(); stopSensor(); };
  ui(); draw(); paint();
}
function pageSaveTrail() {
  if (!state.me) return needLogin('#/record');
  const d = loadDraft(); if (!d) { toast('Record a walk first.'); location.hash = '#/record'; return; }
  const auto = d.distanceKm < 5 && d.elevationM < 250 ? 'Easy' : d.distanceKm > 10 || d.elevationM > 700 ? 'Hard' : 'Moderate';
  render('/record/save', `<div class="page"><div class="wrap"><h1>Save trail</h1><p class="lead">Give it a name so you can find it in Explore trails.</p>
    <div class="fgrid"><section class="card pad"><h3 style="font-size:20px">Your walk</h3><div class="vals"><div><b>${d.distanceKm.toFixed(2)} km</b><span>Distance</span></div><div><b>+${d.elevationM} m</b><span>Elevation gain</span></div><div><b>${hms(d.durationS)}</b><span>Duration</span></div></div>${d.demo ? '<p class="help">This was a demo walk.</p>' : ''}</section>
    <form class="card pad" id="sf" novalidate><label class="lbl" for="tn" style="margin-top:0">Trail name</label><input class="inp" id="tn" maxlength="80" placeholder="e.g. Sunrise ridge walk" required><p class="help" id="te" style="color:var(--err)"></p>
      <label class="lbl" for="td">Difficulty</label><select class="inp" id="td">${['Easy', 'Moderate', 'Hard'].map((x) => `<option ${x === auto ? 'selected' : ''}>${x}</option>`).join('')}</select><p class="help">Suggested from your distance and climb.</p>
      <label class="lbl">Tags</label><div class="row" style="gap:8px">${[['lakes', 'Lakes'], ['waterfalls', 'Waterfalls'], ['family', 'Family friendly']].map(([k, l]) => `<button class="tag" type="button" data-tg="${k}" aria-pressed="false">${l}</button>`).join('')}</div>
      <label class="sw"><input type="checkbox" id="sh" checked><span><b>Share with the community</b><br><span class="help" style="margin:0">Other hikers can find this trail in Explore trails.</span></span></label>
      <div class="row" style="gap:10px;margin-top:10px"><button class="btn" type="button" id="dc" style="flex:1">Discard</button><button class="btn btn--fill" type="submit" style="flex:1" id="sv">Save trail</button></div></form></div></div></div>`);
  const tags = new Set(); $$('[data-tg]').forEach((b) => (b.onclick = () => { tags.has(b.dataset.tg) ? tags.delete(b.dataset.tg) : tags.add(b.dataset.tg); b.setAttribute('aria-pressed', tags.has(b.dataset.tg)); }));
  $('#dc').onclick = () => { if (!confirm('Discard this recording?')) return; saveDraft(null); try { sessionStorage.removeItem('dcl_draft'); } catch { /* ignore */ } location.hash = '#/history'; };
  $('#sf').onsubmit = async (ev) => { ev.preventDefault(); const name = $('#tn').value.trim(); if (!name) { $('#te').textContent = 'Please name your trail.'; return $('#tn').focus(); } $('#te').textContent = ''; $('#sv').disabled = true;
    try { await api('POST', '/api/recordings', { name, difficulty: $('#td').value, tags: [...tags], shared: $('#sh').checked, distanceKm: d.distanceKm, elevationM: d.elevationM, durationS: d.durationS }); saveDraft(null); try { sessionStorage.removeItem('dcl_draft'); } catch { /* ignore */ } toast('Trail saved. Find it in Explore trails.'); location.hash = '#/trails'; }
    catch (e) { toast(e.message); $('#sv').disabled = false; } };
}

/* ---------- legal ---------- */
function pageLegal(kind) {
  const terms = [['1. Acceptance of Terms', 'Welcome to Declination ("we," "our," "us," or the "Platform"). By creating an account or using the Platform you agree to these Terms of Service. If you do not agree, please do not use the Platform.'],
    ['2. Your account', 'You must provide accurate information and keep your password secure. You are responsible for all activity under your account. You must be at least 16 years old to create an account.'],
    ['3. Hiking safety', 'Hiking involves risk. Trail information, weather and difficulty ratings are provided for guidance only and may be inaccurate or out of date. You are responsible for your own safety, equipment and decisions, and for following local rules and conditions.'],
    ['4. Community conduct', 'Be respectful. Do not post unlawful, harassing, misleading or infringing content. You keep ownership of what you post and grant us a licence to display it on the Platform. We may remove content or suspend accounts that break these terms.'],
    ['5. Bookings', 'Stays and tables are provided by third-party venues. We help you request and manage reservations but are not the provider of those services. Cancellation and payment terms are set by each venue.'],
    ['6. Group hikes', 'Group hikes are organised by members. Hosts and participants are responsible for their own conduct. We do not vet members and are not liable for incidents on group hikes.'],
    ['7. Changes and contact', 'We may update these terms from time to time and will post the new date above. Continued use means you accept the changes. Questions? Contact support@declination.app.']];
  const priv = [['1. What we collect', 'Account details (name, email, password hash), content you post, trails you record, bookings you make, and basic technical data such as your browser type. If you record a trail, location data is used only to draw your route and calculate distance and elevation.'],
    ['2. How we use it', 'To run the Platform, show you relevant trails, process bookings, keep your account secure, and improve the service. We do not sell your personal data.'],
    ['3. Sharing', 'Your name, handle, posts and any trails you choose to share are visible to other members. Bookings are shared with the relevant venue. We use service providers to host the Platform under confidentiality obligations.'],
    ['4. Cookies', 'We use a single essential session cookie to keep you logged in. We do not use advertising cookies.'],
    ['5. Your choices', 'You can edit your profile, make recorded trails private, cancel bookings, and ask us to export or delete your data by emailing privacy@declination.app.'],
    ['6. Security and retention', 'Passwords are stored using a salted one-way hash. We keep your data while your account is active and delete or anonymise it afterwards unless the law requires otherwise.'],
    ['7. Updates', 'We will post any changes to this policy here and update the date above.']];
  const [title, body] = kind === 'terms' ? ['Terms of Service for Declination', terms] : ['Privacy Policy for Declination', priv];
  render('/' + kind, `<div class="page"><div class="wrap" style="max-width:960px"><h1>${title}</h1><p class="lead">Last Updated: January 5, 2026</p><article class="card doc">${body.map(([h, t]) => `<h2>${esc(h)}</h2><p>${esc(t)}</p>`).join('')}</article></div></div>`);
}

/* ---------- router ---------- */
function route() {
  if (state.watch) { state.watch(); state.watch = null; }
  const raw = location.hash.replace(/^#/, '') || '/'; const [path, qs] = raw.split('?'); const q = new URLSearchParams(qs || ''); const seg = path.split('/').filter(Boolean);
  const home = !seg.length;
  const logged = state.me;
  if (['login', 'signup', 'forgot'].includes(seg[0]) && logged && seg[0] !== 'forgot') { location.hash = nextUrl(q); return; }
  if (home) return pageHome();
  switch (seg[0]) {
    case 'login': return pageLogin(q);
    case 'signup': return pageSignup(q);
    case 'forgot': return pageForgot();
    case 'reset': return pageReset(q);
    case 'trails': return seg[1] ? pageTrail(decodeURIComponent(seg[1])) : pageTrails(q);
    case 'book': return pageBook(q);
    case 'groups': return seg[1] ? pageChat(Number(seg[1])) : pageGroups();
    case 'saved': return pageSaved(q);
    case 'history': return pageHistory();
    case 'profile': return pageProfile(q);
    case 'record': return seg[1] === 'save' ? pageSaveTrail() : pageRecord();
    case 'terms': return pageLegal('terms');
    case 'privacy': return pageLegal('privacy');
    default: return render('/404', `<div class="page"><div class="wrap"><div class="card empty"><h1 style="font-size:34px">Off the trail</h1><p class="lead">We couldn’t find that page.</p><br><a class="btn btn--fill btn--sm" href="#/">Back home</a></div></div></div>`);
  }
}
window.addEventListener('hashchange', route);
(async () => { try { state.me = (await api('GET', '/api/me')).user; } catch { state.me = null; } state.ready = true; route(); })();
})();
