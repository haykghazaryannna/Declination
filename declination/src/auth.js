'use strict';
const crypto = require('crypto');
const db = require('./db');

const SESSION_MS = 30 * 24 * 3600 * 1000;

function hashPassword(pw, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  return { salt, hash };
}
function verifyPassword(pw, salt, hash) {
  if (!salt || !hash) return false;
  const a = Buffer.from(crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex'));
  const b = Buffer.from(hash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token,user_id,expires_at) VALUES (?,?,?)').run(token, userId, Date.now() + SESSION_MS);
  return token;
}
function userFromToken(token) {
  if (!token) return null;
  const row = db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ?`).get(token, Date.now());
  return row || null;
}
function destroySession(token) { db.prepare('DELETE FROM sessions WHERE token = ?').run(token); }
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
module.exports = { hashPassword, verifyPassword, createSession, userFromToken, destroySession, SESSION_MS, sha };
