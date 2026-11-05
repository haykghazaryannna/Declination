// Declination API. Every /api/* request is handled here (wired up by netlify/functions/api.mjs).
import crypto from 'node:crypto';
import db from './db.js';
import * as auth from './auth.js';
import { seedIfEmpty, syncDemoPassword, DEMO_PASSWORD } from './seed.js';

const COOKIE = 'dcl_sid';
const SECURITY = {
  'X-Frame-Options': 'DENY', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'Permissions-Policy': 'geolocation=(self), camera=(), microphone=()',
  'X-Content-Type-Options': 'nosniff',
};
class HttpError extends Error { constructor(status, message, field) { super(message); this.status = status; this.field = field; } }
const bad = (m, f) => new HttpError(400, m, f);

/* ---------- helpers ---------- */
// Sends mail through Resend (https://resend.com) when RESEND_API_KEY and MAIL_FROM are set; otherwise logs it.
async function sendMail(to, subject, text) {
  if (!process.env.RESEND_API_KEY || !process.env.MAIL_FROM) { console.log(`[mail:dev] To ${to} | ${subject}\n${text}`); return; }
  try {
    const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.MAIL_FROM, to: [to], subject, text }) });
    if (!r.ok) console.error('Mail provider error', r.status, await r.text());
  } catch (e) { console.error('Mail send failed', e.message); }
}
const initials = (u) => ((u.name?.[0] || '') + (u.surname?.[0] || '')).toUpperCase();
const publicUser = (u) => u && ({ id: u.id, name: u.name, surname: u.surname, email: u.email, handle: u.handle, avatar: u.avatar || null, initials: initials(u) });
const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
// Tolerate up to one day of timezone skew between the browser and the server.
const today = () => new Date(Date.now() - 864e5).toISOString().slice(0, 10);
const nights = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);
// Row ids from the URL or body; anything that is not a valid id matches nothing.
const idOf = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 && n < 2 ** 31 ? n : -1; };

// Rate limits are stored in the database because function instances do not share memory.
async function rateLimit(key, max, windowMs) {
  const now = Date.now();
  if ((await db.get('SELECT COUNT(*)::int c FROM rate_hits WHERE key=? AND at>?', key, now - windowMs)).c >= max)
    throw new HttpError(429, 'Too many attempts. Please wait a few minutes and try again.');
  await db.run('INSERT INTO rate_hits (key,at) VALUES (?,?)', key, now);
}
// Occasional cleanup of expired rows (replaces the hourly timer of the old long-running server).
async function sweep() {
  const now = Date.now();
  await db.run('DELETE FROM rate_hits WHERE at < ?', now - 2 * 3600e3);
  await db.run('DELETE FROM sessions WHERE expires_at < ?', now);
  await db.run('DELETE FROM reset_tokens WHERE expires_at < ?', now);
}

function parseCookies(h = '') { const o = {}; h.split(';').forEach((p) => { const i = p.indexOf('='); if (i > 0) { try { o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); } catch { /* ignore bad cookie */ } } }); return o; }
const setCookie = (token, secure) => `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${auth.SESSION_MS / 1000}${secure ? '; Secure' : ''}`;
const clearCookie = (secure) => `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure ? '; Secure' : ''}`;

