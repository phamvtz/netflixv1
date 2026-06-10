const express = require('express');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

(function loadEnvFile() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] == null || process.env[key] === '') process.env[key] = val;
  }
})();
const https = require('https');
const http = require('http');
const zlib = require('zlib');
const { v4: uuidv4 } = require('uuid');
const { nfExtractEmailFromHtml, nfDetectPaymentHold, nfAccountPagePaymentHold } = require('./lib/nf-email-parse');
const {
  nfHasPaymentElement,
  nfHasActiveMembershipSignals,
  nfHasActiveFutureBilling,
  nfBillingIsFuture,
  nfResolveSubscriptionStatus,
} = require('./lib/nf-account-live');

// SQLite — initialize singleton before routes use the query layer
require('./db/database');
const { runMigrations } = require('./db/migrate');
const { runSeed } = require('./db/seed');
const {
  deleteExpiredSessions,
  createKey,
  getKey,
  resolveKeyEmail,
  incrementKeyUsage,
  updateKey,
  clampKeyPerms,
  clampKeyPermsFull,
  getSellerMaxPerms,
  setSellerPerms,
  getAllKeys,
  getKeysBySeller,
  getKeysBySellerEnriched,
  deleteKey,
  deleteKeyForSeller,
  syncKeyFromOrder,
  getAdminStats,
  getAllUsers,
  createAccount,
  getAccountByUsername,
  getAccountByEmail,
  getAccountById,
  setAccountPassword,
  setVerifyCode,
  markEmailVerified,
  setAccountStatus,
  getSellers,
  getPendingSellers,
  createPanelSession,
  getPanelSession,
  deletePanelSession,
} = require('./db/queries');
const {
  getProducts,
  upsertProduct,
  getSellerBalance,
  adjustBalance,
  getTransactions,
  getTransactionSummary,
  getSellerOrders,
  getSellerOrderById,
  getOrderCookie,
  recordOrderCheck,
  listOrdersDueForCheck,
  updateSellerOrder,
  renewSellerOrder,
  getOrderHistory,
  getSellerEmails,
  getSellerDashboardStats,
  purchaseProduct,
  migrateOrphanKeysToOrders,
  updateSellerProfile,
  getSellerProfile,
  adminCreateOrderForSeller,
  getOrderByEmailForInbox,
  getProductById,
  logOrderEvent,
  recordDepositIntent,
  findDepositIntentByRef,
  listRecentDepositIntents,
  getDepositIntentsBySeller,
  listUnmatchedDepositIntents,
  assignDepositIntent,
} = require('./db/queries-orders');
const { subdomainMiddleware } = require('./subdomain');
const { verifyPassword, hashPassword } = require('./auth');
const { sendVerificationEmail } = require('./mailer');

// Only disable TLS verification when truly needed to debug cert errors — keep security ON by default.
// The sites we use (netflix.com, cloudflare, nftoken.site...) all have valid certs.
if (process.env.INSECURE_TLS === '1') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  console.warn('[SECURITY] TLS verification DISABLED (INSECURE_TLS=1)');
}

// Admin token: prefer env. If unset → generate random on each startup
// (printed to console) instead of an easy-to-guess default.
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || crypto.randomBytes(24).toString('hex');
const ADMIN_TOKEN_GENERATED = !process.env.ADMIN_TOKEN;

// ─── HTTP client (ported from D:\net) ─────────────────────────────────────────
function nodeRequest(url, options = {}) {
  const timeoutMs = options.timeout || 20000;
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const isPost = (options.method || 'GET').toUpperCase() === 'POST';
    const bodyBuf = Buffer.from(options.body || '', 'utf8');
    const reqOpts = {
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method: options.method || 'GET',
      headers: { ...(options.headers || {}), ...(isPost ? { 'Content-Length': bodyBuf.length } : {}) },
    };
    const req = lib.request(reqOpts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const rawBuf = Buffer.concat(chunks);
        const enc = (res.headers['content-encoding'] || '').toLowerCase();
        const decompress = (buf) => new Promise((ok, fail) => {
          if (enc === 'gzip' || enc === 'x-gzip') zlib.gunzip(buf, (e, d) => e ? fail(e) : ok(d));
          else if (enc === 'deflate') zlib.inflate(buf, (e, d) => e ? zlib.inflateRaw(buf, (e2, d2) => e2 ? fail(e2) : ok(d2)) : ok(d));
          else if (enc === 'br') zlib.brotliDecompress(buf, (e, d) => e ? fail(e) : ok(d));
          else ok(buf);
        });
        decompress(rawBuf).then(buf => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            buffer: buf,
            text: () => buf.toString('utf8'),
            json: () => JSON.parse(buf.toString('utf8').replace(/^﻿/, '')),
          });
        }).catch(reject);
      });
    });
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
    if (isPost && bodyBuf.length) req.write(bodyBuf);
    req.end();
  });
}

// Pool UA + sec-ch-ua khớp nhau — xoay để mỗi request trông như browser khác nhau,
// giảm khả năng Netflix nhận diện pattern bot từ cùng 1 fingerprint cố định.
const NF_UA_POOL = [
  {
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
    chUa: '"Chromium";v="146", "Google Chrome";v="146", "Not?A_Brand";v="24"',
    platform: '"Windows"',
  },
  {
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0',
    chUa: '"Chromium";v="146", "Microsoft Edge";v="146", "Not?A_Brand";v="24"',
    platform: '"Windows"',
  },
  {
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
    chUa: '"Chromium";v="146", "Google Chrome";v="146", "Not?A_Brand";v="24"',
    platform: '"macOS"',
  },
];

// Một "phiên browser" cố định cho cả warmup + /account (không đổi UA giữa 2 request).
function createNetflixBrowserSession(cookieStr, extra = {}) {
  const p = NF_UA_POOL[Math.floor(Math.random() * NF_UA_POOL.length)];
  const common = {
    'User-Agent': p.ua,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br',
    'Upgrade-Insecure-Requests': '1',
    'sec-ch-ua': p.chUa,
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': p.platform,
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-User': '?1',
    'Cache-Control': 'max-age=0',
    Cookie: cookieStr.trim(),
    ...extra,
  };
  return {
    home: {
      ...common,
      'Sec-Fetch-Site': 'none',
    },
    account: {
      ...common,
      'Sec-Fetch-Site': 'same-origin',
      Referer: 'https://www.netflix.com/browse',
    },
  };
}

function buildNetflixHeaders(extra = {}) {
  const p = NF_UA_POOL[Math.floor(Math.random() * NF_UA_POOL.length)];
  return {
    'User-Agent': p.ua,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': 'en-US,en;q=0.9',
    'Upgrade-Insecure-Requests': '1',
    'sec-ch-ua': p.chUa,
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': p.platform,
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-User': '?1',
    'Referer': 'https://www.netflix.com/',
    'Cache-Control': 'max-age=0',
    ...extra,
  };
}

// Giữ tương thích ngược cho code cũ còn tham chiếu NETFLIX_HEADERS.
const NETFLIX_HEADERS = buildNetflixHeaders();

// Delay ngẫu nhiên (ms) — tránh pattern request đều đặn dễ bị quét.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const randDelay = (min = 800, max = 2500) =>
  sleep(min + Math.floor(Math.random() * Math.max(1, max - min)));

// Tốc độ check — chậm = ít request, ít burst, khó bị Netflix gắn bot.
const CHECK_PACES = {
  normal: {
    preMin: 800, preMax: 2500, gapMin: 1500, gapMax: 4000,
    warmupMin: 0, warmupMax: 0, betweenMin: 0, betweenMax: 0,
    nftMin: 0, nftMax: 800, skipNftoken: false, warmup: false,
  },
  slow: {
    preMin: 5000, preMax: 11000, gapMin: 12000, gapMax: 25000,
    warmupMin: 800, warmupMax: 2200, betweenMin: 1200, betweenMax: 3500,
    nftMin: 0, nftMax: 0, skipNftoken: true, warmup: true,
  },
  stealth: {
    preMin: 10000, preMax: 22000, gapMin: 20000, gapMax: 45000,
    warmupMin: 1500, warmupMax: 4000, betweenMin: 2500, betweenMax: 6000,
    nftMin: 0, nftMax: 0, skipNftoken: true, warmup: true,
  },
};

const CHECK_MAX_PER_HOUR = Math.max(10, parseInt(process.env.CHECK_MAX_PER_HOUR || '50', 10) || 50);
const checkRateState = { windowStart: Date.now(), count: 0 };

function assertCheckRateLimit() {
  const now = Date.now();
  if (now - checkRateState.windowStart > 3600000) {
    checkRateState.windowStart = now;
    checkRateState.count = 0;
  }
  checkRateState.count += 1;
  if (checkRateState.count > CHECK_MAX_PER_HOUR) {
    const err = new Error(`Reached ${CHECK_MAX_PER_HOUR} checks/hour — wait ~${Math.ceil((3600000 - (now - checkRateState.windowStart)) / 60000)} minutes to avoid Netflix IP scanning`);
    err.code = 'RATE_LIMIT';
    throw err;
  }
}

function resolveCheckPace(id) {
  const key = String(id || process.env.CHECK_PACE || 'stealth').toLowerCase().trim();
  const cfg = CHECK_PACES[key] || CHECK_PACES.stealth;
  return { ...cfg, key: CHECK_PACES[key] ? key : 'stealth' };
}

const CHECK_DEBUG = String(process.env.CHECK_DEBUG || '').toLowerCase() === '1';
function nfLog(...args) {
  if (CHECK_DEBUG) console.log(...args);
}

function isNetflixPremiumPlan(planStr) {
  if (!planStr || typeof planStr !== 'string') return false;
  const lower = planStr.toLowerCase().trim();
  const expired = ['expired', 'cancelled', 'canceled', 'inactive', 'no plan', 'no active', 'ended', 'hết hạn', 'đã huỷ'];
  if (expired.some(kw => lower.includes(kw))) return false;
  const nonPremium = ['ads', 'free', 'with ads', 'standard with ads', 'basic with ads'];
  if (nonPremium.some(kw => lower.includes(kw))) return false;
  return true;
}

// ─── Netflix HTML parser suite (ported from D:\net) ──────────────────────────

function nfClean(value) {
  if (value == null) return '';
  // Guard String.fromCodePoint against RangeError (invalid code points crash Node)
  const safeCodePoint = (n) => { try { return String.fromCodePoint(n); } catch { return ''; } };
  return String(value)
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#x([0-9a-fA-F]+);/g,  (_, h) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g,            (_, d) => safeCodePoint(parseInt(d, 10)))
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/g, "'")
    .replace(/\\"/g, '"').replace(/\\\//g, '/').replace(/\s+/g, ' ').trim();
}

function nfVisibleLines(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:div|p|h[1-6]|li|section|article|button|span)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .split(/\n+/)
    .map(l => nfClean(l))
    .filter(Boolean);
}

function nfJsonValues(html, keys) {
  const values = [];
  for (const key of keys) {
    const re = new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\]){1,240})"`, 'gi');
    for (const m of String(html || '').matchAll(re)) {
      const v = nfClean(m[1]);
      if (v && !values.includes(v)) values.push(v);
    }
  }
  return values;
}

const NF_DATE_PATS = [
  /(?:Ngày\s*)?\d{1,2}\s+tháng\s+\d{1,2}\s+năm\s+\d{4}/i,
  /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{4}\b/i,
  /\b\d{1,2}\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{4}\b/i,
  /\b\d{4}-\d{2}-\d{2}\b/,
  /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/,
];
function nfExtractDate(value) {
  const text = nfClean(value);
  if (!text) return null;
  for (const pat of NF_DATE_PATS) { const m = text.match(pat); if (m) return nfClean(m[0]); }
  return null;
}

