'use strict';

const { nfClean, nfVisibleLines } = require('./nf-email-parse');

const NF_CANCEL_NEAR_BILLING = [
  'ends on', 'end on', 'will end', 'membership ends', 'your membership ends',
  'has been cancelled', 'has been canceled', 'cancellation',
  'kết thúc', 'hết hạn vào', 'sẽ kết thúc', 'đã hủy', 'đã bị hủy', 'chấm dứt',
  // TH
  'สิ้นสุด', 'จะสิ้นสุด', 'ยกเลิกแล้ว',
  // ID
  'berakhir pada', 'akan berakhir', 'telah dibatalkan',
  // JA
  '終了します', '終了日', 'キャンセルされました',
  // KO
  '종료됩니다', '해지되었습니다', '취소되었습니다',
  // DE
  'endet am', 'wird beendet', 'wurde gekündigt',
  // ES
  'finaliza el', 'finalizará', 'ha sido cancelada',
  // FR
  'se termine le', 'prendra fin', 'a été annulé',
];

const NF_NEXT_BILLING_LABELS = [
  'next payment', 'next billing', 'renews on', 'renewal date',
  'thanh toán tiếp theo', 'ngày thanh toán tiếp theo', 'lần thanh toán tiếp theo',
  // TH
  'การชำระเงินครั้งถัดไป', 'ชำระเงินครั้งต่อไป', 'วันที่เรียกเก็บเงินถัดไป',
  // ID
  'pembayaran berikutnya', 'tagihan berikutnya', 'tanggal pembaruan',
  // JA
  '次回のお支払い', '次回請求日', '次のお支払い日',
  // KO
  '다음 결제', '다음 결제일', '결제 예정일',
  // DE
  'nächste zahlung', 'nächste abrechnung', 'verlängert sich am',
  // ES
  'próximo pago', 'próxima facturación', 'se renueva el',
  // FR
  'prochain paiement', 'prochaine facturation', 'se renouvelle le',
];

const NF_LIVE_PAYMENT_UIA = [
  'account-overview-page+membership-card+payment+details+CC',
  'account-overview-page+membership-card+payment+details+PAYPAL',
  'account-overview-page+membership-card+payment+details+CARRIER',
  'account-overview-page+membership-card+payment+details+GIFT',
  'account-overview-page+membership-card+payment+details+MOBILE',
  'account-overview-page+membership-card+payment+details',
];

const NF_CANCEL_MEMBERSHIP_PHRASES = [
  'cancel membership', 'cancel your membership',
  'ยกเลิกสมาชิก', 'ยกเลิกการเป็นสมาชิก',
  'hủy tư cách thành viên', 'hủy gói', 'hủy thành viên', 'hủy đăng ký',
  'cancelar tu suscripción', 'annuler votre abonnement',
  // ID
  'batalkan keanggotaan', 'batalkan langganan',
  // JA
  'メンバーシップをキャンセル', 'メンバーシップの解約',
  // KO
  '멤버십 취소', '멤버십 해지',
  // DE
  'mitgliedschaft kündigen',
  // ES (alt)
  'cancelar membresía', 'cancelar la membresía',
  // FR (alt)
  'résilier votre abonnement',
];

const NF_MANAGE_MEMBERSHIP_PHRASES = [
  'manage membership', 'manage your membership',
  'quản lý tư cách thành viên', 'quản lý gói', 'quản lý thành viên',
  // TH
  'จัดการสมาชิก', 'จัดการการเป็นสมาชิก',
  // ID
  'kelola keanggotaan', 'kelola langganan',
  // JA
  'メンバーシップの管理',
  // KO
  '멤버십 관리',
  // DE
  'mitgliedschaft verwalten',
  // ES
  'administrar membresía', 'gestionar membresía',
  // FR
  'gérer votre abonnement',
];

