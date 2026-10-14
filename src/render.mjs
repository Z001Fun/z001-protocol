// Pure renderers: register in, markup out. Used by the build and by the gate harness.
import { X_ICON, GITHUB_ICON } from './icons.mjs';

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export const B58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const isSolAddress = (s) => typeof s === 'string' && B58_RE.test(s);

export function b58encode(bytes) {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = '';
  while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  for (const b of bytes) { if (b === 0) out = '1' + out; else break; }
  return out;
}

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const DATE_KEYS = new Set(['checked', 'recorded', 'asOf', 'date']);
const SOCIAL = {
  x: { hosts: ['x.com', 'twitter.com'], icon: X_ICON },
  github: { hosts: ['github.com'], icon: GITHUB_ICON },
};

export const get = (reg, id) => reg.records.find((r) => r.id === id);
export const isStated = (r) => !!r && r.state === 'stated';

export function validate(reg) {
  const errs = [];
  for (const r of reg.records) {
    if (!['stated', 'absent', 'unconfirmed'].includes(r.state)) errs.push(`${r.id}: bad state ${r.state}`);
    if (r.state !== 'stated' && ('value' in r || 'url' in r)) errs.push(`${r.id}: inert record carries value or url`);
    if (r.state === 'stated') {
      if (r.id === 'ca' && !isSolAddress(r.value)) errs.push('ca: stated value is not a Solana address');
      if (SOCIAL[r.id]) {
        try {
          const u = new URL(r.url);
          if (u.protocol !== 'https:' || !SOCIAL[r.id].hosts.includes(u.hostname.replace(/^www\./, ''))) errs.push(`${r.id}: url host`);
          if (!u.pathname.split('/').filter(Boolean)[0]) errs.push(`${r.id}: url has no handle`);
        } catch { errs.push(`${r.id}: stated without a valid url`); }
      }
    }
  }
  return errs;
}

export function deriveHandle(url) {
  return new URL(url).pathname.split('/').filter(Boolean)[0];
}

export function renderCa(rec) {
  if (isStated(rec)) {
    return `<button type="button" class="ca spot" id="ca" data-record="ca" data-state="stated" data-copy="${esc(rec.value)}" aria-label="Copy contract address">
  <span class="ca-label">${esc(rec.label)}</span>
  <span class="ca-val">${esc(rec.value)}</span>
  <span class="ca-act" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M9 9h10v10H9zM5 15V5h10"/></svg><span class="ca-fb"></span></span>
  <span class="sr" role="status" aria-live="polite" data-fb></span>
</button>`;
  }
  return `<div class="ca is-inert" id="ca" data-record="ca" data-state="${esc(rec.state)}" aria-disabled="true">
  <span class="ca-label">${esc(rec.label)}</span>
  <span class="ca-val">pending</span>
</div>`;
}

export function renderSocial(rec) {
  const def = SOCIAL[rec.id];
  if (isStated(rec)) {
    const handle = deriveHandle(rec.url);
    return `<a class="social" data-record="${rec.id}" data-state="stated" href="${esc(rec.url)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(rec.label)} @${esc(handle)}">${def.icon}</a>`;
  }
  return `<span class="social is-inert" data-record="${rec.id}" data-state="${esc(rec.state)}" role="img" aria-disabled="true" aria-label="${esc(rec.label)}, pending" title="${esc(rec.label)} · pending">${def.icon}</span>`;
}

function valueMarkup(rec) {
  if (!isStated(rec)) return '<span class="v">pending</span>';
  if (SOCIAL[rec.id]) return `<a class="v" href="${esc(rec.url)}" target="_blank" rel="noopener noreferrer">@${esc(deriveHandle(rec.url))}</a>`;
  return `<span class="v">${esc(rec.value)}</span>`;
}

export function renderLedger(reg) {
  return reg.records.filter((r) => r.id !== 'market-source').map((r) =>
    `<li class="row${isStated(r) ? '' : ' is-inert'}" data-record="${r.id}" data-state="${r.state}"><span class="dot-s" aria-hidden="true"></span><span class="k">${esc(r.label)}</span>${valueMarkup(r)}</li>`).join('\n');
}

const TILE_IDS = ['supply', 'agents', 'fee-split', 'liquidity-lock', 'audit'];
export function renderTiles(reg) {
  return TILE_IDS.map((id) => get(reg, id)).filter(Boolean).map((r) =>
    `<li class="tile spot${isStated(r) ? '' : ' is-inert'}" data-record="${r.id}" data-state="${r.state}"><span class="k">${esc(r.label)}</span>${valueMarkup(r).replace('class="v"', 'class="v big"')}</li>`).join('\n');
}

export function renderFooterChips(reg) {
  return ['x', 'github'].map((id) => get(reg, id)).filter(Boolean).map((r) =>
    isStated(r)
      ? `<a class="chip" data-record="${r.id}" data-state="stated" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.label)} @${esc(deriveHandle(r.url))}</a>`
      : `<span class="chip is-inert" data-record="${r.id}" data-state="${r.state}">${esc(r.label)} · pending</span>`).join('\n');
}

export function runtimeRegister(reg) {
  const keep = { chain: ['value', 'rpc'], 'market-source': ['value', 'boosts', 'pairs'] };
  const records = Object.entries(keep).map(([id, keys]) => {
    const r = get(reg, id);
    const o = { id, state: r.state };
    for (const k of keys) if (isStated(r) && k in r && !DATE_KEYS.has(k)) o[k] = r[k];
    return o;
  });
  return { records };
}

export function renderSlots(reg) {
  const errs = validate(reg);
  if (errs.length) throw new Error('register invalid:\n' + errs.join('\n'));
  const chain = get(reg, 'chain'), dom = get(reg, 'domain');
  return {
    ca: renderCa(get(reg, 'ca')),
    social: `${renderSocial(get(reg, 'x'))}${renderSocial(get(reg, 'github'))}`,
    ledger: renderLedger(reg),
    tiles: renderTiles(reg),
    chips: renderFooterChips(reg),
    chain: isStated(chain) ? esc(chain.value) : 'pending',
    domain: isStated(dom) ? esc(dom.value) : 'pending',
    runtime: JSON.stringify(runtimeRegister(reg)).replace(/</g, '\u003c'),
  };
}
