// Customer accounts: sign up with name + mobile + email, verify with a 6-digit code sent by email,
// and log in later with email + code (no passwords). Sessions use their own cookie, separate from admin.
import crypto from 'node:crypto';
import { db, setting } from '../db.js';
import { config } from '../config.js';
import { sendMail, mailLive } from './mailer.js';
import { UserError, normalisePhone } from './orders.js';

const COOKIE = 'cus';
const SESSION_DAYS = 30;
const OTP_MINUTES = 10;
const OTP_MAX_TRIES = 5;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^[6-9]\d{9}$/;
const sign = (v) => crypto.createHmac('sha256', config.sessionSecret).update(`cus:${v}`).digest('base64url');
const hashCode = (email, code) => crypto.createHmac('sha256', config.sessionSecret).update(`otp:${email}:${code}`).digest('hex');
const cleanEmail = (e) => String(e || '').trim().toLowerCase().slice(0, 120);

function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

// ---------- One-time codes ----------

/**
 * Creates a code and emails it. Without email set up (local testing only), the code is returned as `devCode`
 * so the flow can still be tried; in production that is refused instead.
 */
async function issueCode(email, purpose, payload = {}) {
  const recent = db.prepare(`SELECT COUNT(*) n FROM otp_codes WHERE email = ? AND created_at > datetime('now', '-15 minutes')`).get(email).n;
  if (recent >= 5) throw new UserError('Too many codes requested. Please wait 15 minutes and try again.', 429);
  if (!mailLive() && config.isProd) throw new UserError('Login by email is not available right now. Please check out as a guest.', 503);

  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  db.prepare(`UPDATE otp_codes SET used = 1 WHERE email = ? AND used = 0`).run(email); // only the newest code works
  db.prepare(`INSERT INTO otp_codes (email, code_hash, purpose, payload, expires_at) VALUES (?, ?, ?, ?, datetime('now', '+${OTP_MINUTES} minutes'))`)
    .run(email, hashCode(email, code), purpose, JSON.stringify(payload));

  const brand = setting('brand_name');
  await sendMail({
    to: email, kind: `otp_${purpose}`, ref: email,
    subject: `${code} is your ${brand} code`,
    text: `Your ${brand} ${purpose === 'signup' ? 'sign-up' : 'login'} code is ${code}. It expires in ${OTP_MINUTES} minutes. If you didn't ask for this, ignore this email.`,
    html: `<div style="font-family:Arial,sans-serif;max-width:460px;margin:auto;padding:24px;color:#1f1d1b">
      <h2 style="margin:0 0 12px">${brand}</h2>
      <p>Your ${purpose === 'signup' ? 'sign-up' : 'login'} code is:</p>
      <p style="font-size:32px;letter-spacing:8px;font-weight:bold;margin:12px 0">${code}</p>
      <p style="color:#7a746c;font-size:13px">It expires in ${OTP_MINUTES} minutes. If you didn't ask for this, you can ignore this email.</p></div>`,
  });
  return mailLive() ? {} : { devCode: code };
}

