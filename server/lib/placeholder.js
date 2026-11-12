// Generates clean SVG product placeholders (garment silhouette in the variant colour) until real photos are uploaded.

const SHAPES = {
  shirt: 'M200 150 L262 124 Q300 160 338 124 L400 150 L486 252 L436 300 L404 268 L404 660 L196 660 L196 268 L164 300 L114 252 Z',
  tee: 'M196 160 L258 130 Q300 168 342 130 L404 160 L478 236 L430 282 L404 256 L404 650 L196 650 L196 256 L170 282 L122 236 Z',
  kurta: 'M214 140 L266 120 Q300 168 334 120 L386 140 L452 380 L414 392 L386 268 L398 724 L202 724 L214 268 L186 392 L148 380 Z',
  dress: 'M238 120 Q300 168 362 120 L384 132 L372 310 L476 712 L124 712 L228 310 L216 132 Z',
  trousers: 'M206 120 L394 120 L410 716 L322 716 L300 270 L278 716 L190 716 Z',
  jacket: 'M196 150 L256 120 L300 210 L344 120 L404 150 L494 270 L446 316 L410 284 L410 666 L190 666 L190 284 L154 316 L106 270 Z',
};

const DETAILS = {
  shirt: '<line x1="300" y1="160" x2="300" y2="660" stroke="rgba(0,0,0,.18)" stroke-width="3"/>' +
    [230, 300, 370, 440, 510, 580].map((y) => `<circle cx="300" cy="${y}" r="5" fill="rgba(255,255,255,.55)"/>`).join(''),
  kurta: '<line x1="300" y1="160" x2="300" y2="300" stroke="rgba(0,0,0,.2)" stroke-width="3"/>',
  jacket: '<path d="M300 210 L300 666" stroke="rgba(0,0,0,.25)" stroke-width="3"/><path d="M256 120 L300 330 L344 120" fill="none" stroke="rgba(0,0,0,.18)" stroke-width="3"/>',
  trousers: '<line x1="300" y1="120" x2="300" y2="260" stroke="rgba(0,0,0,.2)" stroke-width="3"/><line x1="206" y1="150" x2="394" y2="150" stroke="rgba(0,0,0,.15)" stroke-width="3"/>',
  dress: '<path d="M228 310 Q300 330 372 310" fill="none" stroke="rgba(0,0,0,.18)" stroke-width="3"/>',
  tee: '',
};

function mix(hex, toward, amount) {
  const h = hex.replace('#', '');
  const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  const t = toward === 'white' ? 255 : 0;
  return '#' + c.map((v) => Math.round(v + (t - v) * amount).toString(16).padStart(2, '0')).join('');
}

export function placeholderSvg(kind, hex, view = 'front') {
  const color = /^[0-9a-f]{6}$/i.test(hex) ? `#${hex}` : '#7a6a58';
  const shape = SHAPES[kind] || SHAPES.shirt;
  const bg = mix(color, 'white', 0.86);
  const bg2 = mix(color, 'white', 0.74);
  const zoom = view === 'detail' ? 'transform="translate(-300 -260) scale(2)"' : view === 'side' ? 'transform="translate(600 0) scale(-1 1)"' : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 800" preserveAspectRatio="xMidYMid slice">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${bg}"/><stop offset="1" stop-color="${bg2}"/></linearGradient>
    <linearGradient id="sh" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="rgba(255,255,255,.22)"/><stop offset=".55" stop-color="rgba(255,255,255,0)"/><stop offset="1" stop-color="rgba(0,0,0,.22)"/></linearGradient>
    <pattern id="weave" width="6" height="6" patternUnits="userSpaceOnUse"><path d="M0 0H6M0 3H6" stroke="rgba(0,0,0,.06)" stroke-width="1"/><path d="M0 0V6" stroke="rgba(255,255,255,.05)"/></pattern>
    <filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="#000" flood-opacity=".18"/></filter>
  </defs>
  <rect width="600" height="800" fill="url(#bg)"/>
  <ellipse cx="300" cy="752" rx="190" ry="16" fill="rgba(0,0,0,.08)"/>
  <g ${zoom}>
    <path d="${shape}" fill="${color}" filter="url(#soft)"/>
    <path d="${shape}" fill="url(#weave)"/>
    <path d="${shape}" fill="url(#sh)"/>
    ${DETAILS[kind] || ''}
  </g>
</svg>`;
}
