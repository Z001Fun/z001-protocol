// Static build: register -> markup, assets -> dist/. No dependencies.
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderSlots } from '../src/render.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function tokenValue(name, root = ROOT) {
  const css = readFileSync(join(root, 'src/styles/tokens.css'), 'utf8');
  const m = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) throw new Error('token missing: ' + name);
  return m[1];
}

/** Builds into outDir from a register object (default: register/register.json). */
export function build({ register, outDir = join(ROOT, 'dist'), root = ROOT } = {}) {
  const reg = register || JSON.parse(readFileSync(join(root, 'register/register.json'), 'utf8'));
  const slots = renderSlots(reg);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(join(outDir, 'assets/js'), { recursive: true });
  cpSync(join(root, 'public'), outDir, { recursive: true });
  cpSync(join(root, 'src/styles'), join(outDir, 'assets'), { recursive: true });
  cpSync(join(root, 'src/js'), join(outDir, 'assets/js'), { recursive: true });
  let html = readFileSync(join(root, 'src/index.html'), 'utf8');
  const all = { ...slots, night: tokenValue('night', root) };
  html = html.replace(/<!--@(\w+)-->/g, (_, k) => {
    if (!(k in all)) throw new Error('unknown slot ' + k);
    return all[k];
  });
  writeFileSync(join(outDir, 'index.html'), html);
  writeFileSync(join(outDir, '_headers'), '/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n/assets/*\n  Cache-Control: public, max-age=3600\n');
  return { outDir, html };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { outDir } = build();
  console.log('built ->', outDir);
}
