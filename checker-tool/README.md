# Netflix Cookie Checker (standalone)

A self-contained version of the cookie checker, split out of the main panel so
it can run on its own — its own web UI + API, no Express, no database, no panel
dependencies.

## What it does

Paste one or more Netflix cookie strings (one set per line) and it verifies each
as **LIVE**, **plan lost**, **payment hold**, **cancelled**, or **dead** — using
the same logic as the main app:

- Direct `netflix.com/account` HTML check (plan, billing date, profiles, holds).
- Optional `nftoken.site` verification to catch client-side payment holds
  (controlled by `NFTOKEN_MODE`).
- Pace control (stealth / slow / normal) to avoid Netflix IP scanning.

## Run from source

Requires Node.js 18+.

```bash
cd checker-tool
npm start
# open http://localhost:3010
```

Change the port: `set PORT=4000 && npm start` (Windows) or `PORT=4000 npm start`.

## Build a Windows .exe

Uses [`pkg`](https://www.npmjs.com/package/pkg) to bundle Node + code + assets
into a single executable.

```bash
cd checker-tool
npm install
npm run build:exe
# → dist/netflix-checker.exe
```

Double-click the exe (or run it from a terminal), then open
`http://localhost:3010`. The `public/` UI and `lib/` code are embedded in the
exe via the `pkg.assets` config in `package.json`.

## Environment variables (optional)

| Variable             | Default   | Meaning                                                        |
|----------------------|-----------|----------------------------------------------------------------|
| `PORT`               | `3010`    | Web server port.                                               |
| `CHECK_PACE`         | `stealth` | Default pace: `stealth` \| `slow` \| `normal`.                 |
| `CHECK_MAX_PER_HOUR` | `50`      | Hourly check budget (anti-scan throttle).                      |
| `NFTOKEN_MODE`       | `fallback`| `off` \| `fallback` \| `parallel` — nftoken.site verification. |
| `VERIFY_LIVE_NFTOKEN`| `1`       | Set `0` to skip verifying HTML-only LIVE results with nftoken. |
| `CHECK_DEBUG`        | `0`       | Set `1` to log parsing details to the console.                 |

## Notes

- This tool sends cookies to `netflix.com` and (when enabled) `nftoken.site`.
  Run it only on machines you trust.
- It's a copy: improvements made here are independent of the main app.
