import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });

export const db = new DatabaseSync(config.dbFile);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

// All money is stored as integer paise (₹1 = 100 paise). Prices include GST.
db.exec(`
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Shirts',
  tagline TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  fabric TEXT NOT NULL DEFAULT '',
  care TEXT NOT NULL DEFAULT '',
  price_paise INTEGER NOT NULL CHECK (price_paise > 0),
  mrp_paise INTEGER NOT NULL,
  hsn TEXT NOT NULL DEFAULT '6205',
  silhouette TEXT NOT NULL DEFAULT 'shirt',
  images TEXT NOT NULL DEFAULT '[]',
  similar TEXT NOT NULL DEFAULT '[]',
  weight_grams INTEGER NOT NULL DEFAULT 400,
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS variants (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  color TEXT NOT NULL,
  color_hex TEXT NOT NULL DEFAULT '#888888',
  size TEXT NOT NULL,
  sku TEXT UNIQUE NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  UNIQUE (product_id, color, size)
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY,
  number TEXT UNIQUE NOT NULL,
  customer_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  address_line1 TEXT NOT NULL,
  address_line2 TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  pincode TEXT NOT NULL,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('prepaid','cod')),
  payment_status TEXT NOT NULL,
  status TEXT NOT NULL,
  items_paise INTEGER NOT NULL,
  shipping_paise INTEGER NOT NULL DEFAULT 0,
  cod_fee_paise INTEGER NOT NULL DEFAULT 0,
  total_paise INTEGER NOT NULL,
  tax_paise INTEGER NOT NULL DEFAULT 0,
  refunded_paise INTEGER NOT NULL DEFAULT 0,
  razorpay_order_id TEXT,
  razorpay_payment_id TEXT,
  shiprocket_order_id TEXT,
  shipment_id TEXT,
  awb TEXT,
  courier TEXT,
  invoice_no TEXT,
  hold_expires_at TEXT,
  shipped_at TEXT,
  delivered_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_rzp ON orders(razorpay_order_id);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  variant_id INTEGER NOT NULL REFERENCES variants(id),
  product_id INTEGER NOT NULL,
  product_name TEXT NOT NULL,
  color TEXT NOT NULL,
  size TEXT NOT NULL,
  sku TEXT NOT NULL,
  hsn TEXT NOT NULL,
  unit_price_paise INTEGER NOT NULL,
  qty INTEGER NOT NULL CHECK (qty > 0),
  gst_rate INTEGER NOT NULL,
  tax_paise INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS order_events (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  actor TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS returns (
  id INTEGER PRIMARY KEY,
  number TEXT UNIQUE NOT NULL,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  type TEXT NOT NULL CHECK (type IN ('refund','exchange')),
  reason TEXT NOT NULL,
  items TEXT NOT NULL,              -- JSON [{itemId, qty, exchangeSize?}]
  refund_upi TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'requested',
  refund_paise INTEGER NOT NULL DEFAULT 0,
  refund_ref TEXT NOT NULL DEFAULT '',
  restocked INTEGER NOT NULL DEFAULT 0,
  admin_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS enquiries (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  product TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL DEFAULT 0,
  message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Money the gateway paid to the bank, or COD cash the courier remitted. Entered by staff.
CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('gateway_settlement','cod_remittance','adjustment')),
  amount_paise INTEGER NOT NULL,
  reference TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  entry_date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'manager' CHECK (role IN ('owner','manager','orders','catalogue')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  admin_id INTEGER,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS counters (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
`);

