// Shared motion primitives: reduced-motion flag and a damped spring solver.
const mq = matchMedia('(prefers-reduced-motion: reduce)');
export const reduced = () => mq.matches;

/** Integrates x'' = -k(x - to) - c x' with a fixed 1/240s step (semi-implicit Euler),
 *  calling onUpdate(x) every frame until the spring settles. Returns a cancel fn. */
export function spring({ from = 0, to = 1, k = 170, c = 15, mass = 1, onUpdate, onDone }) {
  if (reduced()) { onUpdate(to); onDone && onDone(); return () => {}; }
  const dt = 1 / 240;
  let x = from, v = 0, last = performance.now(), acc = 0, raf = 0, dead = false;
  const frame = (now) => {
    if (dead) return;
    acc += Math.min(0.05, (now - last) / 1000); last = now;
    while (acc >= dt) {
      const a = (-k * (x - to) - c * v) / mass;
      v += a * dt; x += v * dt; acc -= dt;
    }
    if (Math.abs(x - to) < 0.0005 && Math.abs(v) < 0.01) { onUpdate(to); onDone && onDone(); return; }
    onUpdate(x);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => { dead = true; cancelAnimationFrame(raf); };
}

export const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
