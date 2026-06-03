'use strict';

// Detect subdomain từ Host header. Hỗ trợ:
//   - Production: me.example.com, seller.example.com, admin.example.com
//   - Local hosts: me.netflix.local, seller.netflix.local, admin.netflix.local
//   - lvh.me: me.lvh.me:3002, ...
//   - localhost trần (không subdomain) → 'main'
//
// Cơ chế: chỉ nhận diện subdomain nằm trong allow-list KNOWN_SUBS (label đầu của
// hostname). Mọi host khác (apex domain, www, IP, localhost) → 'main'.

const KNOWN_SUBS = new Set(['me', 'seller', 'admin']);

function parseSubdomain(hostHeader) {
  const host = String(hostHeader || '').split(':')[0].toLowerCase().trim();
  if (!host) return 'main';

  const labels = host.split('.');
  // IP hoặc localhost trần → main
  if (host === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return 'main';

  const first = labels[0];
  if (KNOWN_SUBS.has(first)) return first;

  // Không khớp allow-list → coi như domain chính
  return 'main';
}

// Middleware: gắn req.subdomain
function subdomainMiddleware(req, res, next) {
  req.subdomain = parseSubdomain(req.headers.host);
  next();
}

module.exports = { parseSubdomain, subdomainMiddleware, KNOWN_SUBS };
