// Builds cat.json: a 12s looping Lottie of a minimal black cat that lies, perks up,
// sits, gets sleepy, flicks its tail and lies back down.
// Run: node films/cat/build.mjs   (also copies the lottie-web player next to the page)

import { copyFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const W = 980, H = 736, FPS = 30, END = 360;
const INK = [0.137, 0.137, 0.137, 1];
const EYE = [0.96, 0.96, 0.96, 1];

const EASE = { o: { x: [0.42], y: [0] }, i: { x: [0.58], y: [1] } };
const SNAP = { o: { x: [0.3], y: [0] }, i: { x: [0.2], y: [1] } };

// keys: [[frame, value, ease?], ...] -> animated Lottie property
function anim(keys, wrap = (v) => v) {
  return {
    a: 1,
    k: keys.map(([t, v, ease = EASE], n) =>
      n === keys.length - 1 ? { t, s: wrap(v) } : { t, s: wrap(v), ...ease }),
  };
}
const still = (k) => ({ a: 0, k });

// Path from [[x, y, inTangent, outTangent], ...]; tangents are relative, default sharp.
function shape(points, closed) {
  return {
    c: closed,
    v: points.map(([x, y]) => [x, y]),
    i: points.map((p) => p[2] ?? [0, 0]),
    o: points.map((p) => p[3] ?? [0, 0]),
  };
}

// Body poses share vertex order: base-left, left ear base, left ear tip, left ear root,
// right ear root, right ear tip, right ear base, base-right.
// Lying with the head turned right: round back on the left, straight right flank.
const LIE_R = shape([
  [405, 460, [0, 0], [6, -40]],
  [447, 379, [-22, 12], [0, 0]],
  [460, 352],
  [474, 375, [0, 0], [28, -7]],
  [540, 377, [-28, -7], [0, 0]],
  [557, 352],
  [571, 406],
  [585, 460],
], true);
// Lying with the head turned left: straight left flank, round back on the right.
const LIE_L = shape([
  [405, 460],
  [416, 406],
  [428, 353],
  [443, 377, [0, 0], [28, -8]],
  [514, 377, [-26, -7], [0, 0]],
  [532, 354],
  [545, 378, [0, 0], [22, 12]],
  [585, 460, [-6, -40], [0, 0]],
], true);
const SIT = shape([
  [402, 460], [421.5, 368.5], [441, 277], [463, 313], [523, 313], [546, 277], [566.5, 368.5], [587, 460],
], true);
// Rise overshoot: a touch taller and narrower before settling.
const SIT_UP = shape([
  [405, 460], [424, 364], [443, 268], [465, 305], [521, 305], [544, 268], [564, 364], [584, 460],
], true);

// Tail: base at the body, a middle, and the tip.
const TAIL_LIE = shape([[408, 455, [0, 0], [-30, 0]], [350, 453, [22, 0], [-20, 0]], [312, 449, [8, 2]]], false);
const TAIL_HOOK = shape([[408, 455, [0, 0], [-30, 0]], [348, 451, [22, 0], [-20, 0]], [314, 438, [4, 10]]], false);
const TAIL_SIT = shape([[410, 455, [0, 0], [-24, 0]], [358, 439, [18, 0], [-18, 0]], [320, 449, [8, -8]]], false);
const TAIL_SWAY = shape([[410, 455, [0, 0], [-24, 0]], [360, 450, [18, 0], [-18, 0]], [318, 441, [10, 4]]], false);
const TAIL_CURL = shape([[410, 455, [0, 0], [-26, 0]], [348, 456, [22, 0], [-18, -2]], [318, 430, [2, 18]]], false);

// Eyes: [frame, centerX, centerY, gap]
const EYES = [
  [0, 517, 423, 38], [40, 517, 423, 38], [52, 466, 423, 38], [80, 466, 423, 38],
  [94, 479, 341, 38], [102, 479, 349, 38], [128, 479, 349, 38], [134, 468, 349, 38],
  [150, 468, 349, 38], [156, 479, 349, 38], [240, 479, 349, 38], [258, 517, 423, 38],
  [300, 517, 423, 38], [316, 466, 423, 38], [344, 466, 423, 38], [358, 517, 423, 38],
  [360, 517, 423, 38],
];

// Eye openness (% open; above 100 widens the eye): sleepy start, blinks, a long squint,
// then wide awake.
// The loop ends sleepy again so frame 360 meets frame 0.
const SQUINT = 42;
function blink(f) { return [[f - 3, 100], [f, 8, SNAP], [f + 4, 100]]; }
const OPEN = [
  [0, SQUINT], [16, SQUINT], [22, 100], ...blink(66), ...blink(112),
  [160, 100], [168, SQUINT], [184, SQUINT], [188, 8], [194, SQUINT], [206, SQUINT],
  [212, 120, SNAP], [222, 100], ...blink(282), ...blink(326), [348, 100], [358, SQUINT], [360, SQUINT],
];

const BODY = [
  [0, LIE_R], [40, LIE_R], [52, LIE_L], [80, LIE_L], [94, SIT_UP], [102, SIT],
  [240, SIT], [258, LIE_R], [300, LIE_R], [316, LIE_L], [344, LIE_L], [358, LIE_R], [360, LIE_R],
];
const TAIL = [
  [0, TAIL_HOOK], [40, TAIL_HOOK], [56, TAIL_LIE], [80, TAIL_LIE], [100, TAIL_SIT], [130, TAIL_SWAY], [160, TAIL_SIT],
  [190, TAIL_SWAY], [208, TAIL_SIT], [218, TAIL_CURL, SNAP], [236, TAIL_CURL], [258, TAIL_HOOK],
  [300, TAIL_HOOK], [316, TAIL_LIE], [344, TAIL_LIE], [358, TAIL_HOOK], [360, TAIL_HOOK],
];

function transform(p) {
  return { ty: 'tr', p, a: still([0, 0]), s: still([100, 100]), r: still(0), o: still(100), sk: still(0), sa: still(0) };
}
const EYE_R = 9;
// Eye as one path: a circle whose top is cut flat by a lowering lid.
// v is % open; the lid covers (1 - v/100) of the diameter.
function eyePath(v) {
  const r = EYE_R, c = 1 - Math.min(v, 100) / 100;
  const y = -r + 2 * r * c, w = Math.sqrt(Math.max(r * r - y * y, 0));
  const th = Math.atan2(y, w), L = (4 / 3) * Math.tan((Math.PI / 2 - th) / 4) * r;
  const down = [-L * Math.sin(th), L * Math.cos(th)];
  return shape([
    [0, y, [-w / 3, 0], [w / 3, 0]],
    [w, y, [-w / 3, 0], down],
    [0, r, [L, 0], [-L, 0]],
    [-w, y, [-down[0], down[1]], [w / 3, 0]],
  ], true);
}
function eye(side) {
  return {
    ty: 'gr', nm: side < 0 ? 'eye L' : 'eye R',
    it: [
      { ty: 'sh', ks: anim(OPEN, (v) => [eyePath(v)]) },
      { ty: 'fl', c: still(EYE), o: still(100), r: 1 },
      {
        ...transform(anim(EYES.map(([t, x, y, gap]) => [t, [x + (side * gap) / 2, y]]))),
        s: anim(OPEN, (v) => [Math.max(v, 100), Math.max(v, 100)]),
      },
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
      it: [{ ty: 'sh', ks: anim(BODY, (v) => [v]) }, { ty: 'fl', c: still(INK), o: still(100), r: 1 }, transform(still([0, 0]))],
    },
    {
      ty: 'gr', nm: 'tail',
      it: [
        { ty: 'sh', ks: anim(TAIL, (v) => [v]) },
        { ty: 'st', c: still(INK), o: still(100), w: still(15), lc: 2, lj: 2 },
        transform(still([0, 0])),
      ],
    },
  ],
};

const lottie = { v: '5.12.0', nm: 'cat', fr: FPS, ip: 0, op: END, w: W, h: H, ddd: 0, assets: [], layers: [cat] };
writeFileSync(path.join(here, 'cat.json'), JSON.stringify(lottie));
copyFileSync(path.join(here, '../../node_modules/lottie-web/build/player/lottie_svg.min.js'), path.join(here, 'lottie_svg.min.js'));
console.log(`cat.json: ${W}x${H}, ${END / FPS}s @ ${FPS}fps`);
