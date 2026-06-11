'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  nfClean,
  nfIsValidEmail,
  nfExtractEmailFromHtml,
  nfDetectPaymentHold,
  nfAccountPagePaymentHold,
  nfParseEmail,
} = require('../lib/nf-email-parse');

describe('Netflix email parse', () => {
  it('nfIsValidEmail chấp nhận email che và từ chối netflix.com', () => {
    assert.equal(nfIsValidEmail('user@gmail.com'), true);
    assert.equal(nfIsValidEmail('p***@gmail.com'), true);
    assert.equal(nfIsValidEmail('noreply@netflix.com'), false);
    assert.equal(nfIsValidEmail('not-an-email'), false);
  });

  it('nfExtractEmailFromHtml lấy memberLoginId trong JSON', () => {
    const html = '<script>{"memberLoginId":"test.user@mail.shop","planName":"Premium"}</script>';
    assert.equal(nfExtractEmailFromHtml(html), 'test.user@mail.shop');
  });

  it('nfClean giải mã \\u và \\x trong chuỗi', () => {
    assert.equal(nfClean('Vi\\u1EC7t\\x20Nam'), 'Việt Nam');
  });

  it('nfDetectPaymentHold bắt popup cập nhật thanh toán', () => {
    const html = '<div>Update your payment information to continue. Standard plan</div>';
    assert.equal(nfDetectPaymentHold(html), true);
  });

  it('nfDetectPaymentHold không false positive trên plan bình thường', () => {
    const html = '<div>Standard plan</div><div>Next payment: July 2, 2026</div>';
    assert.equal(nfDetectPaymentHold(html), false);
  });

  it('nfDetectPaymentHold bắt text rải trong HTML (fuzzy)', () => {
    const html = '<script>{"msg":"Update your payment information to continue enjoying Netflix"}</script>';
    assert.equal(nfDetectPaymentHold(html), true);
  });

  it('nfDetectPaymentHold không nhầm hasPaymentIssue:false trong JSON', () => {
    const html = '<script>{"hasPaymentIssue":false,"paymentIssue":false,"planName":"Premium"}</script>';
    assert.equal(nfDetectPaymentHold(html), false);
  });

  it('nfDetectPaymentHold không nhầm link quản lý phương thức thanh toán (VI)', () => {
    const html = `
      <div>Gói Cao cấp</div>
      <div>Ngày thanh toán tiếp theo: 30 tháng 6, 2026</div>
      <a>Quản lý phương thức thanh toán</a>
      <a>Cập nhật phương thức thanh toán</a>
    `;
    assert.equal(nfDetectPaymentHold(html), false);
    assert.equal(nfAccountPagePaymentHold(html), false);
  });

  it('nfAccountPagePaymentHold ignores browse notification heuristics', () => {
    const html = `
      <div data-uia="account-overview-page+notification+banner">Reminder</div>
      <div>Gói Cao cấp</div>
      <div>Ngày thanh toán tiếp theo: 30 tháng 6, 2026</div>
      <a>Quản lý phương thức thanh toán</a>
    `;
    assert.equal(nfAccountPagePaymentHold(html), false);
    assert.equal(nfDetectPaymentHold(html), false);
  });
});

describe('nfParseEmail — login / household / reset', () => {
  it('login code (EN): extracts the OTP and prioritizes it', () => {
    const r = nfParseEmail({
      subject: 'Your Netflix verification code',
      html: '<p>Enter this code to sign in: <b>458213</b></p>',
    });
    assert.equal(r.extracted_code, '458213');
    assert.equal(r.priority, 10);
  });

  it('login code (VI): extracts after "mã đăng nhập"', () => {
    const r = nfParseEmail({
      subject: 'Mã đăng nhập Netflix của bạn',
      html: '<p>Mã đăng nhập: <b>739104</b> để tiếp tục đăng nhập.</p>',
    });
    assert.equal(r.extracted_code, '739104');
    assert.equal(r.priority, 10);
  });

  it('household code (EN): extracts after "household code"', () => {
    const r = nfParseEmail({
      subject: 'Your Netflix Household travel code',
      html: '<div>Enter your household code: <strong>HJ4K9Q</strong></div>',
    });
    assert.equal(r.family_code, 'HJ4K9Q');
    assert.equal(r.priority, 9);
  });

  it('household code (VI): extracts after "Hộ gia đình"', () => {
    const r = nfParseEmail({
      subject: 'Cập nhật Hộ gia đình Netflix',
      html: '<div>Mã Hộ gia đình: <strong>AB12CD</strong></div>',
    });
    assert.equal(r.family_code, 'AB12CD');
    assert.equal(r.priority, 9);
  });

  it('reset link: captures explicit password-reset URL even with a stray number', () => {
    const r = nfParseEmail({
      subject: 'Reset your password',
      html: '<p>Order 12345.</p><a href="https://www.netflix.com/password?g=abc123XYZ&lkid=99">Reset password</a>',
    });
    assert.ok(r.reset_link && r.reset_link.includes('/password?'), 'reset_link should be captured');
    assert.equal(r.extracted_code, null, 'stray order number must not be treated as a login code');
    assert.equal(r.priority, 8);
  });

  it('does not capture a generic netflix.com link (logo/footer) as a reset link', () => {
    const r = nfParseEmail({
      subject: 'Welcome to Netflix',
      html: '<a href="https://www.netflix.com/browse">Open Netflix</a>',
    });
    assert.equal(r.reset_link, null);
    assert.equal(r.priority, 0);
  });

  it('returns empty result for an unrelated email', () => {
    const r = nfParseEmail({ subject: 'Receipt', html: '<p>Thanks for your purchase.</p>' });
    assert.equal(r.extracted_code, null);
    assert.equal(r.family_code, null);
    assert.equal(r.reset_link, null);
    assert.equal(r.priority, 0);
  });
});