function nfExtractBilling(html) {
  if (!html) return null;
  // Extended key list — Netflix has changed key names multiple times
  const dateKeys = [
    'nextBillingDate','nextPaymentDate','nextPayment','billingDate',
    'renewalDate','currentBillingPeriodEndDate','subscriptionEndDate',
    'membershipEndDate','nextChargeDate','periodEndDate',
  ];
  for (const v of nfJsonValues(html, dateKeys)) {
    const d = nfExtractDate(v); if (d) return d;
  }
  // membershipStatus object — often contains billing dates nested
  const mStatusMatch = html.match(/"membershipStatus"\s*:\s*\{([^}]{1,600})\}/);
  if (mStatusMatch) {
    const d = nfExtractDate(mStatusMatch[1]);
    if (d) return d;
  }
  // Visible text approach
  const text  = nfVisibleLines(html).join(' ');
  const lower = text.toLowerCase();
  const labels = [
    'next payment','next billing','renews on','renewal date','billed on',
    'thanh toán tiếp theo','ngày thanh toán tiếp theo','lần thanh toán tiếp theo',
    'วันที่เรียกเก็บเงินถัดไป', // Thai
  ];
  for (const label of labels) {
    const idx = lower.indexOf(label);
    if (idx === -1) continue;
    const d = nfExtractDate(text.slice(idx, idx + 320));
    if (d) return d;
  }
  return null;
}

function nfExtractPlan(html) {
  if (!html) return null;
  // Extended key list
  const planKeys = [
    'planName','planLabel','planDisplayName','currentPlanName','localizedPlanName',
    'membershipPlanName','planTitle','subscriptionPlanName','currentPlanDisplayName',
    'userPlanName','planNameForDisplay',
  ];
  for (const v of nfJsonValues(html, planKeys)) {
    // Match known plan tiers
    const m = v.match(/\b(?:Ultra|Premium|Standard|Basic|Mobile)(?:\+|\s+(?:with\s+Ads|Ads))?\b/i)
           || v.match(/Gói\s+(?:cao cấp|tiêu chuẩn|cơ bản|di động)/i)
           || v.match(/(?:แผน|แพ็กเกจ)\s*(?:พรีเมียม|มาตรฐาน|พื้นฐาน|มือถือ)/i); // Thai
    if (m) return nfClean(m[0]);
    if (v.length >= 3 && v.length < 60 && !v.includes('http') && !v.includes('{')) return nfClean(v);
  }
  // Visible text fallback — works for English AND Thai UI
  const PLAN_RE = /\b(?:Ultra|Premium|Standard|Basic|Mobile)(?:\+|\s+(?:with\s+Ads|Ads))?\b/i;
  const VI_PLAN_RE = /Gói\s+(?:Cao cấp|Tiêu chuẩn|Cơ bản|Di động)/i;
  const THAI_RE = /(?:Netflix\s+)?(?:พรีเมียม|มาตรฐาน|พื้นฐาน|มือถือ|เบสิก|สแตนดาร์ด)/;
  const lines = nfVisibleLines(html);
  for (const line of lines) {
    const m = line.match(PLAN_RE) || line.match(VI_PLAN_RE) || line.match(THAI_RE);
    if (m && line.length < 100) return nfClean(m[0]);
  }
  // Last resort: raw regex on full HTML
  const raw = html.match(PLAN_RE) || html.match(VI_PLAN_RE) || html.match(THAI_RE);
  if (raw) return nfClean(raw[0]);
  return null;
}

function nfPushProfile(profiles, rawName) {
  const name = nfClean(rawName);
  if (!name || /^\d+$/.test(name) || profiles.includes(name)) return;
  profiles.push(name);
}

function nfBillingLooksLikeMemberSince(text) {
  return /thành viên từ|member since/i.test(String(text || ''));
}

const NF_CANCEL_KW = [
  'ends on','end on','membership ends','will end','membership will end',
  'cancellation','cancelled','canceled','your membership ends','has been cancelled','has been canceled',
  'reactivate membership','restart membership',
  'kết thúc','hết hạn vào','đã hủy','sẽ kết thúc','đã bị hủy','chấm dứt','kích hoạt lại',
];
/** Visible payment-failure copy only — avoid matching JSON keys or "update payment method". */
const NF_PAYERR_PHRASES = [
  'payment failed', 'payment unsuccessful', 'unable to process your payment',
  "couldn't process your payment", 'problem with your payment', 'payment method was declined',
  'account is on hold', 'your account is on hold', 'on hold. retry', 'retry your payment',
  'thanh toán không thành công', 'không thể xử lý khoản thanh toán',
  'cập nhật thông tin thanh toán để tiếp tục',
];

function nfAccountPaymentError(html) {
  const low = String(html || '').toLowerCase();
  if (NF_PAYERR_PHRASES.some((p) => low.includes(p))) return true;
  return /"(?:paymentIssue|paymentError|paymentFailed|billingIssue)"\s*:\s*(?:true|1|"true")/i.test(html || '');
}

// ─── Netflix account check — simple & accurate ────────────────────────────────
// Logic: GET /account với cookie → check element data-uia cụ thể
//   Có "account-overview-page+membership-card+payment+details" → LIVE
//   Không có → subscription ended / cancelled
async function fetchNetflixAccountInfo(cookieStr, pace) {
  try {
    const cookie = cookieStr.trim();
    const p = pace || resolveCheckPace();
    const session = createNetflixBrowserSession(cookie);

    await randDelay(p.preMin, p.preMax);

    let browsePaymentHold = false;
    // Warmup: vào trang chủ/browse trước (giống user thật) — chỉ slow/stealth
    if (p.warmup) {
      try {
        const browseRes = await nodeRequest('https://www.netflix.com/browse', {
          method: 'GET', headers: session.home, timeout: 12000,
        });
        if (browseRes.status === 200) browsePaymentHold = nfDetectPaymentHold(browseRes.text());
      } catch { /* bỏ qua — vẫn thử /account */ }
      await randDelay(p.warmupMin, p.warmupMax);
      await randDelay(p.betweenMin, p.betweenMax);
    }

    const res = await nodeRequest('https://www.netflix.com/account', {
      method: 'GET', headers: session.account, timeout: 15000,
    });

    // Redirect → cookie expired/invalid
    if (res.status === 301 || res.status === 302) return { reachable: false, reason: 'redirect→login' };
    if (res.status !== 200) return { reachable: false, reason: `HTTP ${res.status}` };

    let html = res.text();
    if (!html || html.length < 3000) return { reachable: false, reason: 'empty' };

    let membershipHtml = '';
    try {
      await randDelay(350, 900);
      const memRes = await nodeRequest('https://www.netflix.com/account/membership', {
        method: 'GET', headers: session.account, timeout: 15000,
      });
      if (memRes.status === 200) {
        membershipHtml = memRes.text() || '';
        if (membershipHtml.length > 2000) html += `\n<!-- membership -->\n${membershipHtml}`;
      }
    } catch { /* optional — /account alone is enough when it fails */ }

    // ── PRIMARY LIVE SIGNAL ────────────────────────────────────────────────────
    // Signal 1: payment details element (CC, PayPal, carrier, gift card)
    const hasPaymentEl = nfHasPaymentElement(html);

    // Log all membership-related data-uia attributes found
    const uiaAll = [...html.matchAll(/data-uia="([^"]+)"/g)].map(m => m[1]);
    const uiaMembership = uiaAll.filter(a => a.includes('membership') || a.includes('plan') || a.includes('payment'));
    nfLog(`[NF] status=${res.status} len=${html.length} paymentEl=${hasPaymentEl}`);
    if (uiaMembership.length) nfLog(`[NF-UIA]`, uiaMembership.join(', '));
    const emailDbg = nfExtractEmailFromHtml(html);
    nfLog(`[NF-EMAIL]`, emailDbg || '(not found)');
    const allProfileNames = [...html.matchAll(/"profileName"\s*:\s*"([^"]{1,50})"/g)].map(m=>m[1]).slice(0,5);
    if (allProfileNames.length) nfLog(`[NF-PROFILES]`, allProfileNames);

    // ── PLAN — data-uia attribute (most reliable) ──────────────────────────────
    let plan = null;
    const planUia = html.match(/data-uia="account-overview-page\+membership-card\+title"[^>]*>\s*([^<]{2,60})/);
    if (planUia) plan = nfClean(planUia[1]);
    if (!plan) plan = nfExtractPlan(html);

    // Hold on /account: strict phrases only (browse uses full nfDetectPaymentHold)
    let accountPaymentHold = nfAccountPagePaymentHold(html);
    let paymentHold = browsePaymentHold || accountPaymentHold;
    const htmlLow = html.toLowerCase();
    let paymentError = paymentHold || nfAccountPaymentError(html);

    // ── BILLING DATE — data-uia attribute ──────────────────────────────────────
    let billingText = null;
    const billUia = html.match(/data-uia="account-overview-page\+membership-card\+description"[^>]*>\s*([^<]{4,120})/);
    if (billUia) billingText = nfClean(billUia[1]);
    if (!billingText) billingText = nfExtractBilling(html);
    if (membershipHtml && (!billingText || nfBillingLooksLikeMemberSince(billingText))) {
      const memBilling = nfExtractBilling(membershipHtml);
      if (memBilling) billingText = memBilling;
    }
    if (!billingText || nfBillingLooksLikeMemberSince(billingText)) {
      const scraped = nfExtractBilling(html);
      if (scraped && !nfBillingLooksLikeMemberSince(scraped)) billingText = scraped;
    }

    const membershipActiveUi = nfHasActiveMembershipSignals(html, billingText);
    // Browse-only hold banner often false-positives; trust /account when membership UI is clearly active
    if (browsePaymentHold && !accountPaymentHold && membershipActiveUi) {
      browsePaymentHold = false;
      paymentHold = false;
      paymentError = nfAccountPaymentError(html);
    }

    const futureBillingOnAccount = !!(plan && billingText && nfHasActiveFutureBilling(html, billingText));

    // Browse popup hold — skip when /account already shows a future next payment date
    let browseVerifyHold = false;
    if (plan && !paymentHold && !futureBillingOnAccount) {
      try {
        await randDelay(400, 1200);
        const br = await nodeRequest('https://www.netflix.com/browse', {
          method: 'GET', headers: session.home, timeout: 12000,
        });
        if (br.status === 200) {
          browseVerifyHold = nfDetectPaymentHold(br.text());
          if (browseVerifyHold && (!membershipActiveUi || accountPaymentHold)) paymentHold = true;
        }
      } catch { /* bỏ qua */ }
    }

    // ── EMAIL ──────────────────────────────────────────────────────────────────
    const emailFromHtml = nfExtractEmailFromHtml(html);

    // ── PROFILES ──────────────────────────────────────────────────────────────
    const profiles = [];
    // Method 1: JSON "profileName" key
    for (const m of html.matchAll(/"profileName"\s*:\s*"((?:\\.|[^"\\]){1,80})"/g)) {
      nfPushProfile(profiles, m[1]);
    }
    // Method 2: profiles array in JSON
    if (!profiles.length) {
      const raw = html.match(/"profiles"\s*:\s*(\[[\s\S]{1,8000}?\])/)?.[1];
      if (raw) {
        try {
          for (const p of JSON.parse(raw)) {
            nfPushProfile(profiles, p?.summary?.profileName || p?.profileName || p?.name || '');
          }
        } catch {}
      }
    }
    // Method 3: data-uia SSR
    if (!profiles.length) {
      for (const m of html.matchAll(/data-uia="profile-name"[^>]*>\s*([^<]+)/g)) {
        nfPushProfile(profiles, m[1]);
      }
    }
    // Method 4: "displayName" in profile objects
    if (!profiles.length) {
      for (const m of html.matchAll(/"displayName"\s*:\s*"((?:\\.|[^"\\]){1,80})"/g)) {
        nfPushProfile(profiles, m[1]);
      }
    }

    const resolved = nfResolveSubscriptionStatus({
      html,
      plan,
      billingText,
      profiles,
      accountPaymentHold,
      paymentHold,
      paymentError,
      membershipActiveUi,
    });
    paymentHold = resolved.paymentHold;
    paymentError = resolved.paymentError;
    billingText = resolved.billingText || billingText;
    const subscriptionActive = resolved.subscriptionActive;
    const isLive = resolved.isLive;
    const planLost = resolved.planLost;
    const membershipEnded = !!resolved.cancelled;
    nfLog(`[NF] plan=${plan || '-'} billing=${billingText || '-'} profiles=${profiles.length} activeUi=${resolved.membershipActiveUi} futureBill=${resolved.futureBilling} profLive=${resolved.planProfiles} hold=${paymentHold} live=${isLive} planLost=${planLost} ended=${membershipEnded}`);

    return {
      reachable:    true,
      alive:        isLive,
      cancelled:    membershipEnded || (!subscriptionActive && !paymentHold && !planLost),
      planLost,
      plan,
      billingText,
      profiles,
      paymentError,
      paymentHold,
      accountPaymentHold,
      futureBilling: resolved.futureBilling,
      browsePaymentHold: browsePaymentHold || browseVerifyHold,
      emailFromHtml,
    };
  } catch (e) {
    return { reachable: false, error: e.message };
  }
}

