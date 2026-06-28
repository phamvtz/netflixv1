'use strict';

// Module nhỏ để test + dùng chung logic trích email (server import)
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

function nfIsValidEmail(candidate) {
  const e = nfClean(candidate);
  if (!e || !e.includes('@')) return false;
  if (!/^[^\s@]{1,80}@[^\s@]{2,80}$/.test(e)) return false;
  const domain = (e.split('@')[1] || '').toLowerCase();
  if (!domain || domain.includes('netflix.com') || domain.startsWith('example.')) return false;
  if (/noreply|no-reply|support@|mailer-daemon/i.test(e)) return false;
  return true;
}

function nfExtractEmailFromHtml(html) {
  if (!html) return null;

  const emailKeys = [
    'memberLoginId', 'userLogin', 'loginEmail', 'loginName', 'memberEmail',
    'email', 'primaryEmail', 'accountEmail', 'membershipEmail', 'contactEmail',
    'userEmail', 'currentEmail', 'signInEmail', 'accountOwnerEmail',
  ];
  for (const v of nfJsonValues(html, emailKeys)) {
    if (nfIsValidEmail(v)) return v;
  }

  const emailPats = [
    /"userLogin"\s*:\s*"((?:\\.|[^"\\]){2,80})"/,
    /"memberLoginId"\s*:\s*"((?:\\.|[^"\\]){2,80})"/,
    /"email"\s*:\s*"((?:\\.|[^"\\]){2,80})"/,
    /"memberEmail"\s*:\s*"((?:\\.|[^"\\]){2,80})"/,
    /"loginName"\s*:\s*"((?:\\.|[^"\\]){2,80})"/,
    /"primaryEmail"\s*:\s*"((?:\\.|[^"\\]){2,80})"/,
    /"accountEmail"\s*:\s*"((?:\\.|[^"\\]){2,80})"/,
    /data-uia="[^"]*email[^"]*"[^>]*>\s*([^<]{2,80}@[^<]{2,80})/i,
    /data-uia="account-overview-page\+email"[^>]*>\s*([^<]{2,80})/i,
  ];
  for (const pat of emailPats) {
    const m = html.match(pat);
    if (m && nfIsValidEmail(m[1])) return nfClean(m[1]);
  }

  const ctxPats = [
    /netflix\.reactContext\s*=\s*(\{[\s\S]{200,}?\})\s*;?\s*<\/script>/,
    /"memberLoginId"\s*:\s*"((?:\\.|[^"\\]){1,80})"/,
    /"membershipEmail"\s*:\s*"((?:\\.|[^"\\]){1,80})"/,
    /"userEmail"\s*:\s*"((?:\\.|[^"\\]){1,80})"/,
    /"[a-zA-Z]{0,24}[Ee]mail[a-zA-Z]{0,24}"\s*:\s*"((?:\\.|[^"\\]){2,80})"/,
    /"[a-zA-Z]{0,24}[Ll]ogin[a-zA-Z]{0,24}"\s*:\s*"((?:\\.|[^"\\]){2,80})"/,
  ];
  for (const pat of ctxPats) {
    const m = html.match(pat);
    if (!m) continue;
    let candidate = nfClean(m[1]);
    if (candidate.startsWith('{')) {
      const inner = candidate.match(/"(?:memberLoginId|userLogin|email|memberEmail|loginEmail)"\s*:\s*"((?:\\.|[^"\\]){2,80})"/);
      if (inner) candidate = nfClean(inner[1]);
    }
    if (nfIsValidEmail(candidate)) return candidate;
  }

  for (const line of nfVisibleLines(html)) {
    const m = line.match(/[\w.+\-*]{1,50}@[\w.-]{2,50}/);
    if (m && nfIsValidEmail(m[0])) return m[0];
  }
  return null;
}