/* ---------- serializers ---------- */
async function trailRow(t, userId) {
  const w = JSON.parse(t.weather || '{}');
  const [hotels, groups, saved] = await Promise.all([
    db.all("SELECT * FROM places WHERE trail_id = ? AND kind='hotel'", t.id),
    db.get('SELECT COUNT(*)::int c FROM groups_ WHERE trail_id = ? AND starts_at >= ?', t.id, new Date().toISOString()),
    userId ? db.get('SELECT 1 FROM saved_trails WHERE user_id=? AND trail_id=?', userId, t.id) : null,
  ]);
  let stayStatus = 'No stays listed';
  if (hotels.length) {
    const range = defaultRange();
    const hs = await Promise.all(hotels.map((h) => roomsLeft(h, range.start, range.end)));
    const avail = hs.filter((r) => r > 0);
    stayStatus = !avail.length ? 'Sold out' : Math.min(...avail) <= 2 && avail.length === 1 ? 'Few rooms left' : 'Stays available';
  }
  return {
    id: t.id, slug: t.slug, name: t.name, location: t.location, difficulty: t.difficulty,
    distanceKm: t.distance_km, elevationM: t.elevation_m, durationH: t.duration_h,
    tags: t.tags ? t.tags.split(',') : [], description: t.description, image: t.image || null, featured: !!t.featured, isNew: !!t.is_new, shared: !!t.shared,
    mine: !!userId && t.owner_id === userId,
    weather: { temp: w.temp, cond: w.cond }, stayStatus, groupsHiking: groups.c,
    saved: !!saved,
  };
}
const trailRows = (rows, userId) => Promise.all(rows.map((t) => trailRow(t, userId)));
function defaultRange() {
  const d = new Date(); d.setUTCDate(d.getUTCDate() + ((6 - d.getUTCDay() + 7) % 7 || 7));
  const s = d.toISOString().slice(0, 10); d.setUTCDate(d.getUTCDate() + 2);
  return { start: s, end: d.toISOString().slice(0, 10) };
}
async function roomsLeft(place, start, end, q = db) {
  const used = (await q.get(`SELECT COALESCE(SUM(rooms),0)::int n FROM bookings WHERE place_id = ? AND kind='hotel' AND status='confirmed' AND start_date < ? AND end_date > ?`, place.id, end, start)).n;
  return Math.max(0, place.rooms_total - used);
}
async function placeRow(p, ctx) {
  const base = { id: p.id, kind: p.kind, name: p.name, image: p.image || null, distanceKm: p.distance_km, rating: p.rating, reviews: p.reviews };
  if (p.kind === 'hotel') {
    const rooms = ctx.start && ctx.end ? await roomsLeft(p, ctx.start, ctx.end) : p.rooms_total;
    return { ...base, price: p.price, amenities: p.amenities.split(','), roomsLeft: rooms, status: rooms === 0 ? 'soldout' : rooms <= 2 ? 'few' : 'available' };
  }
  if (p.kind === 'restaurant') {
    const taken = ctx.date ? await db.all(`SELECT time_slot, COUNT(*)::int n FROM bookings WHERE place_id=? AND kind='restaurant' AND status='confirmed' AND start_date=? GROUP BY time_slot`, p.id, ctx.date) : [];
    const full = new Set(taken.filter((t) => t.n >= 6).map((t) => t.time_slot));
    return { ...base, cuisine: p.cuisine, priceLevel: p.price_level, slots: p.slots.split(',').map((s) => ({ time: s, available: !full.has(s) })) };
  }
  return { ...base, denomination: p.cuisine, hours: p.hours, notes: p.notes, openToday: true };
}
const groupMembers = (groupId) => db.all('SELECT u.* FROM group_members m JOIN users u ON u.id=m.user_id WHERE m.group_id=? ORDER BY m.joined_at, u.id', groupId);
async function groupRow(g, userId) {
  const [host, trail, members] = await Promise.all([
    db.get('SELECT * FROM users WHERE id=?', g.host_id),
    db.get('SELECT id,name,difficulty,slug FROM trails WHERE id=?', g.trail_id),
    groupMembers(g.id),
  ]);
  return {
    id: g.id, name: g.name, trail, startsAt: g.starts_at, meetingPoint: g.meeting_point, capacity: g.capacity,
    joined: members.length, spotsLeft: Math.max(0, g.capacity - members.length), full: members.length >= g.capacity,
    host: { id: host.id, name: `${host.name} ${host.surname[0]}.`, initials: initials(host) },
    members: members.slice(0, 5).map((u) => ({ id: u.id, initials: initials(u), name: `${u.name} ${u.surname[0]}.`, isYou: u.id === userId })),
    isMember: !!userId && members.some((m) => m.id === userId),
  };
}
async function postRow(p, userId) {
  const [u, g, liked] = await Promise.all([
    db.get('SELECT * FROM users WHERE id=?', p.user_id),
    p.group_id ? db.get('SELECT name FROM groups_ WHERE id=?', p.group_id) : null,
    userId ? db.get('SELECT 1 FROM post_likes WHERE post_id=? AND user_id=?', p.id, userId) : null,
  ]);
  return { id: p.id, body: p.body, image: p.image || null, likes: p.likes, comments: p.comments, createdAt: Number(p.created_at), group: g?.name || null,
    author: { id: u.id, name: `${u.name} ${u.surname[0]}.`, handle: u.handle, avatar: u.avatar || null, initials: initials(u) },
    liked: !!liked };
}
async function bookingRow(b) {
  const p = await db.get('SELECT name, kind FROM places WHERE id=?', b.place_id);
  return { id: b.id, kind: b.kind, place: p.name, startDate: b.start_date, endDate: b.end_date, timeSlot: b.time_slot, guests: b.guests,
    nights: b.end_date ? nights(b.start_date, b.end_date) : null, total: b.total, status: b.status };
}
const requireUser = (ctx) => { if (!ctx.user) throw new HttpError(401, 'Please log in to continue.'); return ctx.user; };
const int = (v, name, min, max) => { const n = Number(v); if (!Number.isInteger(n) || n < min || n > max) throw bad(`${name} must be a whole number between ${min} and ${max}.`, name); return n; };
const num = (v, name, min, max) => { const n = Number(v); if (!Number.isFinite(n) || n < min || n > max) throw bad(`${name} must be between ${min} and ${max}.`, name); return n; };

/* ---------- routes ---------- */
const routes = [];
const route = (method, pattern, handler) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), handler });

route('GET', '/api/health', async () => { await db.get('SELECT 1'); return { ok: true }; });

