'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  nfClean,
  nfIsValidEmail,
  nfExtractEmailFromHtml,
  nfDetectPaymentHold,
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
});
