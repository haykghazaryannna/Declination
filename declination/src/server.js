'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const auth = require('./auth');
const { seedIfEmpty, upgradeData } = require('./seed');

const PORT = Number(process.env.PORT || 3000);
const PROD = process.env.NODE_ENV === 'production';
const TRUST_PROXY = process.env.TRUST_PROXY ? process.env.TRUST_PROXY === '1' : PROD;
const APP_URL = (process.env.APP_URL || '').replace(/\/$/, '');
const PUBLIC = path.join(__dirname, '..', 'public');
const COOKIE = 'dcl_sid';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff' };

const SECURITY = {
  'X-Frame-Options': 'DENY', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'Permissions-Policy': 'geolocation=(self), camera=(), microphone=()',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  ...(PROD ? { 'Strict-Transport-Security': 'max-age=15552000; includeSubDomains' } : {}),
};
class HttpError extends Error { constructor(status, message, field) { super(message); this.status = status; this.field = field; } }
const bad = (m, f) => new HttpError(400, m, f);

/* ---------- helpers ---------- */
function clientIp(req) {
  if (TRUST_PROXY) { const f = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim(); if (f) return f; }
  return req.socket.remoteAddress || '';
}
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

const buckets = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const b = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (b.length >= max) throw new HttpError(429, 'Too many attempts. Please wait a few minutes and try again.');
  b.push(now); buckets.set(key, b);
}
setInterval(() => { const now = Date.now(); for (const [k, v] of buckets) if (!v.some((t) => now - t < 3600e3)) buckets.delete(k); }, 600e3).unref();

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 100_000) { reject(new HttpError(413, 'Request too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { const j = JSON.parse(Buffer.concat(chunks).toString('utf8')); resolve(j && typeof j === 'object' ? j : {}); } catch { reject(bad('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}
function parseCookies(h = '') { const o = {}; h.split(';').forEach((p) => { const i = p.indexOf('='); if (i > 0) o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); }); return o; }

function send(res, status, body, headers = {}) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...SECURITY, ...headers });
  res.end(data);
}
const setCookie = (token) => `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${auth.SESSION_MS / 1000}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
const clearCookie = `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;

