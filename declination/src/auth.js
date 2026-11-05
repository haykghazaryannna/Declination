import crypto from 'node:crypto';
import db from './db.js';

export const SESSION_MS = 30 * 24 * 3600 * 1000;

export function hashPassword(pw, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  return { salt, hash };
}
export function verifyPassword(pw, salt, hash) {
  if (!salt || !hash) return false;
  const a = Buffer.from(crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex'));
  const b = Buffer.from(hash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
export async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await db.run('INSERT INTO sessions (token,user_id,expires_at) VALUES (?,?,?)', token, userId, Date.now() + SESSION_MS);
  return token;
}
export async function userFromToken(token) {
  if (!token) return null;
  return (await db.get('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ?', token, Date.now())) || null;
}
export async function destroySession(token) { await db.run('DELETE FROM sessions WHERE token = ?', token); }
export const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
