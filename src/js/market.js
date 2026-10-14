// Live market: DexScreener boosts -> Solana tokens -> pair stats -> top ten by 24h volume.
// This module follows only the market-source and chain records of the runtime register.
import { createPoller, getJson } from './poller.js';
import { reduced, clamp } from './motion.js';

const TOP = 10;
const CHUNK = 30;
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export function aggregate(boosts, pairs) {
  const icons = new Map();
  for (const b of boosts) if (b.chainId === 'solana' && b.tokenAddress && b.icon) icons.set(b.tokenAddress, b.icon);
  const by = new Map();
  for (const p of pairs) {
    if (!p || p.chainId !== 'solana' || !p.baseToken || !p.baseToken.address) continue;
    const a = p.baseToken.address;
    let t = by.get(a);
    if (!t) { t = { address: a, name: p.baseToken.name || p.baseToken.symbol || '', symbol: p.baseToken.symbol || '', volume: 0, liquidity: 0, best: -1, price: NaN, change: NaN, img: '' }; by.set(a, t); }
    t.volume += num(p.volume && p.volume.h24);
    const liq = num(p.liquidity && p.liquidity.usd);
    t.liquidity += liq;
    if (liq > t.best || t.best < 0) {
      t.best = liq; t.price = Number(p.priceUsd);
      t.change = p.priceChange && p.priceChange.h24 != null ? Number(p.priceChange.h24) : NaN;
      t.img = (p.info && p.info.imageUrl) || t.img;
    }
  }
  for (const t of by.values()) if (!t.img) t.img = icons.get(t.address) || '';
  return [...by.values()].filter((t) => Number.isFinite(t.price)).sort((a, b) => b.volume - a.volume).slice(0, TOP);
}

export async function fetchMarket(src) {
  const boosts = await getJson(src.boosts);
  const addrs = [...new Set(boosts.filter((b) => b.chainId === 'solana' && b.tokenAddress).map((b) => b.tokenAddress))];
  if (!addrs.length) throw new Error('empty');
  const chunks = [];
  for (let i = 0; i < addrs.length; i += CHUNK) chunks.push(addrs.slice(i, i + CHUNK));
  const lists = await Promise.all(chunks.map((c) => getJson(src.pairs + c.join(','))));
  const out = aggregate(boosts, lists.flat());
  if (!out.length) throw new Error('empty');
  return out;
}

/* ---------- formatting ---------- */
const compact = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2 });
export const fmtUsd = (n) => compact.format(n);
export function fmtPrice(n) {
  if (!Number.isFinite(n)) return '—';
  if (n >= 100) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (n >= 1) return '$' + n.toFixed(3);
  if (n === 0) return '$0';
  const d = clamp(Math.ceil(-Math.log10(n)) + 3, 4, 12);
  return '$' + n.toFixed(d);
}
export const fmtChange = (n) => (Number.isFinite(n) ? (n > 0 ? '+' : '') + n.toFixed(1) + '%' : '—');
const fmtInt = (n) => Math.round(n).toLocaleString('en-US');

/* ---------- number tween + flash ---------- */
function setNum(el, to, fmt, first) {
  const from = el._v;
  el._v = to;
  if (from === to && el.textContent) return;
  const changed = from !== undefined && from !== to;
  if (reduced() || !Number.isFinite(to)) { el.textContent = fmt(to); }
  else {
    const start = Number.isFinite(from) ? from : 0, t0 = performance.now(), ms = first ? 1100 : 700;
    cancelAnimationFrame(el._r);
    const step = (now) => {
      const p = clamp((now - t0) / ms, 0, 1), e = 1 - Math.pow(1 - p, 4);
      el.textContent = fmt(start + (to - start) * e);
      if (p < 1) el._r = requestAnimationFrame(step); else el.textContent = fmt(to);
    };
    el._r = requestAnimationFrame(step);
  }
  if (changed && !reduced()) {
    const cls = to > from ? 'flash-up' : 'flash-down';
    el.classList.remove('flash-up', 'flash-down'); void el.offsetWidth; el.classList.add(cls);
  }
}

