# UI — Monochrome primary

## Palette

| Token | Value |
|-------|--------|
| Background | `#0a0a0a` |
| Card | `#141414` |
| Border | `#2a2a2a` |
| Text | `#f5f5f5` / `#a3a3a3` / `#6b6b6b` |
| Accent (CTA) | `#ffffff` on dark (button text `#0a0a0a`) |

No red/green brand colors. Status uses brightness: **live** = white, **dead** = dim gray, **pending** = mid gray.

## Files

- `public/panel/css/tokens.css` — source of truth
- `public/panel/css/brand.css` — fonts, mesh, shells
- `public/panel/css/depth.css` — elevation
- `public/panel/css/seller-cyber.css` — seller dark overrides

## Depth (T1)

CSS perspective on cards/stats; optional grain via `depth.css`.
