import { db } from '../db.js';

const phUrl = (kind, hex, view = 'front') => `/img/ph/${kind}/${String(hex).replace('#', '')}.svg${view === 'front' ? '' : `?view=${view}`}`;

/** Shape a product row + its variants for the storefront. Stock numbers are hidden beyond "few left". */
export function serializeProduct(p, variants, { forAdmin = false } = {}) {
  const colors = [];
  for (const v of variants) {
    if (!colors.find((c) => c.name === v.color)) colors.push({ name: v.color, hex: v.color_hex });
  }
  const uploaded = JSON.parse(p.images || '[]');
  const imagesFor = (hex) => (uploaded.length ? uploaded : [phUrl(p.silhouette, hex), phUrl(p.silhouette, hex, 'detail'), phUrl(p.silhouette, hex, 'side')]);
  const totalStock = variants.reduce((s, v) => s + v.stock, 0);
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    category: p.category,
    tagline: p.tagline,
    sizeChart: (() => { try { return p.size_chart ? JSON.parse(p.size_chart) : null; } catch { return null; } })(),
    description: p.description,
    fabric: p.fabric,
    care: p.care,
    price: p.price_paise,
    mrp: p.mrp_paise,
    hsn: p.hsn,
    silhouette: p.silhouette,
    soldOut: totalStock === 0,
    colors: colors.map((c) => ({ ...c, images: imagesFor(c.hex) })),
    image: imagesFor(colors[0]?.hex || '#7a6a58')[0],
    variants: variants.map((v) => ({
      id: v.id,
      color: v.color,
      size: v.size,
      sku: v.sku,
      ...(forAdmin ? { stock: v.stock } : { available: v.stock > 0, low: v.stock > 0 && v.stock <= 3 ? v.stock : null }),
    })),
    ...(forAdmin ? {
      active: !!p.active, sort: p.sort, weightGrams: p.weight_grams, images: uploaded,
      similar: JSON.parse(p.similar || '[]'), totalStock,
    } : {}),
  };
}

const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '28', '30', '32', '34', '36', '38', '40', 'Free'];
export const sortVariants = (vs) =>
  vs.sort((a, b) => a.color.localeCompare(b.color) || SIZE_ORDER.indexOf(a.size) - SIZE_ORDER.indexOf(b.size));

export function loadProducts({ activeOnly = true, forAdmin = false } = {}) {
  const products = db.prepare(`SELECT * FROM products ${activeOnly ? 'WHERE active = 1' : ''} ORDER BY sort, id`).all();
  const allVariants = db.prepare('SELECT * FROM variants ORDER BY id').all();
  return products.map((p) => serializeProduct(p, sortVariants(allVariants.filter((v) => v.product_id === p.id)), { forAdmin }));
}

export function loadProduct(where, value, opts = {}) {
  const p = db.prepare(`SELECT * FROM products WHERE ${where} = ?`).get(value);
  if (!p) return null;
  const variants = sortVariants(db.prepare('SELECT * FROM variants WHERE product_id = ?').all(p.id));
  return { row: p, product: serializeProduct(p, variants, opts) };
}

/** Hand-picked similar items, topped up with same-category products when fewer than 4 are chosen. */
export function similarProducts(row, limit = 4) {
  const picked = JSON.parse(row.similar || '[]').map(Number);
  const all = loadProducts();
  const out = picked.map((id) => all.find((p) => p.id === id)).filter(Boolean);
  for (const p of all) {
    if (out.length >= limit) break;
    if (p.id !== row.id && !out.includes(p) && p.category === row.category) out.push(p);
  }
  for (const p of all) {
    if (out.length >= limit) break;
    if (p.id !== row.id && !out.includes(p)) out.push(p);
  }
  return out.slice(0, limit);
}