function consumeCode(email, code, purpose) {
  const row = db.prepare(`SELECT * FROM otp_codes WHERE email = ? AND purpose = ? AND used = 0 ORDER BY id DESC LIMIT 1`).get(email, purpose);
  if (!row || row.expires_at < new Date().toISOString().replace('T', ' ').slice(0, 19)) throw new UserError('This code has expired. Ask for a new one.');
  if (row.attempts >= OTP_MAX_TRIES) throw new UserError('Too many wrong tries. Ask for a new code.');
  const ok = /^\d{6}$/.test(String(code)) && crypto.timingSafeEqual(Buffer.from(row.code_hash), Buffer.from(hashCode(email, String(code))));
  if (!ok) {
    db.prepare('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?').run(row.id);
    const left = OTP_MAX_TRIES - row.attempts - 1;
    throw new UserError(left > 0 ? `That code is not right. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'Too many wrong tries. Ask for a new code.');
  }
  db.prepare('UPDATE otp_codes SET used = 1 WHERE id = ?').run(row.id);
  return JSON.parse(row.payload || '{}');
}

// ---------- Sign up / log in ----------

export async function startSignup({ name, phone, email }) {
  const n = String(name || '').trim().slice(0, 80);
  const p = normalisePhone(phone);
  const e = cleanEmail(email);
  if (n.length < 2) throw new UserError('Enter your name.');
  if (!PHONE.test(p)) throw new UserError('Enter a valid 10-digit mobile number.');
  if (!EMAIL.test(e)) throw new UserError('Enter a valid email address.');
  if (db.prepare('SELECT 1 FROM customers WHERE email = ?').get(e)) throw new UserError('An account with this email already exists. Please log in.');
  if (db.prepare('SELECT 1 FROM customers WHERE phone = ?').get(p)) throw new UserError('An account with this mobile number already exists. Please log in with its email.');
  return issueCode(e, 'signup', { name: n, phone: p });
}

export async function startLogin({ email }) {
  const e = cleanEmail(email);
  if (!EMAIL.test(e)) throw new UserError('Enter a valid email address.');
  if (!db.prepare('SELECT 1 FROM customers WHERE email = ?').get(e)) throw new UserError('No account with this email. Please sign up first.');
  return issueCode(e, 'login');
}

/** Checks the code; for sign-up creates the account. Starts a session either way. */
export function verifyCode(res, { email, code, purpose }) {
  const e = cleanEmail(email);
  if (!['signup', 'login'].includes(purpose)) throw new UserError('Invalid request.');
  const payload = consumeCode(e, code, purpose);
  let customer = db.prepare('SELECT * FROM customers WHERE email = ?').get(e);
  if (purpose === 'signup' && !customer) {
    if (db.prepare('SELECT 1 FROM customers WHERE phone = ?').get(payload.phone)) throw new UserError('An account with this mobile number already exists.');
    const id = Number(db.prepare('INSERT INTO customers (name, phone, email) VALUES (?, ?, ?)').run(payload.name, payload.phone, e).lastInsertRowid);
    // Earlier guest orders with the same email and phone become part of the new account
    db.prepare('UPDATE orders SET customer_id = ? WHERE customer_id IS NULL AND email = ? AND phone = ?').run(id, e, payload.phone);
    customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
  }
  if (!customer) throw new UserError('Account not found.');
  db.prepare(`UPDATE customers SET last_login_at = datetime('now') WHERE id = ?`).run(customer.id);
  startCustomerSession(res, customer.id);
  return publicCustomer(customer);
}

// ---------- Sessions ----------

function startCustomerSession(res, customerId) {
  const id = crypto.randomBytes(32).toString('base64url');
  db.prepare(`INSERT INTO customer_sessions (id, customer_id, expires_at) VALUES (?, ?, datetime('now', '+${SESSION_DAYS} days'))`).run(id, customerId);
  db.prepare(`DELETE FROM customer_sessions WHERE expires_at < datetime('now')`).run();
  res.append('Set-Cookie', `${COOKIE}=${id}.${sign(id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${config.isProd ? '; Secure' : ''}`);
}

function sessionId(req) {
  const raw = readCookie(req, COOKIE);
  if (!raw) return null;
  const i = raw.lastIndexOf('.');
  const id = raw.slice(0, i), sig = raw.slice(i + 1), expected = sign(id);
  return sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) ? id : null;
}

export function currentCustomer(req) {
  const id = sessionId(req);
  if (!id) return null;
  return db.prepare(`SELECT c.* FROM customer_sessions s JOIN customers c ON c.id = s.customer_id WHERE s.id = ? AND s.expires_at > datetime('now')`).get(id) || null;
}

export function endCustomerSession(req, res) {
  const id = sessionId(req);
  if (id) db.prepare('DELETE FROM customer_sessions WHERE id = ?').run(id);
  res.append('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

export function requireCustomer(req, res, next) {
  const c = currentCustomer(req);
  if (!c) return res.status(401).json({ error: 'Please log in.' });
  req.customer = c;
  next();
}

// ---------- Profile & address ----------

export function publicCustomer(c) {
  let address = null;
  try { address = c.address ? JSON.parse(c.address) : null; } catch { /* ignore */ }
  return { id: c.id, name: c.name, phone: c.phone, email: c.email, address, since: c.created_at };
}

const PIN = /^[1-9]\d{5}$/;
export function updateProfile(customer, body = {}) {
  const name = String(body.name ?? customer.name).trim().slice(0, 80);
  if (name.length < 2) throw new UserError('Enter your name.');
  let address = customer.address;
  if (body.address) {
    const a = body.address;
    const clean = {
      line1: String(a.line1 || '').trim().slice(0, 160), line2: String(a.line2 || '').trim().slice(0, 160),
      city: String(a.city || '').trim().slice(0, 60), state: String(a.state || '').trim().slice(0, 60), pincode: String(a.pincode || '').trim(),
    };
    if (clean.line1.length < 5 || !clean.city || !clean.state || !PIN.test(clean.pincode)) throw new UserError('Fill in the full address with a valid 6-digit pincode.');
    address = JSON.stringify(clean);
  }
  db.prepare('UPDATE customers SET name = ?, address = ? WHERE id = ?').run(name, address, customer.id);
  return publicCustomer(db.prepare('SELECT * FROM customers WHERE id = ?').get(customer.id));
}

/** After an order, remember its address as the customer's default. */
export function rememberAddress(customerId, o) {
  db.prepare('UPDATE customers SET address = ? WHERE id = ?').run(JSON.stringify({
    line1: o.address_line1, line2: o.address_line2, city: o.city, state: o.state, pincode: o.pincode,
  }), customerId);
}
