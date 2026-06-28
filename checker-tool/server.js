'use strict';

// Standalone Netflix Cookie Checker — zero-dependency mini HTTP server.
// Serves the checker UI + the 3 API endpoints the frontend calls.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { fullCheck } = require('./lib/checker-core');

const PORT = process.env.PORT || 3010;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 12 * 1024 * 1024) { req.destroy(); return; } // 12MB cap
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

// Serve a static file from PUBLIC_DIR. Returns true if handled.
function serveStatic(urlPath, res) {
  // Map shared asset prefixes used by the copied HTML (/css, /js, /panel).
  let rel = urlPath;
  if (rel === '/' || rel === '/checker') rel = '/checker.html';
  // Strip query string.
  rel = rel.split('?')[0];
  // Prevent path traversal.
  const safe = path.normalize(rel).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, safe);
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end('Forbidden'); return true; }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false;
  const ext = path.extname(filePath).toLowerCase();
  const data = fs.readFileSync(filePath);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': data.length });
  res.end(data);
  return true;
}

async function handler(req, res) {
  const url = req.url || '/';
  const method = (req.method || 'GET').toUpperCase();

  // ── API: ping ──────────────────────────────────────────────────────────────
  if (method === 'GET' && url.startsWith('/api/checker/ping')) {
    const { getNftokenMode, CHECK_PACES } = require('./lib/checker-core');
    return sendJson(res, 200, {
      ok: true, ts: Date.now(), version: 'standalone-1',
      nftokenMode: getNftokenMode(),
      checkPaces: Object.keys(CHECK_PACES),
      defaultPace: process.env.CHECK_PACE || 'stealth',
    });
  }

  // ── API: single live check ───────────────────────────────────────────────────
  if (method === 'POST' && url.startsWith('/api/checker/live-check')) {
    const body = await readBody(req);
    const cookie = body.cookie;
    if (!cookie || typeof cookie !== 'string') return sendJson(res, 400, { error: 'Missing cookie' });
    try {
      const result = await fullCheck(cookie, body.pace);
      return sendJson(res, 200, result);
    } catch (e) {
      const limited = e.code === 'RATE_LIMIT';
      return sendJson(res, limited ? 429 : 500, { alive: false, error: limited ? e.message : 'Internal error', profiles: [], rateLimited: limited });
    }
  }

  // ── API: debug (simple — runs a full check and returns the raw verdict) ──────
  if (method === 'POST' && url.startsWith('/api/checker/debug')) {
    const body = await readBody(req);
    const cookie = body.cookie;
    if (!cookie || typeof cookie !== 'string') return sendJson(res, 400, { error: 'no cookie' });
    try {
      const result = await fullCheck(cookie, body.pace);
      return sendJson(res, 200, { verdict: result });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  // ── Static files ─────────────────────────────────────────────────────────────
  if (method === 'GET') {
    if (serveStatic(url, res)) return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
}

const server = http.createServer(handler);
server.listen(PORT, () => {
  console.log(`\n  Netflix Cookie Checker (standalone)`);
  console.log(`  Listening: http://localhost:${PORT}\n`);
});