const NF_MEMBERSHIP_ENDED_PHRASES = [
  'your membership has ended',
  'your membership has already been canceled',
  'your membership has already been cancelled',
  'membership has already been canceled',
  'membership has already been cancelled',
  'ready to watch? restart your membership',
  'tư cách thành viên đã kết thúc',
  'tư cách thành viên của bạn đã kết thúc',
  'đã hủy tư cách thành viên',
  'gói đã hết hạn',
  // TH
  'การเป็นสมาชิกของคุณสิ้นสุดลงแล้ว', 'สมาชิกของคุณสิ้นสุดแล้ว', 'เริ่มการเป็นสมาชิกอีกครั้ง',
  // ID
  'keanggotaan anda telah berakhir', 'mulai ulang keanggotaan',
  // JA
  'メンバーシップは終了しました', 'メンバーシップを再開',
  // KO
  '멤버십이 종료되었습니다', '멤버십 다시 시작',
  // DE
  'ihre mitgliedschaft ist beendet', 'mitgliedschaft neu starten',
  // ES
  'tu membresía ha finalizado', 'reinicia tu membresía',
  // FR
  'votre abonnement a pris fin', 'redémarrer votre abonnement',
];

/** Normalize a year: Thai Buddhist era (e.g. 2567) → Gregorian (2024). */
function nfNormalizeYear(year) {
  const y = Number(year);
  if (!Number.isFinite(y)) return NaN;
  // Buddhist Era is Gregorian + 543. Thai Netflix UI shows years like 2567.
  if (y >= 2400) return y - 543;
  return y;
}

const NF_THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

/** Parse billing date strings (VI / EN / TH / numeric) to Date at local midnight. */
function nfParseBillingDate(text) {
  if (!text) return null;
  const t = nfClean(text);

  // Vietnamese: "6 tháng 6, 2026" / "6 tháng 6 năm 2026"
  let m = t.match(/(\d{1,2})\s+tháng\s+(\d{1,2})(?:,?\s*(?:năm\s+)?)?(\d{4})/i);
  if (m) return new Date(nfNormalizeYear(m[3]), +m[2] - 1, +m[1]);

  // Thai: "6 มิถุนายน 2567" (day month year, Buddhist era)
  const thMonthAlt = NF_THAI_MONTHS.join('|');
  const thRe = new RegExp(`(\\d{1,2})\\s*(${thMonthAlt})\\s*(\\d{4})`, 'i');
  m = t.match(thRe);
  if (m) {
    const mon = NF_THAI_MONTHS.indexOf(m[2]);
    if (mon >= 0) return new Date(nfNormalizeYear(m[3]), mon, +m[1]);
  }

  // English: "6 June 2026"
  m = t.match(/\b(\d{1,2})\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{4})\b/i);
  if (m) {
    const months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
    const mon = months[m[2].slice(0, 3).toLowerCase()];
    if (mon != null) return new Date(nfNormalizeYear(m[3]), mon, +m[1]);
  }

  // English: "June 6, 2026"
  m = t.match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),?\s+(\d{4})\b/i);
  if (m) {
    const months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
    const mon = months[m[1].slice(0, 3).toLowerCase()];
    if (mon != null) return new Date(nfNormalizeYear(m[3]), mon, +m[2]);
  }

  // ISO: 2026-06-06
  m = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return new Date(nfNormalizeYear(m[1]), +m[2] - 1, +m[3]);

  // Numeric day-first: 06/06/2026 or 6.6.2026 (non-US / German). Day assumed first.
  m = t.match(/\b(\d{1,2})[/.](\d{1,2})[/.](\d{4})\b/);
  if (m) {
    const day = +m[1];
    const mon = +m[2];
    if (mon >= 1 && mon <= 12 && day >= 1 && day <= 31) {
      return new Date(nfNormalizeYear(m[3]), mon - 1, day);
    }
  }

  return null;
}

