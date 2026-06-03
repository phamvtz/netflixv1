const express = require('express');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const path = require('path');
const https = require('https');
const http = require('http');
const zlib = require('zlib');
const { v4: uuidv4 } = require('uuid');

// SQLite — khởi tạo singleton trước khi route dùng query layer
require('./db/database');
const { runMigrations } = require('./db/migrate');
const { runSeed } = require('./db/seed');
const {
  getUserByEmail,
  getUserById,
  getProfilesByUserId,
  getProfileByIdAndUserId,
  createSession,
  getSession,
  deleteSession,
  deleteExpiredSessions,
  getAllContent,
  createKey,
  resolveKeyEmail,
  getAllKeys,
  getKeysBySeller,
  deleteKey,
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
const { subdomainMiddleware } = require('./subdomain');
const { verifyPassword, hashPassword } = require('./auth');
const { sendVerificationEmail } = require('./mailer');

// Chỉ tắt verify TLS khi thật sự cần debug cert lỗi — mặc định GIỮ bảo mật.
// Các site dùng (netflix.com, cloudflare, nftoken.site...) đều có cert hợp lệ.
if (process.env.INSECURE_TLS === '1') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  console.warn('[SECURITY] TLS verification DISABLED (INSECURE_TLS=1)');
}

// Admin token: ưu tiên env. Không set → sinh ngẫu nhiên mỗi lần khởi động
// (in ra console) thay vì mặc định dễ đoán.
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

// Tạo header browser-realistic cho 1 request Netflix (xoay UA + đủ sec-ch/sec-fetch).
// Mô phỏng điều hướng thật: từ trang chủ → /account (Referer + Sec-Fetch-User).
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
  sleep(min + Math.floor(Math.random() * (max - min)));

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

// Extract email directly from Netflix HTML (doesn't need nftoken.site)
function nfExtractEmail(html) {
  if (!html) return null;
  const emailPats = [
    /"userLogin"\s*:\s*"([^"@]{2,50}@[^"]{2,50})"/,
    /"email"\s*:\s*"([^"@]{2,50}@[^"]{2,50})"/,
    /"memberEmail"\s*:\s*"([^"@]{2,50}@[^"]{2,50})"/,
    /"loginName"\s*:\s*"([^"@]{2,50}@[^"]{2,50})"/,
    /"primaryEmail"\s*:\s*"([^"@]{2,50}@[^"]{2,50})"/,
    /"accountEmail"\s*:\s*"([^"@]{2,50}@[^"]{2,50})"/,
  ];
  for (const pat of emailPats) {
    const m = html.match(pat);
    if (m) return m[1].trim();
  }
  return null;
}

