// Sample catalogue so the store works on first start. Replace with real products from Admin > Products.
import { pathToFileURL } from 'node:url';
import { db, tx } from './db.js';

const C = {
  ivory: ['Ivory', '#EDE6D8'], indigo: ['Indigo', '#2E3A5C'], rust: ['Rust', '#A4502F'], sage: ['Sage', '#8A9A7B'],
  charcoal: ['Charcoal', '#3A3836'], sand: ['Sand', '#C9B48F'], olive: ['Olive', '#5E6240'], wine: ['Wine', '#6B2737'],
  sky: ['Sky', '#9DB4C8'], black: ['Black', '#1E1C1B'], ochre: ['Ochre', '#C08A2D'], white: ['White', '#F6F4EF'],
};
const TOP = ['S', 'M', 'L', 'XL', 'XXL'];
const BOTTOM = ['28', '30', '32', '34', '36'];

const P = [
  ['Handloom Oxford Shirt', 'Shirts', 'shirt', 2490, 2990, '6205', [C.ivory, C.sky, C.indigo], TOP, 'Loom-textured cotton, cut for every day.'],
  ['Indigo Resist Shirt', 'Shirts', 'shirt', 3290, 3690, '6205', [C.indigo], TOP, 'Hand-dyed indigo with a quiet resist print.'],
  ['Linen Band-Collar Shirt', 'Shirts', 'shirt', 2790, 2790, '6205', [C.white, C.sage, C.sand], TOP, 'Pure linen that softens with every wash.'],
  ['Khadi Overshirt', 'Shirts', 'shirt', 3890, 4290, '6205', [C.olive, C.charcoal], TOP, 'Hand-spun khadi, heavy enough to layer.'],
  ['Chambray Work Shirt', 'Shirts', 'shirt', 2190, 2490, '6205', [C.sky, C.indigo], TOP, 'Twin pockets, triple-stitched seams.'],
  ['Mul Cotton Straight Kurta', 'Kurtas', 'kurta', 2290, 2590, '6211', [C.ivory, C.rust, C.sage], TOP, 'Feather-light mul for long summer days.'],
  ['Block-Print Long Kurta', 'Kurtas', 'kurta', 2690, 2990, '6211', [C.ochre, C.indigo], TOP, 'Hand-carved wooden blocks, printed by hand.'],
  ['Chanderi Festive Kurta', 'Kurtas', 'kurta', 4890, 5490, '6211', [C.wine, C.ivory], TOP, 'Sheer chanderi with a soft zari edge.'],
  ['Pathani Kurta', 'Kurtas', 'kurta', 2990, 2990, '6211', [C.charcoal, C.sand, C.white], TOP, 'Structured cotton with a sharp collar.'],
  ['Tiered Cotton Dress', 'Dresses', 'dress', 3190, 3590, '6204', [C.rust, C.ivory], ['XS', 'S', 'M', 'L', 'XL'], 'Three tiers of gathered cotton voile.'],
  ['Ajrakh Wrap Dress', 'Dresses', 'dress', 4290, 4790, '6204', [C.indigo, C.wine], ['XS', 'S', 'M', 'L', 'XL'], 'Natural-dye ajrakh, wrapped and tied.'],
  ['Linen Shift Dress', 'Dresses', 'dress', 3590, 3590, '6204', [C.sand, C.black, C.sage], ['XS', 'S', 'M', 'L', 'XL'], 'A clean shift in breathable linen.'],
  ['Pleated Linen Trousers', 'Trousers', 'trousers', 2890, 3290, '6203', [C.sand, C.charcoal], BOTTOM, 'Double pleats, a relaxed straight leg.'],
  ['Handloom Drawstring Pants', 'Trousers', 'trousers', 1990, 2290, '6203', [C.ivory, C.olive, C.indigo], BOTTOM, 'Soft handloom with an easy drawstring waist.'],
  ['Selvedge Denim Jeans', 'Trousers', 'trousers', 4490, 4990, '6203', [C.indigo, C.black], BOTTOM, 'Raw selvedge denim that fades to you.'],
  ['Quilted Kantha Jacket', 'Jackets', 'jacket', 6490, 6990, '6201', [C.rust, C.indigo], TOP, 'Layers of cotton, running-stitched by hand.'],
  ['Nehru Jacket', 'Jackets', 'jacket', 3990, 4490, '6203', [C.charcoal, C.wine, C.sand], TOP, 'Mandarin collar, cut close to the body.'],
  ['Organic Cotton Tee', 'Tees', 'tee', 1290, 1290, '6109', [C.white, C.black, C.sage, C.rust], TOP, 'Heavyweight organic jersey, garment-dyed.'],
  ['Slub Henley Tee', 'Tees', 'tee', 1490, 1690, '6109', [C.sand, C.charcoal], TOP, 'Irregular slub yarn with a three-button placket.'],
  ['Pocket Tee — Natural Dye', 'Tees', 'tee', 1690, 1890, '6109', [C.ochre, C.indigo, C.sage], TOP, 'Coloured with plants, not petrochemicals.'],
];

const slug = (s) => s.toLowerCase().replace(/[—–]/g, '').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');

export function seedIfEmpty() {
  if (db.prepare('SELECT COUNT(*) n FROM products').get().n > 0) return false;
  tx(() => {
    const addP = db.prepare(`INSERT INTO products (slug, name, category, tagline, description, fabric, care, price_paise, mrp_paise, hsn, silhouette, sort, weight_grams)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const addV = db.prepare('INSERT INTO variants (product_id, color, color_hex, size, sku, stock) VALUES (?, ?, ?, ?, ?, ?)');
    P.forEach(([name, cat, sil, price, mrp, hsn, colors, sizes, tagline], i) => {
      const s = slug(name);
      const id = Number(addP.run(s, name, cat, tagline,
        `${tagline} Made in small batches by our partner workshops. Each piece is checked by hand before it leaves us. This is sample text: replace it with your real product story in Admin > Products.`,
        cat === 'Trousers' ? '100% cotton (sample — replace)' : '100% cotton handloom (sample — replace)',
        'Gentle machine wash cold, inside out. Dry in shade. Warm iron.',
        price * 100, mrp * 100, hsn, sil, i, sil === 'jacket' ? 800 : 400).lastInsertRowid);
      colors.forEach(([cname, hex], ci) => sizes.forEach((size, si) => {
        const stock = (i * 7 + ci * 5 + si * 3) % 11 === 0 ? 0 : ((i + ci + si) % 4) * 4 + 2;
        addV.run(id, cname, hex, size, `${s.slice(0, 12).toUpperCase()}-${cname.slice(0, 3).toUpperCase()}-${size}`, stock);
      }));
    });
  });
  console.log(`[seed] Added ${P.length} sample products.`);
  return true;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) seedIfEmpty();
