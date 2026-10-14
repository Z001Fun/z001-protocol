// Click-to-copy for any element carrying data-copy, with visible and spoken feedback.
async function write(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
  const ta = document.createElement('textarea');
  ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
  document.body.appendChild(ta); ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

export function initCopy() {
  document.addEventListener('click', async (e) => {
    const t = e.target.closest && e.target.closest('[data-copy]');
    if (!t) return;
    e.preventDefault();
    const ok = await write(t.dataset.copy);
    const fb = t.querySelector('.ca-fb'), sr = t.querySelector('[data-fb]');
    const msg = ok ? 'Copied' : 'Press Ctrl+C';
    const val = t.querySelector('.ca-val');
    if (!ok && val) { const r = document.createRange(); r.selectNodeContents(val); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); }
    t.dataset.copied = ok ? 'true' : 'false';
    if (fb) fb.textContent = msg;
    if (sr) sr.textContent = msg;
    clearTimeout(t._fb);
    t._fb = setTimeout(() => { delete t.dataset.copied; if (fb) fb.textContent = ''; if (sr) sr.textContent = ''; }, 1800);
  });
}
