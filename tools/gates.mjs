// Release gates. Exit 0 only when every gate passes. Run after `npm run build`.
import { readFileSync, readdirSync, statSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, dirname, relative, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { build } from './build.mjs';
import { validate, isStated, get, b58encode, isSolAddress, deriveHandle, renderSlots } from '../src/render.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const read = (p) => readFileSync(p, 'utf8');
const register = JSON.parse(read(join(ROOT, 'register/register.json')));

const results = [];
let current = '';
const gate = (name, fn) => { current = name; results.push({ name, checks: 0, fails: [] }); try { fn(); } catch (e) { fail('threw: ' + (e.stack || e)); } };
const R = () => results[results.length - 1];
const check = (cond, msg) => { R().checks++; if (!cond) R().fails.push(msg); };
const fail = (msg) => { R().checks++; R().fails.push(msg); };

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    if (['node_modules', '.git'].includes(n)) continue;
    const p = join(dir, n);
    statSync(p).isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
}
const TEXT_EXT = new Set(['.html', '.css', '.js', '.mjs', '.json', '.svg', '.md', '.txt', '.py', '']);
const textFiles = (dir) => walk(dir).filter((f) => TEXT_EXT.has(extname(f)) || f.endsWith('LICENSE') || f.endsWith('_headers'));

if (!existsSync(join(DIST, 'index.html'))) { console.error('dist/index.html missing. Run npm run build first.'); process.exit(2); }