// Small migrations for databases created by earlier versions
const hasColumn = (table, col) => db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
if (!hasColumn('products', 'size_chart')) db.exec(`ALTER TABLE products ADD COLUMN size_chart TEXT NOT NULL DEFAULT ''`);
if (!hasColumn('orders', 'coupon_code')) db.exec(`ALTER TABLE orders ADD COLUMN coupon_code TEXT`);
if (!hasColumn('orders', 'discount_paise')) db.exec(`ALTER TABLE orders ADD COLUMN discount_paise INTEGER NOT NULL DEFAULT 0`);
if (!hasColumn('order_items', 'discount_paise')) db.exec(`ALTER TABLE order_items ADD COLUMN discount_paise INTEGER NOT NULL DEFAULT 0`);
// Admin roles: older databases only allowed 'owner' and 'staff'. Rebuild the table; 'staff' becomes 'manager'.
if (/'staff'\)/.test(db.prepare(`SELECT sql FROM sqlite_master WHERE name = 'admins'`).get()?.sql || '')) {
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN');
  db.exec(`CREATE TABLE admins_new (
    id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'manager' CHECK (role IN ('owner','manager','orders','catalogue')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  db.exec(`INSERT INTO admins_new (id, email, name, password_hash, role, created_at)
    SELECT id, email, name, password_hash, CASE role WHEN 'staff' THEN 'manager' ELSE role END, created_at FROM admins`);
  db.exec('DROP TABLE admins');
  db.exec('ALTER TABLE admins_new RENAME TO admins');
  db.exec('COMMIT');
  db.exec('PRAGMA foreign_keys = ON');
}

// Customer accounts (email one-time-code login)
db.exec(`CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  address TEXT,                  -- JSON of the default delivery address
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
)`);
db.exec(`CREATE TABLE IF NOT EXISTS customer_sessions (
  id TEXT PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
)`);
db.exec(`CREATE TABLE IF NOT EXISTS otp_codes (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  purpose TEXT NOT NULL,         -- signup | login
  payload TEXT NOT NULL DEFAULT '{}',
  attempts INTEGER NOT NULL DEFAULT 0,
  used INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);
db.exec('CREATE INDEX IF NOT EXISTS idx_otp_email ON otp_codes(email)');
if (!hasColumn('orders', 'customer_id')) db.exec('ALTER TABLE orders ADD COLUMN customer_id INTEGER REFERENCES customers(id)');

db.exec(`CREATE TABLE IF NOT EXISTS email_log (
  id INTEGER PRIMARY KEY,
  to_addr TEXT NOT NULL,
  subject TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'other',
  ref TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,          -- sent | failed | skipped
  error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);
db.exec(`CREATE TABLE IF NOT EXISTS coupons (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('percent','flat')),
  value INTEGER NOT NULL,                 -- percent (1-90) or paise
  min_order_paise INTEGER NOT NULL DEFAULT 0,
  max_discount_paise INTEGER NOT NULL DEFAULT 0,   -- 0 = no cap
  starts_on TEXT NOT NULL DEFAULT '',     -- YYYY-MM-DD, India time; empty = no start date
  ends_on TEXT NOT NULL DEFAULT '',
  usage_limit INTEGER NOT NULL DEFAULT 0, -- 0 = unlimited
  per_customer_limit INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

const DEFAULT_SETTINGS = {
  brand_name: 'Vari Fashion',
  store_open: '1',
  cod_enabled: '1',
  max_qty_per_item: '10',
  return_window_days: '7',
  shipping_fee_paise: '9900',
  free_shipping_over_paise: '199900',
  cod_fee_paise: '0',
  payment_hold_minutes: '30',
  whatsapp_number: '919999999999',
  support_email: 'care@example.com',
  order_alert_email: '',
  email_customers: '1',
  support_phone: '+91 99999 99999',
  seller_legal_name: 'Your Business Name (replace)',
  seller_address: 'Full registered address (replace)',
  shop_hours: '',
  seller_state: 'Tamil Nadu',
  seller_gstin: '',
  grievance_officer: 'Name of grievance officer (replace)',
  gst_threshold_paise: '250000',   // per-piece price at which GST moves from low to high rate [verify with CA]
  gst_low_rate: '5',
  gst_high_rate: '18',
  gateway_fee_bps: '236',          // 2% + 18% GST on fee, as basis points. Estimate only.
};

const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insertSetting.run(k, v);

export function getSettings() {
  const out = {};
  for (const r of db.prepare('SELECT key, value FROM settings').all()) out[r.key] = r.value;
  return out;
}
export const setting = (key) => db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value;
export const intSetting = (key) => Number(setting(key) ?? 0);

/** Run fn inside a transaction. node:sqlite is synchronous, so this is safe within one process. */
export function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** Next value of a named counter, for human-friendly order / invoice / return numbers. */
export function nextCounter(name, start = 1000) {
  db.prepare('INSERT OR IGNORE INTO counters (name, value) VALUES (?, ?)').run(name, start);
  db.prepare('UPDATE counters SET value = value + 1 WHERE name = ?').run(name);
  return db.prepare('SELECT value FROM counters WHERE name = ?').get(name).value;
}

export function audit(adminId, action, entity, entityId = '', detail = '') {
  db.prepare('INSERT INTO audit_log (admin_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)')
    .run(adminId ?? null, action, entity, String(entityId), typeof detail === 'string' ? detail : JSON.stringify(detail));
}