/* ---------- serializers ---------- */
function trailRow(t, userId) {
  const w = JSON.parse(t.weather || '{}');
  const stays = db.prepare(`SELECT kind, COUNT(*) c FROM places WHERE trail_id = ? GROUP BY kind`).all(t.id);
  const hotels = stays.find((s) => s.kind === 'hotel')?.c || 0;
  const groups = db.prepare(`SELECT COUNT(*) c FROM groups_ WHERE trail_id = ? AND starts_at >= ?`).get(t.id, new Date().toISOString()).c;
  const left = db.prepare(`SELECT MIN(1) m FROM places WHERE trail_id = ? AND kind='hotel'`).get(t.id);
  let stayStatus = 'No stays listed';
  if (hotels) {
    const range = defaultRange();
    const hs = db.prepare(`SELECT * FROM places WHERE trail_id = ? AND kind='hotel'`).all(t.id).map((h) => roomsLeft(h, range.start, range.end));
    const avail = hs.filter((r) => r > 0);
    stayStatus = !avail.length ? 'Sold out' : Math.min(...avail) <= 2 && avail.length === 1 ? 'Few rooms left' : 'Stays available';
  }
  void left;
  return {
    id: t.id, slug: t.slug, name: t.name, location: t.location, difficulty: t.difficulty,
    distanceKm: t.distance_km, elevationM: t.elevation_m, durationH: t.duration_h,
    tags: t.tags ? t.tags.split(',') : [], description: t.description, image: t.image || null, featured: !!t.featured, isNew: !!t.is_new, shared: !!t.shared,
    mine: !!userId && t.owner_id === userId,
    weather: { temp: w.temp, cond: w.cond }, stayStatus, groupsHiking: groups,
    saved: userId ? !!db.prepare('SELECT 1 FROM saved_trails WHERE user_id=? AND trail_id=?').get(userId, t.id) : false,
  };
}
function defaultRange() {
  const d = new Date(); d.setUTCDate(d.getUTCDate() + ((6 - d.getUTCDay() + 7) % 7 || 7));
  const s = d.toISOString().slice(0, 10); d.setUTCDate(d.getUTCDate() + 2);
  return { start: s, end: d.toISOString().slice(0, 10) };
}
function roomsLeft(place, start, end) {
  const used = db.prepare(`SELECT COALESCE(SUM(rooms),0) n FROM bookings WHERE place_id = ? AND kind='hotel' AND status='confirmed' AND start_date < ? AND end_date > ?`).get(place.id, end, start).n;
  return Math.max(0, place.rooms_total - used);
}
function placeRow(p, ctx) {
  const base = { id: p.id, kind: p.kind, name: p.name, image: p.image || null, distanceKm: p.distance_km, rating: p.rating, reviews: p.reviews };
  if (p.kind === 'hotel') {
    const rooms = ctx.start && ctx.end ? roomsLeft(p, ctx.start, ctx.end) : p.rooms_total;
    return { ...base, price: p.price, amenities: p.amenities.split(','), roomsLeft: rooms, status: rooms === 0 ? 'soldout' : rooms <= 2 ? 'few' : 'available' };
  }
  if (p.kind === 'restaurant') {
    const taken = ctx.date ? db.prepare(`SELECT time_slot, COUNT(*) n FROM bookings WHERE place_id=? AND kind='restaurant' AND status='confirmed' AND start_date=? GROUP BY time_slot`).all(p.id, ctx.date) : [];
    const full = new Set(taken.filter((t) => t.n >= 6).map((t) => t.time_slot));
    return { ...base, cuisine: p.cuisine, priceLevel: p.price_level, slots: p.slots.split(',').map((s) => ({ time: s, available: !full.has(s) })) };
  }
  return { ...base, denomination: p.cuisine, hours: p.hours, notes: p.notes, openToday: true };
}
function groupRow(g, userId) {
  const host = db.prepare('SELECT * FROM users WHERE id=?').get(g.host_id);
  const trail = db.prepare('SELECT id,name,difficulty,slug FROM trails WHERE id=?').get(g.trail_id);
  const members = db.prepare(`SELECT u.* FROM group_members m JOIN users u ON u.id=m.user_id WHERE m.group_id=? ORDER BY m.joined_at, u.id`).all(g.id);
  return {
    id: g.id, name: g.name, trail, startsAt: g.starts_at, meetingPoint: g.meeting_point, capacity: g.capacity,
    joined: members.length, spotsLeft: Math.max(0, g.capacity - members.length), full: members.length >= g.capacity,
    host: { id: host.id, name: `${host.name} ${host.surname[0]}.`, initials: initials(host) },
    members: members.slice(0, 5).map((u) => ({ id: u.id, initials: initials(u), name: `${u.name} ${u.surname[0]}.`, isYou: u.id === userId })),
    isMember: !!userId && members.some((m) => m.id === userId),
  };
}
function postRow(p, userId) {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(p.user_id);
  const g = p.group_id ? db.prepare('SELECT name FROM groups_ WHERE id=?').get(p.group_id) : null;
  return { id: p.id, body: p.body, image: p.image || null, likes: p.likes, comments: p.comments, createdAt: p.created_at, group: g?.name || null,
    author: { id: u.id, name: `${u.name} ${u.surname[0]}.`, handle: u.handle, avatar: u.avatar || null, initials: initials(u) },
    liked: !!userId && !!db.prepare('SELECT 1 FROM post_likes WHERE post_id=? AND user_id=?').get(p.id, userId) };
}
function bookingRow(b) {
  const p = db.prepare('SELECT name, kind FROM places WHERE id=?').get(b.place_id);
  return { id: b.id, kind: b.kind, place: p.name, startDate: b.start_date, endDate: b.end_date, timeSlot: b.time_slot, guests: b.guests,
    nights: b.end_date ? nights(b.start_date, b.end_date) : null, total: b.total, status: b.status };
}
const requireUser = (ctx) => { if (!ctx.user) throw new HttpError(401, 'Please log in to continue.'); return ctx.user; };
const int = (v, name, min, max) => { const n = Number(v); if (!Number.isInteger(n) || n < min || n > max) throw bad(`${name} must be a whole number between ${min} and ${max}.`, name); return n; };
const num = (v, name, min, max) => { const n = Number(v); if (!Number.isFinite(n) || n < min || n > max) throw bad(`${name} must be between ${min} and ${max}.`, name); return n; };

/* ---------- routes ---------- */
const routes = [];
const route = (method, pattern, handler) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), handler });

route('GET', '/api/health', () => ({ ok: true }));