route('POST', '/api/auth/signup', async (ctx) => {
  await rateLimit('signup:' + ctx.ip, 10, 3600e3);
  const name = str(ctx.body.name, 60), surname = str(ctx.body.surname, 60), email = str(ctx.body.email, 254).toLowerCase(), pw = typeof ctx.body.password === 'string' ? ctx.body.password : '';
  if (!name) throw bad('Please enter your name.', 'name');
  if (!surname) throw bad('Please enter your surname.', 'surname');
  if (!EMAIL.test(email)) throw bad('Please enter a valid email address.', 'email');
  if (pw.length < 8 || pw.length > 128) throw bad('Password must be 8–128 characters.', 'password');
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) throw bad('Password needs at least one letter and one number.', 'password');
  const taken = new HttpError(409, 'An account with this email already exists. Try logging in.', 'email');
  if (await db.get('SELECT 1 FROM users WHERE email = ?', email)) throw taken;
  const base = (name + '.' + surname).toLowerCase().replace(/[^a-z0-9.]/g, '') || 'hiker';
  let handle = base, i = 1;
  while (await db.get('SELECT 1 FROM users WHERE handle=?', handle)) handle = base + ++i;
  const { salt, hash } = auth.hashPassword(pw);
  let user;
  try {
    user = await db.get('INSERT INTO users (name,surname,email,handle,pass_salt,pass_hash) VALUES (?,?,?,?,?,?) RETURNING *', name, surname, email, handle, salt, hash);
  } catch (e) {
    if (e.code === '23505') throw taken; // unique violation from a simultaneous signup
    throw e;
  }
  return { status: 201, cookie: setCookie(await auth.createSession(user.id), ctx.secure), body: { user: publicUser(user) } };
});
route('POST', '/api/auth/login', async (ctx) => {
  await rateLimit('login:' + ctx.ip, 15, 15 * 60e3);
  const email = str(ctx.body.email, 254).toLowerCase(), pw = typeof ctx.body.password === 'string' ? ctx.body.password : '';
  if (!EMAIL.test(email)) throw bad('Please enter a valid email address.', 'email');
  if (!pw) throw bad('Please enter your password.', 'password');
  const u = await db.get('SELECT * FROM users WHERE email = ?', email);
  const ok = u ? auth.verifyPassword(pw, u.pass_salt, u.pass_hash) : (auth.verifyPassword(pw, 'x', 'x'), false);
  if (!ok) throw new HttpError(401, 'Incorrect email or password.');
  if (Math.random() < 0.05) await sweep();
  return { cookie: setCookie(await auth.createSession(u.id), ctx.secure), body: { user: publicUser(u) } };
});
route('POST', '/api/auth/logout', async (ctx) => { if (ctx.token) await auth.destroySession(ctx.token); return { cookie: clearCookie(ctx.secure), body: { ok: true } }; });
route('GET', '/api/auth/google', () => { throw new HttpError(501, 'Google sign-in is not configured yet. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to enable it.'); });
route('POST', '/api/auth/forgot', async (ctx) => {
  await rateLimit('forgot:' + ctx.ip, 5, 3600e3);
  const email = str(ctx.body.email, 254).toLowerCase();
  if (!EMAIL.test(email)) throw bad('Please enter a valid email address.', 'email');
  const u = await db.get('SELECT * FROM users WHERE email=?', email);
  if (u) {
    const token = crypto.randomBytes(32).toString('hex');
    await db.run('INSERT INTO reset_tokens (token_hash,user_id,expires_at) VALUES (?,?,?)', auth.sha(token), u.id, Date.now() + 3600e3);
    const appUrl = (process.env.APP_URL || ctx.origin).replace(/\/$/, '');
    await sendMail(email, 'Reset your Declination password', `Hi ${u.name},\n\nUse this link to choose a new password (valid for 1 hour):\n${appUrl}/#/reset?token=${token}\n\nIf you did not ask for this, you can ignore this email.`);
  }
  return { ok: true, message: 'If an account exists for that email, a reset link is on its way.' };
});
route('POST', '/api/auth/reset', async (ctx) => {
  const token = str(ctx.body.token, 200), pw = typeof ctx.body.password === 'string' ? ctx.body.password : '';
  if (pw.length < 8 || pw.length > 128 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw)) throw bad('Password must be 8+ characters with a letter and a number.', 'password');
  const row = await db.get('SELECT * FROM reset_tokens WHERE token_hash=? AND expires_at>?', auth.sha(token), Date.now());
  if (!row) throw bad('This reset link is invalid or has expired.');
  const { salt, hash } = auth.hashPassword(pw);
  await db.tx(async (q) => {
    await q.run('UPDATE users SET pass_salt=?, pass_hash=? WHERE id=?', salt, hash, row.user_id);
    await q.run('DELETE FROM reset_tokens WHERE user_id=?', row.user_id);
    await q.run('DELETE FROM sessions WHERE user_id=?', row.user_id);
  });
  return { ok: true };
});
route('GET', '/api/me', (ctx) => ({ user: publicUser(ctx.user) }));

route('GET', '/api/stats', () => ({ trails: 12000, adventurers: 50000 }));
route('GET', '/api/featured', async (ctx) => ({ trails: await trailRows(await db.all('SELECT * FROM trails WHERE shared=1 AND (featured=1 OR popularity > 700) ORDER BY featured DESC, popularity DESC LIMIT 5'), ctx.user?.id) }));

