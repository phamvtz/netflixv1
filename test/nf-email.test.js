'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  nfClean,
  nfIsValidEmail,
  nfExtractEmailFromHtml,
  nfDetectPaymentHold,
  nfAccountPagePaymentHold,
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