route('POST', '/api/auth/signup', (ctx) => {
  rateLimit('signup:' + ctx.ip, 10, 3600e3);
  const name = str(ctx.body.name, 60), surname = str(ctx.body.surname, 60), email = str(ctx.body.email, 254).toLowerCase(), pw = typeof ctx.body.password === 'string' ? ctx.body.password : '';
  if (!name) throw bad('Please enter your name.', 'name');
  if (!surname) throw bad('Please enter your surname.', 'surname');
  if (!EMAIL.test(email)) throw bad('Please enter a valid email address.', 'email');
  if (pw.length < 8 || pw.length > 128) throw bad('Password must be 8–128 characters.', 'password');
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) throw bad('Password needs at least one letter and one number.', 'password');
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw new HttpError(409, 'An account with this email already exists. Try logging in.', 'email');
  let base = (name + '.' + surname).toLowerCase().replace(/[^a-z0-9.]/g, '') || 'hiker', handle = base, i = 1;
  while (db.prepare('SELECT 1 FROM users WHERE handle=?').get(handle)) handle = base + ++i;
  const { salt, hash } = auth.hashPassword(pw);
  const id = Number(db.prepare('INSERT INTO users (name,surname,email,handle,pass_salt,pass_hash) VALUES (?,?,?,?,?,?)').run(name, surname, email, handle, salt, hash).lastInsertRowid);
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(id);
  return { status: 201, cookie: setCookie(auth.createSession(id)), body: { user: publicUser(user) } };
});
route('POST', '/api/auth/login', (ctx) => {
  rateLimit('login:' + ctx.ip, 15, 15 * 60e3);
  const email = str(ctx.body.email, 254).toLowerCase(), pw = typeof ctx.body.password === 'string' ? ctx.body.password : '';
  if (!EMAIL.test(email)) throw bad('Please enter a valid email address.', 'email');
  if (!pw) throw bad('Please enter your password.', 'password');
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  const ok = u ? auth.verifyPassword(pw, u.pass_salt, u.pass_hash) : (auth.verifyPassword(pw, 'x', 'x'), false);
  if (!ok) throw new HttpError(401, 'Incorrect email or password.');
  return { cookie: setCookie(auth.createSession(u.id)), body: { user: publicUser(u) } };
});
route('POST', '/api/auth/logout', (ctx) => { if (ctx.token) auth.destroySession(ctx.token); return { cookie: clearCookie, body: { ok: true } }; });
route('GET', '/api/auth/google', () => { throw new HttpError(501, 'Google sign-in is not configured yet. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to enable it.'); });
route('POST', '/api/auth/forgot', (ctx) => {
  rateLimit('forgot:' + ctx.ip, 5, 3600e3);
  const email = str(ctx.body.email, 254).toLowerCase();
  if (!EMAIL.test(email)) throw bad('Please enter a valid email address.', 'email');
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (u) {
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare('INSERT INTO reset_tokens (token_hash,user_id,expires_at) VALUES (?,?,?)').run(auth.sha(token), u.id, Date.now() + 3600e3);
    const link = `${APP_URL || `http://localhost:${PORT}`}/#/reset?token=${token}`;
    sendMail(email, 'Reset your Declination password', `Hi ${u.name},\n\nUse this link to choose a new password (valid for 1 hour):\n${link}\n\nIf you did not ask for this, you can ignore this email.`);
  }
  return { ok: true, message: 'If an account exists for that email, a reset link is on its way.' };
});
route('POST', '/api/auth/reset', (ctx) => {
  const token = str(ctx.body.token, 200), pw = typeof ctx.body.password === 'string' ? ctx.body.password : '';
  if (pw.length < 8 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw)) throw bad('Password must be 8+ characters with a letter and a number.', 'password');
  const row = db.prepare('SELECT * FROM reset_tokens WHERE token_hash=? AND expires_at>?').get(auth.sha(token), Date.now());
  if (!row) throw bad('This reset link is invalid or has expired.');
  const { salt, hash } = auth.hashPassword(pw);
  db.prepare('UPDATE users SET pass_salt=?, pass_hash=? WHERE id=?').run(salt, hash, row.user_id);
  db.prepare('DELETE FROM reset_tokens WHERE user_id=?').run(row.user_id);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(row.user_id);
  return { ok: true };
});
route('GET', '/api/me', (ctx) => ({ user: publicUser(ctx.user) }));

route('GET', '/api/stats', () => ({ trails: 12000, adventurers: 50000 }));
route('GET', '/api/featured', (ctx) => ({ trails: db.prepare('SELECT * FROM trails WHERE featured=1 OR popularity > 700 ORDER BY featured DESC, popularity DESC LIMIT 5').all().map((t) => trailRow(t, ctx.user?.id)) }));