route('GET', '/api/trails', async (ctx) => {
  const q = ctx.query;
  const where = ['(shared = 1 OR owner_id = ?)']; const p = [ctx.user?.id ?? -1];
  const text = str(q.q, 80).toLowerCase();
  if (text) {
    where.push("(LOWER(name) LIKE ? ESCAPE '\\' OR LOWER(location) LIKE ? ESCAPE '\\' OR LOWER(difficulty) LIKE ? ESCAPE '\\')");
    const like = '%' + text.replace(/[\\%_]/g, '\\$&') + '%'; p.push(like, like, like);
  }
  if (['Easy', 'Moderate', 'Hard'].includes(q.difficulty)) { where.push('difficulty = ?'); p.push(q.difficulty); }
  const tags = (q.tags || '').split(',').filter((t) => ['under5', 'lakes', 'waterfalls', 'family', 'stays'].includes(t));
  for (const t of tags) {
    if (t === 'under5') where.push('distance_km < 5');
    else if (t === 'stays') where.push("EXISTS (SELECT 1 FROM places WHERE places.trail_id = trails.id AND kind='hotel')");
    else where.push(`(',' || tags || ',') LIKE '%,${t},%'`);
  }
  const order = { popular: 'is_new DESC, popularity DESC', distance: 'distance_km ASC', difficulty: "CASE difficulty WHEN 'Easy' THEN 1 WHEN 'Moderate' THEN 2 ELSE 3 END, name", name: 'LOWER(name)' }[q.sort || 'popular'] || 'popularity DESC';
  const rows = await db.all(`SELECT * FROM trails WHERE ${where.join(' AND ')} ORDER BY ${order}, id`, ...p);
  return { count: rows.length, trails: await trailRows(rows, ctx.user?.id) };
});
route('GET', '/api/trails/:id', async (ctx) => {
  const t = await db.get('SELECT * FROM trails WHERE id=? OR slug=?', idOf(ctx.params.id), ctx.params.id);
  if (!t || (!t.shared && t.owner_id !== ctx.user?.id)) throw new HttpError(404, 'Trail not found.');
  const w = JSON.parse(t.weather || '{}');
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const d0 = new Date(), nowIso = d0.toISOString();
  const forecast = (w.days || []).map((d, i) => ({ label: i === 0 ? 'Today' : dayNames[(d0.getDay() + i) % 7], hi: d.hi, lo: d.lo }));
  const [hotels, nextGroups, joined, avatars, restaurants, trail] = await Promise.all([
    db.all("SELECT price FROM places WHERE trail_id=? AND kind='hotel'", t.id),
    db.get('SELECT COUNT(*)::int c FROM groups_ WHERE trail_id=? AND starts_at>=?', t.id, nowIso),
    db.get('SELECT COUNT(*)::int c FROM group_members m JOIN groups_ g ON g.id=m.group_id WHERE g.trail_id=? AND g.starts_at>=?', t.id, nowIso),
    db.all('SELECT DISTINCT u.* FROM group_members m JOIN users u ON u.id=m.user_id JOIN groups_ g ON g.id=m.group_id WHERE g.trail_id=? ORDER BY u.id LIMIT 4', t.id),
    db.get("SELECT COUNT(*)::int c FROM places WHERE trail_id=? AND kind='restaurant'", t.id),
    trailRow(t, ctx.user?.id),
  ]);
  return {
    trail,
    weather: { ...w, updatedMinAgo: Math.max(0, Math.round((Date.now() - Number(t.weather_updated)) / 60000)), forecast },
    plan: { hotels: hotels.length, fromPrice: hotels.length ? Math.min(...hotels.map((h) => h.price)) : null, restaurants: restaurants.c, defaultRange: defaultRange() },
    community: { groups: nextGroups.c, avatars: avatars.map(initials), more: Math.max(0, joined.c - avatars.length) },
  };
});
route('POST', '/api/trails/:id/save', async (ctx) => {
  const u = requireUser(ctx); const t = await db.get('SELECT id FROM trails WHERE id=? AND (shared=1 OR owner_id=?)', idOf(ctx.params.id), u.id);
  if (!t) throw new HttpError(404, 'Trail not found.');
  await db.run('INSERT INTO saved_trails (user_id,trail_id) VALUES (?,?) ON CONFLICT DO NOTHING', u.id, t.id); return { saved: true };
});
route('DELETE', '/api/trails/:id/save', async (ctx) => { const u = requireUser(ctx); await db.run('DELETE FROM saved_trails WHERE user_id=? AND trail_id=?', u.id, idOf(ctx.params.id)); return { saved: false }; });
route('GET', '/api/saved', async (ctx) => {
  const u = requireUser(ctx);
  const rows = await db.all('SELECT t.* FROM saved_trails s JOIN trails t ON t.id=s.trail_id WHERE s.user_id=? ORDER BY s.saved_at DESC, t.id DESC', u.id);
  return { trails: await trailRows(rows, u.id) };
});

