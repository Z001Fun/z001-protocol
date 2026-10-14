"""Derives every raster/vector asset in public/ from brand/ and reference/.
Resizes are done on premultiplied RGBA because the transparent regions of the
alpha logo are stored as pure black RGB (colortype 6, all alpha==0 pixels rgb 0,0,0)."""
import json, sys
import numpy as np
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
LOGO = ROOT / 'brand' / 'LOGO Z001 PNG...png'
SCENE = ROOT / 'reference' / 'Z001 3.jpg.jpeg'
OUT = ROOT / 'public'
OUT.mkdir(exist_ok=True)


def premul_resize(img, size):
    a = np.asarray(img.convert('RGBA')).astype(np.float64)
    al = a[..., 3:4] / 255.0
    pm = np.concatenate([a[..., :3] * al, a[..., 3:4]], axis=-1)
    chans = [Image.fromarray(pm[..., i].astype(np.float32), mode='F').resize(size, Image.LANCZOS) for i in range(4)]
    r = np.stack([np.asarray(c) for c in chans], axis=-1)
    alpha = np.clip(r[..., 3:4], 0, 255)
    rgb = np.where(alpha > 0, r[..., :3] / np.maximum(alpha / 255.0, 1e-6), 0)
    out = np.concatenate([np.clip(rgb, 0, 255), alpha], axis=-1)
    return Image.fromarray(np.rint(out).astype(np.uint8), 'RGBA')


logo = Image.open(LOGO).convert('RGBA')
arr = np.asarray(logo)
ys, xs = np.nonzero(arr[..., 3] > 0)
x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
print('logo bbox', x0, y0, x1, y1)
crop = logo.crop((x0, y0, x1, y1))
w, h = crop.size


def square(img, side, pad):
    inner = side - 2 * pad
    s = min(inner / img.width, inner / img.height)
    sz = (max(1, round(img.width * s)), max(1, round(img.height * s)))
    r = premul_resize(img, sz)
    canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    canvas.paste(r, ((side - sz[0]) // 2, (side - sz[1]) // 2))
    return canvas


square(crop, 512, 24).save(OUT / 'logo-512.png', optimize=True)
square(crop, 192, 10).save(OUT / 'logo-192.png', optimize=True)
square(crop, 180, 14).save(OUT / 'apple-touch-icon.png', optimize=True)

# ---- favicon: trace the real pixel grid ----
A = arr[y0:y1, x0:x1]
solid = A[..., 3] >= 128
rgb = A[..., :3].astype(int)
diff = (np.abs(np.diff(rgb, axis=1)).sum(-1) > 90) | (np.diff(solid.astype(int), axis=1) != 0)
colhist = diff.sum(0).astype(float)
rowdiff = (np.abs(np.diff(rgb, axis=0)).sum(-1) > 90) | (np.diff(solid.astype(int), axis=0) != 0)
rowhist = rowdiff.sum(1).astype(float)


def period(hist):
    best = (0, None)
    for p10 in range(200, 400):
        p = p10 / 10
        idx = np.arange(1, len(hist) + 1)
        score = 0
        for k in range(1, int(len(hist) / p)):
            pos = int(round(k * p))
            if pos < len(hist):
                score += hist[max(0, pos - 2):pos + 2].sum()
        norm = score / max(1, int(len(hist) / p))
        if norm > best[0]:
            best = (norm, p)
    return best[1]


# the logo sits on a regular lattice, so use the shared lattice period of both axes
pc, pr = period(colhist), period(rowhist)
cell = pr  # the row axis shows the cleaner lattice peak; the art is square-celled
cols, rows = round(w / cell), round(h / cell)
print('cell', pc, pr, '->', cols, 'x', rows)
cw, ch_ = w / cols, h / rows
grid = []
for r in range(rows):
    line = []
    for c in range(cols):
        cx, cy = int((c + .5) * cw), int((r + .5) * ch_)
        hx, hy = max(1, int(cw * .2)), max(1, int(ch_ * .2))
        blk = A[max(0, cy - hy):cy + hy, max(0, cx - hx):cx + hx].reshape(-1, 4)
        if np.median(blk[:, 3]) < 128:
            line.append(None)
        else:
            med = np.median(blk[:, :3], axis=0)
            pick = blk[np.argmin(((blk[:, :3].astype(float) - med) ** 2).sum(1))]  # a real pixel, not an average
            line.append(tuple(int(v) for v in pick[:3]))
    grid.append(line)

# collapse near-duplicate cell colours to the nearest real sampled cell colour
from sklearn.cluster import KMeans
cells = sorted({v for ln in grid for v in ln if v})
K = min(14, len(cells))
allc = np.array([v for ln in grid for v in ln if v])
km = KMeans(K, n_init=3, random_state=1).fit(allc)
lab = dict(zip(cells, km.predict(np.array(cells))))
snap = {}
for v in cells:
    c = km.cluster_centers_[lab[v]]
    members = [u for u in cells if lab[u] == lab[v]]
    snap[v] = min(members, key=lambda u: sum((a - b) ** 2 for a, b in zip(u, c)))
grid = [[None if v is None else '#%02x%02x%02x' % snap[v] for v in ln] for ln in grid]

used = [[False] * cols for _ in range(rows)]
rects = []
for r in range(rows):
    for c in range(cols):
        col = grid[r][c]
        if col is None or used[r][c]:
            continue
        wd = 1
        while c + wd < cols and grid[r][c + wd] == col and not used[r][c + wd]:
            wd += 1
        ht = 1
        while r + ht < rows and all(grid[r + ht][c + i] == col and not used[r + ht][c + i] for i in range(wd)):
            ht += 1
        for j in range(ht):
            for i in range(wd):
                used[r + j][c + i] = True
        rects.append((c, r, wd, ht, col))

side = max(cols, rows)
ox, oy = (side - cols) / 2, (side - rows) / 2
body = ''.join('<rect x="%s" y="%s" width="%d" height="%d" fill="%s"/>' % (
    ('%g' % (c + ox)), ('%g' % (r + oy)), wd, ht, col) for c, r, wd, ht, col in rects)
svg = ('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 %d %d" '
       'shape-rendering="crispEdges">%s</svg>\n' % (side, side, body))
assert '--' not in svg
(OUT / 'favicon.svg').write_text(svg, encoding='utf8')
print('favicon rects', len(rects), 'bytes', len(svg))

# ---- hero art plate and share image from the scene reference ----
sc = Image.open(SCENE).convert('RGB')
sc.crop((640, 60, 1600, 900)).save(OUT / 'hero-plate.jpg', quality=84, optimize=True)
sc.resize((1200, 675), Image.LANCZOS).save(OUT / 'share.jpg', quality=84, optimize=True)
print('ok')
