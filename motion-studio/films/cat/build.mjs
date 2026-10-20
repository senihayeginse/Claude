// Builds cat.json: a 9s looping Lottie of a minimal black cat, driven frame by frame
// from tracks.json (measured from the reference video by track.py). It starts sitting.
// Run: node films/cat/build.mjs   (also copies the lottie-web player next to the page)

import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const tracks = JSON.parse(readFileSync(path.join(here, 'tracks.json'), 'utf8'));
const W = 980, H = 736, FPS = tracks.fps, END = tracks.frames;
const INK = [0.137, 0.137, 0.137, 1];
const EYE = [0.96, 0.96, 0.96, 1];
const TAIL_W = 20;
const GROUND = 461; // y of the body's flat base

const still = (k) => ({ a: 0, k });
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Path from [[x, y, inTangent, outTangent], ...]; tangents are relative, default sharp.
function shape(points, closed) {
  return {
    c: closed,
    v: points.map(([x, y]) => [x, y]),
    i: points.map((p) => p[2] ?? [0, 0]),
    o: points.map((p) => p[3] ?? [0, 0]),
  };
}
function mixShape(a, b, t) {
  const mix = (pa, pb) => pa.map((p, n) => [lerp(p[0], pb[n][0], t), lerp(p[1], pb[n][1], t)]);
  return { c: a.c, v: mix(a.v, b.v), i: mix(a.i, b.i), o: mix(a.o, b.o) };
}

// Body poses share vertex order: base-left, left ear base, left ear tip, left ear root,
// right ear root, right ear tip, right ear base, base-right.
// Lying with the head turned right: round back on the left, straight right flank.
const LIE_R = shape([
  [406, 461, [0, 0], [0, -45]],
  [449, 381, [-18, 13], [0, 0]],
  [454, 355],
  [468, 375, [0, 0], [24, -5]],
  [541, 384, [-24, -10], [0, 0]],
  [558, 355],
  [572, 408],
  [586, 461],
], true);
// Lying with the head turned left: straight left flank, round back on the right.
const LIE_L = shape([
  [404, 461],
  [417, 408],
  [430, 354],
  [449, 383, [0, 0], [20, -8]],
  [521, 376, [-20, -4], [0, 0]],
  [532, 354],
  [541, 381, [0, 0], [14, 4]],
  [582, 461, [0, -38], [0, 0]],
], true);
const SIT = shape([
  [402, 461], [421.5, 369], [441, 277], [463, 314], [523, 314], [546, 277], [567, 369], [588, 461],
], true);

// Body from the measured ear tips: the right ear's height says how far the cat has
// risen, its x says which way the lying head faces; each tip then sits where measured.
// The ears reach their full sitting height early in the rise, so the ear roots
// follow the tips on a faster curve than the rest of the outline.
// The left ear is only read while sitting (it flicks); lying, it reads unreliably.
function body({ earL, earR }) {
  const rise = (356 - earR[1]) / (356 - 278);
  const face = clamp((earR[0] - 532) / (558 - 532), 0, 1);
  const lie = mixShape(LIE_L, LIE_R, face);
  const s = mixShape(lie, SIT, rise);
  // Curves straighten into the sitting outline faster than the points travel.
  const fast = mixShape(lie, SIT, Math.sqrt(clamp(rise, 0, 1)));
  s.i = fast.i;
  s.o = fast.o;
  if (rise > 0.5) s.v[2] = [earL[0], earL[1] - 1];
  // Just after lying down the back is still puffed up a few px; the tracker sees this
  // as the left ear tip dropping below its resting height.
  const puff = rise < 0.5 ? clamp((earL[1] - 356) / 17, 0, 1) : 0;
  s.v[1] = [s.v[1][0] - puff, s.v[1][1] - 2 * puff];
  s.v[3][1] -= 3 * puff;
  s.v[4][1] -= 3 * puff;
  s.v[5] = [earR[0], earR[1] - 1];
  const ears = Math.sqrt(clamp(rise, 0, 1));
  for (const [root, tip] of [[3, 2], [4, 5]]) {
    const drop = lerp(lie.v[root][1] - lie.v[tip][1], SIT.v[root][1] - SIT.v[tip][1], ears);
    s.v[root][1] = s.v[tip][1] + drop;
  }
  return s;
}

// Eye. A blink squashes the circle about its centre; the sleepy squint instead drops a
// flat lid onto a circle resting on the lower edge. A closing eye whose middle stays
// where the open eye's was is a blink, otherwise a squint.
const isBlink = ({ top, bottom, cy }) => Math.abs((top + bottom) / 2 - cy) <= 1.5;
function eyePath(e) {
  const r = (e.w + 1) / 2;
  if (isBlink(e)) {
    const sy = Math.max(e.bottom - e.top, 0.2) / (2 * r);
    return lidded(r, 0, sy);
  }
  return lidded(r, clamp(e.top - (e.bottom - 2 * r), 0, 2 * r), 1);
}
// Circle of radius r around (0, 0), top cut flat `cut` px down, then scaled by sy vertically.
function lidded(r, cut, sy) {
  const y = -r + cut, wid = Math.sqrt(Math.max(r * r - y * y, 0));
  const th = Math.atan2(y, wid), L = (4 / 3) * Math.tan((Math.PI / 2 - th) / 4) * r;
  const down = [-L * Math.sin(th), L * Math.cos(th) * sy];
  return shape([
    [0, y * sy, [-wid / 3, 0], [wid / 3, 0]],
    [wid, y * sy, [-wid / 3, 0], down],
    [0, r * sy, [L, 0], [-L, 0]],
    [-wid, y * sy, [-down[0], down[1]], [wid / 3, 0]],
  ], true);
}
const eyeCentre = (e) => [e.x, isBlink(e) ? (e.top + e.bottom) / 2 : e.bottom - (e.w + 1) / 2];