route('GET', '/api/trails', (ctx) => {
  const q = ctx.query;
  const where = ["(shared = 1 OR owner_id = @uid)"]; const p = { uid: ctx.user?.id ?? -1 };
  const text = str(q.q, 80).toLowerCase();
  if (text) { where.push("(LOWER(name) LIKE @q ESCAPE '\\' OR LOWER(location) LIKE @q ESCAPE '\\' OR LOWER(difficulty) LIKE @q ESCAPE '\\')"); p.q = '%' + text.replace(/[\\%_]/g, '\\$&') + '%'; }
  if (['Easy', 'Moderate', 'Hard'].includes(q.difficulty)) { where.push('difficulty = @d'); p.d = q.difficulty; }
  const tags = (q.tags || '').split(',').filter((t) => ['under5', 'lakes', 'waterfalls', 'family', 'stays'].includes(t));
  for (const t of tags) {
    if (t === 'under5') where.push('distance_km < 5');
    else if (t === 'stays') where.push("EXISTS (SELECT 1 FROM places WHERE places.trail_id = trails.id AND kind='hotel')");
    else where.push(`(',' || tags || ',') LIKE '%,${t},%'`);
  }
  const order = { popular: 'is_new DESC, popularity DESC', distance: 'distance_km ASC', difficulty: "CASE difficulty WHEN 'Easy' THEN 1 WHEN 'Moderate' THEN 2 ELSE 3 END, name", name: 'name COLLATE NOCASE' }[q.sort || 'popular'] || 'popularity DESC';
  const rows = db.prepare(`SELECT * FROM trails WHERE ${where.join(' AND ')} ORDER BY ${order}`).all(p);
  return { count: rows.length, trails: rows.map((t) => trailRow(t, ctx.user?.id)) };
});
route('GET', '/api/trails/:id', (ctx) => {
  const t = db.prepare('SELECT * FROM trails WHERE id=? OR slug=?').get(Number(ctx.params.id) || -1, ctx.params.id);
  if (!t || (!t.shared && t.owner_id !== ctx.user?.id)) throw new HttpError(404, 'Trail not found.');
  const w = JSON.parse(t.weather || '{}');
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const d0 = new Date();
  const forecast = (w.days || []).map((d, i) => ({ label: i === 0 ? 'Today' : dayNames[(d0.getDay() + i) % 7], hi: d.hi, lo: d.lo }));
  const hotels = db.prepare("SELECT price FROM places WHERE trail_id=? AND kind='hotel'").all(t.id);
  const nextGroups = db.prepare('SELECT * FROM groups_ WHERE trail_id=? AND starts_at>=? ORDER BY starts_at').all(t.id, new Date().toISOString());
  const joinedCount = nextGroups.reduce((n, g) => n + db.prepare('SELECT COUNT(*) c FROM group_members WHERE group_id=?').get(g.id).c, 0);
  const avatars = db.prepare(`SELECT DISTINCT u.* FROM group_members m JOIN users u ON u.id=m.user_id JOIN groups_ g ON g.id=m.group_id WHERE g.trail_id=? ORDER BY u.id LIMIT 4`).all(t.id);
  return {
    trail: trailRow(t, ctx.user?.id),
    weather: { ...w, updatedMinAgo: Math.max(0, Math.round((Date.now() - t.weather_updated) / 60000)), forecast },
    plan: { hotels: hotels.length, fromPrice: hotels.length ? Math.min(...hotels.map((h) => h.price)) : null,
      restaurants: db.prepare("SELECT COUNT(*) c FROM places WHERE trail_id=? AND kind='restaurant'").get(t.id).c, defaultRange: defaultRange() },
    community: { groups: nextGroups.length, avatars: avatars.map(initials), more: Math.max(0, joinedCount - avatars.length) },
  };
});
route('POST', '/api/trails/:id/save', (ctx) => {
  const u = requireUser(ctx); const t = db.prepare('SELECT id FROM trails WHERE id=?').get(Number(ctx.params.id));
  if (!t) throw new HttpError(404, 'Trail not found.');
  db.prepare('INSERT OR IGNORE INTO saved_trails (user_id,trail_id) VALUES (?,?)').run(u.id, t.id); return { saved: true };
});
route('DELETE', '/api/trails/:id/save', (ctx) => { const u = requireUser(ctx); db.prepare('DELETE FROM saved_trails WHERE user_id=? AND trail_id=?').run(u.id, Number(ctx.params.id)); return { saved: false }; });
route('GET', '/api/saved', (ctx) => {
  const u = requireUser(ctx);
  const rows = db.prepare('SELECT t.* FROM saved_trails s JOIN trails t ON t.id=s.trail_id WHERE s.user_id=? ORDER BY s.saved_at DESC, t.id DESC').all(u.id);
  return { trails: rows.map((t) => trailRow(t, u.id)) };
});

