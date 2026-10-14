"""Palette gate: every palette colour is a real pixel; tokens.css and favicon.svg use only sampled colours."""
import json, re, sys
from pathlib import Path
from PIL import Image
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
pal = json.loads((ROOT / 'register' / 'palette.json').read_text(encoding='utf8'))
bad = 0
cache = {}
for c in pal['colors']:
    f = ROOT / c['file']
    im = cache.get(f) or cache.setdefault(f, Image.open(f).convert('RGBA'))
    px = im.getpixel((c['x'], c['y']))
    want = tuple(int(c['hex'][i:i + 2], 16) for i in (1, 3, 5))
    tol = 0 if f.suffix == '.png' else 4
    if px[3] < 200 or max(abs(a - b) for a, b in zip(px[:3], want)) > tol:
        print('FAIL pixel', c['token'], c['hex'], 'got', px); bad += 1
hexes = {c['hex'].lower() for c in pal['colors']}
tok = (ROOT / 'src' / 'styles' / 'tokens.css').read_text(encoding='utf8')
used = {h.lower() for h in re.findall(r'#[0-9a-fA-F]{6}\b', tok)}
for h in sorted(used - hexes):
    print('FAIL tokens.css hex not in palette', h); bad += 1
for h in sorted(hexes - used):
    print('FAIL palette hex missing from tokens.css', h); bad += 1
logo = np.asarray(Image.open(ROOT / 'brand' / 'LOGO Z001 PNG...png').convert('RGBA'))
flat = logo.reshape(-1, 4)
real = set(map(tuple, np.unique(flat[flat[:, 3] > 0][:, :3], axis=0)))
fav = (ROOT / 'public' / 'favicon.svg').read_text(encoding='utf8')
for h in sorted(set(re.findall(r'#[0-9a-fA-F]{6}\b', fav))):
    if tuple(int(h[i:i + 2], 16) for i in (1, 3, 5)) not in real:
        print('FAIL favicon colour is not a logo pixel', h); bad += 1
print('palette gate:', 'FAIL' if bad else 'ok', len(pal['colors']), 'colours')
sys.exit(1 if bad else 0)