// Gói còn hiển thị trên /account nhưng không xem được (lỗi TT, popup browse).
const NF_PAY_HOLD_PHRASES = [
  'update your payment information to continue',
  'unable to process your last payment',
  "couldn't process your last payment",
  "couldn't process your payment",
  'could not process your last payment',
  'could not process your payment',
  'retry your payment',
  'we were unable to process your payment',
  "we can't process your payment",
  'we cannot process your payment',
  'unable to process your payment',
  'payment method to continue',
  'account is on hold',
  'your account is on hold',
  'cập nhật thông tin thanh toán để tiếp tục',
  'cập nhật thông tin thanh toán của bạn',
  'không thể xử lý khoản thanh toán',
  'không thể xử lý thanh toán của bạn',
  // TH
  'อัปเดตข้อมูลการชำระเงินเพื่อดำเนินการต่อ',
  'ไม่สามารถดำเนินการชำระเงินครั้งล่าสุด',
  'บัญชีของคุณถูกระงับ',
  // ID
  'perbarui informasi pembayaran anda untuk melanjutkan',
  'kami tidak dapat memproses pembayaran',
  'akun anda ditangguhkan',
  // JA
  'お支払い情報を更新してください',
  'お支払いを処理できませんでした',
  'アカウントは保留中です',
  // KO
  '계속하려면 결제 정보를 업데이트',
  '결제를 처리할 수 없습니다',
  '계정이 보류 중입니다',
  // DE
  'zahlungsinformationen aktualisieren',
  'wir konnten ihre zahlung nicht verarbeiten',
  'ihr konto ist gesperrt',
  // ES
  'actualiza tu información de pago para continuar',
  'no pudimos procesar tu pago',
  'tu cuenta está suspendida',
  // FR
  'mettez à jour vos informations de paiement',
  "nous n'avons pas pu traiter votre paiement",
  'votre compte est suspendu',
];

/** Strict hold for /account HTML — phrases + JSON flags only (no browse-style fuzzy). */
function nfAccountPagePaymentHold(html) {
  if (!html) return false;
  const raw = String(html);
  const low = raw.toLowerCase();
  if (NF_PAY_HOLD_PHRASES.some((p) => low.includes(p))) return true;
  if (/"(?:isOnHold|onHold|paymentPastDue|hasPaymentIssue|paymentIssue|paymentFailed|billingIssue|requiresPaymentUpdate|showPaymentUpdate|isPastDue)"\s*:\s*(?:true|1|"true")/i.test(raw)) {
    return true;
  }
  const ms = raw.match(/"membershipStatus"\s*:\s*"([^"]+)"/i);
  if (ms && /hold|past.?due|grace|suspended|retry|payment[_-]?failed|pastdue/i.test(ms[1])) return true;
  return false;
}

