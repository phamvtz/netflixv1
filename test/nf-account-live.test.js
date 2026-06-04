'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  nfBillingIsFuture,
  nfDetectMembershipEnded,
  nfHasActiveMembershipSignals,
  nfHasPaymentElement,
  nfResolveSubscriptionStatus,
} = require('../lib/nf-account-live');
const { nfDetectPaymentHold } = require('../lib/nf-email-parse');

describe('Netflix account LIVE signals', () => {
  it('nfBillingIsFuture parses Vietnamese next payment date', () => {
    assert.equal(nfBillingIsFuture('Ngày thanh toán tiếp theo: 30 tháng 6, 2026'), true);
    assert.equal(nfBillingIsFuture('6 tháng 6, 2026'), true);
    assert.equal(nfBillingIsFuture('30 tháng 6 năm 2020'), false);
  });

  it('nfHasActiveMembershipSignals: VI Premium + billing + manage link → active', () => {
    const html = `
      <div data-uia="account-overview-page+membership-card+title">Gói Cao cấp</div>
      <div>Thành viên từ tháng 5 năm 2025</div>
      <div>Ngày thanh toán tiếp theo: 30 tháng 6, 2026</div>
      <a href="#">Quản lý tư cách thành viên</a>
      <span>VISA **** **** **** 8127</span>
    `;
    const billing = 'Ngày thanh toán tiếp theo: 30 tháng 6, 2026';
    assert.equal(nfHasActiveMembershipSignals(html, billing), true);
  });

  it('nfHasActiveMembershipSignals: plan name only in JSON, no payment uia → still active via billing', () => {
    const html = '<script>{"planName":"Gói Cao cấp"}</script><p>Ngày thanh toán tiếp theo: 1 tháng 7, 2026</p>';
    assert.equal(nfHasActiveMembershipSignals(html, '1 tháng 7, 2026'), true);
  });

  it('nfHasPaymentElement detects payment data-uia', () => {
    const html = '<div data-uia="account-overview-page+membership-card+payment+details+CC">';
    assert.equal(nfHasPaymentElement(html), true);
  });

  it('nfResolveSubscriptionStatus: 6 tháng 6 2026 billing → LIVE', () => {
    const html = '<div>Gói Cao cấp</div><div>Ngày thanh toán tiếp theo: 6 tháng 6, 2026</div>';
    const out = nfResolveSubscriptionStatus({
      html,
      plan: 'Gói Cao cấp',
      billingText: 'Ngày thanh toán tiếp theo: 6 tháng 6, 2026',
      accountPaymentHold: false,
      paymentHold: true,
      paymentError: true,
      membershipActiveUi: false,
    });
    assert.equal(out.isLive, true);
    assert.equal(out.planLost, false);
  });

  it('nfResolveSubscriptionStatus: plan + profiles → LIVE without billing date', () => {
    const out = nfResolveSubscriptionStatus({
      html: '<div>Gói Cao cấp</div>',
      plan: 'Gói Cao cấp',
      billingText: null,
      profiles: ['A', 'B'],
      accountPaymentHold: false,
      paymentHold: true,
      paymentError: true,
      membershipActiveUi: false,
    });
    assert.equal(out.isLive, true);
    assert.equal(out.planLost, false);
  });

  it('nfDetectMembershipEnded: canceled account with restart CTA', () => {
    const html = `
      <div>Your membership has already been canceled.</div>
      <h2>Your membership has ended</h2>
      <p>Ready to watch? Restart your membership any time.</p>
      <button>Restart membership</button>
      <script>{"planName":"Mobile"}</script>
    `;
    assert.equal(nfDetectMembershipEnded(html, null), true);
    const out = nfResolveSubscriptionStatus({
      html,
      plan: 'Mobile',
      billingText: null,
      profiles: ['Main'],
      accountPaymentHold: false,
      paymentHold: false,
      paymentError: false,
      membershipActiveUi: false,
    });
    assert.equal(out.isLive, false);
    assert.equal(out.cancelled, true);
  });

  it('nfHasActiveMembershipSignals: membership page billing label (Lần thanh toán)', () => {
    const html = `
      <h1>Tư cách thành viên</h1>
      <p>Gói Cao cấp</p>
      <p>Lần thanh toán tiếp theo: 30 tháng 6, 2026</p>
      <a>Hủy tư cách thành viên</a>
    `;
    assert.equal(nfHasActiveMembershipSignals(html, '30 tháng 6, 2026'), true);
  });

  it('nfResolveSubscriptionStatus: future billing → LIVE despite false payment hold', () => {
    const html = `
      <div>Gói Cao cấp</div>
      <a>Cập nhật phương thức thanh toán</a>
    `;
    const billing = 'Ngày thanh toán tiếp theo: 30 tháng 6, 2026';
    assert.equal(nfDetectPaymentHold(html), false);
    const out = nfResolveSubscriptionStatus({
      html,
      plan: 'Gói Cao cấp',
      billingText: billing,
      accountPaymentHold: false,
      paymentHold: true,
      paymentError: true,
      membershipActiveUi: false,
    });
    assert.equal(out.isLive, true);
    assert.equal(out.planLost, false);
    assert.equal(out.paymentError, false);
  });
});
