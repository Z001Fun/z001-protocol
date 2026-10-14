// Polls on a fixed cadence, pauses while the tab is hidden, fetches at once when it returns,
// and retries failures with exponential backoff (capped, jittered).
export function createPoller(task, { every = 60000, base = 2 * 1000, cap = 30000, onState = () => {} } = {}) {
  let timer = 0, fails = 0, busy = false, stopped = false;
  const visible = () => document.visibilityState === 'visible';

  const schedule = (ms) => { clearTimeout(timer); if (!stopped && visible()) timer = setTimeout(run, ms); };

  async function run() {
    if (busy || stopped || !visible()) return;
    busy = true;
    onState(fails ? 'retry' : 'loading');
    try {
      await task();
      fails = 0; onState('live'); busy = false; schedule(every);
    } catch (err) {
      fails += 1;
      const wait = Math.min(cap, base * 2 ** (fails - 1)) * (0.8 + Math.random() * 0.4);
      onState('error', err); busy = false; schedule(wait);
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (visible()) { onState('loading'); run(); } else { clearTimeout(timer); onState('paused'); }
  });
  if (visible()) run(); else onState('paused');
  return { stop() { stopped = true; clearTimeout(timer); } };
}

export async function getJson(url, init = {}, ms = 12000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal });
    if (!res.ok) throw new Error('http ' + res.status);
    return await res.json();
  } finally { clearTimeout(t); }
}