// Tail: smooth curve from the round tip through the measured centreline, ending
// well inside the body so the join never shows.
const TAIL_AT = [330, 350, 370, 390];
function tailPath({ tip, tail }) {
  const xs = Object.keys(tail).map(Number).filter((x) => x > tip[0] + 2).sort((a, b) => a - b);
  const at = (x) => {
    const lo = xs.filter((k) => k <= x).pop() ?? xs[0];
    const hi = xs.find((k) => k >= x) ?? xs[xs.length - 1];
    return lo === hi ? tail[lo] : lerp(tail[lo], tail[hi], (x - lo) / (hi - lo));
  };
  // Near the body the tail lies on the floor: its lower edge runs flush with the
  // flat base of the body instead of bulging below it.
  const floor = GROUND - TAIL_W / 2 - 0.5;
  const pts = [tip, ...TAIL_AT.map((x) => [x, x >= 370 ? Math.min(at(x), floor) : at(x)]), [412, floor], [436, floor]];
  // Catmull-Rom through the points, as cubic tangents.
  return shape(pts.map((p, n) => {
    const a = pts[Math.max(n - 1, 0)], b = pts[Math.min(n + 1, pts.length - 1)];
    const t = [(b[0] - a[0]) / 6, n >= pts.length - 2 ? 0 : (b[1] - a[1]) / 6]; // flat where it meets the body
    return [p[0], p[1], [-t[0], -t[1]], t];
  }), false);
}

// Per-frame values -> the fewest linear keyframes that stay within tol of every frame.
const LINEAR = { o: { x: [0], y: [0] }, i: { x: [1], y: [1] } };
const flat = (v) => (Array.isArray(v) ? v.flatMap(flat) : typeof v === 'object' ? [...flat(v.v), ...flat(v.i), ...flat(v.o)] : [v]);
function keyed(values, wrap, tol) {
  const f = values.map(flat);
  const keys = [0];
  let a = 0;
  while (a < values.length - 1) {
    let b = a + 1;
    while (b + 1 < values.length) {
      const c = b + 1;
      const fits = f.slice(a + 1, c).every((row, k) => row.every((v, j) =>
        Math.abs(v - lerp(f[a][j], f[c][j], (k + 1) / (c - a))) <= tol));
      if (!fits) break;
      b = c;
    }
    keys.push(b);
    a = b;
  }
  return {
    a: 1,
    k: keys.map((t, n) => (n === keys.length - 1 ? { t, s: wrap(values[t]) } : { t, s: wrap(values[t]), ...LINEAR })),
  };
}

// One loop: frames 0..END-1 from the tracks, plus frame END equal to frame 0.
const rows = [...tracks.rows, tracks.rows[0]];
const shapeKeys = (fn, tol) => keyed(rows.map(fn), (v) => [v], tol);

function transform(p) {
  return { ty: 'tr', p, a: still([0, 0]), s: still([100, 100]), r: still(0), o: still(100), sk: still(0), sa: still(0) };
}
function eye(side) {
  const dx = side > 0 ? tracks.gap : 0;
  return {
    ty: 'gr', nm: side < 0 ? 'eye L' : 'eye R',
    it: [
      { ty: 'sh', ks: shapeKeys((r) => eyePath(r.eye), 0.15) },
      { ty: 'fl', c: still(EYE), o: still(100), r: 1 },
      transform(keyed(rows.map((r) => { const [x, y] = eyeCentre(r.eye); return [x + dx, y]; }), (v) => v, 0.3)),
    ],
  };
}

const cat = {
  ty: 4, nm: 'cat', ind: 1, ip: 0, op: END, st: 0, sr: 1, ao: 0, bm: 0, ddd: 0,
  ks: { o: still(100), r: still(0), p: still([0, 0, 0]), a: still([0, 0, 0]), s: still([100, 100, 100]) },
  shapes: [
    eye(-1),
    eye(1),
    {
      ty: 'gr', nm: 'body',
      it: [{ ty: 'sh', ks: shapeKeys(body, 0.6) }, { ty: 'fl', c: still(INK), o: still(100), r: 1 }, transform(still([0, 0]))],
    },
    {
      ty: 'gr', nm: 'tail',
      it: [
        { ty: 'sh', ks: shapeKeys(tailPath, 0.6) },
        { ty: 'st', c: still(INK), o: still(100), w: still(TAIL_W), lc: 2, lj: 2 },
        transform(still([0, 0])),
      ],
    },
  ],
};

const lottie = { v: '5.12.0', nm: 'cat', fr: FPS, ip: 0, op: END, w: W, h: H, ddd: 0, assets: [], layers: [cat] };
// Two decimals is far below a pixel and halves the file.
writeFileSync(path.join(here, 'cat.json'), JSON.stringify(lottie, (k, v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v)));
copyFileSync(path.join(here, '../../node_modules/lottie-web/build/player/lottie_svg.min.js'), path.join(here, 'lottie_svg.min.js'));
const nKeys = (p) => p.k.length;
console.log(`cat.json: ${W}x${H}, ${END / FPS}s @ ${FPS}fps; keys: body ${nKeys(cat.shapes[2].it[0].ks)}, ` +
  `tail ${nKeys(cat.shapes[3].it[0].ks)}, eye ${nKeys(cat.shapes[0].it[0].ks)}`);
