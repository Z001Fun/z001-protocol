"""One-off: hash the word 2-grams and words of the reference site's copy so the originality gate can
compare without keeping the reference prose in this repo. Usage: python -I tools/mkrefgrams.py <ref.js> <ref.html> <ref.css>"""
import re, sys, json, hashlib

def words(t): return re.findall(r"[a-z0-9]+(?:'[a-z]+)?", t.lower())
h = lambda s: hashlib.sha1(s.encode()).hexdigest()[:10]
js = open(sys.argv[1], encoding='utf8').read()
html = open(sys.argv[2], encoding='utf8').read()
css = open(sys.argv[3], encoding='utf8').read()
chunks = []
for m in re.finditer(r'"((?:[^"\\n]|\.){6,400})"|`((?:[^`\]|\.){6,600})`|\'((?:[^\'\\n]|\.){6,400})\'', js):
    s = m.group(1) or m.group(2) or m.group(3)
    if ' ' in s and re.search(r'[a-zA-Z]{3,} [a-zA-Z]{2,}', s) and not re.search(r'[{};=<>]|function|=>|https?:', s):
        chunks.append(s)
for m in re.finditer(r'>([^<>{}]{6,})<', js): chunks.append(m.group(1))
chunks += re.findall(r'<title>(.*?)</title>', html) + re.findall(r'content="([^"]{10,})"', html) + re.findall(r'<!--(.*?)-->', html, re.S)
if len(sys.argv)>4: chunks += open(sys.argv[4],encoding='utf8').read().split(' | ')
bi, uni = set(), set()
for c in chunks:
    w = words(c)
    uni.update(w)
    bi.update(h(a + ' ' + b) for a, b in zip(w, w[1:]))
json.dump({'note': 'sha1/10 of lowercase words and word pairs from the reference copy', 'bigrams': sorted(bi), 'words': sorted(h(x) for x in uni)}, open('gates/ref-grams.json', 'w'))
print(len(chunks), 'chunks', len(bi), 'bigrams', len(uni), 'words')