route('GET', '/api/trails/:id/places', async (ctx) => {
  const t = await db.get('SELECT * FROM trails WHERE id=?', idOf(ctx.params.id)); if (!t) throw new HttpError(404, 'Trail not found.');
  const q = ctx.query; const range = defaultRange();
  const start = isDate(q.start || '') ? q.start : range.start;
  let end = range.end;
  if (isDate(q.end || '')) end = q.end;
  else if (isDate(q.start || '')) { const d = new Date(start + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 2); end = d.toISOString().slice(0, 10); }
  if (end <= start) throw bad('Check-out must be after check-in.', 'end');
  const date = isDate(q.date || '') ? q.date : start;
  const guests = int(q.guests || 2, 'guests', 1, 12);
  const rows = await Promise.all((await db.all('SELECT * FROM places WHERE trail_id=? ORDER BY distance_km', t.id)).map((p) => placeRow(p, { start, end, date })));
  return { trail: { id: t.id, name: t.name, location: t.location }, start, end, date, guests,
    hotels: rows.filter((r) => r.kind === 'hotel'), restaurants: rows.filter((r) => r.kind === 'restaurant'), churches: rows.filter((r) => r.kind === 'church') };
});
route('POST', '/api/bookings', async (ctx) => {
  const u = requireUser(ctx); const b = ctx.body;
  const p = await db.get('SELECT * FROM places WHERE id=?', idOf(b.placeId));
  if (!p || p.kind === 'church') throw bad('That place cannot be booked.');
  const guests = int(b.guests, 'guests', 1, 12);
  let id;
  if (p.kind === 'hotel') {
    if (!isDate(b.start || '') || !isDate(b.end || '')) throw bad('Choose valid check-in and check-out dates.');
    if (b.start < today()) throw bad('Check-in cannot be in the past.', 'start');
    const n = nights(b.start, b.end); if (n < 1 || n > 30) throw bad('Stays must be between 1 and 30 nights.', 'end');
    const rooms = int(b.rooms ?? 1, 'rooms', 1, 5);
    id = await db.tx(async (q) => {
      await q.get('SELECT id FROM places WHERE id=? FOR UPDATE', p.id); // serialise bookings for this place
      if (await roomsLeft(p, b.start, b.end, q) < rooms) throw new HttpError(409, `${p.name} has no rooms left for those dates.`);
      return (await q.get('INSERT INTO bookings (user_id,place_id,kind,start_date,end_date,guests,rooms,total) VALUES (?,?,?,?,?,?,?,?) RETURNING id',
        u.id, p.id, 'hotel', b.start, b.end, guests, rooms, p.price * n * rooms)).id;
    });
  } else {
    if (!isDate(b.date || '')) throw bad('Choose a valid date.', 'date');
    if (b.date < today()) throw bad('Date cannot be in the past.', 'date');
    const slot = str(b.time, 5);
    if (!p.slots.split(',').includes(slot)) throw bad('Choose one of the available times.', 'time');
    id = await db.tx(async (q) => {
      await q.get('SELECT id FROM places WHERE id=? FOR UPDATE', p.id);
      const n = (await q.get("SELECT COUNT(*)::int c FROM bookings WHERE place_id=? AND kind='restaurant' AND status='confirmed' AND start_date=? AND time_slot=?", p.id, b.date, slot)).c;
      if (n >= 6) throw new HttpError(409, 'That time has just been taken. Pick another.');
      return (await q.get('INSERT INTO bookings (user_id,place_id,kind,start_date,time_slot,guests) VALUES (?,?,?,?,?,?) RETURNING id', u.id, p.id, 'restaurant', b.date, slot, guests)).id;
    });
  }
  return { status: 201, body: { booking: await bookingRow(await db.get('SELECT * FROM bookings WHERE id=?', id)) } };
});
route('GET', '/api/bookings', async (ctx) => {
  const u = requireUser(ctx);
  return { bookings: await Promise.all((await db.all("SELECT * FROM bookings WHERE user_id=? AND status<>'cancelled' ORDER BY created_at DESC, id DESC", u.id)).map(bookingRow)) };
});
route('DELETE', '/api/bookings/:id', async (ctx) => {
  const u = requireUser(ctx); const r = await db.run("UPDATE bookings SET status='cancelled' WHERE id=? AND user_id=?", idOf(ctx.params.id), u.id);
  if (!r.rowCount) throw new HttpError(404, 'Booking not found.'); return { ok: true };
});