function nfBillingIsFuture(billingText) {
  const d = nfParseBillingDate(billingText);
  if (!d || Number.isNaN(d.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return d >= today;
}

// Language-independent billing keys Netflix embeds in SSR JSON.
const NF_JSON_BILLING_KEYS = [
  'nextBillingDate', 'nextRenewalDate', 'nextPaymentDate', 'nextChargeDate',
  'nextInvoiceDate', 'billingDate', 'renewalDate', 'currentPeriodEnd',
  'periodEndDate', 'nextBillingTimestamp',
];

/** Convert an epoch (s/ms) or ISO string to a normalized YYYY-MM-DD, else null. */
function nfNormalizeJsonDateValue(value) {
  if (value == null) return null;
  const s = String(value).trim();
  if (/^\d{13}$/.test(s)) {            // epoch ms
    const d = new Date(Number(s));
    return Number.isNaN(d.getTime()) ? null : nfToIsoDate(d);
  }
  if (/^\d{10}$/.test(s)) {            // epoch seconds
    const d = new Date(Number(s) * 1000);
    return Number.isNaN(d.getTime()) ? null : nfToIsoDate(d);
  }
  const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/);  // ISO date or datetime
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return null;
}

function nfToIsoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Find a billing date from SSR JSON keys — works regardless of UI language. */
function nfFindBillingDateInJson(html) {
  if (!html) return null;
  const raw = String(html);
  for (const key of NF_JSON_BILLING_KEYS) {
    // string value: "nextBillingDate":"2026-06-06T00:00:00Z"
    let m = raw.match(new RegExp(`"${key}"\\s*:\\s*"([^"]{4,40})"`, 'i'));
    if (m) {
      const norm = nfNormalizeJsonDateValue(m[1]);
      if (norm) return norm;
    }
    // numeric value: "nextBillingDate":1780531200000
    m = raw.match(new RegExp(`"${key}"\\s*:\\s*(\\d{10,13})\\b`, 'i'));
    if (m) {
      const norm = nfNormalizeJsonDateValue(m[1]);
      if (norm) return norm;
    }
  }
  return null;
}

/** Scan raw HTML for a next billing date (JSON first, then VI/EN/TH text). */
function nfFindBillingDateInHtml(html) {
  if (!html) return null;
  const raw = String(html);

  // 1) Language-independent JSON billing keys (most reliable across locales)
  const json = nfFindBillingDateInJson(html);
  if (json) return json;

  // 2) Vietnamese/English labelled date
  const vi = raw.match(
    /(?:ngày\s+thanh\s+toán|thanh\s+toán\s+tiếp\s+theo|next\s+payment|next\s+billing)[^0-9]{0,40}(\d{1,2}\s+tháng\s+\d{1,2}(?:,?\s*(?:năm\s+)?)?\d{4})/i,
  );
  if (vi) return nfClean(vi[1]);
  const vi2 = raw.match(/(\d{1,2}\s+tháng\s+\d{1,2}(?:,?\s*(?:năm\s+)?)?\d{4})/i);
  if (vi2) return nfClean(vi2[0]);

  // 3) Thai date: "6 มิถุนายน 2567"
  const thRe = new RegExp(`(\\d{1,2}\\s*(?:${NF_THAI_MONTHS.join('|')})\\s*\\d{4})`, 'i');
  const th = raw.match(thRe);
  if (th) return nfClean(th[1]);

  return null;
}

function nfBillingContextCancelled(html, billingText) {
  const ctx = `${billingText || ''} ${nfVisibleLines(html).slice(0, 80).join(' ')}`.toLowerCase();
  return NF_CANCEL_NEAR_BILLING.some((kw) => ctx.includes(kw.toLowerCase()));
}

function nfHasNextBillingLabel(html, billingText) {
  const ctx = `${billingText || ''} ${nfVisibleLines(html).join(' ')}`.toLowerCase();
  return NF_NEXT_BILLING_LABELS.some((l) => ctx.includes(l));
}

function nfHasPaymentElement(html) {
  return NF_LIVE_PAYMENT_UIA.some((sel) => String(html || '').includes(`data-uia="${sel}`));
}

function nfHasMaskedPayment(html) {
  const raw = String(html || '');
  if (/(?:\*{4}\s+){2,}\d{4}/.test(raw)) return true;
  if (/[•·]{4}\s*[•·]{4}\s*\d{4}/.test(raw)) return true;
  return /payment\+details/i.test(raw) && /\b\d{4}\b/.test(raw);
}

/**
 * Strong signals that /account still represents an active paid membership.
 * Covers VI UI where English cancel/payment data-uia may be missing in HTML snapshot.
 */
/** /account shows subscription ended (restart CTA, no next billing). */
function nfDetectMembershipEnded(html, billingText) {
  if (!html) return false;
  const low = String(html).toLowerCase();
  if (NF_MEMBERSHIP_ENDED_PHRASES.some((p) => low.includes(p))) return true;
  const hasRestart = /restart\s+(?:your\s+)?membership|kích hoạt lại\s+(?:gói|tư cách)|bắt đầu lại/i.test(low);
  const hasFutureBill = nfHasActiveFutureBilling(html, billingText);
  if (hasRestart && !hasFutureBill) return true;
  return false;
}

function nfHasActiveMembershipSignals(html, billingText) {
  if (!html) return false;
  if (nfDetectMembershipEnded(html, billingText)) return false;
  const low = html.toLowerCase();

  if (nfHasPaymentElement(html)) return true;
  if (NF_MANAGE_MEMBERSHIP_PHRASES.some((p) => low.includes(p))) return true;
  if (NF_CANCEL_MEMBERSHIP_PHRASES.some((p) => low.includes(p))) return true;
  if (/thành viên từ tháng/i.test(html) || low.includes('member since')) return true;
  if (nfHasMaskedPayment(html)) return true;

  if (billingText && !nfBillingContextCancelled(html, billingText)) {
    if (nfHasNextBillingLabel(html, billingText) && nfBillingIsFuture(billingText)) return true;
    if (nfBillingIsFuture(billingText) && !low.includes('reactivate')) return true;
  }

  return false;
}

/** Next billing date in the future = paid active membership (unless /account shows hold). */
function nfHasActiveFutureBilling(html, billingText) {
  if (nfBillingContextCancelled(html, billingText)) return false;
  const found = nfFindBillingDateInHtml(html);
  const merged = [billingText, found, html].filter(Boolean).join(' ');
  if (nfHasNextBillingLabel(html, merged) && nfBillingIsFuture(merged)) return true;
  if (nfBillingIsFuture(merged)) return true;
  if (found && nfBillingIsFuture(found)) return true;
  return false;
}

/** Logged-in /account with plan + profiles = subscription still tied to account. */
function nfHasActivePlanAndProfiles(plan, profiles) {
  return !!plan && Array.isArray(profiles) && profiles.length > 0;
}

/**
 * When Netflix shows a future renewal/charge date, treat as LIVE.
 * Fixes false PLAN LOST from manage-payment links or loose payment keywords.
 */
function nfResolveSubscriptionStatus(fields) {
  const {
    html,
    plan,
    billingText,
    profiles,
    accountPaymentHold,
    paymentHold,
    paymentError,
    membershipActiveUi,
  } = fields;

  if (nfDetectMembershipEnded(html, billingText)) {
    return {
      paymentHold: false,
      paymentError: false,
      membershipActiveUi: false,
      subscriptionActive: false,
      isLive: false,
      planLost: false,
      cancelled: true,
      futureBilling: false,
      planProfiles: false,
      billingText: billingText || nfFindBillingDateInHtml(html) || billingText,
    };
  }

  let hold = !!paymentHold;
  let payErr = !!paymentError;
  let activeUi = !!membershipActiveUi;
  const futureBilling = nfHasActiveFutureBilling(html, billingText);
  const planProfiles = nfHasActivePlanAndProfiles(plan, profiles);
  const explicitAccountHold = !!accountPaymentHold;

  // Explicit /account hold banner ("account is on hold", "couldn't process your
  // last payment", isOnHold/pastDue JSON flags) is authoritative. A "next payment"
  // date shown on a held account is only the retry date, NOT a healthy renewal —
  // so it must never be promoted to LIVE via future-billing/profile signals.
  if (explicitAccountHold) {
    return {
      paymentHold: true,
      paymentError: true,
      membershipActiveUi: activeUi,
      subscriptionActive: false,
      isLive: false,
      planLost: !!plan,
      cancelled: false,
      futureBilling,
      planProfiles,
      billingText: billingText || nfFindBillingDateInHtml(html) || billingText,
    };
  }

  let strongLive = futureBilling || planProfiles || activeUi;

  let subscriptionActive = !hold && strongLive;
  let isLive = subscriptionActive;
  let planLost = !!plan && !strongLive && (hold || payErr);

  if (plan && strongLive) {
    hold = false;
    payErr = false;
    activeUi = true;
    subscriptionActive = true;
    isLive = true;
    planLost = false;
  }

  const billingOut = billingText || nfFindBillingDateInHtml(html) || billingText;

  return {
    paymentHold: hold,
    paymentError: payErr,
    membershipActiveUi: activeUi,
    subscriptionActive,
    isLive,
    planLost,
    cancelled: false,
    futureBilling,
    planProfiles,
    billingText: billingOut,
  };
}

module.exports = {
  nfParseBillingDate,
  nfBillingIsFuture,
  nfFindBillingDateInHtml,
  nfFindBillingDateInJson,
  nfHasPaymentElement,
  nfDetectMembershipEnded,
  nfHasActiveMembershipSignals,
  nfHasActiveFutureBilling,
  nfHasActivePlanAndProfiles,
  nfResolveSubscriptionStatus,
};