// Real Netflix cookie checker — uses nftoken.site
async function checkAccountDetails(cookieStr) {
  try {
    // nftoken.site only needs NetflixId onwards (same as D:\net)
    let cookie = cookieStr.trim();
    const idx = cookie.indexOf('NetflixId=');
    if (idx > 0) cookie = cookie.substring(idx);

    const bodyStr = new URLSearchParams({ raw_cookie: cookie, ajax: '1', is_bulk: '1' }).toString();
    const result = await nodeRequest('https://nftoken.site/cookies/index.php', {
      method: 'POST',
      headers: {
        'accept': 'application/json, text/javascript, */*; q=0.01',
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'origin': 'https://nftoken.site',
        'referer': 'https://nftoken.site/cookies/',
        'user-agent': 'Mozilla/5.0',
        'x-requested-with': 'XMLHttpRequest',
      },
      body: bodyStr,
    });

    let data;
    try { data = result.json(); } catch { return { alive: false, plan: null, email: null, screens: null, paymentError: false, raw: null }; }

    const alive      = data?.status === 'SUCCESS';
    const plan       = data?.plan || data?.subscription || null;
    const email      = data?.email || data?.mail || data?.loginEmail || data?.login
      || data?.member_email || data?.user_email || data?.account_email || null;
    const screens    = data?.max_streams != null ? parseInt(data.max_streams) : null;
    const hasPremium = alive && isNetflixPremiumPlan(plan);
    const paymentError = !!(data?.paymentError || data?.payment_error);

    // Definitive dead/expired verdict from nftoken — used to override an
    // HTML-only LIVE (Netflix renders payment-hold banners client-side, so the
    // SSR HTML can look perfectly active even when the account is on hold/dead).
    const statusStr = String(data?.status || '').toUpperCase();
    const msgStr = String(data?.message || data?.msg || data?.error || '').toLowerCase();
    const definitiveDead = !!data && statusStr !== 'SUCCESS'
      && (statusStr === 'DEAD' || /dead|expired|invalid|cancel|hold|inactive|fail/i.test(msgStr));

    return { alive, hasPremium, plan, email, screens, paymentError, definitiveDead, raw: data };
  } catch (e) {
    return { alive: false, hasPremium: false, plan: null, email: null, screens: null, paymentError: false, definitiveDead: false, raw: null, error: e.message };
  }
}