route('GET', '/api/groups', async (ctx) => {
  const f = ctx.query.filter || 'all';
  let rows = await Promise.all((await db.all('SELECT * FROM groups_ WHERE starts_at >= ? ORDER BY starts_at, id', new Date(Date.now() - 3 * 3600e3).toISOString())).map((g) => groupRow(g, ctx.user?.id)));
  if (['Easy', 'Moderate', 'Hard'].includes(f)) rows = rows.filter((g) => g.trail.difficulty === f);
  if (f === 'weekend') rows = rows.filter((g) => { const d = new Date(g.startsAt).getDay(); return (d === 0 || d === 6) && Date.parse(g.startsAt) - Date.now() < 7 * 864e5; });
  const posts = await Promise.all((await db.all('SELECT * FROM posts WHERE group_id IS NOT NULL ORDER BY created_at DESC LIMIT 5')).map((p) => postRow(p, ctx.user?.id)));
  const prog = ctx.user ? ((await db.get('SELECT trails_done FROM challenge_progress WHERE user_id=?', ctx.user.id))?.trails_done ?? 0) : 0;
  const mon = new Date().toLocaleString('en-GB', { month: 'long' });
  return { groups: rows, posts, challenge: { title: `${mon[0].toUpperCase() + mon.slice(1)} challenge`, text: 'Summit 3 trails above 1,500 m this month and earn reward points.', done: Math.min(prog, 3), goal: 3, points: 200 } };
});
route('POST', '/api/groups', async (ctx) => {
  const u = requireUser(ctx); const b = ctx.body;
  const name = str(b.name, 80), point = str(b.meetingPoint, 120);
  if (!name) throw bad('Give your group a name.', 'name'); if (!point) throw bad('Add a meeting point.', 'meetingPoint');
  const t = await db.get('SELECT id FROM trails WHERE id=?', idOf(b.trailId)); if (!t) throw bad('Choose a trail.', 'trailId');
  const when = new Date(b.startsAt); if (Number.isNaN(+when) || +when < Date.now()) throw bad('Choose a start time in the future.', 'startsAt');
  const cap = int(b.capacity ?? 8, 'capacity', 2, 50);
  const g = await db.tx(async (q) => {
    const row = await q.get('INSERT INTO groups_ (name,trail_id,host_id,starts_at,meeting_point,capacity) VALUES (?,?,?,?,?,?) RETURNING *', name, t.id, u.id, when.toISOString(), point, cap);
    await q.run('INSERT INTO group_members (group_id,user_id) VALUES (?,?)', row.id, u.id);
    return row;
  });
  return { status: 201, body: { group: await groupRow(g, u.id) } };
});
route('GET', '/api/groups/:id', async (ctx) => {
  const g = await db.get('SELECT * FROM groups_ WHERE id=?', idOf(ctx.params.id)); if (!g) throw new HttpError(404, 'Group not found.');
  const [row, all] = await Promise.all([groupRow(g, ctx.user?.id), groupMembers(g.id)]);
  row.members = all.slice(0, 5).map((u) => ({ id: u.id, initials: initials(u), name: `${u.name} ${u.surname[0]}.`, isYou: u.id === ctx.user?.id }));
  row.moreMembers = Math.max(0, all.length - 5);
  return { group: row };
});
route('POST', '/api/groups/:id/join', async (ctx) => {
  const u = requireUser(ctx); const id = idOf(ctx.params.id);
  const g = await db.tx(async (q) => {
    const grp = await q.get('SELECT * FROM groups_ WHERE id=? FOR UPDATE', id); if (!grp) throw new HttpError(404, 'Group not found.');
    if (await q.get('SELECT 1 FROM group_members WHERE group_id=? AND user_id=?', id, u.id)) return grp;
    if ((await q.get('SELECT COUNT(*)::int c FROM group_members WHERE group_id=?', id)).c >= grp.capacity) throw new HttpError(409, 'This group is full.');
    await q.run('INSERT INTO group_members (group_id,user_id) VALUES (?,?)', id, u.id);
    return grp;
  });
  return { group: await groupRow(g, u.id) };
});
route('POST', '/api/groups/:id/leave', async (ctx) => {
  const u = requireUser(ctx); const g = await db.get('SELECT * FROM groups_ WHERE id=?', idOf(ctx.params.id)); if (!g) throw new HttpError(404, 'Group not found.');
  if (g.host_id === u.id) throw bad('Hosts cannot leave their own group.');
  await db.run('DELETE FROM group_members WHERE group_id=? AND user_id=?', g.id, u.id); return { group: await groupRow(g, u.id) };
});
async function requireMember(ctx) {
  const u = requireUser(ctx); const id = idOf(ctx.params.id);
  if (!(await db.get('SELECT 1 FROM group_members WHERE group_id=? AND user_id=?', id, u.id))) throw new HttpError(403, 'Join this group to read and send messages.');
  return { u, id };
}
route('GET', '/api/groups/:id/messages', async (ctx) => {
  const { u, id } = await requireMember(ctx); const after = Math.max(0, idOf(ctx.query.after));
  const rows = await db.all('SELECT m.*, us.name, us.surname FROM messages m JOIN users us ON us.id=m.user_id WHERE m.group_id=? AND m.id>? ORDER BY m.id LIMIT 200', id, after);
  return { messages: rows.map((m) => ({ id: m.id, body: m.body, createdAt: Number(m.created_at), from: { id: m.user_id, name: `${m.name} ${m.surname[0]}.`, initials: (m.name[0] + m.surname[0]).toUpperCase() }, mine: m.user_id === u.id })) };
});
route('POST', '/api/groups/:id/messages', async (ctx) => {
  const { u, id } = await requireMember(ctx); await rateLimit('msg:' + u.id, 30, 60e3);
  const body = str(ctx.body.body, 1000); if (!body) throw bad('Write a message first.', 'body');
  const now = Date.now();
  const mid = (await db.get('INSERT INTO messages (group_id,user_id,body,created_at) VALUES (?,?,?,?) RETURNING id', id, u.id, body, now)).id;
  return { status: 201, body: { message: { id: mid, body, createdAt: now, from: { id: u.id, name: `${u.name} ${u.surname[0]}.`, initials: initials(u) }, mine: true } } };
});

