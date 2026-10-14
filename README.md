# Z001

**Crowned by code.** A pixel-royal stage for tokens on Solana.

[![Live site](https://img.shields.io/badge/live%20site-z001.fun-3fc822?style=flat-square)](https://z001.fun)
![Chain](https://img.shields.io/badge/chain-Solana-8dfa90?style=flat-square)

| | |
|---|---|
| Chain | Solana |
| Contract address | `pending` |

## Overview

Z001 is the public face of a bitmap-styled project: a crowned green coin, a swarm of tireless automatons, and a stage for projects that want one. The site carries a streaming read on the ten busiest Solana tokens, a ledger of confirmed facts, and a short road map.

## Features

- Streaming market board: ten busiest Solana tokens by daily volume, with logo, price, change, volume, liquidity and a copy button per address.
- Ticker fed by the same data, with skeleton loading, backoff on failure and a pause while the tab is hidden.
- Contract slot at the top of the page, large and click-to-copy once an address is confirmed.
- Fact register: every external claim is one record, and anything unconfirmed renders as an inert placeholder.
- Spring-driven reveals, layered parallax, spotlight hover and a full reduced-motion fallback.

## Links

- Site: https://z001.fun
- X: pending
- GitHub: pending
- Whitepaper: [docs/whitepaper.md](docs/whitepaper.md)

## Develop

```bash
npm run assets   # regenerate icons and art plate from brand/ and reference/
npm run build    # writes dist/
npm run gates    # release gates
npm run serve    # preview dist/ on http://localhost:4173
```

Deploy by dragging `dist/` to Cloudflare Pages.

## License

MIT. See [LICENSE](LICENSE).