const app = express();
const PORT = process.env.PORT || 3002;

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// CORS — allow requests from old server on port 3000
app.use((req, res, next) => {
  const origin = req.headers.origin || '';
  if (origin.includes('localhost')) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use(cookieParser());
app.use(subdomainMiddleware);

// ─── Static pages (public/admin | seller | me | user) ────────────────────────
const PAGE = {
  admin: path.join(__dirname, 'public', 'admin', 'index.html'),
  seller: path.join(__dirname, 'public', 'seller', 'index.html'),
  me: path.join(__dirname, 'public', 'me', 'index.html'),
  user: (name) => path.join(__dirname, 'public', 'user', name),
};

// ─── Subdomain root routing ────────────────────────────────────────────────────
// me.domain/me      → me/index.html (Get Code)
// seller.domain/seller  → seller/index.html
// admin.domain/admin   → admin/index.html
// me.domain/        → redirect to /me
// seller.domain/    → redirect to /seller
// admin.domain/     → redirect to /admin
// (domain trần)/    → redirect to /me
function serveSubdomainRoot(req, res, next) {
  if (req.path === '/') {
    if (req.subdomain === 'me') return res.redirect('/me');
    if (req.subdomain === 'seller') return res.redirect('/seller');
    if (req.subdomain === 'admin') return res.redirect('/admin');
    return res.redirect('/me');
  }

  if (req.subdomain === 'me' && req.path === '/me') {
    return res.sendFile(PAGE.me);
  }
  if (req.subdomain === 'seller' && req.path === '/seller') {
    return res.sendFile(PAGE.seller);
  }
  // Seller SPA deep links: only known view slugs, NOT static asset paths (/seller/js/, etc.)
  const SELLER_VIEW_SLUGS = ['dashboard', 'orders', 'keys', 'store', 'emails', 'deposit', 'transactions', 'profile'];
  if (req.subdomain === 'seller' && req.path.startsWith('/seller/')) {
    const slug = req.path.split('/')[2];
    if (SELLER_VIEW_SLUGS.includes(slug)) return res.sendFile(PAGE.seller);
  }
  if (req.subdomain === 'admin' && req.path === '/admin') {
    return res.sendFile(PAGE.admin);
  }
  // Admin SPA deep links: /admin/sellers, /admin/products, etc.
  if (req.subdomain === 'admin' && req.path.startsWith('/admin/')) {
    const slug = req.path.split('/')[2];
    if (['overview', 'sellers', 'products', 'keys', 'users'].includes(slug))
      return res.sendFile(PAGE.admin);
  }

  return next();
}
app.use(serveSubdomainRoot);

// index: false so that GET / goes through our route handler (which sets cookies)
// instead of express.static serving public/user/index.html directly
app.use(express.static(path.join(__dirname, 'public'), { index: false }));
// CSS/JS user — URL giữ /css, /js (không đổi link trong HTML)
app.use('/css', express.static(path.join(__dirname, 'public', 'user', 'css')));
app.use('/js', express.static(path.join(__dirname, 'public', 'user', 'js')));
app.use('/panel', express.static(path.join(__dirname, 'public', 'panel')));
app.use('/admin/js', express.static(path.join(__dirname, 'public', 'admin', 'js')));
app.use('/seller/js', express.static(path.join(__dirname, 'public', 'seller', 'js')));

// ─── Page Routes ───────────────────────────────────────────────────────────────

app.get('/me', (req, res) => {
  res.sendFile(PAGE.me);
});

app.get('/login', (req, res) => res.redirect('/'));
app.get('/profiles', (req, res) => res.redirect('/'));
app.get('/browse', (req, res) => res.redirect('/'));

app.get('/checker', (req, res) => {
  res.sendFile(PAGE.user('checker.html'));
});

// Alias cũ → cùng trang lấy mã
app.get('/getcode.html', (req, res) => {
  res.redirect('/me');
});

// Panel trên domain chính (redirect API login)
app.get('/admin', (req, res) => res.sendFile(PAGE.admin));
app.get('/seller', (req, res) => res.sendFile(PAGE.seller));

// Admin SPA sub-routes — serve same HTML, client handles routing
const ADMIN_VIEWS = ['overview', 'sellers', 'products', 'keys', 'deposits', 'users'];
ADMIN_VIEWS.forEach((slug) => {
  app.get(`/admin/${slug}`, (req, res) => res.sendFile(PAGE.admin));
});

// Seller SPA sub-routes — serve same HTML, client handles routing
const SELLER_VIEWS = ['dashboard', 'orders', 'keys', 'store', 'emails', 'deposit', 'transactions', 'profile'];
SELLER_VIEWS.forEach((slug) => {
  app.get(`/seller/${slug}`, (req, res) => res.sendFile(PAGE.seller));
});

app.get('/', (req, res) => {
  res.redirect('/me');
});

// ─── API Routes ────────────────────────────────────────────────────────────────

// ─── nftoken.site — optional; default direct netflix.com only ───
// NFTOKEN_MODE=off       → chỉ direct (mặc định)
// NFTOKEN_MODE=parallel  → song song nftoken + direct (hành vi cũ)
// NFTOKEN_MODE=fallback  → direct trước, gọi nftoken nếu unreachable hoặc thiếu plan/email
// USE_NFTOKEN=1|true|on  → alias của parallel
function getNftokenMode() {
  const raw = String(process.env.NFTOKEN_MODE || process.env.USE_NFTOKEN || 'fallback').toLowerCase().trim();
  if (raw === '1' || raw === 'true' || raw === 'on' || raw === 'parallel') return 'parallel';
  if (raw === 'fallback') return 'fallback';
  return 'off';
}

const NFT_SKIPPED = { alive: false, hasPremium: false, plan: null, email: null, screens: null, paymentError: false, definitiveDead: false, raw: null, skipped: true };

function mergeCheckResults(nf, nft) {
  const plan = nf.plan || nft.plan || null;
  let paymentHold = !!nf.paymentHold;
  let paymentError = !!nf.paymentError || !!(nft.paymentError && !nf.reachable);
  let planLost = !!nf.planLost;
  let alive = false;

  if (nf.reachable) {
    alive = !!nf.alive;
    if (nf.cancelled) {
      alive = false;
      planLost = false;
      paymentError = false;
      paymentHold = false;
    } else if (nf.accountPaymentHold) {
      // Explicit /account hold banner is authoritative — a future "next payment"
      // date on a held account is only the retry date, not a healthy renewal.
      alive = false;
      paymentHold = true;
      paymentError = true;
      planLost = !!plan;
    } else {
      const hasProfiles = Array.isArray(nf.profiles) && nf.profiles.length > 0;
      const futureBill = !!(nf.futureBilling || (nf.billingText && nfBillingIsFuture(nf.billingText)));
      if (plan && (futureBill || hasProfiles || nf.alive)) {
        alive = true;
        planLost = false;
        paymentError = false;
        paymentHold = false;
      }
    }
  } else if (!nft.skipped && nft.alive) {
    alive = !!nft.alive && !paymentError;
  }

  // nftoken gave a definitive DEAD/expired/hold verdict → override HTML-only LIVE.
  // Netflix renders payment-hold banners client-side, so SSR HTML can look active
  // even when the account is dead/on-hold; nftoken actually tries to mint a token.
  if (!nft.skipped && nft.definitiveDead) {
    alive = false;
    paymentHold = true;
    paymentError = true;
    planLost = !!plan;
  }

  let source = 'none';
  if (nft.skipped) {
    source = nf.reachable ? 'direct' : 'none';
  } else if (nft.definitiveDead) {
    source = 'nftoken';
  } else if (nf.reachable && nft.alive) {
    source = planLost ? 'direct' : 'direct+nftoken';
  } else if (nft.alive && !nf.reachable) {
    source = 'nftoken';
  } else if (nf.reachable) {
    source = 'direct';
  }

  return {
    alive,
    source,
    nftokenMode: getNftokenMode(),
    plan,
    email:        nf.emailFromHtml || nft.email || null,
    screens:      nft.screens      || null,
    hasPremium:   !!(nft.hasPremium || (alive && isNetflixPremiumPlan(plan))),
    paymentError,
    paymentHold,
    planLost,
    profiles:     nf.profiles      || [],
    billingText:  nf.billingText   || null,
    cancelled:    !!(nf.cancelled && !planLost) || (!alive && nf.reachable && !planLost),
    reachable:    !!(nf.reachable),
    _nft: nft.skipped ? { skipped: true } : { alive: nft.alive, definitiveDead: !!nft.definitiveDead, error: nft.error },
    _nf:  { reachable: nf.reachable, alive: nf.alive, error: nf.error },
  };
}

async function runNftokenCheck(cookieStr) {
  return checkAccountDetails(cookieStr).catch(e => ({
    alive: false, hasPremium: false, plan: null, email: null, screens: null,
    paymentError: false, definitiveDead: false, raw: null, error: e.message, skipped: false,
  }));
}

function shouldFallbackNftoken(nf) {
  if (!nf.reachable) return true;
  // Có plan nhưng không có email → gọi nftoken (trường hợp Netflix SSR đổi format)
  if (!nf.emailFromHtml) return true;
  if (nf.alive && !nf.plan) return true;
  return false;
}

// Map a fullCheck result into a compact warranty status string for storage/UI.
// live | payment_hold | plan_lost | dead | inconclusive | unknown
function checkResultToStatus(out) {
  if (!out || typeof out !== 'object') return 'unknown';
  if (out.rateLimited) return 'inconclusive';
  if (out.alive) return 'live';
  if (out.paymentHold) return 'payment_hold';
  if (out.planLost) return 'plan_lost';
  if (out.verifyInconclusive) return 'inconclusive';
  if (out.reachable === false && !out.source) return 'inconclusive';
  return 'dead';
}

// ─── Full check — direct netflix.com (+ nftoken tùy NFTOKEN_MODE) ─────────────
async function fullCheck(cookieStr, paceId) {
  try {
    assertCheckRateLimit();
    const pace = resolveCheckPace(paceId);
    const mode = getNftokenMode();
    const nf = await fetchNetflixAccountInfo(cookieStr, pace).catch(e => ({
      reachable: false, alive: false, error: e.message, profiles: [],
    }));

    let nft = NFT_SKIPPED;
    let inconclusiveVerify = false;

    if (!pace.skipNftoken) {
      if (mode === 'parallel') {
        await randDelay(pace.nftMin, pace.nftMax);
        nft = await runNftokenCheck(cookieStr);
      } else if (mode === 'fallback' && shouldFallbackNftoken(nf)) {
        await randDelay(pace.nftMin, pace.nftMax);
        nft = await runNftokenCheck(cookieStr);
      }
    }

    // Verify-LIVE: if direct HTML looks alive but nftoken hasn't run yet, verify it.
    // Netflix renders payment-hold/dead banners client-side, so SSR HTML can look
    // active on a dead/on-hold account. nftoken actually mints a token, so a
    // definitive DEAD verdict here overrides the HTML-only LIVE (even in stealth).
    // Retry on transient/inconclusive nftoken responses so a single network blip
    // can't silently fall back to a false LIVE ("fail-open").
    const verifyLiveEnabled = process.env.VERIFY_LIVE_NFTOKEN !== '0' && mode !== 'off';
    if (verifyLiveEnabled && nft.skipped && nf.reachable && nf.alive) {
      const maxTries = Math.max(1, parseInt(process.env.VERIFY_LIVE_RETRIES || '2', 10) || 2);
      for (let attempt = 1; attempt <= maxTries; attempt++) {
        await randDelay(pace.nftMin || 400, pace.nftMax || 1500);
        nft = await runNftokenCheck(cookieStr);
        // Stop as soon as nftoken gives a definitive verdict (alive or dead).
        if (nft.definitiveDead || nft.alive) break;
        // Otherwise it was a transient error / inconclusive response — retry.
      }
      inconclusiveVerify = !nft.definitiveDead && !nft.alive;
    }

    const out = mergeCheckResults(nf, nft);
    out.checkPace = pace.key;
    if (pace.skipNftoken && nft.skipped) out.nftokenSkippedStealth = true;
    // Could not confirm a LIVE-looking account with nftoken (all attempts failed)
    // — surface it so the UI can warn instead of showing a confident LIVE.
    if (inconclusiveVerify) out.verifyInconclusive = true;
    return out;
  } catch (e) {
    const out = { alive: false, error: e.message, profiles: [], plan: null, billingText: null, nftokenMode: getNftokenMode() };
    if (e.code === 'RATE_LIMIT') out.rateLimited = true;
    return out;
  }
}

// ─── Live check – single cookie set ──────────────────────────────────────────
app.post('/api/checker/live-check', ipRateLimit('check', CHECK_MAX_PER_HOUR, 3600000), async (req, res) => {
  try {
    const { cookie } = req.body;
    if (!cookie || typeof cookie !== 'string') {
      return res.status(400).json({ error: 'Missing cookie' });
    }
    const result = await fullCheck(cookie, req.body.pace);
    return res.json(result);
  } catch (e) {
    console.error('[live-check] ERROR:', e.message);
    const limited = e.code === 'RATE_LIMIT';
    // Rate-limit message is user-facing guidance; anything else stays generic.
    return res.status(limited ? 429 : 500).json({ alive: false, error: limited ? e.message : 'Internal server error', profiles: [], rateLimited: limited });
  }
});

// ─── Batch live check – multiple sets ────────────────────────────────────────
app.post('/api/checker/batch', ipRateLimit('batch', 10, 3600000), async (req, res) => {
  try {
    const { cookies } = req.body;
    if (!Array.isArray(cookies) || !cookies.length) {
      return res.status(400).json({ error: 'Missing cookies array' });
    }
    const BATCH_MAX = Math.max(1, parseInt(process.env.CHECK_BATCH_MAX || '50', 10) || 50);
    if (cookies.length > BATCH_MAX) {
      return res.status(400).json({ error: `Too many cookies — max ${BATCH_MAX} per batch` });
    }
    if (cookies.some(c => typeof c !== 'string' || !c.trim())) {
      return res.status(400).json({ error: 'Each cookie must be a non-empty string' });
    }
    // CONCURRENCY=1: check tuần tự từ cùng 1 IP → tránh burst song song dễ bị Netflix flag.
    // Mỗi fullCheck đã có randDelay nội bộ; thêm khoảng nghỉ giữa các cookie cho tự nhiên.
    const pace = resolveCheckPace(req.body.pace);
    const CONCURRENCY = 1;
    const results = new Array(cookies.length).fill(null);
    for (let i = 0; i < cookies.length; i += CONCURRENCY) {
      const slice   = cookies.slice(i, i + CONCURRENCY);
      const checked = await Promise.all(slice.map(c => fullCheck(c, req.body.pace).catch(e => ({ alive: false, error: e.message, profiles: [] }))));
      checked.forEach((r, j) => { results[i + j] = r; });
      if (i + CONCURRENCY < cookies.length) await randDelay(pace.gapMin, pace.gapMax);
    }
    return res.json({ results });
  } catch (e) {
    console.error('[batch] ERROR:', e.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Cloudflare Turnstile ─────────────────────────────────────────────────────
// Production: https://dash.cloudflare.com → Turnstile → site key + secret in .env
// Dev-only test widget: TURNSTILE_USE_TEST=1 (shows "For testing only" banner)
const TURNSTILE_TEST_SITE_KEY = '1x00000000000000000000AA';
const TURNSTILE_TEST_SECRET_KEY = '1x0000000000000000000000000000000AA';

function resolveTurnstileConfig() {
  if (process.env.TURNSTILE_DISABLED === '1') {
    return { enabled: false, siteKey: '', secretKey: '', testMode: false, reason: 'disabled' };
  }
  const siteKey = String(process.env.TURNSTILE_SITE_KEY || '').trim();
  const secretKey = String(process.env.TURNSTILE_SECRET_KEY || '').trim();
  const isTestKey = (k) => !k || k === TURNSTILE_TEST_SITE_KEY || k.startsWith('1x00000000000000000000');
  if (siteKey && secretKey && !isTestKey(siteKey)) {
    return { enabled: true, siteKey, secretKey, testMode: false, reason: 'production' };
  }
  if (process.env.TURNSTILE_USE_TEST === '1') {
    return {
      enabled: true,
      siteKey: TURNSTILE_TEST_SITE_KEY,
      secretKey: TURNSTILE_TEST_SECRET_KEY,
      testMode: true,
      reason: 'test',
    };
  }
  return { enabled: false, siteKey: '', secretKey: '', testMode: false, reason: 'missing_keys' };
}

const TURNSTILE_CFG = resolveTurnstileConfig();
const TURNSTILE_SITE_KEY = TURNSTILE_CFG.siteKey;
const TURNSTILE_SECRET_KEY = TURNSTILE_CFG.secretKey;
const TURNSTILE_ENABLED = TURNSTILE_CFG.enabled;
const TURNSTILE_TEST_MODE = TURNSTILE_CFG.testMode;

async function verifyTurnstile(token, remoteip) {
  if (!TURNSTILE_ENABLED) return { success: true, skipped: true };
  if (!token) return { success: false, error: 'Missing captcha' };

  try {
    const body = new URLSearchParams({
      secret: TURNSTILE_SECRET_KEY,
      response: token,
      ...(remoteip ? { remoteip: String(remoteip) } : {}),
    }).toString();
    const r = await nodeRequest('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      timeout: 10000,
    });
    const data = r.json();
    if (!data.success) {
      return { success: false, error: data['error-codes']?.join(', ') || 'Captcha failed' };
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.socket?.remoteAddress || req.ip || '';
}

// ─── Per-IP rate limiter for abuse-prone endpoints (login brute force, OTP
// guessing, inbox scraping). Fixed window, in-memory — đủ cho single instance.
const ipRateBuckets = new Map();
function ipRateLimit(name, max, windowMs) {
  return (req, res, next) => {
    const key = `${name}:${getClientIp(req)}`;
    const now = Date.now();
    let bucket = ipRateBuckets.get(key);
    if (!bucket || now - bucket.start > windowMs) {
      bucket = { start: now, count: 0 };
      ipRateBuckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > max) {
      return res.status(429).json({ success: false, error: 'Too many requests — try again later' });
    }
    next();
  };
}
setInterval(() => {
  const cutoff = Date.now() - 3600000;
  for (const [key, bucket] of ipRateBuckets) {
    if (bucket.start < cutoff) ipRateBuckets.delete(key);
  }
}, 600000).unref();

// 500s: log the real error server-side, return a generic message to the client
// (raw e.message can leak DB schema / internal paths / upstream details).
function serverError(req, res, e) {
  console.error(`[500] ${req.method} ${req.path}:`, e.message);
  return res.status(500).json({ success: false, error: 'Internal server error' });
}

// Chỉ trả loại mã key được phép — seller/admin cấp qua key
function filterEmailsByPerms(emails, perms) {
  const p = perms || { permLogin: true, permReset: true, permFamily: true };
  return emails
    .map((e) => {
      const out = { ...e };
      if (!p.permLogin) out.extracted_code = null;
      if (!p.permReset) out.reset_link = null;
      if (!p.permFamily) out.family_code = null;
      const has = out.extracted_code || out.reset_link || out.family_code;
      if (!has) return null;
      let priority = 0;
      if (out.extracted_code) priority = 10;
      else if (out.family_code) priority = 9;
      else if (out.reset_link) priority = 8;
      out.priority = priority;
      return out;
    })
    .filter(Boolean)
    .sort((a, b) => (b.priority || 0) - (a.priority || 0));
}

// ─── Temp-mail provider: tempmail.id.vn (Bearer-token, account-scoped) ────────
// Reading an inbox is a 3-step flow: list mailboxes → find the one matching the
// address → list its messages → read each message body. The mailbox must belong
// to the account that owns TEMPMAIL_TOKEN.
const MAIL_API_BASE  = String(process.env.TEMPMAIL_API_BASE || 'https://tempmail.id.vn').replace(/\/+$/, '');
const MAIL_API_TOKEN = String(process.env.TEMPMAIL_TOKEN || '').trim();
const MAIL_MAX_MESSAGES = Math.max(1, parseInt(process.env.TEMPMAIL_MAX_MESSAGES || '15', 10) || 15);

function mailAuthHeaders() {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${MAIL_API_TOKEN}`,
    'User-Agent': 'Mozilla/5.0',
  };
}

async function mailGet(path) {
  const r = await nodeRequest(`${MAIL_API_BASE}${path}`, {
    method: 'GET', headers: mailAuthHeaders(), timeout: 12000,
  });
  if (r.status !== 200) return null;
  try { return r.json(); } catch { return null; }
}

// Normalize the many possible array wrappers the API may use.
function mailListOf(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  return data.data || data.emails || data.messages || data.mails || [];
}

function mailAddressOf(m) {
  return String(m.email || m.address || m.mail || `${m.user || ''}@${m.domain || ''}`).toLowerCase();
}

function mailIdOf(m) {
  return m.id || m._id || m.mail_id || m.message_id || null;
}

// Find the mailbox id for an address (must belong to the token's account).
async function findMailboxId(email) {
  const data = await mailGet('/api/email');
  const target = email.toLowerCase();
  for (const m of mailListOf(data)) {
    if (mailAddressOf(m) === target) return mailIdOf(m);
  }
  return null;
}

async function fetchInboxForEmail(email, perms) {
  if (!MAIL_API_TOKEN) {
    console.warn('[inbox] TEMPMAIL_TOKEN not configured — cannot fetch mail');
    return { success: true, emails: [], total: 0 };
  }

  const mailId = await findMailboxId(email);
  if (!mailId) return { success: true, emails: [], total: 0 };

  const list = mailListOf(await mailGet(`/api/email/${encodeURIComponent(mailId)}`));
  const top  = list.slice(0, MAIL_MAX_MESSAGES);

  // Message-list items often omit the body — fetch full content when missing.
  const detailed = await Promise.all(top.map(async (m) => {
    if (m.body || m.text_body || m.html_body || m.html) return m;
    const id = mailIdOf(m);
    if (!id) return m;
    const full = await mailGet(`/api/message/${encodeURIComponent(id)}`).catch(() => null);
    const body = full ? (full.data || full.message || full) : null;
    return body ? { ...m, ...body } : m;
  }));

  let emails = detailed.map(parseNetflixEmail).sort((a, b) => (b.priority || 0) - (a.priority || 0));
  if (perms) emails = filterEmailsByPerms(emails, perms);
  return { success: true, emails, total: emails.length };
}

app.get('/api/turnstile/config', (req, res) => {
  return res.json({
    success: true,
    enabled: TURNSTILE_ENABLED,
    siteKey: TURNSTILE_ENABLED ? TURNSTILE_SITE_KEY : null,
    testMode: TURNSTILE_TEST_MODE,
    reason: TURNSTILE_CFG.reason,
  });
});

// Bank/deposit config from .env (no hardcoded values in the UI)
app.get('/api/deposit/config', requireSeller, (req, res) => {
  const bankCode  = String(process.env.BANK_CODE || '').trim();
  const bankName  = String(process.env.BANK_NAME || '').trim();
  const accountNo = String(process.env.BANK_ACCOUNT_NO || '').trim();
  const holder    = String(process.env.BANK_ACCOUNT_NAME || '').trim();
  const configured = !!(bankCode && accountNo && holder);
  const memo = `${String(process.env.BANK_MEMO_PREFIX || 'NAP').trim()} ${req.account.username}`.trim();
  let qrUrl = null;
  if (configured) {
    qrUrl = `https://img.vietqr.io/image/${encodeURIComponent(bankCode)}-${encodeURIComponent(accountNo)}-compact2.png`
      + `?addInfo=${encodeURIComponent(memo)}&accountName=${encodeURIComponent(holder)}`;
  }
  return res.json({
    success: true,
    configured,
    bankName: bankName || bankCode,
    bankCode,
    accountNo,
    holder,
    memo,
    qrUrl,
  });
});

// ── Bank webhook: auto-credit seller balance on incoming transfer ──────
// Accepts Casso (array under data[]) or SePay (single-object) payloads.
// Authorization: shared secret in `BANK_WEBHOOK_TOKEN` env, sent as
// `Authorization: Bearer <token>` or `?token=` (Casso supports both).
// Idempotency: each transaction's bank-side tx id (tid / id) is stored
// UNIQUE in `deposit_intents`, so retries / re-deliveries are no-ops.
function bankWebhookAuthorized(req) {
  const expected = String(process.env.BANK_WEBHOOK_TOKEN || '').trim();
  if (!expected) return false; // refuse if not configured
  const header = String(req.headers.authorization || '').trim();
  const bearer = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  const queryToken = String(req.query.token || '').trim();
  return bearer === expected || queryToken === expected || header === expected;
}

function normalizeWebhookEvents(body) {
  if (!body) return [];
  // Casso: { error: 0, data: [ { tid, amount, description, when, gateway } ] }
  if (Array.isArray(body.data)) {
    return body.data.map((d) => ({
      provider: 'casso',
      txRef: String(d.tid ?? d.id ?? ''),
      amount: Number(d.amount ?? 0),
      memo: String(d.description ?? d.content ?? ''),
      when: d.when || d.transactionDateTime || null,
      raw: d,
    }));
  }
  // SePay: { id, gateway, transferAmount, content, transferType, transactionDate }
  if (body.id != null && (body.transferAmount != null || body.content != null)) {
    return [{
      provider: 'sepay',
      txRef: String(body.id),
      amount: Number(body.transferAmount ?? body.amount ?? 0),
      memo: String(body.content ?? body.description ?? ''),
      when: body.transactionDate || null,
      raw: body,
    }];
  }
  // Generic fallback
  if (body.tx_ref || body.txRef) {
    return [{
      provider: String(body.provider || 'generic'),
      txRef: String(body.tx_ref ?? body.txRef),
      amount: Number(body.amount ?? 0),
      memo: String(body.memo ?? body.description ?? ''),
      when: body.timestamp || null,
      raw: body,
    }];
  }
  return [];
}

function extractUsernameFromMemo(memo) {
  if (!memo) return null;
  const prefix = String(process.env.BANK_MEMO_PREFIX || 'NAP').trim();
  // Strip diacritics, normalize whitespace
  const flat = String(memo)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ').trim();
  // Match: <prefix> <username> (username = alnum/underscore, 3–32 chars)
  const re = new RegExp(`(?:^|\\s)${prefix}\\s+([a-zA-Z0-9_]{3,32})`, 'i');
  const m = flat.match(re);
  if (m) return m[1].toLowerCase();
  // Fallback: any alnum token >= 3 chars that matches an existing username
  return null;
}

app.post('/api/deposit/webhook', express.json({ limit: '256kb' }), (req, res) => {
  if (!bankWebhookAuthorized(req)) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  const events = normalizeWebhookEvents(req.body);
  if (!events.length) {
    return res.status(400).json({ success: false, error: 'Unrecognized payload' });
  }
  const results = [];
  for (const ev of events) {
    if (!ev.txRef) {
      results.push({ ok: false, error: 'missing tx_ref' });
      continue;
    }
    if (ev.amount <= 0) {
      results.push({ txRef: ev.txRef, ok: false, error: 'non-credit ignored' });
      continue;
    }
    const existing = findDepositIntentByRef(ev.provider, ev.txRef);
    if (existing) {
      results.push({ txRef: ev.txRef, ok: true, duplicate: true, status: existing.status });
      continue;
    }
    const username = extractUsernameFromMemo(ev.memo);
    let acc = null;
    if (username) {
      const a = getAccountByUsername(username);
      if (a && a.role === 'seller' && a.status === 'active') acc = a;
    }
    const out = recordDepositIntent({
      provider: ev.provider,
      txRef: ev.txRef,
      amount: ev.amount,
      memo: ev.memo,
      matchedUser: username,
      accountId: acc ? acc.id : null,
      payload: JSON.stringify(ev.raw).slice(0, 8000),
    });
    if (out.duplicate) {
      results.push({ txRef: ev.txRef, ok: true, duplicate: true });
    } else if (out.unmatched) {
      results.push({ txRef: ev.txRef, ok: true, unmatched: true, memo: ev.memo });
    } else if (out.error) {
      results.push({ txRef: ev.txRef, ok: false, error: out.error });
    } else {
      results.push({
        txRef: ev.txRef, ok: true, credited: true,
        username, amount: ev.amount, balance: out.balance, transactionId: out.transactionId,
      });
    }
  }
  return res.json({ success: true, processed: results.length, results });
});

// Recent deposit intents — admin-visibility
app.get('/api/admin/deposit-intents', requireAdmin, (req, res) => {
  const rows = listRecentDepositIntents(100);
  return res.json({ success: true, intents: rows });
});

// Unmatched deposits the system could not auto-credit (admin review queue).
app.get('/api/admin/deposit-intents/unmatched', requireAdmin, (req, res) => {
  return res.json({ success: true, intents: listUnmatchedDepositIntents(100) });
});

// Manually assign an unmatched deposit to a seller and credit their balance.
app.post('/api/admin/deposit-intents/:id/assign', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const sellerId = String(req.body.sellerId || '').trim();
  if (!Number.isInteger(id) || !sellerId) {
    return res.status(400).json({ success: false, error: 'Missing deposit id or sellerId' });
  }
  const out = assignDepositIntent(id, sellerId);
  if (out.error) return res.status(400).json({ success: false, error: out.error });
  return res.json({ success: true, ...out });
});

// ─── Temp Mail Inbox API ──────────────────────────────────────────────────────
// Codes are only released for emails bound to a valid key or a via-email order
// (security: an unauthenticated GET variant used to leak unfiltered codes).
app.post('/api/inbox', ipRateLimit('inbox', 30, 5 * 60000), async (req, res) => {
  try {
    const email = (req.body.email || '').trim().toLowerCase();
    const keyStr = (req.body.key || '').trim();
    const turnstileToken = req.body.turnstileToken || req.body.token || '';

    if (!email || !email.includes('@'))
      return res.status(400).json({ success: false, error: 'Invalid email' });

    const captcha = await verifyTurnstile(turnstileToken, getClientIp(req));
    if (!captcha.success) {
      return res.status(403).json({ success: false, error: captcha.error || 'Invalid captcha' });
    }

    let perms = null;
    const orderRow = getOrderByEmailForInbox(email);

    if (keyStr) {
      const row = getKey(keyStr);
      if (!row) return res.status(403).json({ success: false, error: 'Invalid key' });
      if (row.email !== email) return res.status(403).json({ success: false, error: 'Key does not match email' });
      if (row.expiresAt && row.expiresAt < Math.floor(Date.now() / 1000)) {
        return res.status(403).json({ success: false, error: 'Key expired' });
      }
      perms = { permLogin: row.permLogin, permReset: row.permReset, permFamily: row.permFamily };
      incrementKeyUsage(keyStr);
    } else if (orderRow) {
      if (!orderRow.viaEmail) {
        return res.status(403).json({ success: false, error: 'This order has not enabled get-code via email — use a key' });
      }
      if (orderRow.status === 'expired') {
        return res.status(403).json({ success: false, error: 'Order expired' });
      }
      perms = { permLogin: orderRow.permLogin, permReset: orderRow.permReset, permFamily: orderRow.permFamily };
    } else {
      // Fail closed: unknown email (no key, no order) must not receive any codes.
      return res.status(403).json({ success: false, error: 'No key or order found for this email' });
    }

    const result = await fetchInboxForEmail(email, perms);
    if (keyStr && perms) {
      result.permissions = perms;
    }
    return res.json(result);
  } catch (e) {
    return serverError(req, res, e);
  }
});

function parseNetflixEmail(raw) {
  const subject  = String(raw.subject   || raw.title || '');
  const body     = String(raw.body      || raw.text_body || raw.text || raw.content || '');
  const html     = String(raw.html_body || raw.html      || raw.body_html || '');
  const from     = String(raw.from      || raw.sender    || raw.from_email || raw.from_address || '');
  const id        = raw.id || raw._id || raw.message_id || raw.mail_id || '';
  const time     = raw.created_at || raw.date || raw.received_at || raw.time || '';
  const full     = (subject + ' ' + body + ' ' + html).replace(/<[^>]+>/g, ' ');

  let code = null, reset_link = null, family_code = null, priority = 0;

  // Netflix OTP 4-8 digits
  const otp = full.match(/(?:mã|code|passcode|verify)[:\s]+(\d{4,8})/i)
    || full.match(/\b(\d{4,8})\b(?=[^<]{0,80}(?:netflix|sign\s*in|login|xác nhận))/i)
    || subject.match(/\b(\d{4,8})\b/);
  if (otp) { code = otp[1]; priority = 10; }

  // Reset link
  const rl = full.match(/https?:\/\/[^\s"'<>]+(?:reset|password)[^\s"'<>]*/i)
    || full.match(/https?:\/\/www\.netflix\.com\/[^\s"'<>]+/i);
  if (rl && !code) { reset_link = rl[0]; priority = 8; }

  // Household code
  const fam = full.match(/(?:household|family)[:\s]+([A-Z0-9]{4,12})/i);
  if (fam) { family_code = fam[1]; priority = 9; }

  return { id, subject, from, time, extracted_code: code, reset_link, family_code, priority };
}

// ─── Panel auth (admin/seller accounts) ───────────────────────────────────────
const PANEL_COOKIE = 'panelSession';
// Set COOKIE_SECURE=1 in production (TLS) so the session cookie is never sent over plain HTTP.
const COOKIE_SECURE = process.env.COOKIE_SECURE === '1';

function setPanelCookie(res, sessionId) {
  res.cookie(PANEL_COOKIE, sessionId, {
    maxAge: 30 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax',
    secure: COOKIE_SECURE,
    path: '/',
  });
}

// Lấy account từ panelSession cookie (null nếu chưa đăng nhập / hết hạn)
function getPanelAccount(req) {
  const sid = req.cookies[PANEL_COOKIE];
  if (!sid) return null;
  const row = getPanelSession(sid);
  if (!row) return null;
  const acc = getAccountById(row.account_id);
  if (acc) acc._sessionId = sid;
  return acc;
}

// Bắt buộc seller đã đăng nhập + active
function requireSeller(req, res, next) {
  const acc = getPanelAccount(req);
  if (!acc || acc.role !== 'seller') return res.status(401).json({ success: false, error: 'Seller not logged in' });
  if (acc.status !== 'active') return res.status(403).json({ success: false, error: 'Account not approved yet' });
  req.account = acc;
  next();
}

// Đăng nhập panel (admin hoặc seller)
app.post('/api/panel/login', ipRateLimit('login', 20, 15 * 60000), (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ success: false, error: 'Missing username or password' });
    const acc = getAccountByUsername(String(username).trim());
    if (!acc || !verifyPassword(acc.password, password)) {
      return res.status(401).json({ success: false, error: 'Wrong username or password' });
    }
    if (acc.role === 'seller') {
      if (!acc.emailVerified) return res.status(403).json({ success: false, error: 'Email not verified', needVerify: true, accountId: acc.id });
      if (acc.status === 'pending')  return res.status(403).json({ success: false, error: 'Account is pending admin approval' });
      if (acc.status === 'rejected') return res.status(403).json({ success: false, error: 'Account was rejected' });
    }
    if (acc.status !== 'active') return res.status(403).json({ success: false, error: 'Account inactive' });

    const sid = uuidv4();
    createPanelSession(sid, acc.id);
    setPanelCookie(res, sid);
    return res.json({ success: true, account: { username: acc.username, email: acc.email, role: acc.role }, redirect: acc.role === 'admin' ? '/admin' : '/seller' });
  } catch (e) {
    return serverError(req, res, e);
  }
});

app.post('/api/panel/logout', (req, res) => {
  const sid = req.cookies[PANEL_COOKIE];
  if (sid) deletePanelSession(sid);
  res.clearCookie(PANEL_COOKIE, { path: '/' });
  return res.json({ success: true });
});

app.get('/api/panel/me', (req, res) => {
  const acc = getPanelAccount(req);
  if (!acc) return res.status(401).json({ success: false, error: 'Not logged in' });
  const out = { username: acc.username, email: acc.email, role: acc.role, status: acc.status };
  if (acc.role === 'seller') {
    Object.assign(out, getSellerMaxPerms(acc.id));
    const prof = getSellerProfile(acc.id);
    if (prof) {
      out.balance = prof.balance;
      out.contactName = prof.contactName;
      out.contactType = prof.contactType;
      out.contactInfo = prof.contactInfo;
    }
  }
  return res.json({ success: true, account: out });
});

// Seller tự đăng ký → tạo account pending + gửi mã xác minh email
app.post('/api/seller/register', ipRateLimit('register', 10, 3600000), async (req, res) => {
  try {
    const captcha = await verifyTurnstile(req.body.turnstileToken || req.body.token || '', getClientIp(req));
    if (!captcha.success) {
      return res.status(403).json({ success: false, error: captcha.error || 'Invalid captcha' });
    }

    const username    = String(req.body.username || '').trim();
    const email       = String(req.body.email || '').trim().toLowerCase();
    const password    = String(req.body.password || '');
    const contactName = String(req.body.contactName || '').trim();
    const contactType = String(req.body.contactType || '').trim().toLowerCase();
    const contactInfo = String(req.body.contactInfo || '').trim();
    const allowedTypes = new Set(['telegram', 'zalo', 'facebook', '']);
    if (username.length < 3)   return res.status(400).json({ success: false, error: 'Username must be at least 3 characters' });
    if (!email.includes('@'))  return res.status(400).json({ success: false, error: 'Invalid email' });
    if (password.length < 6)   return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });
    if (!contactName)          return res.status(400).json({ success: false, error: 'Full name is required' });
    if (!contactType || !allowedTypes.has(contactType)) {
      return res.status(400).json({ success: false, error: 'Select a contact type' });
    }
    if (!contactInfo)          return res.status(400).json({ success: false, error: 'Contact info is required' });
    if (getAccountByUsername(username)) return res.status(409).json({ success: false, error: 'Username already exists' });
    if (getAccountByEmail(email))       return res.status(409).json({ success: false, error: 'Email already used' });

    const code    = String(Math.floor(100000 + Math.random() * 900000)); // mã 6 số
    const expires = Math.floor(Date.now() / 1000) + 15 * 60;             // hết hạn 15 phút
    const id      = 'sel_' + crypto.randomBytes(6).toString('hex');
    createAccount({
      id, username, email, password: hashPassword(password), role: 'seller',
      verifyCode: code, verifyExpires: expires,
      contactName, contactType, contactInfo,
    });

    const mail = await sendVerificationEmail(email, code).catch(() => ({ sent: false }));
    return res.json({ success: true, accountId: id, emailSent: mail.sent, message: 'Account created. Enter the verification code sent to your email.' });
  } catch (e) {
    return serverError(req, res, e);
  }
});

// Xác minh email bằng mã 6 số
app.post('/api/seller/verify-email', ipRateLimit('verify', 10, 15 * 60000), (req, res) => {
  try {
    const acc = getAccountById(String(req.body.accountId || ''));
    if (!acc || acc.role !== 'seller') return res.status(404).json({ success: false, error: 'Account not found' });
    if (acc.emailVerified) return res.json({ success: true, alreadyVerified: true });
    if (!acc.verifyCode || acc.verifyCode !== String(req.body.code || '').trim()) {
      return res.status(400).json({ success: false, error: 'Incorrect code' });
    }
    if (acc.verifyExpires && Math.floor(Date.now() / 1000) > acc.verifyExpires) {
      return res.status(400).json({ success: false, error: 'Code expired, please resend' });
    }
    markEmailVerified(acc.id);
    return res.json({ success: true, message: 'Verified successfully. Waiting for admin approval.' });
  } catch (e) {
    return serverError(req, res, e);
  }
});

// Gửi lại mã xác minh
app.post('/api/seller/resend-code', ipRateLimit('resend', 5, 15 * 60000), async (req, res) => {
  try {
    const acc = getAccountById(String(req.body.accountId || ''));
    if (!acc || acc.role !== 'seller') return res.status(404).json({ success: false, error: 'Account not found' });
    if (acc.emailVerified) return res.json({ success: true, alreadyVerified: true });
    const code    = String(Math.floor(100000 + Math.random() * 900000));
    const expires = Math.floor(Date.now() / 1000) + 15 * 60;
    setVerifyCode(acc.id, code, expires);
    const mail = await sendVerificationEmail(acc.email, code).catch(() => ({ sent: false }));
    return res.json({ success: true, emailSent: mail.sent });
  } catch (e) {
    return serverError(req, res, e);
  }
});

// ─── Seller workspace API ─────────────────────────────────────────────────────
app.get('/api/seller/dashboard', requireSeller, (req, res) => {
  const sellerId = req.account.id;
  return res.json({
    success: true,
    stats: getSellerDashboardStats(sellerId),
    balance: getSellerBalance(sellerId),
    sellerPerms: getSellerMaxPerms(sellerId),
    profile: getSellerProfile(sellerId),
  });
});

app.get('/api/seller/orders', requireSeller, (req, res) => {
  const orders = getSellerOrders(req.account.id);
  const keys = getKeysBySeller(req.account.id);
  const keysByOrder = {};
  for (const k of keys) {
    if (k.orderId) {
      if (!keysByOrder[k.orderId]) keysByOrder[k.orderId] = [];
      keysByOrder[k.orderId].push(k);
    }
  }
  const enriched = orders.map((o) => ({ ...o, keys: keysByOrder[o.id] || [] }));
  const status = (req.query.status || 'all').toLowerCase();
  const q = (req.query.q || '').trim().toLowerCase();
  let filtered = enriched;
  if (status !== 'all') filtered = filtered.filter((o) => o.status === status);
  if (q) {
    filtered = filtered.filter((o) =>
      [o.id, o.productName, o.publicCode, o.accountEmail, o.note].some(
        (f) => String(f || '').toLowerCase().includes(q),
      ),
    );
  }
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const perPage = Math.min(50, Math.max(5, parseInt(req.query.perPage, 10) || 20));
  const total = filtered.length;
  const start = (page - 1) * perPage;
  return res.json({
    success: true,
    orders: filtered.slice(start, start + perPage),
    pagination: { page, perPage, total, pages: Math.ceil(total / perPage) || 1 },
    sellerPerms: getSellerMaxPerms(req.account.id),
  });
});

app.get('/api/seller/orders/:id', requireSeller, (req, res) => {
  const order = getSellerOrderById(req.params.id, req.account.id);
  if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
  const keys = getKeysBySeller(req.account.id).filter((k) => k.orderId === order.id);
  return res.json({ success: true, order, keys });
});

app.patch('/api/seller/orders/:id', requireSeller, (req, res) => {
  try {
    const { accountPassword, viaEmail, note, permLogin, permReset, permFamily, cookie } = req.body;
    const order = updateSellerOrder(req.params.id, req.account.id, {
      accountPassword, viaEmail, note, permLogin, permReset, permFamily, cookie,
    });
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
    return res.json({ success: true, order });
  } catch (e) {
    return serverError(req, res, e);
  }
});

app.post('/api/seller/orders/:id/renew', requireSeller, (req, res) => {
  const order = renewSellerOrder(req.params.id, req.account.id);
  if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
  return res.json({ success: true, order });
});

app.get('/api/seller/orders/:id/history', requireSeller, (req, res) => {
  const events = getOrderHistory(req.params.id, req.account.id);
  if (!events.length && !getSellerOrderById(req.params.id, req.account.id)) {
    return res.status(404).json({ success: false, error: 'Order not found' });
  }
  return res.json({ success: true, events });
});

// Manual warranty re-check: run the live checker against the order's stored
// cookie and persist the verdict. Cookie is read server-side only.
app.post('/api/seller/orders/:id/recheck', requireSeller, async (req, res) => {
  try {
    const order = getSellerOrderById(req.params.id, req.account.id);
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
    const cookie = getOrderCookie(req.params.id, req.account.id);
    if (!cookie) return res.status(400).json({ success: false, error: 'No cookie stored for this order' });

    const out = await fullCheck(cookie, req.body.pace);
    if (out.rateLimited) {
      return res.status(429).json({ success: false, error: 'Hourly check limit reached — try again later', rateLimited: true });
    }
    const status = checkResultToStatus(out);
    recordOrderCheck(req.params.id, status);
    logOrderEvent(req.params.id, 'warranty_check', `manual: ${status}`);
    return res.json({ success: true, status, checkedAt: Math.floor(Date.now() / 1000) });
  } catch (e) {
    return serverError(req, res, e);
  }
});

app.post('/api/seller/orders/:id/keys', requireSeller, (req, res) => {
  try {
    const order = getSellerOrderById(req.params.id, req.account.id);
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
    const max = getSellerMaxPerms(req.account.id);
    const perms = clampKeyPerms({
      permLogin: req.body.permLogin ?? order.permLogin,
      permReset: req.body.permReset ?? order.permReset,
      permFamily: req.body.permFamily ?? order.permFamily,
    }, max);
    const key = 'SK-' + [1, 2, 3].map(() => crypto.randomBytes(4).toString('hex').toUpperCase()).join('-');
    const row = createKey(key, order.accountEmail, {
      keyName: (req.body.keyName || order.productName || '').trim() || null,
      note: order.note,
      expiresAt: order.expiresAt,
      orderId: order.id,
      ...perms,
    }, req.account.id);
    logOrderEvent(order.id, 'key_created', key, null);
    return res.json({ success: true, key: row });
  } catch (e) {
    return serverError(req, res, e);
  }
});

app.get('/api/seller/products', requireSeller, (req, res) => {
  return res.json({ success: true, products: getProducts(true), balance: getSellerBalance(req.account.id) });
});

app.post('/api/seller/store/buy', requireSeller, (req, res) => {
  try {
    const { productId, accountEmail, accountPassword } = req.body;
    const result = purchaseProduct(req.account.id, productId, { accountEmail, accountPassword });
    if (result.error) return res.status(400).json({ success: false, error: result.error });
    return res.json({ success: true, order: result.order, balance: result.balance });
  } catch (e) {
    return serverError(req, res, e);
  }
});

app.get('/api/seller/transactions', requireSeller, (req, res) => {
  return res.json({
    success: true,
    transactions: getTransactions(req.account.id),
    summary: getTransactionSummary(req.account.id),
  });
});

// Deposit history for the logged-in seller (matched/credited intents).
app.get('/api/seller/deposits', requireSeller, (req, res) => {
  return res.json({
    success: true,
    deposits: getDepositIntentsBySeller(req.account.id, 100),
  });
});

app.get('/api/seller/emails', requireSeller, (req, res) => {
  return res.json({ success: true, emails: getSellerEmails(req.account.id) });
});

app.patch('/api/seller/profile', requireSeller, (req, res) => {
  const profile = updateSellerProfile(req.account.id, {
    contactName: req.body.contactName,
    contactType: req.body.contactType,
    contactInfo: req.body.contactInfo,
  });
  return res.json({ success: true, profile });
});

app.get('/api/seller/profile', requireSeller, (req, res) => {
  const profile = getSellerProfile(req.account.id);
  return res.json({ success: true, profile });
});

// Seller đổi mật khẩu (đăng nhập bằng session, không cần captcha)
app.post('/api/seller/change-password', requireSeller, (req, res) => {
  try {
    const oldPassword = String(req.body.oldPassword || '');
    const newPassword = String(req.body.newPassword || '');
    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });
    }
    const acc = getAccountById(req.account.id);
    if (!acc || !verifyPassword(acc.password, oldPassword)) {
      return res.status(403).json({ success: false, error: 'Current password is incorrect' });
    }
    setAccountPassword(req.account.id, hashPassword(newPassword));
    return res.json({ success: true });
  } catch (e) {
    return serverError(req, res, e);
  }
});