route('POST', '/api/posts', async (ctx) => {
  const u = requireUser(ctx); const body = str(ctx.body.body, 600); if (!body) throw bad('Write something to share.', 'body');
  await rateLimit('post:' + u.id, 20, 3600e3);
  const gid = ctx.body.groupId ? idOf(ctx.body.groupId) : null;
  if (gid && !(await db.get('SELECT 1 FROM group_members WHERE group_id=? AND user_id=?', gid, u.id))) throw new HttpError(403, 'Join the group before posting to it.');
  const p = await db.get('INSERT INTO posts (user_id,group_id,body,created_at) VALUES (?,?,?,?) RETURNING *', u.id, gid, body, Date.now());
  return { status: 201, body: { post: await postRow(p, u.id) } };
});
route('POST', '/api/posts/:id/like', async (ctx) => {
  const u = requireUser(ctx); const id = idOf(ctx.params.id);
  const p = await db.tx(async (q) => {
    if (!(await q.get('SELECT id FROM posts WHERE id=? FOR UPDATE', id))) throw new HttpError(404, 'Post not found.');
    if ((await q.run('DELETE FROM post_likes WHERE post_id=? AND user_id=?', id, u.id)).rowCount) await q.run('UPDATE posts SET likes=GREATEST(0,likes-1) WHERE id=?', id);
    else { await q.run('INSERT INTO post_likes (post_id,user_id) VALUES (?,?)', id, u.id); await q.run('UPDATE posts SET likes=likes+1 WHERE id=?', id); }
    return q.get('SELECT * FROM posts WHERE id=?', id);
  });
  return { post: await postRow(p, u.id) };
});

route('GET', '/api/profile', async (ctx) => {
  const u = requireUser(ctx);
  const [postRowsRaw, hikes, groupRowsRaw, savedRaw, chips] = await Promise.all([
    db.all('SELECT * FROM posts WHERE user_id=? ORDER BY created_at DESC', u.id),
    db.all('SELECT * FROM hikes WHERE user_id=? ORDER BY completed_at DESC', u.id),
    db.all('SELECT g.* FROM group_members m JOIN groups_ g ON g.id=m.group_id WHERE m.user_id=? ORDER BY g.starts_at', u.id),
    db.all('SELECT t.* FROM saved_trails s JOIN trails t ON t.id=s.trail_id WHERE s.user_id=? ORDER BY s.saved_at DESC, t.id DESC', u.id),
    db.all('SELECT t.name FROM hikes h JOIN trails t ON t.id=h.trail_id WHERE h.user_id=? GROUP BY t.name ORDER BY MAX(h.completed_at) DESC LIMIT 6', u.id),
  ]);
  const [posts, groups, saved] = await Promise.all([
    Promise.all(postRowsRaw.map((p) => postRow(p, u.id))),
    Promise.all(groupRowsRaw.map((g) => groupRow(g, u.id))),
    trailRows(savedRaw, u.id),
  ]);
  const km = hikes.reduce((s, h) => s + h.distance_km, 0);
  const demo = u.email === 'anna@declination.app';
  const seededKm = demo ? 1240 : 0, seededSummits = demo ? 42 : 0;
  const hosted = groups.some((g) => g.host.id === u.id);
  const summits = seededSummits + hikes.length, kmTotal = Math.round(seededKm + km);
  const badges = [{ label: `Level ${u.level} Explorer`, on: true }, { label: `${summits} summits`, on: summits > 0 }, { label: `${kmTotal.toLocaleString('en-US')} km hiked`, on: kmTotal > 0 }, { label: 'Group host', on: hosted }].filter((b) => b.on);
  return { profile: { ...publicUser(u), bio: u.bio, followers: u.followers, following: u.following, postsCount: posts.length, badges, visited: chips.map((r) => r.name) },
    posts, saved, groups, hikes: hikes.map((h) => ({ id: h.id, name: h.name, distanceKm: h.distance_km, elevationM: h.elevation_m, durationS: h.duration_s, completedAt: Number(h.completed_at) })) };
});
route('PATCH', '/api/profile', async (ctx) => { const u = requireUser(ctx); await db.run('UPDATE users SET bio=? WHERE id=?', str(ctx.body.bio, 300), u.id); return { ok: true }; });