/* ---------- dom helpers ---------- */
const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const COPY_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 9h10v10H9zM5 15V5h10"/></svg>';
const OK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

function hashTone(s) { let x = 0; for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) >>> 0; return x % 5; }
function logo(t, cls = '') {
  const letter = () => { const l = h('span', 'letter ' + cls, (t.symbol || t.name || '?').trim().charAt(0).toUpperCase() || '?'); l.dataset.t = hashTone(t.address); l.setAttribute('aria-hidden', 'true'); return l; };
  if (!/^https:\/\//.test(t.img || '')) return letter();
  const img = h('img', 'logo ' + cls); img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.referrerPolicy = 'no-referrer'; img.src = t.img;
  img.addEventListener('error', () => img.replaceWith(letter()), { once: true });
  return img;
}

export function initMarket() {
  const reg = JSON.parse(document.getElementById('register').textContent).records;
  const src = reg.find((r) => r.id === 'market-source');
  const chain = reg.find((r) => r.id === 'chain');
  const board = document.querySelector('[data-board]');
  const note = document.querySelector('[data-note]');
  const pill = document.querySelector('[data-pill]');
  const ticker = document.querySelector('[data-ticker]');
  const sum = {}; document.querySelectorAll('[data-s]').forEach((e) => { sum[e.dataset.s] = e; });
  const rows = new Map();
  let have = false, first = true;

  /* skeletons */
  const skelRow = () => {
    const r = h('div', 'brow skel'); r.setAttribute('role', 'row');
    r.innerHTML = '<span><i class="sk" style="width:1rem"></i></span><span class="tok"><i class="sk round"></i><i class="sk" style="width:60%"></i></span><span class="r"><i class="sk" style="width:4rem"></i></span><span class="r"><i class="sk" style="width:3rem"></i></span><span class="r hide-m"><i class="sk" style="width:3.5rem"></i></span><span class="r hide-s"><i class="sk" style="width:3.5rem"></i></span><span></span>';
    return r;
  };
  for (let i = 0; i < TOP; i++) board.appendChild(skelRow());
  const track0 = ticker.querySelector('.track');
  const skTicks = () => { for (let i = 0; i < 8; i++) { const t = h('span', 'tick'); t.innerHTML = '<i class="sk" style="width:7rem"></i>'; track0.appendChild(t); } };
  skTicks();

  const setPill = (state) => {
    const label = { loading: 'Syncing', live: 'Streaming', retry: 'Retrying', error: 'Source down', paused: 'Paused' }[state];
    pill.dataset.state = state; pill.querySelector('span').textContent = label;
  };

  function makeRow(t) {
    const r = h('div', 'brow fadein'); r.setAttribute('role', 'row'); r.dataset.addr = t.address;
    const rank = h('span', 'rk'); const tok = h('span', 'tok'); const nm = h('span', 'nm');
    nm.append(h('b', '', t.name || t.symbol), h('small', '', t.symbol ? '$' + t.symbol : ''));
    tok.append(logo(t), nm);
    const price = h('span', 'r'); const pn = h('span', 'num'); price.append(pn);
    const ch = h('span', 'r'); const cn = h('span', 'num'); ch.append(cn);
    const vol = h('span', 'r hide-m'); const vn = h('span', 'num'); vol.append(vn);
    const liq = h('span', 'r hide-s'); const ln = h('span', 'num'); liq.append(ln);
    const cp = h('button', 'cp'); cp.type = 'button'; cp.innerHTML = COPY_SVG; cp.dataset.copy = t.address; cp.setAttribute('aria-label', 'Copy address of ' + (t.symbol || t.name));
    cp.addEventListener('click', () => { cp.innerHTML = OK_SVG; cp.dataset.copied = 'true'; clearTimeout(cp._t); cp._t = setTimeout(() => { cp.innerHTML = COPY_SVG; delete cp.dataset.copied; }, 1600); });
    r.append(rank, tok, price, ch, vol, liq, cp);
    r._f = { rank, pn, cn, vn, ln, name: nm.firstChild, sym: nm.lastChild };
    return r;
  }

  function paint(tokens) {
    board.querySelectorAll('.skel').forEach((s) => s.remove());
    const keep = new Set(tokens.map((t) => t.address));
    for (const [a, r] of rows) if (!keep.has(a)) { r.remove(); rows.delete(a); }
    let created = 0;
    tokens.forEach((t, i) => {
      let r = rows.get(t.address);
      if (!r) { r = makeRow(t); rows.set(t.address, r); const d = created++; r.style.transitionDelay = reduced() ? '0s' : (d * 55) + 'ms'; requestAnimationFrame(() => requestAnimationFrame(() => r.classList.add('in'))); }
      board.appendChild(r);
      const f = r._f;
      f.rank.textContent = i + 1;
      setNum(f.pn, t.price, fmtPrice, first);
      setNum(f.cn, t.change, fmtChange, first);
      f.cn.classList.toggle('up', t.change >= 0); f.cn.classList.toggle('down', t.change < 0);
      setNum(f.vn, t.volume, fmtUsd, first);
      setNum(f.ln, t.liquidity, fmtUsd, first);
    });
    /* summary */
    const mover = tokens.reduce((m, t) => (Number.isFinite(t.change) && (!m || t.change > m.change) ? t : m), null);
    setNum(sum.count, tokens.length, fmtInt, first);
    setNum(sum.vol, tokens.reduce((s, t) => s + t.volume, 0), fmtUsd, first);
    sum.mover.textContent = mover ? '$' + mover.symbol + ' ' + fmtChange(mover.change) : '—';
    /* ticker */
    const mk = () => {
      const tr = h('div', 'track'); tr.setAttribute('aria-hidden', 'true');
      for (const t of tokens) {
        const el = h('span', 'tick'); el.append(logo(t, 'sm'));
        const sy = h('span', '', '$' + t.symbol); const pr = h('span', '', fmtPrice(t.price)); const c = h('span', 'ch ' + (t.change >= 0 ? 'up' : 'down'), fmtChange(t.change));
        el.append(sy, pr, c); tr.appendChild(el);
      }
      return tr;
    };
    ticker.replaceChildren(mk(), mk());
    ticker.style.setProperty('--dur', Math.max(30, tokens.length * 7) + 's');
    first = false;
  }

  function showDown() {
    board.querySelectorAll('.skel').forEach((s) => s.remove());
    if (!rows.size && !board.querySelector('.dashrow')) {
      const r = h('div', 'brow dashrow'); r.setAttribute('role', 'row');
      r.innerHTML = '<span>—</span><span class="tok">—</span><span class="r">—</span><span class="r">—</span><span class="r hide-m">—</span><span class="r hide-s">—</span><span></span>';
      board.appendChild(r);
      ['count', 'vol', 'mover'].forEach((k) => { sum[k].textContent = '—'; });
      ticker.replaceChildren(Object.assign(h('div', 'track'), { innerHTML: '<span class="tick">— market unavailable</span>' }));
    }
  }

  createPoller(async () => {
    const tokens = await fetchMarket(src);
    board.querySelectorAll('.dashrow').forEach((d) => d.remove());
    paint(tokens); have = true; note.hidden = true;
  }, {
    onState(state, err) {
      if (state === 'loading' && have) return;
      if (state === 'retry' && have) { setPill('live'); return; }
      if (state === 'error') {
        setPill(have ? 'retry' : 'error');
        note.hidden = false;
        note.textContent = have ? 'Refresh failed. Holding the previous read while retrying.' : 'The market source is not answering. Retrying with a growing pause.';
        if (!have) showDown();
        return;
      }
      setPill(state);
    },
  });

  /* network slot, same cadence, same backoff */
  if (chain && chain.rpc) {
    const slotEl = sum.slot; let slotFirst = true, slotHave = false;
    createPoller(async () => {
      const j = await getJson(chain.rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getSlot' }) });
      if (typeof j.result !== 'number') throw new Error('rpc');
      slotEl.querySelector('.sk') && (slotEl.textContent = '');
      setNum(slotEl, j.result, fmtInt, slotFirst); slotFirst = false; slotHave = true;
    }, { onState(s) { if (s === 'error' && !slotHave) slotEl.textContent = '—'; } });
  }
}