// Seller lấy mail của tài khoản đã mua (session auth, dùng quyền của đơn — không cần captcha)
app.post('/api/seller/mail', requireSeller, async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!email.includes('@')) return res.status(400).json({ success: false, error: 'Invalid email' });
    const order = getSellerOrders(req.account.id).find((o) => (o.accountEmail || '').toLowerCase() === email);
    if (!order) return res.status(404).json({ success: false, error: 'Account not found in your orders' });
    const perms = { permLogin: order.permLogin, permReset: order.permReset, permFamily: order.permFamily };
    const result = await fetchInboxForEmail(email, perms);
    result.permissions = perms;
    return res.json(result);
  } catch (e) {
    return serverError(req, res, e);
  }
});

// Danh sách key của seller + tổng quan
app.get('/api/seller/keys', requireSeller, (req, res) => {
  const keys = getKeysBySellerEnriched(req.account.id);
  const used = keys.filter(k => k.usedCount > 0).length;
  const sellerPerms = getSellerMaxPerms(req.account.id);
  return res.json({
    success: true, keys, sellerPerms,
    summary: { total: keys.length, used, unused: keys.length - used },
  });
});

function keyPermContext(sellerId, order) {
  const max = getSellerMaxPerms(sellerId);
  const orderMax = order ? {
    permLogin: order.permLogin,
    permReset: order.permReset,
    permFamily: order.permFamily,
  } : null;
  return { max, orderMax };
}

