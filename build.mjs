// Build: bundles src/ into dist/ with esbuild. `node build.mjs` (production) or `node build.mjs --serve` (dev server on :5173).
// Env: MOMIG_SUPABASE_URL, MOMIG_SUPABASE_ANON_KEY (optional — omit for local-only mode).
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
let esbuild;
try { esbuild = require('esbuild'); } catch { esbuild = require('/opt/npm-tools/node_modules/esbuild'); }

const serve = process.argv.includes('--serve');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
// Public client config (the anon key is designed to be public; row-level security protects data). Env vars override.
const cfg = fs.existsSync('momig.config.json') ? JSON.parse(fs.readFileSync('momig.config.json', 'utf8')) : {};
const supabaseUrl = process.env.MOMIG_SUPABASE_URL || cfg.supabaseUrl || '';
const supabaseAnonKey = process.env.MOMIG_SUPABASE_ANON_KEY || cfg.supabaseAnonKey || '';
const remote = !serve && !process.env.MOMIG_LOCAL && supabaseUrl && supabaseAnonKey;
// Cloudflare Turnstile site key (public). Only used with cloud sync: Supabase Auth checks the token with the secret key.
const turnstileSiteKey = remote ? (process.env.MOMIG_TURNSTILE_SITE_KEY ?? cfg.turnstileSiteKey ?? '') : '';
const version = pkg.version + (serve ? '-dev' : '') + (process.env.GITHUB_SHA ? '+' + process.env.GITHUB_SHA.slice(0, 7) : '');
const out = 'dist';
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.cpSync('public', out, { recursive: true });
// PNG app icons are rendered from public/icon.svg at build time (keeps the repo text-only)
// "any" icons come from icon.svg; "maskable" ones (Android adaptive icons, the Play app's launcher icon)
// from icon-maskable.svg, which keeps the artwork inside the safe zone so no launcher mask crops it
// icon-splash.svg: just the moon and heart on a transparent background, for the Android app's launch screen (not in the web manifest)
const icons = [['icon', 'public/icon.svg'], ['icon-maskable', 'public/icon-maskable.svg'], ['icon-splash', 'public/icon-splash.svg']];
for (const [name, src] of icons) for (const size of [192, 512]) {
  const dest = path.join(out, `${name}-${size}.png`);
  if (fs.existsSync(dest)) continue;
  try { const sharp = require('sharp'); await sharp(fs.readFileSync(src)).resize(size, size).png().toFile(dest); }
  catch { console.warn(`(${name}-${size}.png not generated: install sharp)`); }
}

const opts = {
  entryPoints: ['src/main.tsx'], bundle: true, outdir: out, entryNames: serve ? 'app' : 'app-[hash]', format: 'esm', target: ['es2020', 'safari15'],
  minify: !serve, sourcemap: serve ? 'inline' : false, jsx: 'automatic', loader: { '.json': 'json' }, metafile: true,
  define: {
    'process.env.NODE_ENV': JSON.stringify(serve ? 'development' : 'production'),
    __MOMIG_CONFIG__: JSON.stringify({ supabaseUrl: remote ? supabaseUrl : '', supabaseAnonKey: remote ? supabaseAnonKey : '', version, earlyAccessUntil: process.env.MOMIG_EARLY_ACCESS_UNTIL ?? cfg.earlyAccessUntil ?? '', turnstileSiteKey }),
  },
};

function writeHtml(meta) {
  const outputs = Object.keys(meta.outputs).map(p => path.basename(p));
  const js = outputs.find(f => f.endsWith('.js')), css = outputs.find(f => f.endsWith('.css'));
  const html = fs.readFileSync('index.html', 'utf8').replace('<!--CSS-->', css ? `<link rel="stylesheet" href="./${css}">` : '').replace('<!--JS-->', `<script type="module" src="./${js}"></script>`)
    // Content-Security-Policy: scripts only from this site (+ Turnstile's script and frame when CAPTCHA is on);
    // network only to this site and the Supabase project (no Realtime: Momig polls, so no wss://)
    .replace('__CONNECT_SRC__', remote ? new URL(supabaseUrl).origin : '')
    .replaceAll('__CAPTCHA_SRC__', turnstileSiteKey ? 'https://challenges.cloudflare.com' : '');
  fs.writeFileSync(path.join(out, 'index.html'), html);
  // service worker precache list + versioned cache name
  const sw = fs.readFileSync(path.join(out, 'sw.js'), 'utf8').replace('__VERSION__', version + '-' + Date.now()).replace('__ASSETS__', JSON.stringify(['/', '/index.html', `/${js}`, css && `/${css}`, '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/icon-maskable-192.png', '/icon-maskable-512.png'].filter(Boolean)));
  fs.writeFileSync(path.join(out, 'sw.js'), sw);
}

if (serve) {
  const ctx = await esbuild.context({ ...opts, plugins: [{ name: 'html', setup(b) { b.onEnd(r => r.metafile && writeHtml(r.metafile)); } }] });
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: out, port: 5173, fallback: path.join(out, 'index.html') });
  console.log(`Momig dev server: http://localhost:${port}`);
} else {
  const r = await esbuild.build(opts);
  writeHtml(r.metafile);
  const size = Object.entries(r.metafile.outputs).map(([f, o]) => `${path.basename(f)} ${(o.bytes / 1024).toFixed(1)} kB`).join(', ');
  if (cfg.domain) fs.writeFileSync(path.join(out, 'CNAME'), cfg.domain + '\n');
  console.log('Built dist/:', size, remote ? '(cloud sync: ' + supabaseUrl + ')' : '(local mode — no Supabase anon key set)');
}
