#!/usr/bin/env node
// Render a time-pure HTML film to H.264, or one frame per beat as a contact sheet.
//
// Page contract:
//   window.FILM = { width, height, duration, fps }   (CLI flags override)
//   window.seek(t)  paints frame t (seconds); may return a promise.
//   window.RENDER   is true while rendering, so the page can skip its preview loop.
//
// Usage:
//   node render.mjs [--page index.html] [--out out/film.mp4] [--audio score.wav]
//   node render.mjs --sheet [--beats beats.json] [--cols 6] [--out out/sheet.png]
//   Other flags: --width --height --duration --fps --from (seconds) --no-check

import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchBrowser } from './browser.mjs';

const { values: opt } = parseArgs({
  options: {
    page: { type: 'string', default: 'index.html' },
    out: { type: 'string' },
    audio: { type: 'string' },
    width: { type: 'string' },
    height: { type: 'string' },
    duration: { type: 'string' },
    fps: { type: 'string' },
    from: { type: 'string', default: '0' },
    sheet: { type: 'boolean', default: false },
    beats: { type: 'string', default: 'beats.json' },
    cols: { type: 'string', default: '6' },
    'no-check': { type: 'boolean', default: false },
  },
});

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
  '.otf': 'font/otf', '.wav': 'audio/wav', '.mp3': 'audio/mpeg',
};

// Serve the page's folder over http so ES modules, fonts and fetch() work.
function serve(root) {
  const server = createServer(async (req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.join(root, rel);
    if (!file.startsWith(root)) return res.writeHead(403).end();
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function run(cmd, args, { input } = {}) {
  const child = spawn(cmd, args, { stdio: [input ? 'pipe' : 'ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (d) => (stderr += d));
  const done = new Promise((resolve, reject) =>
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}\n${stderr.slice(-2000)}`)))),
  );
  return { stdin: child.stdin, done };
}

// Flags determinism hazards the render contract bans.
function guard() {
  window.RENDER = true;
  const hits = (window.__violations = {});
  const wrap = (obj, name) => {
    const orig = obj[name];
    obj[name] = function (...args) {
      if (document.readyState === 'complete') hits[name] = (hits[name] ?? 0) + 1;
      return orig.apply(this, args);
    };
  };
  wrap(Math, 'random');
  wrap(window, 'requestAnimationFrame');
  wrap(window, 'setTimeout');
  wrap(window, 'setInterval');
}

const pagePath = path.resolve(opt.page);
const server = await serve(path.dirname(pagePath));
const url = `http://127.0.0.1:${server.address().port}/${path.basename(pagePath)}`;
const browser = await launchBrowser();

try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  await page.addInitScript(guard);
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto(url, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);

  const film = (await page.evaluate(() => window.FILM)) ?? {};
  const width = Number(opt.width ?? film.width ?? 1920);
  const height = Number(opt.height ?? film.height ?? 1080);
  const fps = Number(opt.fps ?? film.fps ?? 30);
  const duration = Number(opt.duration ?? film.duration);
  if (!(duration > 0)) throw new Error('No duration: set window.FILM.duration or pass --duration');
  if (width % 2 || height % 2) throw new Error(`yuv420p needs even dimensions, got ${width}x${height}`);
  if (!(await page.evaluate(() => typeof window.seek === 'function'))) throw new Error('Page has no window.seek(t)');
  await page.setViewportSize({ width, height });

  const shoot = async (t) => {
    await page.evaluate((t) => window.seek(t), t);
    return page.screenshot({ type: 'png' });
  };

  // Pure function of time: frame t must not depend on what was painted before it.
  if (!opt['no-check']) {
    for (const t of [duration * 0.37, duration * 0.71].map((t) => Math.round(t * fps) / fps)) {
      const a = await shoot(t);
      await shoot(0);
      await shoot(duration * 0.9);
      if (!a.equals(await shoot(t))) console.warn(`warning: frame at ${t.toFixed(3)}s changes with seek history (state carried between frames?)`);
    }
    const css = await page.evaluate(() => document.getAnimations().length);
    if (css) console.warn(`warning: ${css} CSS animation(s)/transition(s) running; drive motion from seek(t) instead`);
  }

  if (opt.sheet) {
    const out = path.resolve(opt.out ?? 'out/sheet.png');
    const dir = `${out}.frames`;
    let times;
    try {
      times = JSON.parse(await readFile(path.resolve(opt.beats), 'utf8')).beats.filter((t) => t < duration);
    } catch {
      console.warn(`warning: no usable ${opt.beats}; sampling every 0.5s instead`);
      times = Array.from({ length: Math.floor(duration * 2) }, (_, i) => i / 2);
    }
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    for (const [i, t] of times.entries()) {
      await page.evaluate((t) => window.seek(t), t);
      // Sheet-only label so each tile can be matched to its beat.
      await page.evaluate(([i, t]) => {
        const el = document.createElement('div');
        el.id = '__sheet_label';
        el.textContent = `#${i}  ${t.toFixed(2)}s`;
        el.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;padding:6px 10px;' +
          'font:600 28px/1 monospace;background:#000;color:#fff';
        document.body.append(el);
      }, [i, t]);
      await writeFile(path.join(dir, `${String(i).padStart(4, '0')}.png`), await page.screenshot({ type: 'png' }));
      await page.evaluate(() => document.getElementById('__sheet_label')?.remove());
    }
    const cols = Math.min(Number(opt.cols), times.length);
    const rows = Math.ceil(times.length / cols);
    const thumb = width >= height ? 480 : 270;
    await run('ffmpeg', [
      '-y', '-loglevel', 'error', '-start_number', '0', '-i', path.join(dir, '%04d.png'),
      '-vf', `scale=${thumb}:-2,tile=${cols}x${rows}:padding=6:margin=6:color=0x202020`,
      '-frames:v', '1', out,
    ]).done;
    console.log(`sheet: ${times.length} frames -> ${out} (full frames in ${dir})`);
  } else {
    const out = path.resolve(opt.out ?? 'out/film.mp4');
    await mkdir(path.dirname(out), { recursive: true });
    const first = Math.round(Number(opt.from) * fps);
    const total = Math.round(duration * fps);
    const audio = opt.audio ? ['-ss', String(first / fps), '-i', path.resolve(opt.audio)] : [];
    const ff = run('ffmpeg', [
      '-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-', ...audio,
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      ...(opt.audio ? ['-c:a', 'aac', '-b:a', '192k', '-shortest'] : []),
      out,
    ], { input: true });
    const started = Date.now();
    for (let i = first; i < total; i++) {
      const png = await shoot(i / fps);
      if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once('drain', r));
      if ((i - first) % fps === 0) process.stdout.write(`\rframe ${i + 1}/${total}`);
    }
    ff.stdin.end();
    await ff.done;
    console.log(`\rrendered ${total - first} frames (${width}x${height} @ ${fps}fps) in ${((Date.now() - started) / 1000).toFixed(1)}s -> ${out}`);
  }

  const violations = await page.evaluate(() => window.__violations);
  for (const [name, n] of Object.entries(violations)) console.warn(`warning: ${name} called ${n}x after load in render mode`);
} finally {
  await browser.close();
  server.close();
}