// Tạo key — quyền key ⊆ quyền admin cấp seller
app.post('/api/key/register', requireSeller, (req, res) => {
  try {
    const { email, note, keyName, expiresAt, permLogin, permReset, permFamily, orderId } = req.body;
    let emailAddr = email?.trim().toLowerCase();
    let order = null;
    if (orderId) {
      order = getSellerOrderById(orderId, req.account.id);
      if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
      emailAddr = order.accountEmail;
    }
    if (!emailAddr?.includes('@')) return res.status(400).json({ success: false, error: 'Invalid email' });
    const { max, orderMax } = keyPermContext(req.account.id, order);
    const perms = clampKeyPermsFull({
      permLogin: permLogin ?? order?.permLogin,
      permReset: permReset ?? order?.permReset,
      permFamily: permFamily ?? order?.permFamily,
    }, max, orderMax);
    const key = 'SK-' + [1, 2, 3].map(() => crypto.randomBytes(4).toString('hex').toUpperCase()).join('-');
    let exp = order?.expiresAt ?? null;
    if (expiresAt) {
      const t = new Date(expiresAt).getTime();
      if (!Number.isNaN(t)) exp = Math.floor(t / 1000);
    }
    const row = createKey(key, emailAddr, {
      note: (note || order?.note || '').trim() || null,
      keyName: (keyName || '').trim() || null,
      expiresAt: exp,
      orderId: order?.id ?? orderId ?? null,
      ...perms,
    }, req.account.id);
    if (order) logOrderEvent(order.id, 'key_created', key, null);
    return res.json({ success: true, key, email: row.email, permissions: perms });
  } catch (e) {
    return serverError(req, res, e);
  }
});

