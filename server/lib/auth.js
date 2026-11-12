import crypto from 'node:crypto';
import { db } from '../db.js';
import { config } from '../config.js';

const COOKIE = 'adm';
const SESSION_HOURS = 12;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [, saltHex, hashHex] = String(stored).split('$');
  if (!saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), 64);
  return crypto.timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
}

const sign = (v) => crypto.createHmac('sha256', config.sessionSecret).update(v).digest('base64url');

function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export function startSession(res, adminId) {
  const id = crypto.randomBytes(32).toString('base64url');
  db.prepare(`INSERT INTO sessions (id, admin_id, expires_at) VALUES (?, ?, datetime('now', '+${SESSION_HOURS} hours'))`).run(id, adminId);
  res.setHeader('Set-Cookie', `${COOKIE}=${id}.${sign(id)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_HOURS * 3600}${config.isProd ? '; Secure' : ''}`);
}

export function endSession(req, res) {
  const id = sessionId(req);
  if (id) db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
}

function sessionId(req) {
  const raw = readCookie(req, COOKIE);
  if (!raw) return null;
  const i = raw.lastIndexOf('.');
  const id = raw.slice(0, i), sig = raw.slice(i + 1);
  const expected = sign(id);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  return id;
}

export function currentAdmin(req) {
  const id = sessionId(req);
  if (!id) return null;
  return db.prepare(`SELECT a.id, a.email, a.name, a.role FROM sessions s JOIN admins a ON a.id = s.admin_id
    WHERE s.id = ? AND s.expires_at > datetime('now')`).get(id) || null;
}

/** Admin-only routes. State-changing requests must be JSON (or multipart uploads), which blocks cross-site form posts. */
export function requireAdmin(req, res, next) {
  const admin = currentAdmin(req);
  if (!admin) return res.status(401).json({ error: 'Please sign in.' });
  if (req.method !== 'GET') {
    const ct = req.headers['content-type'] || '';
    if (!ct.startsWith('application/json') && !ct.startsWith('multipart/form-data')) {
      return res.status(415).json({ error: 'Unsupported request.' });
    }
    if (ct.startsWith('multipart/form-data') && req.headers['x-requested-with'] !== 'fetch') {
      return res.status(403).json({ error: 'Blocked request.' });
    }
  }
  req.admin = admin;
  next();
}

/**
 * What each admin role may do. The owner can do everything; checks happen on the server for every request.
 *   manager   — runs the shop day to day: everything except settings changes, staff and deleting money entries
 *   orders    — packing and dispatch: orders, shipping, returns (no refunds), bulk enquiries
 *   catalogue — products, stock, photos and the homepage
 */
export const ROLES = {
  owner: { label: 'Owner', perms: ['*'] },
  manager: { label: 'Manager', perms: ['orders', 'returns', 'refunds', 'products', 'homepage', 'coupons', 'enquiries', 'money', 'export', 'settings.view', 'audit', 'sales', 'customers'] },
  orders: { label: 'Orders staff', perms: ['orders', 'returns', 'enquiries'] },
  catalogue: { label: 'Catalogue staff', perms: ['products', 'homepage'] },
};
export const can = (admin, perm) => {
  const perms = ROLES[admin?.role]?.perms || [];
  return perms.includes('*') || perms.includes(perm);
};
export const permsFor = (role) => (ROLES[role]?.perms.includes('*')
  ? [...new Set(Object.values(ROLES).flatMap((r) => r.perms).filter((x) => x !== '*').concat(['settings.edit', 'staff', 'money.delete']))]
  : ROLES[role]?.perms || []);

export const requireOwner = (req, res, next) =>
  req.admin?.role === 'owner' ? next() : res.status(403).json({ error: 'Only the owner can do this.' });

// Simple in-memory login throttle: 8 failed tries per IP per 15 minutes.
const attempts = new Map();
export function loginThrottled(ip) {
  const now = Date.now();
  const a = attempts.get(ip);
  if (!a || now - a.first > 15 * 60000) return false;
  return a.count >= 8;
}
export function noteLoginFailure(ip) {
  const now = Date.now();
  const a = attempts.get(ip);
  if (!a || now - a.first > 15 * 60000) attempts.set(ip, { first: now, count: 1 });
  else a.count++;
}
export const clearLoginFailures = (ip) => attempts.delete(ip);

export function ensureOwnerAccount() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM admins').get().n;
  if (count > 0) return;
  db.prepare(`INSERT INTO admins (email, name, password_hash, role) VALUES (?, 'Owner', ?, 'owner')`)
    .run(config.admin.email.toLowerCase(), hashPassword(config.admin.password));
  console.log(`[auth] Created owner account ${config.admin.email}. Change the password after first login.`);
}