route('GET', '/api/trails/:id/places', (ctx) => {
  const t = db.prepare('SELECT * FROM trails WHERE id=?').get(Number(ctx.params.id)); if (!t) throw new HttpError(404, 'Trail not found.');
  const q = ctx.query; const range = defaultRange();
  const start = isDate(q.start || '') ? q.start : range.start;
  let end = range.end;
  if (isDate(q.end || '')) end = q.end;
  else if (isDate(q.start || '')) { const d = new Date(start + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 2); end = d.toISOString().slice(0, 10); }
  if (end <= start) throw bad('Check-out must be after check-in.', 'end');
  const date = isDate(q.date || '') ? q.date : start;
  const rows = db.prepare('SELECT * FROM places WHERE trail_id=? ORDER BY distance_km').all(t.id).map((p) => placeRow(p, { start, end, date }));
  return { trail: { id: t.id, name: t.name, location: t.location }, start, end, date, guests: int(q.guests || 2, 'guests', 1, 12),
    hotels: rows.filter((r) => r.kind === 'hotel'), restaurants: rows.filter((r) => r.kind === 'restaurant'), churches: rows.filter((r) => r.kind === 'church') };
});
route('POST', '/api/bookings', (ctx) => {
  const u = requireUser(ctx); const b = ctx.body;
  const p = db.prepare('SELECT * FROM places WHERE id=?').get(Number(b.placeId));
  if (!p || p.kind === 'church') throw bad('That place cannot be booked.');
  const guests = int(b.guests, 'guests', 1, 12);
  if (p.kind === 'hotel') {
    if (!isDate(b.start || '') || !isDate(b.end || '')) throw bad('Choose valid check-in and check-out dates.');
    if (b.start < today()) throw bad('Check-in cannot be in the past.', 'start');
    const n = nights(b.start, b.end); if (n < 1 || n > 30) throw bad('Stays must be between 1 and 30 nights.', 'end');
    const rooms = int(b.rooms ?? 1, 'rooms', 1, 5);
    db.exec('BEGIN IMMEDIATE');
    try {
      if (roomsLeft(p, b.start, b.end) < rooms) throw new HttpError(409, `${p.name} has no rooms left for those dates.`);
      const total = p.price * n * rooms;
      const id = Number(db.prepare('INSERT INTO bookings (user_id,place_id,kind,start_date,end_date,guests,rooms,total) VALUES (?,?,?,?,?,?,?,?)').run(u.id, p.id, 'hotel', b.start, b.end, guests, rooms, total).lastInsertRowid);
      db.exec('COMMIT');
      return { status: 201, body: { booking: bookingRow(db.prepare('SELECT * FROM bookings WHERE id=?').get(id)) } };
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  if (!isDate(b.date || '')) throw bad('Choose a valid date.', 'date');
  if (b.date < today()) throw bad('Date cannot be in the past.', 'date');
  const slot = str(b.time, 5);
  if (!p.slots.split(',').includes(slot)) throw bad('Choose one of the available times.', 'time');
  db.exec('BEGIN IMMEDIATE');
  try {
    const n = db.prepare("SELECT COUNT(*) c FROM bookings WHERE place_id=? AND kind='restaurant' AND status='confirmed' AND start_date=? AND time_slot=?").get(p.id, b.date, slot).c;
    if (n >= 6) throw new HttpError(409, 'That time has just been taken. Pick another.');
    const id = Number(db.prepare('INSERT INTO bookings (user_id,place_id,kind,start_date,time_slot,guests) VALUES (?,?,?,?,?,?)').run(u.id, p.id, 'restaurant', b.date, slot, guests).lastInsertRowid);
    db.exec('COMMIT');
    return { status: 201, body: { booking: bookingRow(db.prepare('SELECT * FROM bookings WHERE id=?').get(id)) } };
  } catch (e) { db.exec('ROLLBACK'); throw e; }
});
route('GET', '/api/bookings', (ctx) => { const u = requireUser(ctx); return { bookings: db.prepare("SELECT * FROM bookings WHERE user_id=? AND status<>'cancelled' ORDER BY created_at DESC, id DESC").all(u.id).map(bookingRow) }; });
route('DELETE', '/api/bookings/:id', (ctx) => {
  const u = requireUser(ctx); const r = db.prepare("UPDATE bookings SET status='cancelled' WHERE id=? AND user_id=?").run(Number(ctx.params.id), u.id);
  if (!r.changes) throw new HttpError(404, 'Booking not found.'); return { ok: true };
});

route('GET', '/api/groups', (ctx) => {
  const f = ctx.query.filter || 'all';
  let rows = db.prepare('SELECT * FROM groups_ WHERE starts_at >= ? ORDER BY starts_at').all(new Date(Date.now() - 3 * 3600e3).toISOString()).map((g) => groupRow(g, ctx.user?.id));
  if (['Easy', 'Moderate', 'Hard'].includes(f)) rows = rows.filter((g) => g.trail.difficulty === f);
  if (f === 'weekend') rows = rows.filter((g) => { const d = new Date(g.startsAt).getDay(); return (d === 0 || d === 6) && Date.parse(g.startsAt) - Date.now() < 7 * 864e5; });
  const posts = db.prepare('SELECT * FROM posts WHERE group_id IS NOT NULL ORDER BY created_at DESC LIMIT 5').all().map((p) => postRow(p, ctx.user?.id));
  const prog = ctx.user ? (db.prepare('SELECT trails_done FROM challenge_progress WHERE user_id=?').get(ctx.user.id)?.trails_done ?? 0) : 0;
  const mon = new Date().toLocaleString('en-GB', { month: 'long' });
  return { groups: rows, posts, challenge: { title: `${mon[0].toUpperCase() + mon.slice(1)} challenge`, text: 'Summit 3 trails above 1,500 m this month and earn reward points.', done: Math.min(prog, 3), goal: 3, points: 200 } };
});
route('POST', '/api/groups', (ctx) => {
  const u = requireUser(ctx); const b = ctx.body;
  const name = str(b.name, 80), point = str(b.meetingPoint, 120);
  if (!name) throw bad('Give your group a name.', 'name'); if (!point) throw bad('Add a meeting point.', 'meetingPoint');
  const t = db.prepare('SELECT id FROM trails WHERE id=?').get(Number(b.trailId)); if (!t) throw bad('Choose a trail.', 'trailId');
  const when = new Date(b.startsAt); if (Number.isNaN(+when) || +when < Date.now()) throw bad('Choose a start time in the future.', 'startsAt');
  const cap = int(b.capacity ?? 8, 'capacity', 2, 50);
  const id = Number(db.prepare('INSERT INTO groups_ (name,trail_id,host_id,starts_at,meeting_point,capacity) VALUES (?,?,?,?,?,?)').run(name, t.id, u.id, when.toISOString(), point, cap).lastInsertRowid);
  db.prepare('INSERT INTO group_members (group_id,user_id) VALUES (?,?)').run(id, u.id);
  return { status: 201, body: { group: groupRow(db.prepare('SELECT * FROM groups_ WHERE id=?').get(id), u.id) } };
});
route('GET', '/api/groups/:id', (ctx) => {
  const g = db.prepare('SELECT * FROM groups_ WHERE id=?').get(Number(ctx.params.id)); if (!g) throw new HttpError(404, 'Group not found.');
  const row = groupRow(g, ctx.user?.id);
  const all = db.prepare(`SELECT u.* FROM group_members m JOIN users u ON u.id=m.user_id WHERE m.group_id=? ORDER BY m.joined_at, u.id`).all(g.id);
  row.members = all.slice(0, 5).map((u) => ({ id: u.id, initials: initials(u), name: `${u.name} ${u.surname[0]}.`, isYou: u.id === ctx.user?.id }));
  row.moreMembers = Math.max(0, all.length - 5);
  return { group: row };
});
route('POST', '/api/groups/:id/join', (ctx) => {
  const u = requireUser(ctx); const id = Number(ctx.params.id);
  db.exec('BEGIN IMMEDIATE');
  try {
    const g = db.prepare('SELECT * FROM groups_ WHERE id=?').get(id); if (!g) throw new HttpError(404, 'Group not found.');
    if (db.prepare('SELECT 1 FROM group_members WHERE group_id=? AND user_id=?').get(id, u.id)) { db.exec('COMMIT'); return { group: groupRow(g, u.id) }; }
    if (db.prepare('SELECT COUNT(*) c FROM group_members WHERE group_id=?').get(id).c >= g.capacity) throw new HttpError(409, 'This group is full.');
    db.prepare('INSERT INTO group_members (group_id,user_id) VALUES (?,?)').run(id, u.id);
    db.exec('COMMIT'); return { group: groupRow(g, u.id) };
  } catch (e) { db.exec('ROLLBACK'); throw e; }
});
route('POST', '/api/groups/:id/leave', (ctx) => {
  const u = requireUser(ctx); const g = db.prepare('SELECT * FROM groups_ WHERE id=?').get(Number(ctx.params.id)); if (!g) throw new HttpError(404, 'Group not found.');
  if (g.host_id === u.id) throw bad('Hosts cannot leave their own group.');
  db.prepare('DELETE FROM group_members WHERE group_id=? AND user_id=?').run(g.id, u.id); return { group: groupRow(g, u.id) };
});
function requireMember(ctx) {
  const u = requireUser(ctx); const id = Number(ctx.params.id);
  if (!db.prepare('SELECT 1 FROM group_members WHERE group_id=? AND user_id=?').get(id, u.id)) throw new HttpError(403, 'Join this group to read and send messages.');
  return { u, id };
}
route('GET', '/api/groups/:id/messages', (ctx) => {
  const { u, id } = requireMember(ctx); const after = Number(ctx.query.after) || 0;
  const rows = db.prepare('SELECT m.*, us.name, us.surname FROM messages m JOIN users us ON us.id=m.user_id WHERE m.group_id=? AND m.id>? ORDER BY m.id LIMIT 200').all(id, after);
  return { messages: rows.map((m) => ({ id: m.id, body: m.body, createdAt: m.created_at, from: { id: m.user_id, name: `${m.name} ${m.surname[0]}.`, initials: (m.name[0] + m.surname[0]).toUpperCase() }, mine: m.user_id === u.id })) };
});
route('POST', '/api/groups/:id/messages', (ctx) => {
  const { u, id } = requireMember(ctx); rateLimit('msg:' + u.id, 30, 60e3);
  const body = str(ctx.body.body, 1000); if (!body) throw bad('Write a message first.', 'body');
  const mid = Number(db.prepare('INSERT INTO messages (group_id,user_id,body,created_at) VALUES (?,?,?,?)').run(id, u.id, body, Date.now()).lastInsertRowid);
  return { status: 201, body: { message: { id: mid, body, createdAt: Date.now(), from: { id: u.id, name: `${u.name} ${u.surname[0]}.`, initials: initials(u) }, mine: true } } };
});

route('POST', '/api/posts', (ctx) => {
  const u = requireUser(ctx); const body = str(ctx.body.body, 600); if (!body) throw bad('Write something to share.', 'body');
  rateLimit('post:' + u.id, 20, 3600e3);
  const gid = ctx.body.groupId ? Number(ctx.body.groupId) : null;
  if (gid && !db.prepare('SELECT 1 FROM group_members WHERE group_id=? AND user_id=?').get(gid, u.id)) throw new HttpError(403, 'Join the group before posting to it.');
  const id = Number(db.prepare('INSERT INTO posts (user_id,group_id,body,created_at) VALUES (?,?,?,?)').run(u.id, gid, body, Date.now()).lastInsertRowid);
  return { status: 201, body: { post: postRow(db.prepare('SELECT * FROM posts WHERE id=?').get(id), u.id) } };
});
route('POST', '/api/posts/:id/like', (ctx) => {
  const u = requireUser(ctx); const id = Number(ctx.params.id);
  const p = db.prepare('SELECT * FROM posts WHERE id=?').get(id); if (!p) throw new HttpError(404, 'Post not found.');
  if (db.prepare('SELECT 1 FROM post_likes WHERE post_id=? AND user_id=?').get(id, u.id)) {
    db.prepare('DELETE FROM post_likes WHERE post_id=? AND user_id=?').run(id, u.id); db.prepare('UPDATE posts SET likes=MAX(0,likes-1) WHERE id=?').run(id);
  } else { db.prepare('INSERT INTO post_likes (post_id,user_id) VALUES (?,?)').run(id, u.id); db.prepare('UPDATE posts SET likes=likes+1 WHERE id=?').run(id); }
  return { post: postRow(db.prepare('SELECT * FROM posts WHERE id=?').get(id), u.id) };
});

route('GET', '/api/profile', (ctx) => {
  const u = requireUser(ctx);
  const posts = db.prepare('SELECT * FROM posts WHERE user_id=? ORDER BY created_at DESC').all(u.id).map((p) => postRow(p, u.id));
  const hikes = db.prepare('SELECT * FROM hikes WHERE user_id=? ORDER BY completed_at DESC').all(u.id);
  const km = hikes.reduce((s, h) => s + h.distance_km, 0);
  const seededKm = u.email === 'anna@declination.app' ? 1240 : 0, seededSummits = u.email === 'anna@declination.app' ? 42 : 0;
  const groups = db.prepare('SELECT g.* FROM group_members m JOIN groups_ g ON g.id=m.group_id WHERE m.user_id=? ORDER BY g.starts_at').all(u.id).map((g) => groupRow(g, u.id));
  const saved = db.prepare('SELECT t.* FROM saved_trails s JOIN trails t ON t.id=s.trail_id WHERE s.user_id=? ORDER BY s.saved_at DESC').all(u.id).map((t) => trailRow(t, u.id));
  const hosted = groups.some((g) => g.host.id === u.id);
  const summits = seededSummits + hikes.length, kmTotal = Math.round(seededKm + km);
  const badges = [{ label: `Level ${u.level} Explorer`, on: true }, { label: `${summits} summits`, on: summits > 0 }, { label: `${kmTotal.toLocaleString('en-US')} km hiked`, on: kmTotal > 0 }, { label: 'Group host', on: hosted }].filter((b) => b.on);
  const chips = db.prepare(`SELECT DISTINCT t.name FROM hikes h JOIN trails t ON t.id=h.trail_id WHERE h.user_id=? ORDER BY h.completed_at DESC LIMIT 6`).all(u.id).map((r) => r.name);
  return { profile: { ...publicUser(u), bio: u.bio, followers: u.followers, following: u.following, postsCount: posts.length, badges, visited: chips },
    posts, saved, groups, hikes: hikes.map((h) => ({ id: h.id, name: h.name, distanceKm: h.distance_km, elevationM: h.elevation_m, durationS: h.duration_s, completedAt: h.completed_at })) };
});
route('PATCH', '/api/profile', (ctx) => { const u = requireUser(ctx); db.prepare('UPDATE users SET bio=? WHERE id=?').run(str(ctx.body.bio, 300), u.id); return { ok: true }; });

route('POST', '/api/recordings', (ctx) => {
  const u = requireUser(ctx); const b = ctx.body;
  const name = str(b.name, 80); if (!name) throw bad('Give your trail a name.', 'name');
  const dist = num(b.distanceKm, 'Distance', 0.05, 500), elev = Math.round(num(b.elevationM ?? 0, 'Elevation', 0, 9000)), secs = Math.round(num(b.durationS, 'Duration', 30, 7 * 86400));
  const diff = ['Easy', 'Moderate', 'Hard'].includes(b.difficulty) ? b.difficulty : (dist < 5 && elev < 250 ? 'Easy' : dist > 10 || elev > 700 ? 'Hard' : 'Moderate');
  const tags = (Array.isArray(b.tags) ? b.tags : []).filter((t) => ['lakes', 'waterfalls', 'family'].includes(t)); if (dist < 5) tags.push('under5');
  const shared = b.shared === false ? 0 : 1;
  let slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'trail', n = 1, s = slug;
  while (db.prepare('SELECT 1 FROM trails WHERE slug=?').get(s)) s = `${slug}-${++n}`;
  const w = JSON.stringify({ temp: 10, cond: 'Clear', feels: 8, low: 4, wind: 10, humidity: 50, uv: '3 (Moderate)', sunset: '18:00', days: [] });
  const id = Number(db.prepare(`INSERT INTO trails (slug,name,location,difficulty,distance_km,elevation_m,duration_h,tags,description,popularity,weather,weather_updated,owner_id,shared,is_new)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`).run(s, name, str(b.location, 100) || 'Recorded by you', diff, Math.round(dist * 10) / 10, elev, Math.round((secs / 3600) * 10) / 10, [...new Set(tags)].join(','),
    `Recorded by ${u.name} ${u.surname[0]}. on ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}.`, 1000, w, Date.now(), u.id, shared).lastInsertRowid);
  db.prepare('INSERT INTO saved_trails (user_id,trail_id) VALUES (?,?)').run(u.id, id);
  db.prepare('INSERT INTO hikes (user_id,trail_id,name,distance_km,elevation_m,duration_s,completed_at) VALUES (?,?,?,?,?,?,?)').run(u.id, id, name, dist, elev, secs, Date.now());
  return { status: 201, body: { trail: trailRow(db.prepare('SELECT * FROM trails WHERE id=?').get(id), u.id) } };
});

/* ---------- static ---------- */
function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || !path.extname(rel)) rel = '/index.html';
  const full = path.normalize(path.join(PUBLIC, rel));
  if (!full.startsWith(PUBLIC + path.sep)) return send(res, 403, { error: 'Forbidden' });
  fs.stat(full, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, { error: 'Not found' });
    const ext = path.extname(full).toLowerCase();
    const longCache = ['.jpg', '.jpeg', '.png', '.webp', '.svg', '.ico', '.woff2', '.woff'].includes(ext);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': st.size, 'X-Content-Type-Options': 'nosniff', ...SECURITY,
      'Cache-Control': longCache ? 'public, max-age=86400' : 'no-cache' });
    fs.createReadStream(full).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (!url.pathname.startsWith('/api/')) {
      if (!['GET', 'HEAD'].includes(req.method)) return send(res, 405, { error: 'Method not allowed' });
      return serveStatic(req, res, url.pathname);
    }
    const method = req.method;
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) throw new HttpError(403, 'Cross-origin request blocked.');
    }
    const token = parseCookies(req.headers.cookie)[COOKIE];
    const ctx = { req, token, user: auth.userFromToken(token), query: Object.fromEntries(url.searchParams), params: {}, body: {}, ip: clientIp(req) };
    let matched = null;
    for (const r of routes) { if (r.method !== method) continue; const m = r.re.exec(url.pathname); if (m) { matched = r; ctx.params = m.groups || {}; break; } }
    if (!matched) {
      if (routes.some((r) => r.re.test(url.pathname))) throw new HttpError(405, 'Method not allowed');
      throw new HttpError(404, 'Endpoint not found');
    }
    if (['POST', 'PUT', 'PATCH'].includes(method)) ctx.body = await readBody(req);
    if (url.pathname === '/api/me' && !ctx.user) return send(res, 200, { user: null });
    const out = await matched.handler(ctx);
    if (out && out.body !== undefined) send(res, out.status || 200, out.body, out.cookie ? { 'Set-Cookie': out.cookie } : {});
    else send(res, 200, out ?? { ok: true });
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, { error: e.message, field: e.field });
    console.error(e); send(res, 500, { error: 'Something went wrong on our side. Please try again.' });
  }
});

if (require.main === module) {
  upgradeData();
  if (seedIfEmpty()) console.log(PROD && !process.env.DEMO_PASSWORD ? 'Database seeded with starter trails, stays and groups (demo accounts are locked).' : 'Database seeded with demo data. Demo login: anna@declination.app / ' + (process.env.DEMO_PASSWORD || 'wyoming1230'));
  const sweep = () => { try { db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now()); db.prepare('DELETE FROM reset_tokens WHERE expires_at < ?').run(Date.now()); } catch (e) { console.error('sweep failed', e.message); } };
  sweep(); setInterval(sweep, 3600e3).unref();
  server.listen(PORT, '0.0.0.0', () => console.log(`Declination running on port ${PORT}${PROD ? ' (production)' : ` at http://localhost:${PORT}`}`));
  const stop = () => { console.log('Shutting down…'); server.close(() => { try { db.close(); } catch { /* ignore */ } process.exit(0); }); setTimeout(() => process.exit(0), 8000).unref(); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
module.exports = { server };