app.post('/api/seller/keys/batch', requireSeller, (req, res) => {
  try {
    const { orderId, items, syncName, syncExpires, syncPerms } = req.body;
    if (!orderId) return res.status(400).json({ success: false, error: 'Select an account (order)' });
    const order = getSellerOrderById(orderId, req.account.id);
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });

    const list = Array.isArray(items) ? items : [{ keyName: req.body.keyName }];
    if (!list.length || list.length > 5) {
      return res.status(400).json({ success: false, error: 'Create 1 to 5 keys at a time' });
    }

    const { max, orderMax } = keyPermContext(req.account.id, order);
    const sharedName = syncName !== false ? (list[0].keyName || '').trim() || null : null;
    let sharedExp = order.expiresAt;
    if (syncExpires === false && list[0].expiresAt) {
      const t = new Date(list[0].expiresAt).getTime();
      if (!Number.isNaN(t)) sharedExp = Math.floor(t / 1000);
    } else if (syncExpires !== false && list[0].expiresAt) {
      const t = new Date(list[0].expiresAt).getTime();
      if (!Number.isNaN(t)) sharedExp = Math.floor(t / 1000);
    }
    const sharedPerms = clampKeyPermsFull({
      permLogin: req.body.permLogin ?? order.permLogin,
      permReset: req.body.permReset ?? order.permReset,
      permFamily: req.body.permFamily ?? order.permFamily,
    }, max, orderMax);

    const created = [];
    for (const item of list) {
      const perms = syncPerms !== false ? sharedPerms : clampKeyPermsFull({
        permLogin: item.permLogin ?? sharedPerms.permLogin,
        permReset: item.permReset ?? sharedPerms.permReset,
        permFamily: item.permFamily ?? sharedPerms.permFamily,
      }, max, orderMax);
      let exp = sharedExp;
      if (syncExpires === false && item.expiresAt) {
        const t = new Date(item.expiresAt).getTime();
        if (!Number.isNaN(t)) exp = Math.floor(t / 1000);
      }
      const keyId = 'SK-' + [1, 2, 3].map(() => crypto.randomBytes(4).toString('hex').toUpperCase()).join('-');
      const row = createKey(keyId, order.accountEmail, {
        keyName: syncName !== false ? sharedName : ((item.keyName || '').trim() || null),
        expiresAt: exp,
        orderId: order.id,
        note: order.note,
        ...perms,
      }, req.account.id);
      created.push(row);
      logOrderEvent(order.id, 'key_created', keyId, null);
    }
    return res.json({ success: true, keys: created, count: created.length });
  } catch (e) {
    return serverError(req, res, e);
  }
});

app.patch('/api/seller/keys/:key', requireSeller, (req, res) => {
  try {
    const keyId = (req.params.key || '').trim();
    const { note, keyName, expiresAt, permLogin, permReset, permFamily } = req.body;
    const existing = getKey(keyId);
    if (!existing || existing.sellerId !== req.account.id) {
      return res.status(404).json({ success: false, error: 'Key not found' });
    }
    const order = existing.orderId ? getSellerOrderById(existing.orderId, req.account.id) : null;
    const { max, orderMax } = keyPermContext(req.account.id, order);
    const updates = {};
    if (note !== undefined) updates.note = (note || '').trim() || null;
    if (keyName !== undefined) updates.keyName = (keyName || '').trim() || null;
    if (expiresAt !== undefined) {
      if (!expiresAt) updates.expiresAt = null;
      else {
        const t = new Date(expiresAt).getTime();
        updates.expiresAt = Number.isNaN(t) ? null : Math.floor(t / 1000);
      }
    }
    if (permLogin !== undefined || permReset !== undefined || permFamily !== undefined) {
      const merged = clampKeyPermsFull({
        permLogin: permLogin !== undefined ? permLogin : existing.permLogin,
        permReset: permReset !== undefined ? permReset : existing.permReset,
        permFamily: permFamily !== undefined ? permFamily : existing.permFamily,
      }, max, orderMax);
      Object.assign(updates, merged);
    }
    const row = updateKey(keyId, req.account.id, updates);
    if (!row) return res.status(404).json({ success: false, error: 'Key not found' });
    return res.json({ success: true, key: row, orderPerms: order ? {
      permLogin: order.permLogin, permReset: order.permReset, permFamily: order.permFamily,
    } : null });
  } catch (e) {
    return serverError(req, res, e);
  }
});

app.post('/api/seller/keys/:key/sync', requireSeller, (req, res) => {
  const row = syncKeyFromOrder(req.params.key, req.account.id);
  if (!row) return res.status(404).json({ success: false, error: 'Key not found or not linked to an order' });
  return res.json({ success: true, key: row });
});

app.delete('/api/seller/keys/:key', requireSeller, (req, res) => {
  const ok = deleteKeyForSeller(req.params.key, req.account.id);
  if (!ok) return res.status(404).json({ success: false, error: 'Key not found' });
  return res.json({ success: true });
});

app.get('/api/key/resolve', (req, res) => {
  const row = getKey((req.query.key || '').trim());
  if (!row) return res.status(404).json({ success: false, error: 'Key not found' });
  if (row.expiresAt && row.expiresAt < Math.floor(Date.now() / 1000)) {
    return res.status(403).json({ success: false, error: 'Key expired' });
  }
  return res.json({
    success: true,
    email: row.email,
    permissions: { permLogin: row.permLogin, permReset: row.permReset, permFamily: row.permFamily },
  });
});

// ─── Admin API (X-Admin-Token) ────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  // Header-only: query-string tokens leak via logs/Referer/history.
  const token = req.headers['x-admin-token'] || '';
  if (token && token === ADMIN_TOKEN) return next();
  // 2) Hoặc session tài khoản admin
  const acc = getPanelAccount(req);
  if (acc && acc.role === 'admin' && acc.status === 'active') {
    req.account = acc;
    return next();
  }
  return res.status(401).json({ success: false, error: 'Unauthorized' });
}

app.get('/api/admin/stats', requireAdmin, (req, res) => {
  return res.json({ success: true, stats: getAdminStats() });
});

app.get('/api/admin/keys', requireAdmin, (req, res) => {
  return res.json({ success: true, keys: getAllKeys() });
});

app.delete('/api/admin/keys/:key', requireAdmin, (req, res) => {
  const ok = deleteKey(req.params.key);
  return res.json({ success: ok });
});

app.get('/api/admin/users', requireAdmin, (req, res) => {
  return res.json({ success: true, users: getAllUsers() });
});

app.get('/api/admin/sellers', requireAdmin, (req, res) => {
  return res.json({ success: true, sellers: getSellers(), pending: getPendingSellers() });
});

app.post('/api/admin/sellers/:id/approve', requireAdmin, (req, res) => {
  const ok = setAccountStatus(req.params.id, 'active');
  if (ok) {
    const body = req.body || {};
    setSellerPerms(req.params.id, {
      permLogin: body.permLogin !== false,
      permReset: !!body.permReset,
      permFamily: body.permFamily !== false,
    });
  }
  return res.json({ success: ok });
});

app.patch('/api/admin/sellers/:id/perms', requireAdmin, (req, res) => {
  const { permLogin, permReset, permFamily } = req.body || {};
  const ok = setSellerPerms(req.params.id, {
    permLogin: permLogin !== false,
    permReset: !!permReset,
    permFamily: permFamily !== false,
  });
  if (!ok) return res.status(404).json({ success: false, error: 'Seller not found' });
  return res.json({ success: true, sellerPerms: getSellerMaxPerms(req.params.id) });
});

app.post('/api/admin/sellers/:id/reject', requireAdmin, (req, res) => {
  return res.json({ success: setAccountStatus(req.params.id, 'rejected') });
});

