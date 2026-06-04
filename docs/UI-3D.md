# UI 3D — Style & scope

## Theme map (locked)

| Surface | Style | Tokens |
|---------|--------|--------|
| **Get Code** (`public/me/`) | Cinematic red-black | `--accent: #e50914`, deep `#0b0b10` bg, soft red glow, film-grain optional |
| **Admin** (`public/admin/`) | Cinematic red-black | Same as me; shared `public/panel/css/tokens.css` base |
| **Seller** (`public/seller/`) | Cyber glass green | `[data-theme="seller"]` — glass cards, `#46d369` accent, cool `#0f1623` bg |
| **Checker** (`public/user/checker`) | Cinematic red-black | Matches product brand; stat cards get T1 depth only |

**Not 3D:** data tables (keys, orders, products), forms, modals — stay flat 2D.

## Tiers

1. **T1** — CSS perspective / glass / elevation (`panel/css/depth.css`) — **done**
2. **T2** — Motion on stat chips (checker, seller dashboard)
3. **T3** — WebGL hero (me landing + checker header only), lazy-loaded

## Removed

Netflix clone demo (login / browse / profiles) is **out of scope** — no `apps/demo/`.
