'use strict';

const { nfClean, nfVisibleLines } = require('./nf-email-parse');

const NF_CANCEL_NEAR_BILLING = [
  'ends on', 'end on', 'will end', 'membership ends', 'your membership ends',
  'has been cancelled', 'has been canceled', 'cancellation',
  'kết thúc', 'hết hạn vào', 'sẽ kết thúc', 'đã hủy', 'đã bị hủy', 'chấm dứt',
];

const NF_NEXT_BILLING_LABELS = [
  'next payment', 'next billing', 'renews on', 'renewal date',
  'thanh toán tiếp theo', 'ngày thanh toán tiếp theo', 'lần thanh toán tiếp theo',
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
  'ยกเลิกสมาชิก',
  'hủy tư cách thành viên', 'hủy gói', 'hủy thành viên', 'hủy đăng ký',
  'cancelar tu suscripción', 'annuler votre abonnement',
];

const NF_MANAGE_MEMBERSHIP_PHRASES = [
  'manage membership', 'manage your membership',
  'quản lý tư cách thành viên', 'quản lý gói', 'quản lý thành viên',
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
];

/** Parse billing date strings (VI / EN) to Date at local midnight. */
function nfParseBillingDate(text) {
  if (!text) return null;
  const t = nfClean(text);

  let m = t.match(/(\d{1,2})\s+tháng\s+(\d{1,2})(?:,?\s*(?:năm\s+)?)?(\d{4})/i);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);

  m = t.match(/\b(\d{1,2})\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{4})\b/i);
  if (m) {
    const months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
    const mon = months[m[2].slice(0, 3).toLowerCase()];
    if (mon != null) return new Date(+m[3], mon, +m[1]);
  }

  m = t.match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),?\s+(\d{4})\b/i);
  if (m) {
    const months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
    const mon = months[m[1].slice(0, 3).toLowerCase()];
    if (mon != null) return new Date(+m[3], mon, +m[2]);
  }

  m = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);

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

/** Scan raw HTML for Vietnamese/English next billing date (SSR/JSON). */
function nfFindBillingDateInHtml(html) {
  if (!html) return null;
  const raw = String(html);
  const vi = raw.match(
    /(?:ngày\s+thanh\s+toán|thanh\s+toán\s+tiếp\s+theo|next\s+payment|next\s+billing)[^0-9]{0,40}(\d{1,2}\s+tháng\s+\d{1,2}(?:,?\s*(?:năm\s+)?)?\d{4})/i,
  );
  if (vi) return nfClean(vi[1]);
  const vi2 = raw.match(/(\d{1,2}\s+tháng\s+\d{1,2}(?:,?\s*(?:năm\s+)?)?\d{4})/i);
  if (vi2) return nfClean(vi2[0]);
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
  let strongLive = futureBilling || planProfiles || activeUi;
  if (explicitAccountHold && !futureBilling && !planProfiles) strongLive = false;

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
  nfHasPaymentElement,
  nfDetectMembershipEnded,
  nfHasActiveMembershipSignals,
  nfHasActiveFutureBilling,
  nfHasActivePlanAndProfiles,
  nfResolveSubscriptionStatus,
};