app.post('/api/admin/sellers/:id/topup', requireAdmin, (req, res) => {
  try {
    const amount = parseInt(req.body.amount, 10);
    if (!amount || amount < 1000) return res.status(400).json({ success: false, error: 'Minimum amount is 1,000đ' });
    if (amount > 100000000) return res.status(400).json({ success: false, error: 'Maximum amount is 100,000,000đ per top-up' });
    const r = adjustBalance(req.params.id, amount, {
      type: 'topup',
      description: req.body.description || 'Admin nạp tiền',
    });
    if (!r || r.error) return res.status(400).json({ success: false, error: r?.error || 'Top-up failed' });
    return res.json({ success: true, balance: r.balance });
  } catch (e) {
    return serverError(req, res, e);
  }
});

app.get('/api/admin/products', requireAdmin, (req, res) => {
  return res.json({ success: true, products: getProducts(false) });
});

app.post('/api/admin/products', requireAdmin, (req, res) => {
  try {
    const b = req.body;
    const id = b.id || 'prod_' + crypto.randomBytes(4).toString('hex');
    const p = upsertProduct({
      id,
      name: b.name,
      durationLabel: b.durationLabel,
      durationDays: parseInt(b.durationDays, 10) || 30,
      price: parseInt(b.price, 10),
      warrantyNote: b.warrantyNote,
      active: b.active !== false,
    });
    return res.json({ success: true, product: p });
  } catch (e) {
    return serverError(req, res, e);
  }
});

app.post('/api/admin/sellers/:id/orders', requireAdmin, (req, res) => {
  try {
    const b = req.body;
    const product = b.productId ? getProductById(b.productId) : null;
    const order = adminCreateOrderForSeller({
      sellerId: req.params.id,
      productId: product?.id,
      productName: b.productName || product?.name || 'Netflix Premium',
      durationLabel: product?.durationLabel || b.durationLabel,
      durationDays: product?.durationDays || 30,
      accountEmail: b.accountEmail,
      accountPassword: b.accountPassword,
      viaEmail: b.viaEmail !== false,
      permLogin: b.permLogin !== false,
      permReset: !!b.permReset,
      permFamily: b.permFamily !== false,
      note: b.note,
    });
    return res.json({ success: true, order });
  } catch (e) {
    return serverError(req, res, e);
  }
});

app.get('/api/domains', async (req, res) => {
  try {
    // tempmail.id.vn has no public "random domains" endpoint — serve the
    // allowed list from env (comma-separated TEMPMAIL_DOMAINS).
    const domains = String(process.env.TEMPMAIL_DOMAINS || 'tempmail.id.vn')
      .split(',').map(d => d.trim()).filter(Boolean);
    return res.json({ success: true, domains });
  } catch (e) { return serverError(req, res, e); }
});

// ─── Ping ─────────────────────────────────────────────────────────────────────
console.log('[BOOT] Registering /api/checker/ping ...');
app.get('/api/checker/ping', (req, res) => {
  console.log('[PING] called');
  res.json({
    ok: true, ts: Date.now(), version: 'v4',
    nftokenMode: getNftokenMode(),
    checkPaces: Object.keys(CHECK_PACES),
    defaultPace: process.env.CHECK_PACE || 'stealth',
    maxChecksPerHour: CHECK_MAX_PER_HOUR,
  });
});
console.log('[BOOT] /api/checker/ping registered OK');

// ─── Debug: test one cookie, return raw details ───────────────────────────────
app.post('/api/checker/debug', ipRateLimit('debug', 10, 3600000), async (req, res) => {
  try {
    const { cookie } = req.body;
    if (!cookie || typeof cookie !== 'string') return res.status(400).json({ error: 'no cookie' });
    // Debug probes hit Netflix/nftoken too — count against the hourly budget.
    assertCheckRateLimit();

    // Test 1: can we reach /account ?
    const cookie_full = cookie.trim();
    const nfH = {
      ...NETFLIX_HEADERS,
      Cookie: cookie_full,
      'Accept-Encoding': 'gzip, deflate, br',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
    };

    let acctStatus = null, acctLen = 0;
    try {
      const r = await nodeRequest('https://www.netflix.com/account', { method: 'GET', headers: nfH, timeout: 12000 });
      acctStatus = r.status;
      acctLen    = r.buffer.length;
    } catch (e) { acctStatus = 'error:' + e.message; }

    // Test 2: nftoken.site (chỉ khi mode bật)
    let nftData = null;
    const nftMode = getNftokenMode();
    if (nftMode !== 'off') {
      try {
        const ckNft = cookie_full.substring(Math.max(0, cookie_full.indexOf('NetflixId=')));
        const body  = new URLSearchParams({ raw_cookie: ckNft, ajax: '1', is_bulk: '1' }).toString();
        const r     = await nodeRequest('https://nftoken.site/cookies/index.php', {
          method: 'POST', timeout: 12000,
          headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8', 'origin': 'https://nftoken.site', 'referer': 'https://nftoken.site/cookies/', 'user-agent': 'Mozilla/5.0', 'x-requested-with': 'XMLHttpRequest', 'accept': 'application/json' },
          body,
        });
        try { nftData = r.json(); } catch { nftData = { raw_text: r.text().substring(0, 200) }; }
      } catch (e) { nftData = { error: e.message }; }
    } else {
      nftData = { skipped: true, reason: 'NFTOKEN_MODE=off' };
    }

    // Extract useful info from account HTML
    let acctInfo = { status: acctStatus, html_len: acctLen, live: acctStatus === 200 };
    if (acctStatus === 200) {
      // Get all data-uia values related to membership
      const uiaMatches = [];
      try {
        const r2 = await nodeRequest('https://www.netflix.com/account', {
          method: 'GET', timeout: 12000,
          headers: { ...NETFLIX_HEADERS, Cookie: cookie_full, 'Accept-Encoding': 'identity', 'Accept-Language': 'en-US,en;q=0.9' }
        });
        const h = r2.text();
        const all = [...h.matchAll(/data-uia="([^"]+)"/g)].map(m => m[1]);
        const membership = all.filter(a => a.includes('membership') || a.includes('plan') || a.includes('payment') || a.includes('billing'));
        uiaMatches.push(...membership);

        // Check for the key live element
        const LIVE_CHECK = 'account-overview-page+membership-card+payment+details';
        acctInfo.has_payment_element = h.includes(LIVE_CHECK);
        acctInfo.uia_membership = membership;
        acctInfo.html_snippet = h.substring(h.indexOf('membership-card') > 0 ? Math.max(0, h.indexOf('membership-card') - 100) : 0, h.indexOf('membership-card') + 500);
      } catch(e2) { acctInfo.extract_error = e2.message; }
    }

    return res.json({
      netflix_account: acctInfo,
      nftoken_site:    nftData,
      nftokenMode:     nftMode,
    });
  } catch (e) {
    const limited = e.code === 'RATE_LIMIT';
    return res.status(limited ? 429 : 500).json({ error: limited ? e.message : 'Internal server error', rateLimited: limited });
  }
});

// ─── Global JSON error handler (Express 4 catch-all) ─────────────────────────
// Must have 4 params so Express recognises it as error middleware.
// This ensures Express NEVER returns HTML — always JSON.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[EXPRESS ERR]', req.method, req.path, err.message);
  const status = err.status || 500;
  // 4xx (e.g. body-parser JSON errors) are safe to surface; 5xx stay generic.
  res.status(status).json({ error: status < 500 ? (err.message || 'Bad request') : 'Internal server error' });
});

// ─── Start ─────────────────────────────────────────────────────────────────────

try {
  runMigrations();
  runSeed();
  const migrated = migrateOrphanKeysToOrders();
  if (migrated > 0) console.log(`[DB] Đã gắn ${migrated} key cũ vào đơn hàng`);
  deleteExpiredSessions();
} catch (err) {
  console.error('[FATAL] Database initialization failed:', err.message);
  process.exit(1);
}

// ─── Background warranty checker ──────────────────────────────────────────────
// Periodically re-checks active orders that have a stored cookie and records the
// verdict so the seller panel can flag dead / payment-hold accounts still under
// warranty. Disabled with WARRANTY_CHECK=0. Runs sequentially with delays to
// avoid bursting Netflix/nftoken and to respect the hourly check budget.
let warrantyJobRunning = false;
async function runWarrantyCheckBatch() {
  if (warrantyJobRunning) return;
  warrantyJobRunning = true;
  try {
    const minInterval = Math.max(600, parseInt(process.env.WARRANTY_MIN_INTERVAL_SEC || '21600', 10) || 21600);
    const batchSize = Math.max(1, parseInt(process.env.WARRANTY_BATCH || '10', 10) || 10);
    const due = listOrdersDueForCheck(minInterval, batchSize);
    if (!due.length) return;
    console.log(`[warranty] checking ${due.length} order(s)`);
    for (const order of due) {
      try {
        const out = await fullCheck(order.cookie);
        if (out.rateLimited) { console.warn('[warranty] hit rate limit — pausing batch'); break; }
        const status = checkResultToStatus(out);
        recordOrderCheck(order.id, status);
        logOrderEvent(order.id, 'warranty_check', `auto: ${status}`);
      } catch (e) {
        console.error(`[warranty] order ${order.id} check failed:`, e.message);
      }
      // Space out checks to stay gentle on upstreams.
      await new Promise((r) => setTimeout(r, 4000 + Math.random() * 4000));
    }
  } catch (e) {
    console.error('[warranty] batch error:', e.message);
  } finally {
    warrantyJobRunning = false;
  }
}

function startWarrantyChecker() {
  if (process.env.WARRANTY_CHECK === '0') {
    console.log('  \x1b[33m●\x1b[0m Warranty auto-check: disabled (WARRANTY_CHECK=0)');
    return;
  }
  const everyMin = Math.max(5, parseInt(process.env.WARRANTY_INTERVAL_MIN || '30', 10) || 30);
  // First run shortly after boot, then on the configured interval.
  setTimeout(() => { runWarrantyCheckBatch(); }, 60000).unref();
  setInterval(() => { runWarrantyCheckBatch(); }, everyMin * 60000).unref();
  console.log(`  \x1b[32m●\x1b[0m Warranty auto-check: every ${everyMin}m`);
}

if (require.main === module) {
  app.listen(PORT, () => {
    console.log('\n\x1b[31m███╗   ██╗███████╗████████╗███████╗██╗     ██╗██╗  ██╗\x1b[0m');
    console.log('\x1b[31m████╗  ██║██╔════╝╚══██╔══╝██╔════╝██║     ██║╚██╗██╔╝\x1b[0m');
    console.log('\x1b[31m██╔██╗ ██║█████╗     ██║   █████╗  ██║     ██║ ╚███╔╝ \x1b[0m');
    console.log('\x1b[31m██║╚██╗██║██╔══╝     ██║   ██╔══╝  ██║     ██║ ██╔██╗ \x1b[0m');
    console.log('\x1b[31m██║ ╚████║███████╗   ██║   ██║     ███████╗██║██╔╝ ██╗\x1b[0m');
    console.log('\x1b[31m╚═╝  ╚═══╝╚══════╝   ╚═╝   ╚═╝     ╚══════╝╚═╝╚═╝  ╚═╝\x1b[0m');
    console.log(`\n  Listening: \x1b[36mhttp://localhost:${PORT}\x1b[0m`);
    console.log('  \x1b[33m/\x1b[0m Get Code   \x1b[33m/checker\x1b[0m   \x1b[33m/seller\x1b[0m   \x1b[33m/admin\x1b[0m\n');
    if (ADMIN_TOKEN_GENERATED) {
      console.log(`  \x1b[35m●\x1b[0m ADMIN_TOKEN (random): \x1b[36m${ADMIN_TOKEN}\x1b[0m`);
      console.log('    (set env ADMIN_TOKEN to pin)\n');
    }
    if (TURNSTILE_CFG.reason === 'production') {
      console.log('  \x1b[32m●\x1b[0m Turnstile: production site key active');
    } else if (TURNSTILE_CFG.reason === 'test') {
      console.log('  \x1b[33m●\x1b[0m Turnstile: TEST keys (set TURNSTILE_SITE_KEY in .env for real widget)');
    } else if (TURNSTILE_CFG.reason === 'missing_keys') {
      console.log('  \x1b[33m●\x1b[0m Turnstile: off — add TURNSTILE_SITE_KEY + TURNSTILE_SECRET_KEY to .env');
    } else {
      console.log('  \x1b[33m●\x1b[0m Turnstile: disabled (TURNSTILE_DISABLED=1)');
    }
    startWarrantyChecker();
  });
}

module.exports = { mergeCheckResults };