function nfDetectPaymentHold(html) {
  if (!html) return false;
  if (nfAccountPagePaymentHold(html)) return true;
  const raw = String(html);
  const low = raw.toLowerCase();
  const compact = low.replace(/\s+/g, ' ');

  if (NF_PAY_HOLD_PHRASES.some((p) => low.includes(p))) return true;

  // Netflix hay nhúng câu rải rác trong JSON/SSR — match fuzzy trên cả trang
  if (/update[\s\S]{0,80}payment[\s\S]{0,80}continue/i.test(low)) return true;
  if (/unable[\s\S]{0,50}process[\s\S]{0,50}(?:your\s+)?last\s+payment/i.test(low)) return true;
  if (/we\s+(?:were\s+)?unable[\s\S]{0,40}process[\s\S]{0,40}payment/i.test(low)) return true;
  if (/can(?:no)?t\s+process[\s\S]{0,40}payment/i.test(low)) return true;
  if (/could\s*n[o']?t\s+process[\s\S]{0,40}payment/i.test(low)) return true;
  if (/retry\s+your\s+payment/i.test(low)) return true;
  // Do not match JSON keys like "hasPaymentIssue":false (payment…issue within 40 chars)
  if (/payment[\s\S]{0,30}(?:failed|unsuccessful|declined)\b/i.test(low)) return true;
  if (/payment[\s\S]{0,20}(?:issue|problem)\b\s*[:=]\s*(?:true|1|"true")/i.test(low)) return true;
  if (/billing[\s\S]{0,20}(?:issue|problem)\b\s*[:=]\s*(?:true|1|"true")/i.test(low)) return true;

  if (/data-uia="[^"]*(?:payment|billing)[^"]*(?:error|issue|hold|pastdue|failed|alert|banner)[^"]*"/i.test(raw)) {
    return true;
  }
  if (/account-overview-page\+[^"]*(?:notification|alert|banner|message)/i.test(raw) &&
      NF_PAY_HOLD_PHRASES.some((p) => compact.includes(p))) {
    return true;
  }
  if (/"(?:isOnHold|onHold|paymentPastDue|hasPaymentIssue|paymentIssue|paymentFailed|billingIssue|requiresPaymentUpdate|showPaymentUpdate|isPastDue)"\s*:\s*(?:true|1|"true")/i.test(raw)) {
    return true;
  }
  const ms = raw.match(/"membershipStatus"\s*:\s*"([^"]+)"/i);
  if (ms && /hold|past.?due|grace|suspended|retry|payment[_-]?failed|pastdue/i.test(ms[1])) return true;

  for (const line of nfVisibleLines(html)) {
    const ln = line.toLowerCase();
    if ((ln.includes('update') || ln.includes('unable') || ln.includes("can't") || ln.includes('cannot')) &&
        ln.includes('payment') &&
        (ln.includes('continue') || ln.includes('method') || ln.includes('information') || ln.includes('process'))) {
      return true;
    }
  }
  return false;
}

// ─── Netflix message parsing (login code / household code / reset link) ───────
// `raw` is a provider-shaped message object; field names vary across providers,
// so we read from a set of common aliases. Returns a normalized shape with a
// `priority` used to sort the most useful result first.
function nfParseEmail(raw) {
  raw = raw || {};
  const subject = String(raw.subject || raw.title || '');
  const body    = String(raw.body || raw.text_body || raw.text || raw.content || '');
  const html    = String(raw.html_body || raw.html || raw.body_html || '');
  const from    = String(raw.from || raw.sender || raw.from_email || raw.from_address || '');
  const id      = raw.id || raw._id || raw.message_id || raw.mail_id || '';
  const time    = raw.created_at || raw.date || raw.received_at || raw.time || '';

  // `full`: tags stripped (for codes shown as text). `decoded`: tags kept but
  // entities/escapes decoded (for links that only live in href="…" attributes).
  const full = nfClean((subject + ' ' + body + ' ' + html).replace(/<[^>]+>/g, ' '));
  const decoded = nfClean(subject + ' ' + body + ' ' + html);

  let code = null, reset_link = null, family_code = null;

  // Login OTP (EN + VI): a 4-8 digit number that sits close after a code keyword,
  // so order numbers / years / IDs are not mistaken for a sign-in code.
  let otp = full.match(/(?:mã đăng nhập|mã xác minh|mã xác nhận|mã|verification code|sign[- ]?in code|login code|one[- ]?time code|passcode|code)[^\d]{0,24}(\d{4,8})\b/i);
  // Fallback: a lone number when the email is unambiguously a sign-in code email.
  if (!otp && /(verification code|sign[- ]?in code|login code|one[- ]?time code|mã đăng nhập|mã xác minh|mã xác nhận)/i.test(full)) {
    otp = full.match(/\b(\d{4,8})\b/);
  }
  if (otp) code = otp[1];

  // Household code (EN + VI keywords). Real codes are alphanumeric and contain a
  // digit — require one so a following plain word (e.g. "Netflix") isn't grabbed.
  const famRe = /(?:household code|family code|mã hộ gia đình|household|family|hộ gia đình)[:\s]+([A-Z0-9]{4,12})\b/ig;
  for (const m of full.matchAll(famRe)) {
    if (/\d/.test(m[1])) { family_code = m[1]; break; }
  }

  // Reset/password link. Prefer an explicit reset/password/forgot URL; only fall
  // back to a netflix.com link when its path looks like a password/account flow
  // (avoids capturing logo/footer links as a bogus "reset link").
  const rl = decoded.match(/https?:\/\/[^\s"'<>]*(?:reset|password|forgot)[^\s"'<>]*/i)
    || decoded.match(/https?:\/\/[^\s"'<>]*netflix\.com\/[^\s"'<>]*(?:password|account\/security|loginhelp)[^\s"'<>]*/i);
  if (rl) reset_link = rl[0];

  // Most useful result first: login code > household code > reset link.
  const priority = code ? 10 : family_code ? 9 : reset_link ? 8 : 0;
  return { id, subject, from, time, extracted_code: code, reset_link, family_code, priority };
}

module.exports = {
  nfClean, nfIsValidEmail, nfExtractEmailFromHtml, nfJsonValues, nfVisibleLines,
  nfAccountPagePaymentHold, nfDetectPaymentHold, nfParseEmail,
};
