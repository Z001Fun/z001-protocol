// Scroll-reveal with spring stagger, hero parallax, spotlight, scroll progress, tabs, nav tracking.
import { reduced, spring, clamp } from './motion.js';

export function initReveal() {
  const els = [...document.querySelectorAll('[data-reveal]')];
  if (reduced() || !('IntersectionObserver' in window)) { els.forEach((e) => e.classList.add('is-in')); return; }
  let batch = 0, timer = 0;
  const io = new IntersectionObserver((entries) => {
    const hits = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
    hits.forEach((en, i) => {
      io.unobserve(en.target);
      const el = en.target;
      setTimeout(() => {
        el.classList.add('is-in');
        spring({
          from: 0, to: 1, k: 190, c: 17,
          onUpdate: (p) => { el.style.opacity = clamp(p, 0, 1); el.style.transform = `translate3d(0, ${(1 - p) * 34}px, 0)`; },
          onDone: () => { el.style.opacity = ''; el.style.transform = ''; },
        });
      }, (batch + i) * 80);
    });
    batch = Math.min(batch + hits.length, 4);
    clearTimeout(timer); timer = setTimeout(() => { batch = 0; }, 600);
  }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
  els.forEach((e) => { e.style.opacity = '0'; e.style.transform = 'translate3d(0, 34px, 0)'; io.observe(e); });
}

export function initStars() {
  const host = document.querySelector('.stars');
  if (!host) return;
  const n = innerWidth < 640 ? 14 : 26;
  let s = 7;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < n; i++) {
    const b = document.createElement('b');
    b.style.left = (rnd() * 100).toFixed(1) + '%';
    b.style.top = (rnd() * 72).toFixed(1) + '%';
    b.style.animationDelay = (-rnd() * 3.4).toFixed(2) + 's';
    b.style.animationDuration = (2.6 + rnd() * 2.4).toFixed(2) + 's';
    host.appendChild(b);
  }
}

export function initParallax() {
  const scene = document.querySelector('.scene');
  if (!scene || reduced()) return;
  const layers = [...scene.querySelectorAll('[data-depth]')].map((el) => ({ el, d: parseFloat(el.dataset.depth) }));
  let tx = 0, ty = 0, cx = 0, cy = 0, sy = 0, raf = 0, vis = true;
  const kick = () => { if (!raf) raf = requestAnimationFrame(tick); };
  const tick = () => {
    raf = 0;
    cx += (tx - cx) * 0.08; cy += (ty - cy) * 0.08;
    for (const { el, d } of layers) {
      el.style.transform = `translate3d(${(cx * d * -28).toFixed(2)}px, ${(cy * d * -18 + sy * d * 0.28).toFixed(2)}px, 0)`;
    }
    if (vis && (Math.abs(tx - cx) > 0.001 || Math.abs(ty - cy) > 0.001)) kick();
  };
  scene.addEventListener('pointermove', (e) => {
    const r = scene.getBoundingClientRect();
    tx = ((e.clientX - r.left) / r.width - 0.5) * 2; ty = ((e.clientY - r.top) / r.height - 0.5) * 2; kick();
  });
  scene.addEventListener('pointerleave', () => { tx = 0; ty = 0; kick(); });
  addEventListener('scroll', () => { sy = clamp(scrollY, 0, scene.offsetHeight); kick(); }, { passive: true });
  new IntersectionObserver(([e]) => { vis = e.isIntersecting; if (vis) kick(); }).observe(scene);
}

export function initSpotlight() {
  document.addEventListener('pointermove', (e) => {
    const t = e.target.closest && e.target.closest('.spot');
    if (!t) return;
    const r = t.getBoundingClientRect();
    t.style.setProperty('--mx', (e.clientX - r.left) + 'px');
    t.style.setProperty('--my', (e.clientY - r.top) + 'px');
  }, { passive: true });
}

export function initProgress() {
  const bar = document.querySelector('.progress i');
  let raf = 0;
  const upd = () => {
    raf = 0;
    const max = document.documentElement.scrollHeight - innerHeight;
    bar.style.transform = `scaleX(${max > 0 ? clamp(scrollY / max, 0, 1) : 0})`;
  };
  addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(upd); }, { passive: true });
  addEventListener('resize', upd);
  upd();
}

export function initTabs() {
  document.querySelectorAll('[data-tabs]').forEach((list) => {
    const tabs = [...list.querySelectorAll('[role=tab]')];
    const ink = list.querySelector('.ink');
    const place = () => {
      const t = tabs.find((x) => x.getAttribute('aria-selected') === 'true');
      ink.style.width = t.offsetWidth + 'px'; ink.style.transform = `translateX(${t.offsetLeft - 0}px)`;
    };
    const select = (t, focus) => {
      tabs.forEach((x) => {
        const on = x === t;
        x.setAttribute('aria-selected', on); x.tabIndex = on ? 0 : -1;
        document.getElementById(x.getAttribute('aria-controls')).hidden = !on;
      });
      place(); if (focus) t.focus();
    };
    tabs.forEach((t, i) => {
      t.addEventListener('click', () => select(t));
      t.addEventListener('keydown', (e) => {
        const k = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
        if (k) { e.preventDefault(); select(tabs[(i + k + tabs.length) % tabs.length], true); }
        if (e.key === 'Home') { e.preventDefault(); select(tabs[0], true); }
        if (e.key === 'End') { e.preventDefault(); select(tabs[tabs.length - 1], true); }
      });
    });
    place(); addEventListener('resize', place);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(place);
  });
}

export function initNav() {
  const links = [...document.querySelectorAll('[data-nav]')];
  const map = new Map(links.map((a) => [document.getElementById(a.dataset.nav), a]));
  const io = new IntersectionObserver((es) => {
    es.forEach((e) => {
      if (!e.isIntersecting) return;
      links.forEach((a) => a.removeAttribute('aria-current'));
      map.get(e.target).setAttribute('aria-current', 'true');
    });
  }, { rootMargin: '-35% 0px -55% 0px' });
  map.forEach((_, el) => el && io.observe(el));
}