route('POST', '/api/recordings', async (ctx) => {
  const u = requireUser(ctx); const b = ctx.body;
  const name = str(b.name, 80); if (!name) throw bad('Give your trail a name.', 'name');
  const dist = num(b.distanceKm, 'Distance', 0.05, 500), elev = Math.round(num(b.elevationM ?? 0, 'Elevation', 0, 9000)), secs = Math.round(num(b.durationS, 'Duration', 30, 7 * 86400));
  const diff = ['Easy', 'Moderate', 'Hard'].includes(b.difficulty) ? b.difficulty : (dist < 5 && elev < 250 ? 'Easy' : dist > 10 || elev > 700 ? 'Hard' : 'Moderate');
  const tags = (Array.isArray(b.tags) ? b.tags : []).filter((t) => ['lakes', 'waterfalls', 'family'].includes(t)); if (dist < 5) tags.push('under5');
  const shared = b.shared === false ? 0 : 1;
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'trail';
  const w = JSON.stringify({ temp: 10, cond: 'Clear', feels: 8, low: 4, wind: 10, humidity: 50, uv: '3 (Moderate)', sunset: '18:00', days: [] });
  const desc = `Recorded by ${u.name} ${u.surname[0]}. on ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}.`;
  const t = await db.tx(async (q) => {
    await q.run('SELECT pg_advisory_xact_lock(4208)'); // keep slug generation unique under concurrent saves
    let s = slug, n = 1;
    while (await q.get('SELECT 1 FROM trails WHERE slug=?', s)) s = `${slug}-${++n}`;
    const row = await q.get(`INSERT INTO trails (slug,name,location,difficulty,distance_km,elevation_m,duration_h,tags,description,popularity,weather,weather_updated,owner_id,shared,is_new)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1) RETURNING *`, s, name, str(b.location, 100) || 'Recorded by you', diff, Math.round(dist * 10) / 10, elev, Math.round((secs / 3600) * 10) / 10, [...new Set(tags)].join(','),
      desc, 1000, w, Date.now(), u.id, shared);
    await q.run('INSERT INTO saved_trails (user_id,trail_id) VALUES (?,?)', u.id, row.id);
    await q.run('INSERT INTO hikes (user_id,trail_id,name,distance_km,elevation_m,duration_s,completed_at) VALUES (?,?,?,?,?,?,?)', u.id, row.id, name, dist, elev, secs, Date.now());
    return row;
  });
  return { status: 201, body: { trail: await trailRow(t, u.id) } };
});

/* ---------- request handling ---------- */
// Seed the demo data on the first request to a fresh database. Retried on the next request if it fails.
let ready;
function ensureReady() {
  ready ||= (async () => {
    if (await seedIfEmpty()) console.log(`Database seeded with demo data. Demo login: anna@declination.app${process.env.DEMO_PASSWORD ? '' : ' / ' + DEMO_PASSWORD}`);
    await syncDemoPassword();
  })().catch((e) => { ready = null; throw e; });
  return ready;
}

function send(status, body, headers = {}, secure = false) {
  return new Response(JSON.stringify(body), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY,
    ...(secure ? { 'Strict-Transport-Security': 'max-age=15552000; includeSubDomains' } : {}), ...headers,
  } });
}

async function readBody(req) {
  const text = await req.text();
  if (text.length > 100_000) throw new HttpError(413, 'Request too large');
  if (!text) return {};
  try { const j = JSON.parse(text); return j && typeof j === 'object' ? j : {}; } catch { throw bad('Invalid JSON body'); }
}

export async function handle(req, context = {}) {
  const url = new URL(req.url);
  const secure = url.protocol === 'https:';
  try {
    const method = req.method;
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      const origin = req.headers.get('origin');
      if (origin) {
        let host; try { host = new URL(origin).host; } catch { host = ''; }
        if (host !== url.host && host !== req.headers.get('host')) throw new HttpError(403, 'Cross-origin request blocked.');
      }
    }
    let matched = null, params = {};
    for (const r of routes) { if (r.method !== method) continue; const m = r.re.exec(url.pathname); if (m) { matched = r; params = m.groups || {}; break; } }
    if (!matched) {
      if (routes.some((r) => r.re.test(url.pathname))) throw new HttpError(405, 'Method not allowed');
      throw new HttpError(404, 'Endpoint not found');
    }
    await ensureReady();
    const token = parseCookies(req.headers.get('cookie') || '')[COOKIE];
    const ctx = {
      token, user: await auth.userFromToken(token), query: Object.fromEntries(url.searchParams), params, body: {},
      ip: context.ip || req.headers.get('x-nf-client-connection-ip') || '', secure, origin: url.origin,
    };
    if (['POST', 'PUT', 'PATCH'].includes(method)) ctx.body = await readBody(req);
    if (url.pathname === '/api/me' && !ctx.user) return send(200, { user: null }, {}, secure);
    const out = await matched.handler(ctx);
    if (out && out.body !== undefined) return send(out.status || 200, out.body, out.cookie ? { 'Set-Cookie': out.cookie } : {}, secure);
    return send(200, out ?? { ok: true }, {}, secure);
  } catch (e) {
    if (e instanceof HttpError) return send(e.status, { error: e.message, field: e.field }, {}, secure);
    console.error(e); return send(500, { error: 'Something went wrong on our side. Please try again.' }, {}, secure);
  }
}
