const express = require('express');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const path = require('path');
const https = require('https');
const http = require('http');
const zlib = require('zlib');
const { v4: uuidv4 } = require('uuid');
const { nfExtractEmailFromHtml, nfDetectPaymentHold } = require('./lib/nf-email-parse');

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
  const THAI_RE = /(?:Netflix\s+)?(?:พรีเมียม|มาตรฐาน|พื้นฐาน|มือถือ|เบสิก|สแตนดาร์ด)/;
  const lines = nfVisibleLines(html);
  for (const line of lines) {
    const m = line.match(PLAN_RE) || line.match(THAI_RE);
    if (m && line.length < 100) return nfClean(m[0]);
  }
  // Last resort: raw regex on full HTML
  const raw = html.match(PLAN_RE) || html.match(THAI_RE);
  if (raw) return nfClean(raw[0]);
  return null;
}

function nfPushProfile(profiles, rawName) {
  const name = nfClean(rawName);
  if (!name || /^\d+$/.test(name) || profiles.includes(name)) return;
  profiles.push(name);
}

const NF_CANCEL_KW = [
  'ends on','end on','membership ends','will end','membership will end',
  'cancellation','cancelled','canceled','your membership ends','has been cancelled','has been canceled',
  'reactivate membership','restart membership',
  'kết thúc','hết hạn vào','đã hủy','sẽ kết thúc','đã bị hủy','chấm dứt','kích hoạt lại',
];
const NF_PAYERR_KW = [
  'payment failed','payment unsuccessful','unable to process your payment',
  "couldn't process your payment",'problem with your payment','payment method was declined',
  'account is on hold','your account is on hold','on hold. retry','retry your payment',
  'update payment','fix payment','payment issue','billing issue',
  'thanh toán không thành công','không thể xử lý khoản thanh toán','kiểm tra số dư',
];

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

    const html = res.text();
    if (!html || html.length < 3000) return { reachable: false, reason: 'empty' };

    // ── PRIMARY LIVE SIGNAL ────────────────────────────────────────────────────
    // Signal 1: payment details element (CC, PayPal, carrier, gift card)
    const LIVE_SELECTORS = [
      'account-overview-page+membership-card+payment+details+CC',
      'account-overview-page+membership-card+payment+details+PAYPAL',
      'account-overview-page+membership-card+payment+details+CARRIER',
      'account-overview-page+membership-card+payment+details+GIFT',
      'account-overview-page+membership-card+payment+details+MOBILE',
      'account-overview-page+membership-card+payment+details',   // catch-all
    ];
    const hasPaymentEl = LIVE_SELECTORS.some(sel => html.includes(`data-uia="${sel}`));

    // Signal 2: Cancel membership button = account is active (can cancel it)
    const hasCancelBtn = html.toLowerCase().includes('cancel membership') ||
                         html.toLowerCase().includes('cancel your membership') ||
                         html.toLowerCase().includes('ยกเลิกสมาชิก');

    // Log all membership-related data-uia attributes found
    const uiaAll = [...html.matchAll(/data-uia="([^"]+)"/g)].map(m => m[1]);
    const uiaMembership = uiaAll.filter(a => a.includes('membership') || a.includes('plan') || a.includes('payment'));
    nfLog(`[NF] status=${res.status} len=${html.length} paymentEl=${hasPaymentEl} cancelBtn=${hasCancelBtn}`);
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

    // Lỗi thanh toán / on hold → không coi là LIVE dù vẫn thấy tên gói trên /account
    let accountPaymentHold = nfDetectPaymentHold(html);
    let paymentHold = browsePaymentHold || accountPaymentHold;
    const htmlLow = html.toLowerCase();
    let paymentError = paymentHold
      || NF_PAYERR_KW.some(kw => htmlLow.includes(kw.toLowerCase()))
      || /"(?:paymentIssue|paymentError|paymentFailed|billingIssue)"\s*:\s*(?:true|1|"true")/i.test(html);

    // Vẫn thấy plan + payment UI nhưng browse chặn popup → xác minh thêm /browse
    let browseVerifyHold = false;
    if (plan && !paymentHold) {
      try {
        await randDelay(400, 1200);
        const br = await nodeRequest('https://www.netflix.com/browse', {
          method: 'GET', headers: session.home, timeout: 12000,
        });
        if (br.status === 200) {
          browseVerifyHold = nfDetectPaymentHold(br.text());
          if (browseVerifyHold) paymentHold = true;
        }
      } catch { /* bỏ qua */ }
    }

    let subscriptionActive = !paymentHold && (hasPaymentEl || hasCancelBtn);
    let isLive = subscriptionActive;

    // ── BILLING DATE — data-uia attribute ──────────────────────────────────────
    let billingText = null;
    const billUia = html.match(/data-uia="account-overview-page\+membership-card\+description"[^>]*>\s*([^<]{4,120})/);
    if (billUia) billingText = nfClean(billUia[1]);
    if (!billingText) billingText = nfExtractBilling(html);

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

    // Có tên gói nhưng không còn quyền xem (TT lỗi hoặc hết membership thật)
    const planLost = !!plan && (paymentHold || paymentError || !subscriptionActive);
    if (planLost) {
      isLive = false;
      subscriptionActive = false;
    }

    return {
      reachable:    true,
      alive:        isLive,
      cancelled:    !subscriptionActive && !paymentHold,
      planLost,
      plan,
      billingText,
      profiles,
      paymentError,
      paymentHold,
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

    return { alive, hasPremium, plan, email, screens, paymentError, raw: data };
  } catch (e) {
    return { alive: false, hasPremium: false, plan: null, email: null, screens: null, paymentError: false, raw: null, error: e.message };
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
// me.domain/      → me/index.html (Get Code)
// seller.domain/  → seller/index.html
// admin.domain/   → admin/index.html
// (domain trần)/  → landing (xử lý ở route '/' bên dưới)
function serveSubdomainRoot(req, res, next) {
  if (req.path !== '/') return next();
  switch (req.subdomain) {
    case 'me':     return res.sendFile(PAGE.me);
    case 'seller': return res.sendFile(PAGE.seller);
    case 'admin':  return res.sendFile(PAGE.admin);
    default:       return next();
  }
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

// Trang chủ user: chỉ lấy mã (email hoặc key) — không còn landing Netflix demo
app.get('/', (req, res) => {
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
  res.sendFile(PAGE.me);
});

// Panel trên domain chính (redirect API login)
app.get('/admin', (req, res) => res.sendFile(PAGE.admin));
app.get('/seller', (req, res) => res.sendFile(PAGE.seller));

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

const NFT_SKIPPED = { alive: false, hasPremium: false, plan: null, email: null, screens: null, paymentError: false, raw: null, skipped: true };

function mergeCheckResults(nf, nft) {
  const plan = nf.plan || nft.plan || null;
  const paymentHold = !!(nf.paymentHold || nf.paymentError);
  const paymentError = paymentHold || !!(nft.paymentError && !nf.reachable);
  const planLost = !!(nf.planLost || (nf.reachable && plan && (!nf.alive || paymentHold || paymentError)));

  // LIVE = còn xem được — chỉ tin kết quả direct /account (+ browse), KHÔNG tin nftoken SUCCESS
  let alive = false;
  if (nf.reachable) {
    alive = !!nf.alive && !planLost;
  } else if (!nft.skipped && nft.alive) {
    alive = !!nft.alive && !paymentError;
  }

  let source = 'none';
  if (nft.skipped) {
    source = nf.reachable ? 'direct' : 'none';
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
    _nft: nft.skipped ? { skipped: true } : { alive: nft.alive, error: nft.error },
    _nf:  { reachable: nf.reachable, alive: nf.alive, error: nf.error },
  };
}

async function runNftokenCheck(cookieStr) {
  return checkAccountDetails(cookieStr).catch(e => ({
    alive: false, hasPremium: false, plan: null, email: null, screens: null,
    paymentError: false, raw: null, error: e.message, skipped: false,
  }));
}

function shouldFallbackNftoken(nf) {
  if (!nf.reachable) return true;
  // Có plan nhưng không có email → gọi nftoken (trường hợp Netflix SSR đổi format)
  if (!nf.emailFromHtml) return true;
  if (nf.alive && !nf.plan) return true;
  return false;
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

    if (!pace.skipNftoken) {
      if (mode === 'parallel') {
        await randDelay(pace.nftMin, pace.nftMax);
        nft = await runNftokenCheck(cookieStr);
      } else if (mode === 'fallback' && shouldFallbackNftoken(nf)) {
        await randDelay(pace.nftMin, pace.nftMax);
        nft = await runNftokenCheck(cookieStr);
      }
    }

    const out = mergeCheckResults(nf, nft);
    out.checkPace = pace.key;
    if (pace.skipNftoken) out.nftokenSkippedStealth = true;
    return out;
  } catch (e) {
    const out = { alive: false, error: e.message, profiles: [], plan: null, billingText: null, nftokenMode: getNftokenMode() };
    if (e.code === 'RATE_LIMIT') out.rateLimited = true;
    return out;
  }
}

// ─── Live check – single cookie set ──────────────────────────────────────────
app.post('/api/checker/live-check', async (req, res) => {
  try {
    const { cookie } = req.body;
    if (!cookie || typeof cookie !== 'string') {
      return res.status(400).json({ error: 'Missing cookie' });
    }
    const result = await fullCheck(cookie, req.body.pace);
    return res.json(result);
  } catch (e) {
    console.error('[live-check] ERROR:', e.message);
    const status = e.code === 'RATE_LIMIT' ? 429 : 500;
    return res.status(status).json({ alive: false, error: e.message, profiles: [], rateLimited: e.code === 'RATE_LIMIT' });
  }
});

// ─── Batch live check – multiple sets ────────────────────────────────────────
app.post('/api/checker/batch', async (req, res) => {
  try {
    const { cookies } = req.body;
    if (!Array.isArray(cookies) || !cookies.length) {
      return res.status(400).json({ error: 'Missing cookies array' });
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
    return res.status(500).json({ error: e.message });
  }
});

// ─── Cloudflare Turnstile ─────────────────────────────────────────────────────
// Test keys (luôn pass): site=1x00000000000000000000AA secret=1x0000000000000000000000000000000AA
// Production: set TURNSTILE_SITE_KEY + TURNSTILE_SECRET_KEY trong env
const TURNSTILE_SITE_KEY   = process.env.TURNSTILE_SITE_KEY   || '1x00000000000000000000AA';
const TURNSTILE_SECRET_KEY = process.env.TURNSTILE_SECRET_KEY || '1x0000000000000000000000000000000AA';
const TURNSTILE_ENABLED    = process.env.TURNSTILE_DISABLED !== '1';

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

async function fetchInboxForEmail(email, perms) {
  const [user, domain] = email.split('@');
  const url = `https://tinyhost.shop/api/email/${encodeURIComponent(domain)}/${encodeURIComponent(user)}/?limit=20`;
  const r   = await nodeRequest(url, {
    method: 'GET',
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
    timeout: 12000,
  });

  let data;
  try { data = r.json(); } catch { return { success: true, emails: [], total: 0 }; }
  if (r.status !== 200) return { success: true, emails: [], total: 0 };

  const raw    = data.emails || data.data || [];
  let emails = raw.map(parseNetflixEmail).sort((a, b) => (b.priority || 0) - (a.priority || 0));
  if (perms) emails = filterEmailsByPerms(emails, perms);
  return { success: true, emails, total: emails.length };
}

app.get('/api/turnstile/config', (req, res) => {
  return res.json({
    success: true,
    enabled: TURNSTILE_ENABLED,
    siteKey: TURNSTILE_SITE_KEY,
  });
});

// ─── Temp Mail Inbox API ──────────────────────────────────────────────────────
app.get('/api/inbox', async (req, res) => {
  try {
    const email = (req.query.email || '').trim().toLowerCase();
    if (!email || !email.includes('@'))
      return res.status(400).json({ success: false, error: 'Invalid email' });

    const result = await fetchInboxForEmail(email);
    return res.json(result);
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/inbox', async (req, res) => {
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
    }

    const result = await fetchInboxForEmail(email, perms);
    if (keyStr && perms) {
      result.permissions = perms;
    }
    return res.json(result);
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

function parseNetflixEmail(raw) {
  const subject  = String(raw.subject   || '');
  const body     = String(raw.body      || raw.text_body || '');
  const html     = String(raw.html_body || raw.html      || '');
  const from     = String(raw.from      || raw.sender    || '');
  const id       = raw.id || raw._id || '';
  const time     = raw.created_at || raw.date || '';
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

function setPanelCookie(res, sessionId) {
  res.cookie(PANEL_COOKIE, sessionId, {
    maxAge: 30 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax',
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
app.post('/api/panel/login', (req, res) => {
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
    return res.status(500).json({ success: false, error: e.message });
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
app.post('/api/seller/register', async (req, res) => {
  try {
    const username = String(req.body.username || '').trim();
    const email    = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (username.length < 3)   return res.status(400).json({ success: false, error: 'Username must be at least 3 characters' });
    if (!email.includes('@'))  return res.status(400).json({ success: false, error: 'Invalid email' });
    if (password.length < 6)   return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });
    if (getAccountByUsername(username)) return res.status(409).json({ success: false, error: 'Username already exists' });
    if (getAccountByEmail(email))       return res.status(409).json({ success: false, error: 'Email already used' });

    const code    = String(Math.floor(100000 + Math.random() * 900000)); // mã 6 số
    const expires = Math.floor(Date.now() / 1000) + 15 * 60;             // hết hạn 15 phút
    const id      = 'sel_' + crypto.randomBytes(6).toString('hex');
    createAccount({ id, username, email, password: hashPassword(password), role: 'seller', verifyCode: code, verifyExpires: expires });

    const mail = await sendVerificationEmail(email, code).catch(() => ({ sent: false }));
    return res.json({ success: true, accountId: id, emailSent: mail.sent, message: 'Account created. Enter the verification code sent to your email.' });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// Xác minh email bằng mã 6 số
app.post('/api/seller/verify-email', (req, res) => {
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
    return res.status(500).json({ success: false, error: e.message });
  }
});

// Gửi lại mã xác minh
app.post('/api/seller/resend-code', async (req, res) => {
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
    return res.status(500).json({ success: false, error: e.message });
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
    const { accountPassword, viaEmail, note, permLogin, permReset, permFamily } = req.body;
    const order = updateSellerOrder(req.params.id, req.account.id, {
      accountPassword, viaEmail, note, permLogin, permReset, permFamily,
    });
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
    return res.json({ success: true, order });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
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
    return res.status(500).json({ success: false, error: e.message });
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
    return res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/seller/transactions', requireSeller, (req, res) => {
  return res.json({
    success: true,
    transactions: getTransactions(req.account.id),
    summary: getTransactionSummary(req.account.id),
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
    return res.status(500).json({ success: false, error: e.message });
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
    return res.status(500).json({ success: false, error: e.message });
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
    return res.status(500).json({ success: false, error: e.message });
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
  // 1) Token cũ (backward-compat)
  const token = req.headers['x-admin-token'] || req.query.token || '';
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
    const r = adjustBalance(req.params.id, amount, {
      type: 'topup',
      description: req.body.description || 'Admin nạp tiền',
    });
    if (!r || r.error) return res.status(400).json({ success: false, error: r?.error || 'Top-up failed' });
    return res.json({ success: true, balance: r.balance });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
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
    return res.status(500).json({ success: false, error: e.message });
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
    return res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/domains', async (req, res) => {
  try {
    const r = await nodeRequest('https://tinyhost.shop/api/random-domains/?limit=30', {
      method: 'GET', headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }, timeout: 8000,
    });
    let d; try { d = r.json(); } catch { return res.json({ success: true, domains: [] }); }
    return res.json({ success: true, domains: d.domains || [] });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
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
app.post('/api/checker/debug', async (req, res) => {
  try {
    const { cookie } = req.body;
    if (!cookie) return res.status(400).json({ error: 'no cookie' });

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
    return res.status(500).json({ error: e.message });
  }
});

// ─── Global JSON error handler (Express 4 catch-all) ─────────────────────────
// Must have 4 params so Express recognises it as error middleware.
// This ensures Express NEVER returns HTML — always JSON.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[EXPRESS ERR]', req.method, req.path, err.message);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
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
});