/* ------------------------------------------------------------------ helpers */
const openTag = (html, re) => { const m = html.match(re); return m ? m[0] : null; };
const attr = (tag, name) => { const m = tag && tag.match(new RegExp(`\\s${name}="([^"]*)"`)); return m ? m[1].replace(/&amp;/g, '&') : null; };
const caBlock = (html) => { const m = html.match(/<(button|div) [^>]*class="ca[^"]*"[^>]*id="ca"[\s\S]*?<\/\1>/); return m ? m[0] : null; };
const socialTag = (html, id) => openTag(html, new RegExp(`<(a|span) class="social[^"]*" data-record="${id}"[^>]*>`));
const textOf = (s) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

export function scanAddresses(text, reg) {
  const known = new Set();
  for (const r of reg.records) if (isStated(r)) for (const k of ['value', 'url', 'rpc', 'boosts', 'pairs']) if (r[k]) known.add(r[k]);
  const knownText = [...known].join(' ');
  const bad = [];
  for (const m of text.matchAll(/\b0x[0-9a-fA-F]{40}\b|\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g)) {
    if (!knownText.includes(m[0])) bad.push(m[0]);
  }
  return bad;
}

const rndHandle = () => 'h' + randomBytes(5).toString('hex');
const rndAddr = () => b58encode(randomBytes(32));

/* ------------------------------------------------------------------ 1 dist shape */
gate('dist: shape and exclusions', () => {
  const files = walk(DIST).map((f) => relative(DIST, f).replace(/\\/g, '/'));
  for (const need of ['index.html', 'favicon.svg', 'apple-touch-icon.png', 'assets/site.css', 'assets/tokens.css', 'assets/js/main.js', 'logo-512.png']) check(files.includes(need), 'missing ' + need);
  for (const f of files) {
    check(!/^(README|LICENSE|docs\/|register\/|brand\/|reference\/)/i.test(f) && !f.endsWith('.map') && !f.endsWith('.py'), 'must not ship: ' + f);
  }
  check(!files.some((f) => /register\.json$/.test(f)), 'register.json must stay out of dist');
});

/* ------------------------------------------------------------------ 2 register rules */
gate('register: one record per fact, inert records carry no value or url', () => {
  const errs = validate(register);
  check(errs.length === 0, errs.join('; '));
  const ids = register.records.map((r) => r.id);
  check(new Set(ids).size === ids.length, 'duplicate ids');
  for (const r of register.records) {
    check(['stated', 'absent', 'unconfirmed'].includes(r.state), r.id + ' state');
    if (r.state !== 'stated') check(!('value' in r) && !('url' in r), r.id + ' inert but carries value/url');
  }
  const rt = JSON.parse(read(join(DIST, 'index.html')).match(/<script type="application\/json" id="register">([\s\S]*?)<\/script>/)[1]);
  check(!JSON.stringify(rt).match(/\d{4}-\d{2}-\d{2}/), 'runtime register carries a date');
  check(!rt.records.some((r) => r.id === 'ca'), 'runtime register must not include the ca record');
});

/* ------------------------------------------------------------------ 3 no dates */
gate('copy: zero dates, clock strings or freshness words in dist', () => {
  const pats = [
    [/\b\d{4}-\d{2}-\d{2}\b/, 'iso date'], [/\b\d{1,2}[/.]\d{1,2}[/.]\d{2,4}\b/, 'numeric date'],
    [/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.? \d{1,2}\b/i, 'month day'],
    [/\b\d{1,2} (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i, 'day month'],
    [/\b\d{1,2}:\d{2}(:\d{2})?\s?(am|pm)?\b/i, 'clock'], [/\b(as of|last checked|checked|updated|last updated|timestamp)\b/i, 'freshness word'],
    [/\b\d+\s?(s|m|h|d|sec|min|hr|hours?|days?|minutes?|seconds?)\s+ago\b/i, 'relative time'], [/\b(19|20)\d{2}\b/, 'year'],
  ];
  for (const f of textFiles(DIST)) {
    const t = read(f).replace(/<svg[\s\S]*?<\/svg>/g, '');
    if (f.endsWith('favicon.svg')) continue;
    for (const [re, n] of pats) {
      const m = t.match(re);
      check(!m, `${relative(DIST, f)}: ${n} -> "${m && m[0]}"`);
    }
  }
});

/* ------------------------------------------------------------------ 4 palette */
gate('palette: sampled from assets, literals only in tokens.css', () => {
  const py = spawnSync('python', ['-I', join(ROOT, 'tools/verify_palette.py')], { encoding: 'utf8' });
  check(py.status === 0, 'verify_palette.py: ' + (py.stdout + py.stderr).trim());
  const lit = /#[0-9a-fA-F]{3,8}\b/g, fn = /\b(rgba?|hsla?|hwb|oklch|lch|lab)\(/;
  const named = /(?:^|[:\s(,])(white|black|red|blue|green|yellow|orange|purple|pink|gray|grey|cyan|magenta|silver|gold|lime|teal|navy)\b(?!-)/i;
  for (const f of walk(join(ROOT, 'src')).concat(textFiles(DIST))) {
    const rel = relative(ROOT, f).replace(/\\/g, '/');
    if (/tokens\.css$/.test(rel)) continue;
    let t = read(f);
    if (/dist\/index\.html$|src\/index\.html$/.test(rel)) t = t.replace(/<meta name="theme-color"[^>]*>/, '');
    if (/favicon\.svg$/.test(rel)) continue;
    check(!lit.test(t), rel + ' contains a colour literal');
    lit.lastIndex = 0;
    check(!fn.test(t), rel + ' contains a colour function literal');
    if (rel.endsWith('.css')) {
      const decl = t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/var\(--[\w-]+\)/g, '').replace(/--[\w-]+/g, '');
      const m = decl.match(/[:;]\s*[^;{}]*/g) || [];
      check(!m.some((d) => named.test(d)), rel + ' uses a named colour');
    }
  }
  const tok = read(join(ROOT, 'src/styles/tokens.css'));
  check(/k-means/i.test(tok) && /snapped|nearest real pixel/i.test(tok), 'tokens.css missing provenance comment');
});

/* ------------------------------------------------------------------ 5 favicon */
gate('favicon: 32x32 svg, traced, no comment hazards', () => {
  const s = read(join(DIST, 'favicon.svg'));
  check(/<svg[^>]*\swidth="32"[^>]*\sheight="32"/.test(s), 'not 32x32');
  check(!/<!--/.test(s) && !/--/.test(s), 'contains XML comment or double hyphen');
  check((s.match(/<rect /g) || []).length > 40, 'too few rects to be a trace');
  check(/shape-rendering="crispEdges"/.test(s), 'pixel grid should stay crisp');
  check(/<link rel="icon" href="\/favicon\.svg"/.test(read(join(DIST, 'index.html'))), 'html does not link the favicon');
});

/* ------------------------------------------------------------------ 6/7 mutation harness */
function mutate(reg, id, state) {
  const copy = structuredClone(reg);
  const rec = get(copy, id);
  const fixture = {};
  delete rec.value; delete rec.url;
  rec.state = state;
  if (state === 'stated') {
    if (id === 'ca') fixture.value = rec.value = rndAddr();
    else { fixture.handle = rndHandle(); fixture.url = rec.url = `https://${id === 'x' ? 'x.com' : 'github.com'}/${fixture.handle}`; }
  }
  return { copy, rec, fixture };
}

gate('mutation harness: both branches of ca, x, github (anchors read the live record)', () => {
  for (const id of ['ca', 'x', 'github']) {
    const live = get(register, id);
    check(!!live, id + ' record missing');
    // baseline: whatever state the live record is in right now must render consistently
    const base = build({ register, outDir: mkdtempSync(join(tmpdir(), 'z001-')) });
    for (const state of ['stated', 'absent', 'unconfirmed']) {
      const { copy, fixture } = mutate(register, id, state);
      const out = mkdtempSync(join(tmpdir(), 'z001-'));
      const { html } = build({ register: copy, outDir: out });
      const tag = `${id}/${state}`;
      if (id === 'ca') {
        const blk = caBlock(html);
        check(!!blk, tag + ' slot missing');
        const top = html.indexOf('id="ca"') < html.indexOf('<main');
        check(top, tag + ' slot must precede main');
        if (state === 'stated') {
          check(blk.includes(`data-copy="${fixture.value}"`), tag + ' data-copy');
          check(textOf(blk).includes(fixture.value), tag + ' full address not printed');
          check(/<button/.test(blk) && !/aria-disabled/.test(blk), tag + ' should be live button');
          check(scanAddresses(html, copy).length === 0, tag + ' scanner flagged the stated CA');
        } else {
          check(!/data-copy|<button/.test(blk) && /aria-disabled="true"/.test(blk), tag + ' inert slot is interactive');
          check(/pending/.test(textOf(blk)) && textOf(blk).split(' ').length <= 2, tag + ' inert slot must show label + pending only');
          check(!/[1-9A-HJ-NP-Za-km-z]{32,44}/.test(textOf(blk)), tag + ' inert slot has an address');
        }
      } else {
        const t = socialTag(html, id);
        check(!!t, tag + ' icon missing');
        check(/<svg/.test(html.slice(html.indexOf(t), html.indexOf(t) + 3000)), tag + ' icon svg missing');
        if (state === 'stated') {
          check(attr(t, 'href') === fixture.url && /^<a /.test(t), tag + ' href');
          check(attr(t, 'aria-label').includes('@' + fixture.handle), tag + ' handle not derived from url');
          check(deriveHandle(fixture.url) === fixture.handle, tag + ' handle derivation');
        } else {
          check(!/href=/.test(t) && /^<span /.test(t) && /aria-disabled="true"/.test(t), tag + ' inert icon must have no href');
          check(/pending/.test(attr(t, 'aria-label')), tag + ' inert label must say pending');
        }
      }
      // market config must not move when the record under test moves
      const rt = (h) => h.match(/id="register">([\s\S]*?)<\/script>/)[1];
      check(rt(html) === rt(base.html), tag + ' changed the market register');
      rmSync(out, { recursive: true, force: true });
    }
    rmSync(base.outDir, { recursive: true, force: true });
  }
  // invalid stated values must be refused by the build
  const bad = structuredClone(register); Object.assign(get(bad, 'ca'), { state: 'stated', value: 'not-an-address' });
  check(validate(bad).length > 0, 'bad ca accepted');
  const bad2 = structuredClone(register); Object.assign(get(bad2, 'x'), { state: 'absent', url: 'https://x.com/a' });
  check(validate(bad2).length > 0, 'inert record carrying a url accepted');
});

gate('address scanner: matches the stated registry, never blanket-rejects 0x', () => {
  const html = read(join(DIST, 'index.html'));
  check(scanAddresses(html, register).length === 0, 'dist contains an unregistered address-shaped string');
  for (const f of textFiles(join(DIST, 'assets'))) check(scanAddresses(read(f), register).length === 0, relative(DIST, f) + ' contains address-shaped string');
  const evm = '0x' + randomBytes(20).toString('hex'), sol = rndAddr();
  check(scanAddresses(`<p>${evm}</p>`, register).includes(evm), 'unregistered 0x not flagged');
  check(scanAddresses(`<p>${sol}</p>`, register).includes(sol), 'unregistered base58 not flagged');
  const reg2 = structuredClone(register); reg2.records.push({ id: 'evm-sample', label: 'Sample', state: 'stated', value: evm });
  check(scanAddresses(`<p>${evm}</p>`, reg2).length === 0, 'stated 0x record was rejected');
  const reg3 = structuredClone(register); Object.assign(get(reg3, 'ca'), { state: 'stated', value: sol });
  check(scanAddresses(`<p>${sol}</p>`, reg3).length === 0, 'stated CA was flagged');
  check(scanAddresses(`<p>${sol}</p>`, register).length === 1, 'same CA must be flagged while absent');
});

/* ------------------------------------------------------------------ 8 header, socials, CA slot */
gate('header: CA slot on top, both social icons at every width, icon only', () => {
  const html = read(join(DIST, 'index.html')), css = read(join(DIST, 'assets/site.css'));
  const header = html.match(/<header class="top">[\s\S]*?<\/header>/)[0];
  check(header.indexOf('id="ca"') > -1 && header.indexOf('class="socials"') > header.indexOf('id="ca"'), 'ca then socials order');
  const soc = header.match(/<div class="socials">([\s\S]*?)<\/div>/)[1];
  check(textOf(soc.replace(/aria-label="[^"]*"/g, '')) === '', 'social icons carry visible text');
  check((soc.match(/<svg/g) || []).length === 2, 'expected exactly two icons');
  check(soc.includes('M18.244 2.25h3.308') && soc.includes('M8 0c4.42 0 8 3.58 8 8a8.013'), 'official marks missing');
  check(/\.socials\s*\{[^}]*justify-self:\s*end/.test(css), 'socials not pinned right');
  const hides = [...css.matchAll(/([^{}]+)\{[^}]*display:\s*none/g)].map((m) => m[1]);
  check(!hides.some((s) => s.split(',').some((x) => /^\s*(\.socials|\.social(\.[\w-]+)?|\.top|#ca|\.ca(\.[\w-]+)?)\s*$/.test(x))), 'a breakpoint hides socials or the ca slot');
  check(/\.top\s*\{[^}]*position:\s*sticky/.test(css), 'top bar must stay visible');
  check(/\.ca-val\s*\{[^}]*font:\s*700\s+clamp\(1\.05rem,\s*1\.9vw,\s*1\.7rem\)/.test(css), 'ca font should be large');
  check(/\.social\s*\{[^}]*width:\s*44px;\s*height:\s*44px/.test(css), 'social tap target');
});

/* ------------------------------------------------------------------ 9 units and tap targets */
gate('css: no ch units, 44px tap targets', () => {
  for (const f of ['site.css', 'tokens.css']) {
    const css = read(join(DIST, 'assets', f)).replace(/\/\*[\s\S]*?\*\//g, '');
    check(!/\d\s?ch\b/.test(css), f + ' uses ch units');
  }
  const css = read(join(DIST, 'assets/site.css'));
  for (const re of [/\.cp\s*\{[^}]*width:\s*44px;\s*height:\s*44px/, /\.tabs button\s*\{[^}]*min-height:\s*44px/, /\.side-nav a\s*\{[^}]*min-height:\s*44px/, /\.foot nav a\s*\{[^}]*min-height:\s*44px/, /\.chip\s*\{[^}]*min-height:\s*44px/, /\.ca-act\s*\{[^}]*min-height:\s*44px/]) check(re.test(css), 'tap target rule missing: ' + re);
});

/* ------------------------------------------------------------------ 10 motion */
gate('motion: reduced-motion fallback covers every animation', () => {
  const css = read(join(DIST, 'assets/site.css'));
  const rm = css.match(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*)\}\s*$/);
  check(!!rm, 'no reduced-motion block');
  check(rm && /\*,\s*\*::before,\s*\*::after\s*\{[^}]*animation:\s*none\s*!important[^}]*transition:\s*none\s*!important/.test(rm[1]), 'blanket none rule missing');
  check(rm && /\[data-reveal\]:not\(\.is-in\)\s*\{\s*opacity:\s*1/.test(rm[1]), 'reveal not instant');
  const js = walk(join(DIST, 'assets/js')).map(read).join('\n');
  check(/matchMedia\('\(prefers-reduced-motion: reduce\)'\)/.test(js), 'js ignores reduced motion');
  check(/reduced\(\)/.test(read(join(DIST, 'assets/js/fx.js'))) && /reduced\(\)/.test(read(join(DIST, 'assets/js/market.js'))), 'fx/market skip motion');
  for (const must of ['@keyframes marquee', '@keyframes ping', '@keyframes drift', '@keyframes shimmer', '.progress', '.spot::after', '.pill[data-state="live"] .dot']) check(css.includes(must), 'missing ' + must);
  check(/k = 170|k: 190/.test(js) && /dt = 1 \/ 240/.test(js), 'spring solver missing');
  check(/data-depth/.test(read(join(DIST, 'index.html'))) && /pointermove/.test(read(join(DIST, 'assets/js/fx.js'))), 'parallax layers missing');
});

/* ------------------------------------------------------------------ 11 market: static + behaviour */
gate('market: always on, independent of the contract record, resilient', async () => {});
const marketGate = async () => {
  current = 'market: always on, independent of the contract record, resilient';
  const g = results.find((r) => r.name === current);
  const ck = (c, m) => { g.checks++; if (!c) g.fails.push(m); };
  const dir = join(DIST, 'assets/js');
  const market = read(join(dir, 'market.js')), poller = read(join(dir, 'poller.js'));
  ck(!/['"`]ca['"`]|getElementById\(['"]ca|data-record|contract|#ca\b/i.test(market + poller), 'market code references the contract record');
  ck(/every = 60000/.test(poller) && /visibilitychange/.test(poller) && /2 \*\* \(fails - 1\)/.test(poller), 'poll cadence, pause or backoff missing');
  const rt = read(join(DIST, 'index.html'));
  ck(rt.includes('api.dexscreener.com/token-boosts/top/v1') && rt.includes('api.dexscreener.com/tokens/v1/solana/'), 'endpoints absent from runtime register');
  ck(!/dexscreener/.test(market + poller), 'endpoints hard-coded in code instead of the register');
  ck(/TOP = 10/.test(market) && /chainId === 'solana'/.test(market) && /replaceWith\(letter\(\)\)/.test(market), 'top ten / solana filter / letter fallback missing');

  // behaviour under stubs
  globalThis.matchMedia = () => ({ matches: false });
  const timers = []; const realST = globalThis.setTimeout, realCT = globalThis.clearTimeout;
  const mod = await import(pathToFileURL(join(dir, 'market.js')).href + '?g=' + Date.now());
  const { aggregate, fetchMarket, fmtPrice, fmtChange } = mod;
  const mk = (a, vol, liq, chain = 'solana', extra = {}) => ({ chainId: chain, baseToken: { address: a, name: 'N' + a, symbol: 'S' + a }, priceUsd: '0.001', priceChange: { h24: 5 }, volume: { h24: vol }, liquidity: { usd: liq }, ...extra });
  const pairs = [];
  for (let i = 1; i <= 14; i++) pairs.push(mk('T' + i, i * 1000, 500));
  pairs.push(mk('T3', 90000, 9000, 'solana', { priceUsd: '7', info: { imageUrl: 'https://x/img.png' } }), mk('E1', 1e9, 1, 'ethereum'));
  const top = aggregate([{ chainId: 'solana', tokenAddress: 'T1', icon: 'https://x/i.png' }], pairs);
  ck(top.length === 10, 'top is not ten rows: ' + top.length);
  ck(top.every((t, i) => i === 0 || top[i - 1].volume >= t.volume), 'not sorted by volume desc');
  ck(!top.some((t) => t.address === 'E1'), 'non-solana leaked');
  const t3 = top.find((t) => t.address === 'T3');
  ck(t3 && t3.volume === 93000 && t3.price === 7 && t3.img === 'https://x/img.png', 'pair merge: volume sum / deepest pair price / imageUrl');
  ck(aggregate([{ chainId: 'solana', tokenAddress: 'T1', icon: 'https://x/i.png' }], [mk('T1', 5, 5)])[0].img === 'https://x/i.png', 'icon fallback from boosts');
  ck(fmtPrice(0.000002745) === '$0.000002745' && fmtPrice(12.3456) === '$12.346' && fmtChange(-9.66) === '-9.7%' && fmtChange(NaN) === '—', 'formatters');

  // fetchMarket: filters chain, chunks by 30, rejects on failure
  const calls = [];
  const src = { boosts: 'https://b/', pairs: 'https://p/' };
  const boosts = []; for (let i = 0; i < 65; i++) boosts.push({ chainId: 'solana', tokenAddress: 'A' + i }); boosts.push({ chainId: 'base', tokenAddress: 'B0' }, { chainId: 'solana', tokenAddress: 'A1' });
  globalThis.fetch = async (u) => { calls.push(u); if (u === src.boosts) return { ok: true, json: async () => boosts }; const ids = u.slice(src.pairs.length).split(','); return { ok: true, json: async () => ids.map((a, i) => mk(a, i + 1, 10)) }; };
  const out = await fetchMarket(src);
  const pcalls = calls.filter((c) => c.startsWith(src.pairs));
  ck(pcalls.length === 3 && pcalls.every((c) => c.slice(src.pairs.length).split(',').length <= 30) && !calls.join().includes('B0'), 'chunking / chain filter: ' + pcalls.length);
  ck(out.length === 10, 'fetchMarket result size');
  globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
  let threw = false; try { await fetchMarket(src); } catch { threw = true; }
  ck(threw, 'source failure must reject so the poller backs off');

  // poller: backoff, cadence, visibility
  const { createPoller } = await import(pathToFileURL(join(dir, 'poller.js')).href + '?g=' + Date.now());
  const listeners = {}; const doc = { visibilityState: 'visible', addEventListener: (e, f) => { listeners[e] = f; } };
  globalThis.document = doc;
  const sched = []; globalThis.setTimeout = (f, ms) => { sched.push({ f, ms }); return sched.length; }; globalThis.clearTimeout = () => {};
  let n = 0; const states = [];
  const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  createPoller(async () => { n++; if (n <= 4) throw new Error('x'); }, { onState: (s) => states.push(s) });
  await flush();
  const waits = []; for (let i = 0; i < 5; i++) { const s = sched.shift(); if (!s) break; waits.push(s.ms); s.f(); await flush(); }
  ck(waits.length >= 5, 'poller stopped retrying: ' + waits);
  ck(waits.slice(0, 4).every((w, i) => w >= 2000 * 2 ** i * 0.8 - 1 && w <= 2000 * 2 ** i * 1.2 + 1), 'backoff not exponential: ' + waits);
  ck(waits[4] === 60000, 'cadence after success is not 60s: ' + waits[4]);
  const before = n; sched.length = 0; doc.visibilityState = 'hidden'; listeners.visibilitychange(); await flush();
  ck(states.includes('paused') && sched.length === 0, 'did not pause when hidden');
  doc.visibilityState = 'visible'; listeners.visibilitychange(); await flush();
  ck(n === before + 1, 'did not fetch immediately on visible');
  globalThis.setTimeout = realST; globalThis.clearTimeout = realCT; delete globalThis.document; delete globalThis.fetch;
  ck(true, 'ok');
};

/* ------------------------------------------------------------------ 12 copy originality */
function words(t) { return t.toLowerCase().match(/[a-z0-9]+(?:'[a-z]+)?/g) || []; }
const sha = (s) => createHash('sha1').update(s).digest('hex').slice(0, 10);
const STOP = new Set('a an and are as at be but by for from has have i if in into is it its of on or our so than that the their them then there these they this to up us was we what when where which who will with you your not no can all any each more most one two three ten per out over while through after before again also just only own same such too very'.split(' '));
gate('copy: zero shared 2-grams or words with the reference', () => {
  const ref = JSON.parse(read(join(ROOT, 'gates/ref-grams.json')));
  const bi = new Set(ref.bigrams), uni = new Set(ref.words);
  const html = read(join(DIST, 'index.html'));
  const chunks = [];
  chunks.push(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, '\n'));
  for (const m of html.matchAll(/\s(?:title|aria-label|alt)="([^"]+)"/g)) chunks.push(m[1]);
  for (const m of html.matchAll(/<meta (?:name="description"|property="og:(?:title|description)") content="([^"]+)"/g)) chunks.push(m[1]);
  for (const f of walk(join(DIST, 'assets/js'))) for (const m of read(f).matchAll(/'([^'\n]{12,})'|"([^"\n]{12,})"/g)) { const s = m[1] || m[2]; if (/^[A-Z—][^{}=;<>]*$/.test(s) && s.split(' ').length >= 3) chunks.push(s); }
  let sharedBi = [], sharedUni = new Set();
  for (const c of chunks) {
    const w = words(c.replace(/&amp;/g, '&').replace(/&#39;/g, "'"));
    for (let i = 0; i < w.length - 1; i++) if (bi.has(sha(w[i] + ' ' + w[i + 1]))) sharedBi.push(w[i] + ' ' + w[i + 1]);
    for (const x of w) if (x.length > 2 && x !== 'fun' && !STOP.has(x) && uni.has(sha(x))) sharedUni.add(x);
  }
  check(sharedBi.length === 0, 'shared 2-grams: ' + sharedBi.join(' | '));
  check(sharedUni.size === 0, 'shared words: ' + [...sharedUni].join(', '));
});

/* ------------------------------------------------------------------ 13 repo hygiene and content files */
gate('repo: hygiene and required files', () => {
  const memo = ['CLAU', 'DE.md'].join(''), dot = ['.cla', 'ude'].join('');
  check(!existsSync(join(ROOT, memo)) && !existsSync(join(ROOT, dot)), 'assistant memo file or folder present');
  const banned = new RegExp([['cla', 'ude'], ['anth', 'ropic'], ['\\bA', 'I\\b'], ['artificial ', 'intelligence'], ['generated ', 'by'], ['co-', 'authored'], ['chat', 'gpt'], ['\\bL', 'LM\\b']].map((p) => p.join('')).join('|'), 'i');
  for (const f of walk(ROOT)) {
    const rel = relative(ROOT, f).replace(/\\/g, '/');
    if (/^(brand|reference|node_modules|\.git)\//.test(rel) || !TEXT_EXT.has(extname(f)) && !/LICENSE$/.test(f)) continue;
    if (rel === 'gates/ref-grams.json') continue;
    const m = read(f).match(banned);
    check(!m, `${rel} mentions "${m && m[0]}"`);
  }
  for (const f of ['README.md', 'docs/whitepaper.md', 'LICENSE']) check(existsSync(join(ROOT, f)), f + ' missing');
  const lic = existsSync(join(ROOT, 'LICENSE')) ? read(join(ROOT, 'LICENSE')) : '';
  check(/MIT License/.test(lic) && /Copyright \(c\) 2026 Z001/.test(lic), 'LICENSE is not MIT / Z001 / 2026');
  const rd = existsSync(join(ROOT, 'README.md')) ? read(join(ROOT, 'README.md')) : '';
  check(/^#\s*Z001/m.test(rd) && /Overview/.test(rd) && /Features/.test(rd) && /Links/.test(rd) && /Solana/.test(rd) && /badge|shields\.io/.test(rd), 'README sections');
  const wp = existsSync(join(ROOT, 'docs/whitepaper.md')) ? read(join(ROOT, 'docs/whitepaper.md')) : '';
  check(/Vision/i.test(wp) && /Mission/i.test(wp) && /Tokenomics/i.test(wp) && /Roadmap/i.test(wp) && /Team/i.test(wp), 'whitepaper sections');
});

/* ------------------------------------------------------------------ run */
await marketGate();
let totalChecks = 0, bad = 0;
for (const r of results) {
  totalChecks += r.checks;
  const ok = r.fails.length === 0;
  if (!ok) bad++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${r.name}  (${r.checks} checks)`);
  for (const f of r.fails.slice(0, 12)) console.log('        - ' + f);
}
console.log(`\n${results.length} gates, ${totalChecks} checks, ${bad} failing`);
process.exit(bad ? 1 : 0);
