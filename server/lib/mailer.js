// Minimal SMTP client (no dependencies). Supports implicit TLS (port 465) and STARTTLS (port 587),
// AUTH LOGIN, and multipart text + HTML messages. Every send is recorded in the email_log table.
import net from 'node:net';
import tls from 'node:tls';
import crypto from 'node:crypto';
import { db, setting } from '../db.js';
import { config } from '../config.js';

export const mailLive = () => Boolean(config.smtp.host && config.smtp.user && config.smtp.pass);

const clean = (s) => String(s ?? '').replace(/[\r\n]+/g, ' ').trim();
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const wrap76 = (s) => s.replace(/.{1,76}/g, '$&\r\n');
const encodeHeader = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);

function buildMessage({ from, fromName, to, subject, text, html }) {
  const boundary = `b_${crypto.randomBytes(12).toString('hex')}`;
  const domain = from.split('@')[1] || 'localhost';
  return [
    `From: ${encodeHeader(fromName)} <${from}>`,
    `To: <${to}>`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(b64(text)),
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(b64(html)),
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

/** Talks SMTP over a socket. Each `cmd` resolves with the server's full reply once it is complete. */
function session(socket) {
  let buf = '';
  let waiting = null;
  // A reply is complete when its last line looks like "250 text" (a space after the code, not a dash).
  const tryResolve = () => {
    if (!waiting) return;
    const lines = buf.split('\r\n');
    const last = lines.length >= 2 ? lines[lines.length - 2] : '';
    if (!/^\d{3} /.test(last)) return;
    const reply = buf; buf = '';
    const w = waiting; waiting = null;
    w.resolve({ code: Number(last.slice(0, 3)), text: reply.trim() });
  };
  const onData = (chunk) => { buf += chunk.toString('utf8'); tryResolve(); };
  const onClose = () => { if (waiting) { const w = waiting; waiting = null; w.reject(new Error('SMTP connection closed')); } };
  socket.on('data', onData);
  socket.on('close', onClose);
  socket.on('error', onClose);
  const read = () => new Promise((resolve, reject) => { waiting = { resolve, reject }; tryResolve(); });
  const cmd = async (line, expect, label) => {
    const p = read();
    if (line !== null) socket.write(line + '\r\n');
    const r = await p;
    if (expect && !expect.includes(r.code)) throw new Error(`SMTP: ${label || (line ? line.split(' ')[0] : 'greeting')} failed — ${r.text.slice(0, 200)}`);
    return r;
  };
  return { cmd, detach: () => { socket.off('data', onData); socket.off('close', onClose); socket.off('error', onClose); } };
}

async function smtpSend({ to, subject, text, html }) {
  const { host, port, user, pass, from, fromName, secure } = config.smtp;
  const sender = from || user;
  const connectOpts = { host, port, servername: host };
  let socket = await new Promise((resolve, reject) => {
    const s = secure ? tls.connect(connectOpts, () => resolve(s)) : net.connect(connectOpts, () => resolve(s));
    s.once('error', reject);
    s.setTimeout(20000, () => s.destroy(new Error('SMTP timeout')));
  });
  try {
    let sess = session(socket);
    await sess.cmd(null, [220]);
    const ehlo = await sess.cmd(`EHLO ${sender.split('@')[1] || 'localhost'}`, [250]);
    if (!secure) {
      if (!/STARTTLS/i.test(ehlo.text)) throw new Error('SMTP server does not offer STARTTLS; use port 465.');
      await sess.cmd('STARTTLS', [220]);
      sess.detach();
      socket = await new Promise((resolve, reject) => {
        const t = tls.connect({ socket, servername: host }, () => resolve(t));
        t.once('error', reject);
      });
      sess = session(socket);
      await sess.cmd(`EHLO ${sender.split('@')[1] || 'localhost'}`, [250]);
    }
    await sess.cmd('AUTH LOGIN', [334]);
    await sess.cmd(b64(user), [334], 'login (username)');
    await sess.cmd(b64(pass), [235], 'login (password or key)');
    await sess.cmd(`MAIL FROM:<${sender}>`, [250]);
    await sess.cmd(`RCPT TO:<${to}>`, [250, 251]);
    await sess.cmd('DATA', [354]);
    const body = buildMessage({ from: sender, fromName: fromName || setting('brand_name'), to, subject, text, html })
      .replace(/\r\n\./g, '\r\n..'); // dot-stuffing
    await sess.cmd(`${body}\r\n.`, [250], 'message body');
    await sess.cmd('QUIT', [221]).catch(() => {});
  } finally {
    socket.end();
  }
}

/**
 * Sends an email and records the result. Never throws: a failed email must not break an order.
 * Without SMTP settings the email is logged as "skipped" so you can see what would have been sent.
 */
export async function sendMail({ to, subject, text, html, kind = 'other', ref = '' }) {
  to = clean(to); subject = clean(subject);
  const log = db.prepare('INSERT INTO email_log (to_addr, subject, kind, ref, status, error) VALUES (?, ?, ?, ?, ?, ?)');
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(to)) { log.run(to, subject, kind, ref, 'failed', 'Invalid address'); return false; }
  if (!mailLive()) { log.run(to, subject, kind, ref, 'skipped', 'Email not set up (add SMTP settings to .env)'); return false; }
  try {
    await smtpSend({ to, subject, text, html });
    log.run(to, subject, kind, ref, 'sent', '');
    return true;
  } catch (err) {
    log.run(to, subject, kind, ref, 'failed', String(err.message).slice(0, 300));
    console.error(`[mail] ${kind} to ${to} failed:`, err.message);
    return false;
  }
}