// Deep email extraction from Netflix reactContext JSON
function nfExtractEmailFallback(html) {
  if (!html) return null;

  // 1. Find netflix.reactContext (main embedded data blob)
  //    Netflix stores user info: memberLoginId, userLogin, email
  const ctxPats = [
    /netflix\.reactContext\s*=\s*(\{[\s\S]{200,}?\})\s*;?\s*<\/script>/,
    /"memberLoginId"\s*:\s*"([^"@]{1,60}@[^"]{2,60})"/,
    /"membershipEmail"\s*:\s*"([^"@]{1,60}@[^"]{2,60})"/,
    /"userEmail"\s*:\s*"([^"@]{1,60}@[^"]{2,60})"/,
    // Visible email in account page (may be masked: p***@gmail.com)
    /data-uia="account-overview-page[^"]*email[^"]*"[^>]*>([^<@]{1,40}@[^<]{2,40})</i,
    // Inside script context — broader key match
    /"[a-zA-Z]{0,20}[Ee]mail[a-zA-Z]{0,20}"\s*:\s*"([^"]{2,60}@[^"]{2,60})"/,
    /"[a-zA-Z]{0,20}[Ll]ogin[a-zA-Z]{0,20}"\s*:\s*"([^"]{2,60}@[^"]{2,60})"/,
  ];

  for (const pat of ctxPats) {
    const m = html.match(pat);
    if (!m) continue;
    const candidate = m[1]?.trim();
    if (!candidate) continue;
    // If it's the full reactContext blob, re-search inside it
    if (candidate.startsWith('{')) {
      const inner = candidate.match(/"(?:memberLoginId|userLogin|email|memberEmail)"\s*:\s*"([^"@]{1,60}@[^"]{2,60})"/);
      if (inner) return inner[1].trim();
      continue;
    }
    // Validate: must have @, not be a Netflix internal email, not example domain
    if (candidate.includes('@') &&
        !candidate.includes('netflix.com') &&
        !candidate.includes('example.') &&
        !candidate.includes('noreply') &&
        !candidate.includes('support@')) {
      return candidate;
    }
  }
  return null;
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
async function fetchNetflixAccountInfo(cookieStr) {
  try {
    const cookie = cookieStr.trim();
    const nfH = buildNetflixHeaders({
      Cookie: cookie,
      'Accept-Encoding': 'gzip, deflate, br',
    });

    // Delay ngẫu nhiên trước khi chạm Netflix → giảm pattern bot
    await randDelay();
    const res = await nodeRequest('https://www.netflix.com/account', { method: 'GET', headers: nfH, timeout: 15000 });

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
    console.log(`[NF] status=${res.status} len=${html.length} paymentEl=${hasPaymentEl} cancelBtn=${hasCancelBtn}`);
    if (uiaMembership.length) console.log(`[NF-UIA]`, uiaMembership.join(', '));
    // Debug email search
    const emailDbg = nfExtractEmail(html) || nfExtractEmailFallback(html);
    console.log(`[NF-EMAIL]`, emailDbg || '(not found)');
    // Debug profiles
    const allProfileNames = [...html.matchAll(/"profileName"\s*:\s*"([^"]{1,50})"/g)].map(m=>m[1]).slice(0,5);
    if (allProfileNames.length) console.log(`[NF-PROFILES]`, allProfileNames);

    // Combine signals: any positive signal = LIVE
    const isLive = hasPaymentEl || hasCancelBtn;

    // ── PLAN — data-uia attribute (most reliable) ──────────────────────────────
    let plan = null;
    const planUia = html.match(/data-uia="account-overview-page\+membership-card\+title"[^>]*>\s*([^<]{2,60})/);
    if (planUia) plan = nfClean(planUia[1]);
    if (!plan) plan = nfExtractPlan(html);

    // ── BILLING DATE — data-uia attribute ──────────────────────────────────────
    let billingText = null;
    const billUia = html.match(/data-uia="account-overview-page\+membership-card\+description"[^>]*>\s*([^<]{4,120})/);
    if (billUia) billingText = nfClean(billUia[1]);
    if (!billingText) billingText = nfExtractBilling(html);

    // ── EMAIL ──────────────────────────────────────────────────────────────────
    const emailFromHtml = nfExtractEmail(html) || nfExtractEmailFallback(html);

    // ── PROFILES ──────────────────────────────────────────────────────────────
    const profiles = [];
    // Method 1: JSON "profileName" key
    for (const m of html.matchAll(/"profileName"\s*:\s*"([^"]{1,50})"/g)) {
      const name = m[1].trim();
      // Exclude pure numbers (those are indices, not names), exclude empty, dedupe
      if (name && !/^\d+$/.test(name) && !profiles.includes(name)) profiles.push(name);
    }
    // Method 2: profiles array in JSON
    if (!profiles.length) {
      const raw = html.match(/"profiles"\s*:\s*(\[[\s\S]{1,8000}?\])/)?.[1];
      if (raw) {
        try {
          for (const p of JSON.parse(raw)) {
            const name = (p?.summary?.profileName || p?.profileName || p?.name || '').trim();
            if (name && !/^\d+$/.test(name) && !profiles.includes(name)) profiles.push(name);
          }
        } catch {}
      }
    }
    // Method 3: data-uia SSR
    if (!profiles.length) {
      for (const m of html.matchAll(/data-uia="profile-name"[^>]*>\s*([^<]+)/g)) {
        const name = m[1].trim();
        if (name && !/^\d+$/.test(name)) profiles.push(name);
      }
    }
    // Method 4: "displayName" in profile objects
    if (!profiles.length) {
      for (const m of html.matchAll(/"displayName"\s*:\s*"([^"]{1,50})"/g)) {
        const name = m[1].trim();
        if (name && !/^\d+$/.test(name) && !profiles.includes(name)) profiles.push(name);
      }
    }

    // ── PAYMENT ERROR ──────────────────────────────────────────────────────────
    const htmlLow    = html.toLowerCase();
    const paymentError = NF_PAYERR_KW.some(kw => htmlLow.includes(kw.toLowerCase()))
      || /"(?:paymentIssue|paymentError|paymentFailed|billingIssue)"\s*:\s*(?:true|1|"true")/i.test(html);

    return {
      reachable:    true,
      alive:        isLive,        // ← based on payment element presence
      cancelled:    !isLive,
      plan,
      billingText,
      profiles,
      paymentError,
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
    const email      = data?.email || null;
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

// ─── Subdomain root routing ────────────────────────────────────────────────────
// me.domain/      → getcode.html
// seller.domain/  → seller.html
// admin.domain/   → admin.html
// (domain trần)/  → landing (xử lý ở route '/' bên dưới)
function serveSubdomainRoot(req, res, next) {
  if (req.path !== '/') return next();
  switch (req.subdomain) {
    case 'me':     return res.sendFile(path.join(__dirname, 'public', 'getcode.html'));
    case 'seller': return res.sendFile(path.join(__dirname, 'public', 'seller.html'));
    case 'admin':  return res.sendFile(path.join(__dirname, 'public', 'admin.html'));
    default:       return next();
  }
}
app.use(serveSubdomainRoot);

// index: false so that GET / goes through our route handler (which sets cookies)
// instead of express.static serving public/index.html directly
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// ─── Cookie Generation – matching real Netflix formats ─────────────────────────

// nfvdid: base64url-encoded 72 random bytes
// Real example: BQFmAAEBEOwULkv5c1bP...TbRy311Jd
function generateNfvdid() {
  return crypto.randomBytes(72).toString('base64url');
}

// tmx_guid: base64url-encoded 64 random bytes (ThreatMetrix device fingerprint)
// Real example: AAwtTZZR2H2Pk8D-dPXx...7g7Q
function generateTmxGuid() {
  return crypto.randomBytes(64).toString('base64url');
}

// thx_guid: 32 hex chars without dashes (UUID without dashes)
// Real example: 9b166c806f66e0e1d2a76cb7a6f0ed47
function generateThxGuid() {
  return crypto.randomBytes(16).toString('hex');
}

// Base32 (uppercase A-Z2-7) for the `pg` field in NetflixId
function toBase32(buf) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, val = 0, out = '';
  for (const byte of buf) {
    val = (val << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(val >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += alphabet[(val << (5 - bits)) & 31];
  return out;
}

// NetflixId: v=3&ct=<long-base64url>&pg=<BASE32-26chars>&ch=<base64url>.
// ct embeds sessionId bytes in a protobuf-like binary frame + random padding
// Real example ct is ~200 base64url chars; pg is 26-char uppercase base32
function generateNetflixId(sessionId) {
  const sidHex = sessionId.replace(/-/g, '');
  const sidBuf = Buffer.from(sidHex, 'hex'); // 16 bytes

  // Protobuf-like framing: field 1 varint=1, field 2 len-delim=16 bytes, random tail
  const preamble = Buffer.from([0x08, 0x01, 0x12, 0x10]);
  const tail     = crypto.randomBytes(128);
  const ct = Buffer.concat([preamble, sidBuf, tail]).toString('base64url');

  const pg = toBase32(crypto.randomBytes(16)).substring(0, 26);

  // ch: HMAC-SHA256 of sessionId, base64url-encoded, trailing dot (real Netflix style)
  const hmac = crypto.createHmac('sha256', 'nflx_ch_key_v3');
  hmac.update(sessionId);
  const ch = hmac.digest().toString('base64url') + '.';

  return `v=3&ct=${ct}&pg=${pg}&ch=${ch}`;
}

// SecureNetflixId: v=3&mac=<base64url-hmac>.&dt=<timestamp>
// Real example: v%3D3%26mac%3DAQEAEQABABT_IgWs...%26dt%3D1780112376148
function generateSecureNetflixId(userId, sessionId) {
  const hmac = crypto.createHmac('sha256', 'nflx_mac_secret_v3');
  hmac.update(`${userId}:${sessionId}`);
  // Real Netflix mac has extra preamble bytes (AQEAEQABABT...) – we prepend similar bytes
  const preamble = Buffer.from([0x01, 0x01, 0x11, 0x01, 0x01, 0x04]);
  const mac = Buffer.concat([preamble, hmac.digest()]).toString('base64url') + '.';
  return `v=3&mac=${mac}&dt=${Date.now()}`;
}

// Extract sessionId from NetflixId ct field, then look up userId in sessions map
function decodeNetflixId(netflixId) {
  try {
    const decoded = decodeURIComponent(netflixId);
    const params  = new URLSearchParams(decoded);
    const ct      = params.get('ct');
    if (!ct) return null;
    const raw = Buffer.from(ct, 'base64url');
    // Skip 4-byte preamble, read 16-byte session ID
    if (raw.length < 20) return null;
    const sidBytes = raw.slice(4, 20);
    const sessionId = [
      sidBytes.slice(0,4).toString('hex'),
      sidBytes.slice(4,6).toString('hex'),
      sidBytes.slice(6,8).toString('hex'),
      sidBytes.slice(8,10).toString('hex'),
      sidBytes.slice(10,16).toString('hex'),
    ].join('-');
    const row = getSession(sessionId);
    return row ? { userId: row.user_id, sessionId } : null;
  } catch {
    return null;
  }
}

// OptanonConsent – matches real Netflix format (OneTrust v202604)
function generateOptanonConsent() {
  const consentId = uuidv4();
  const ts        = Date.now();
  const datestamp = encodeURIComponent(new Date().toUTCString());
  return (
    `isGpcEnabled=0` +
    `&datestamp=${datestamp}` +
    `&version=202604.2.0` +
    `&browserGpcFlag=0` +
    `&isDntEnabled=0` +
    `&isIABGlobal=false` +
    `&hosts=` +
    `&consentId=${consentId}` +
    `&interactionCount=1` +
    `&isAnonUser=1` +
    `&prevHadToken=0` +
    `&landingPath=NotLandingPage` +
    `&groups=C0001%3A1%2CC0002%3A1%2CC0003%3A1%2CC0004%3A1` +
    `&crTime=${ts}` +
    `&AwaitingReconsent=false`
  );
}

// ─── Cookie Setters ────────────────────────────────────────────────────────────

function setAnonymousCookies(req, res) {
  // nfvdid – virtual device ID (1 year, survives logout)
  if (!req.cookies.nfvdid) {
    res.cookie('nfvdid', generateNfvdid(), {
      maxAge: 365 * 24 * 60 * 60 * 1000,
      httpOnly: false,
      sameSite: 'lax',
      path: '/',
    });
  }

  // OptanonConsent – GDPR/CCPA (1 year)
  if (!req.cookies.OptanonConsent) {
    res.cookie('OptanonConsent', generateOptanonConsent(), {
      maxAge: 365 * 24 * 60 * 60 * 1000,
      httpOnly: false,
      sameSite: 'lax',
      path: '/',
    });
  }

  // tmx_guid – ThreatMetrix device fingerprint (30 days)
  if (!req.cookies.tmx_guid) {
    res.cookie('tmx_guid', generateTmxGuid(), {
      maxAge: 30 * 24 * 60 * 60 * 1000,
      httpOnly: false,
      sameSite: 'lax',
      path: '/',
    });
  }

  // thx_guid – analytics GUID, 32 hex chars (30 days)
  if (!req.cookies.thx_guid) {
    res.cookie('thx_guid', generateThxGuid(), {
      maxAge: 30 * 24 * 60 * 60 * 1000,
      httpOnly: false,
      sameSite: 'lax',
      path: '/',
    });
  }
}

function setSessionCookies(res, userId, sessionId) {
  createSession(sessionId, userId);

  const netflixId       = generateNetflixId(sessionId);
  const secureNetflixId = generateSecureNetflixId(userId, sessionId);
  const flwssn          = uuidv4();          // UUID (same as real Netflix)
  const gsid            = uuidv4();          // UUID (real Netflix uses plain UUID, not gs_ prefix)
  const otSession       = uuidv4();          // UUID (real Netflix uses plain UUID)

  // NetflixId – user identity token (30 days)
  res.cookie('NetflixId', netflixId, {
    maxAge: 30 * 24 * 60 * 60 * 1000,
    httpOnly: false,
    sameSite: 'lax',
    path: '/',
  });

  // SecureNetflixId – HMAC-signed with mac+dt format, HttpOnly (30 days)
  res.cookie('SecureNetflixId', secureNetflixId, {
    maxAge: 30 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
  });

  // flwssn – Flow session UUID (session-scoped, no maxAge)
  res.cookie('flwssn', flwssn, {
    httpOnly: false,
    sameSite: 'lax',
    path: '/',
  });

  // gsid – Global session UUID (30 days)
  res.cookie('gsid', gsid, {
    maxAge: 30 * 24 * 60 * 60 * 1000,
    httpOnly: false,
    sameSite: 'lax',
    path: '/',
  });

  // OTSessionTracking – OneTrust session UUID (session-scoped)
  res.cookie('OTSessionTracking', otSession, {
    httpOnly: false,
    sameSite: 'lax',
    path: '/',
  });

  return { netflixId, secureNetflixId, flwssn, gsid, otSession };
}

function clearSessionCookies(res, sessionId) {
  if (sessionId) deleteSession(sessionId);
  const opts = { expires: new Date(0), path: '/' };
  res.clearCookie('NetflixId',          opts);
  res.clearCookie('SecureNetflixId',    opts);
  res.clearCookie('flwssn',             opts);
  res.clearCookie('gsid',               opts);
  res.clearCookie('OTSessionTracking',  opts);
  res.clearCookie('profilesNewSession', opts);
}

// ─── Middleware ────────────────────────────────────────────────────────────────

// API path → 401 JSON; page path → redirect tới trang đăng nhập
function authFail(req, res) {
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ success: false, error: 'Chưa đăng nhập' });
  }
  return res.redirect('/login');
}

function requireAuth(req, res, next) {
  const nfid = req.cookies.NetflixId;
  if (!nfid) return authFail(req, res);
  const decoded = decodeNetflixId(nfid);
  if (!decoded) { clearSessionCookies(res, null); return authFail(req, res); }
  const user = getUserById(decoded.userId);
  if (!user) { clearSessionCookies(res, decoded.sessionId); return authFail(req, res); }
  req.user      = user;
  req.sessionId = decoded.sessionId;
  next();
}

function requireProfile(req, res, next) {
  if (req.cookies.profilesNewSession !== '0') {
    if (req.path.startsWith('/api/')) {
      return res.status(403).json({ success: false, error: 'Chưa chọn hồ sơ' });
    }
    return res.redirect('/profiles');
  }
  next();
}

// ─── Page Routes ───────────────────────────────────────────────────────────────

app.get('/', (req, res) => {
  setAnonymousCookies(req, res);
  if (req.cookies.NetflixId && decodeNetflixId(req.cookies.NetflixId)) return res.redirect('/browse');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/login', (req, res) => {
  setAnonymousCookies(req, res);
  if (req.cookies.NetflixId && decodeNetflixId(req.cookies.NetflixId)) return res.redirect('/browse');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/profiles', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'profiles.html'));
});

app.get('/checker', (req, res) => {
  setAnonymousCookies(req, res);
  res.sendFile(path.join(__dirname, 'public', 'checker.html'));
});

app.get('/browse', requireAuth, requireProfile, (req, res) => {
  // netflix-sans-normal-3-loaded: set when user reaches browse (font loading marker)
  if (!req.cookies['netflix-sans-normal-3-loaded']) {
    res.cookie('netflix-sans-normal-3-loaded', 'true', {
      httpOnly: false,
      sameSite: 'lax',
      path: '/',
    });
  }
  res.sendFile(path.join(__dirname, 'public', 'browse.html'));
});

// ─── API Routes ────────────────────────────────────────────────────────────────

app.post('/api/auth/login', (req, res) => {
  setAnonymousCookies(req, res);
  const { email, password } = req.body;
  const user = getUserByEmail(email);
  if (!user || !verifyPassword(user.password, password)) {
    return res.status(401).json({ success: false, message: 'Email hoặc mật khẩu không đúng.' });
  }
  const sessionId      = uuidv4();
  const sessionCookies = setSessionCookies(res, user.id, sessionId);
  return res.json({
    success: true,
    user: { id: user.id, name: user.name, plan: user.plan },
    sessionCookies,
    redirect: '/profiles',
  });
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  clearSessionCookies(res, req.sessionId);
  return res.json({ success: true, redirect: '/' });
});

app.get('/api/profiles', requireAuth, (req, res) => {
  const profiles = getProfilesByUserId(req.user.id);
  return res.json({ success: true, profiles, user: { name: req.user.name, plan: req.user.plan } });
});

app.post('/api/profiles/select', requireAuth, (req, res) => {
  const { profileId } = req.body;
  const profile = getProfileByIdAndUserId(profileId, req.user.id);
  if (!profile) return res.status(404).json({ success: false, message: 'Profile không tồn tại.' });

  // New flow session after profile selection (same real Netflix behavior)
  res.cookie('flwssn', uuidv4(), { httpOnly: false, sameSite: 'lax', path: '/' });
  res.cookie('profilesNewSession', '0', { httpOnly: false, sameSite: 'lax', path: '/' });

  return res.json({ success: true, profile, redirect: '/browse' });
});

app.get('/api/content', requireAuth, requireProfile, (req, res) => {
  return res.json({ success: true, content: getAllContent() });
});

// ─── nftoken.site — tùy chọn, mặc định TẮT (chỉ check trực tiếp netflix.com) ───
// NFTOKEN_MODE=off       → chỉ direct (mặc định)
// NFTOKEN_MODE=parallel  → song song nftoken + direct (hành vi cũ)
// NFTOKEN_MODE=fallback  → direct trước, gọi nftoken nếu unreachable hoặc thiếu plan/email
// USE_NFTOKEN=1|true|on  → alias của parallel
function getNftokenMode() {
  const raw = String(process.env.NFTOKEN_MODE || process.env.USE_NFTOKEN || 'off').toLowerCase().trim();
  if (raw === '1' || raw === 'true' || raw === 'on' || raw === 'parallel') return 'parallel';
  if (raw === 'fallback') return 'fallback';
  return 'off';
}

const NFT_SKIPPED = { alive: false, hasPremium: false, plan: null, email: null, screens: null, paymentError: false, raw: null, skipped: true };

function mergeCheckResults(nf, nft) {
  const plan = nf.plan || nft.plan || null;
  const alive = !!(nf.alive || nft.alive);

  let source = 'none';
  if (nft.skipped) {
    source = nf.reachable ? 'direct' : 'none';
  } else if (nf.alive && nft.alive) {
    source = 'direct+nftoken';
  } else if (nft.alive) {
    source = 'nftoken';
  } else if (nf.reachable || nf.alive) {
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
    paymentError: !!(nft.paymentError || nf.paymentError),
    profiles:     nf.profiles      || [],
    billingText:  nf.billingText   || null,
    cancelled:    !alive && !!(nf.reachable || nf.cancelled),
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
  if (nf.alive && !nf.plan && !nf.emailFromHtml) return true;
  return false;
}

// ─── Full check — direct netflix.com (+ nftoken tùy NFTOKEN_MODE) ─────────────
async function fullCheck(cookieStr) {
  try {
    const mode = getNftokenMode();
    const nf = await fetchNetflixAccountInfo(cookieStr).catch(e => ({
      reachable: false, alive: false, error: e.message, profiles: [],
    }));

    let nft = NFT_SKIPPED;

    if (mode === 'parallel') {
      nft = await runNftokenCheck(cookieStr);
    } else if (mode === 'fallback' && shouldFallbackNftoken(nf)) {
      nft = await runNftokenCheck(cookieStr);
    }

    return mergeCheckResults(nf, nft);
  } catch (e) {
    return { alive: false, error: e.message, profiles: [], plan: null, billingText: null, nftokenMode: getNftokenMode() };
  }
}

// ─── Live check – single cookie set ──────────────────────────────────────────
app.post('/api/checker/live-check', async (req, res) => {
  try {
    const { cookie } = req.body;
    if (!cookie || typeof cookie !== 'string') {
      return res.status(400).json({ error: 'Thiếu cookie' });
    }
    const result = await fullCheck(cookie);
    return res.json(result);
  } catch (e) {
    console.error('[live-check] ERROR:', e.message);
    return res.status(500).json({ alive: false, error: e.message, profiles: [] });
  }
});

// ─── Batch live check – multiple sets ────────────────────────────────────────
app.post('/api/checker/batch', async (req, res) => {
  try {
    const { cookies } = req.body;
    if (!Array.isArray(cookies) || !cookies.length) {
      return res.status(400).json({ error: 'Thiếu cookies array' });
    }
    // CONCURRENCY=1: check tuần tự từ cùng 1 IP → tránh burst song song dễ bị Netflix flag.
    // Mỗi fullCheck đã có randDelay nội bộ; thêm khoảng nghỉ giữa các cookie cho tự nhiên.
    const CONCURRENCY = 1;
    const results = new Array(cookies.length).fill(null);
    for (let i = 0; i < cookies.length; i += CONCURRENCY) {
      const slice   = cookies.slice(i, i + CONCURRENCY);
      const checked = await Promise.all(slice.map(c => fullCheck(c).catch(e => ({ alive: false, error: e.message, profiles: [] }))));
      checked.forEach((r, j) => { results[i + j] = r; });
      if (i + CONCURRENCY < cookies.length) await randDelay(1500, 4000);
    }
    return res.json({ results });
  } catch (e) {
    console.error('[batch] ERROR:', e.message);
    return res.status(500).json({ error: e.message });
  }
});

// Cookie inspector endpoint
app.get('/api/session/info', (req, res) => {
  const c = req.cookies;
  let user = null, sessionId = null;
  if (c.NetflixId) {
    const d = decodeNetflixId(c.NetflixId);
    if (d) {
      user      = getUserById(d.userId) || null;
      sessionId = d.sessionId;
    }
  }

  const phase = !c.NetflixId
    ? 'anonymous'
    : c.profilesNewSession === '0'
      ? 'profile_selected'
      : 'authenticated';

  // Show realistic truncated values just like the real browser would see
  const truncate = (val, n = 55) => val ? (val.length > n ? val.substring(0, n) + '…' : val) : null;

  return res.json({
    phase,
    authenticated: !!user,
    user: user ? { id: user.id, name: user.name, plan: user.plan } : null,
    cookies: {
      nfvdid:              truncate(c.nfvdid, 60),
      OptanonConsent:      c.OptanonConsent ? '[set – ' + c.OptanonConsent.length + ' chars]' : null,
      tmx_guid:            truncate(c.tmx_guid, 60),
      thx_guid:            c.thx_guid || null,
      NetflixId:           c.NetflixId ? truncate(decodeURIComponent(c.NetflixId), 70) : null,
      SecureNetflixId:     c.SecureNetflixId ? '[HttpOnly – không đọc được bằng JS]' : null,
      flwssn:              c.flwssn || null,
      gsid:                c.gsid || null,
      OTSessionTracking:   c.OTSessionTracking || null,
      profilesNewSession:  c.profilesNewSession || null,
      'netflix-sans-normal-3-loaded': c['netflix-sans-normal-3-loaded'] || null,
    },
  });
});

// ─── Cloudflare Turnstile ─────────────────────────────────────────────────────
// Test keys (luôn pass): site=1x00000000000000000000AA secret=1x0000000000000000000000000000000AA
// Production: set TURNSTILE_SITE_KEY + TURNSTILE_SECRET_KEY trong env
const TURNSTILE_SITE_KEY   = process.env.TURNSTILE_SITE_KEY   || '1x00000000000000000000AA';
const TURNSTILE_SECRET_KEY = process.env.TURNSTILE_SECRET_KEY || '1x0000000000000000000000000000000AA';
const TURNSTILE_ENABLED    = process.env.TURNSTILE_DISABLED !== '1';

async function verifyTurnstile(token, remoteip) {
  if (!TURNSTILE_ENABLED) return { success: true, skipped: true };
  if (!token) return { success: false, error: 'Thiếu captcha' };

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

async function fetchInboxForEmail(email) {
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
  const emails = raw.map(parseNetflixEmail).sort((a, b) => (b.priority || 0) - (a.priority || 0));
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
      return res.status(400).json({ success: false, error: 'Email không hợp lệ' });

    const result = await fetchInboxForEmail(email);
    return res.json(result);
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/inbox', async (req, res) => {
  try {
    const email = (req.body.email || '').trim().toLowerCase();
    const turnstileToken = req.body.turnstileToken || req.body.token || '';

    if (!email || !email.includes('@'))
      return res.status(400).json({ success: false, error: 'Email không hợp lệ' });

    const captcha = await verifyTurnstile(turnstileToken, getClientIp(req));
    if (!captcha.success) {
      return res.status(403).json({ success: false, error: captcha.error || 'Captcha không hợp lệ' });
    }

    const result = await fetchInboxForEmail(email);
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
  if (!acc || acc.role !== 'seller') return res.status(401).json({ success: false, error: 'Chưa đăng nhập seller' });
  if (acc.status !== 'active') return res.status(403).json({ success: false, error: 'Tài khoản chưa được duyệt' });
  req.account = acc;
  next();
}

// Đăng nhập panel (admin hoặc seller)
app.post('/api/panel/login', (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ success: false, error: 'Thiếu tài khoản hoặc mật khẩu' });
    const acc = getAccountByUsername(String(username).trim());
    if (!acc || !verifyPassword(acc.password, password)) {
      return res.status(401).json({ success: false, error: 'Sai tài khoản hoặc mật khẩu' });
    }
    if (acc.role === 'seller') {
      if (!acc.emailVerified) return res.status(403).json({ success: false, error: 'Chưa xác minh email', needVerify: true, accountId: acc.id });
      if (acc.status === 'pending')  return res.status(403).json({ success: false, error: 'Tài khoản đang chờ admin duyệt' });
      if (acc.status === 'rejected') return res.status(403).json({ success: false, error: 'Tài khoản đã bị từ chối' });
    }
    if (acc.status !== 'active') return res.status(403).json({ success: false, error: 'Tài khoản không hoạt động' });

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
  if (!acc) return res.status(401).json({ success: false, error: 'Chưa đăng nhập' });
  return res.json({ success: true, account: { username: acc.username, email: acc.email, role: acc.role, status: acc.status } });
});

// Seller tự đăng ký → tạo account pending + gửi mã xác minh email
app.post('/api/seller/register', async (req, res) => {
  try {
    const username = String(req.body.username || '').trim();
    const email    = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (username.length < 3)   return res.status(400).json({ success: false, error: 'Username tối thiểu 3 ký tự' });
    if (!email.includes('@'))  return res.status(400).json({ success: false, error: 'Email không hợp lệ' });
    if (password.length < 6)   return res.status(400).json({ success: false, error: 'Mật khẩu tối thiểu 6 ký tự' });
    if (getAccountByUsername(username)) return res.status(409).json({ success: false, error: 'Username đã tồn tại' });
    if (getAccountByEmail(email))       return res.status(409).json({ success: false, error: 'Email đã được dùng' });

    const code    = String(Math.floor(100000 + Math.random() * 900000)); // mã 6 số
    const expires = Math.floor(Date.now() / 1000) + 15 * 60;             // hết hạn 15 phút
    const id      = 'sel_' + crypto.randomBytes(6).toString('hex');
    createAccount({ id, username, email, password: hashPassword(password), role: 'seller', verifyCode: code, verifyExpires: expires });

    const mail = await sendVerificationEmail(email, code).catch(() => ({ sent: false }));
    return res.json({ success: true, accountId: id, emailSent: mail.sent, message: 'Đã tạo tài khoản. Nhập mã xác minh gửi tới email.' });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// Xác minh email bằng mã 6 số
app.post('/api/seller/verify-email', (req, res) => {
  try {
    const acc = getAccountById(String(req.body.accountId || ''));
    if (!acc || acc.role !== 'seller') return res.status(404).json({ success: false, error: 'Tài khoản không tồn tại' });
    if (acc.emailVerified) return res.json({ success: true, alreadyVerified: true });
    if (!acc.verifyCode || acc.verifyCode !== String(req.body.code || '').trim()) {
      return res.status(400).json({ success: false, error: 'Mã không đúng' });
    }
    if (acc.verifyExpires && Math.floor(Date.now() / 1000) > acc.verifyExpires) {
      return res.status(400).json({ success: false, error: 'Mã đã hết hạn, hãy gửi lại' });
    }
    markEmailVerified(acc.id);
    return res.json({ success: true, message: 'Xác minh thành công. Chờ admin duyệt tài khoản.' });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// Gửi lại mã xác minh
app.post('/api/seller/resend-code', async (req, res) => {
  try {
    const acc = getAccountById(String(req.body.accountId || ''));
    if (!acc || acc.role !== 'seller') return res.status(404).json({ success: false, error: 'Tài khoản không tồn tại' });
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

// Danh sách key của seller + tổng quan
app.get('/api/seller/keys', requireSeller, (req, res) => {
  const keys = getKeysBySeller(req.account.id);
  const used = keys.filter(k => k.usedCount > 0).length;
  return res.json({ success: true, keys, summary: { total: keys.length, used, unused: keys.length - used } });
});

// Tạo key — yêu cầu seller đăng nhập, gắn seller_id
app.post('/api/key/register', requireSeller, (req, res) => {
  try {
    const { email, note } = req.body;
    if (!email?.includes('@')) return res.status(400).json({ success: false, error: 'Email không hợp lệ' });
    const key = 'SK-' + [1, 2, 3].map(() => crypto.randomBytes(4).toString('hex').toUpperCase()).join('-');
    createKey(key, email.trim().toLowerCase(), (note || '').trim() || null, req.account.id);
    return res.json({ success: true, key, email });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/key/resolve', (req, res) => {
  const email = resolveKeyEmail((req.query.key || '').trim());
  if (!email) return res.status(404).json({ success: false, error: 'Key không tồn tại' });
  return res.json({ success: true, email });
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
  return res.json({ success: setAccountStatus(req.params.id, 'active') });
});

app.post('/api/admin/sellers/:id/reject', requireAdmin, (req, res) => {
  return res.json({ success: setAccountStatus(req.params.id, 'rejected') });
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
  res.json({ ok: true, ts: Date.now(), version: 'v4', nftokenMode: getNftokenMode() });
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
  console.log(`\n  Đang chạy tại: \x1b[36mhttp://localhost:${PORT}\x1b[0m\n`);
  console.log('  Tài khoản demo:');
  console.log('  \x1b[33m●\x1b[0m demo@netflix.com  /  demo123');
  console.log('  \x1b[33m●\x1b[0m user@netflix.com  /  user123\n');
  if (ADMIN_TOKEN_GENERATED) {
    console.log(`  \x1b[35m●\x1b[0m ADMIN_TOKEN (random): \x1b[36m${ADMIN_TOKEN}\x1b[0m`);
    console.log('    (set env ADMIN_TOKEN để cố định)\n');
  }
});
