'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  nfParseBillingDate,
  nfBillingIsFuture,
  nfFindBillingDateInHtml,
  nfFindBillingDateInJson,
  nfHasActiveFutureBilling,
} = require('../lib/nf-account-live');
const { nfDetectPaymentHold } = require('../lib/nf-email-parse');

describe('Netflix multilingual billing & date parsing', () => {
  it('Thai Buddhist-era year is converted to Gregorian', () => {
    // 6 June 2570 BE = 6 June 2027 CE → future
    const d = nfParseBillingDate('6 มิถุนายน 2570');
    assert.ok(d instanceof Date);
    assert.equal(d.getFullYear(), 2027);
    assert.equal(d.getMonth(), 5); // June
    assert.equal(d.getDate(), 6);
    assert.equal(nfBillingIsFuture('6 มิถุนายน 2570'), true);
  });

  it('Thai Buddhist-era past date is not future', () => {
    // 1 Jan 2563 BE = 2020 CE → past
    assert.equal(nfBillingIsFuture('1 มกราคม 2563'), false);
  });

  it('numeric day-first date (DD/MM/YYYY) parses', () => {
    const d = nfParseBillingDate('06/06/2027');
    assert.equal(d.getFullYear(), 2027);
    assert.equal(d.getMonth(), 5);
    assert.equal(d.getDate(), 6);
    assert.equal(nfBillingIsFuture('06/06/2027'), true);
  });

  it('German dotted date (D.M.YYYY) parses', () => {
    assert.equal(nfBillingIsFuture('6.6.2027'), true);
    assert.equal(nfBillingIsFuture('6.6.2020'), false);
  });

  it('ISO date parses and Buddhist-era ISO is normalized', () => {
    assert.equal(nfBillingIsFuture('2027-06-06'), true);
  });

  it('JSON nextBillingDate as ISO string is language-independent', () => {
    const html = '<script>{"membershipStatus":"CURRENT_MEMBER","nextBillingDate":"2027-06-06T00:00:00Z"}</script>';
    assert.equal(nfFindBillingDateInJson(html), '2027-06-06');
    assert.equal(nfFindBillingDateInHtml(html), '2027-06-06');
    assert.equal(nfHasActiveFutureBilling(html, null), true);
  });

  it('JSON nextBillingDate as epoch ms is parsed', () => {
    const ms = Date.UTC(2027, 5, 6); // 2027-06-06
    const html = `<script>{"nextRenewalDate":${ms}}</script>`;
    const found = nfFindBillingDateInJson(html);
    assert.match(found, /^2027-06-0[56]$/); // tz tolerance
    assert.equal(nfHasActiveFutureBilling(html, null), true);
  });

  it('JSON epoch seconds is parsed', () => {
    const secs = Math.floor(Date.UTC(2027, 5, 6) / 1000);
    const html = `<script>{"currentPeriodEnd":${secs}}</script>`;
    const found = nfFindBillingDateInJson(html);
    assert.match(found, /^2027-06-0[56]$/);
  });

  it('Thai date in HTML body is found', () => {
    const html = '<p>การชำระเงินครั้งถัดไป 6 มิถุนายน 2570</p>';
    const found = nfFindBillingDateInHtml(html);
    assert.equal(nfBillingIsFuture(found), true);
  });

  it('multilingual payment-hold phrases are detected', () => {
    // Thai
    assert.equal(nfDetectPaymentHold('<p>บัญชีของคุณถูกระงับ</p>'), true);
    // Indonesian
    assert.equal(nfDetectPaymentHold('<p>akun anda ditangguhkan</p>'), true);
    // Japanese
    assert.equal(nfDetectPaymentHold('<p>お支払いを処理できませんでした</p>'), true);
    // Korean
    assert.equal(nfDetectPaymentHold('<p>결제를 처리할 수 없습니다</p>'), true);
    // German
    assert.equal(nfDetectPaymentHold('<p>wir konnten ihre zahlung nicht verarbeiten</p>'), true);
    // Spanish
    assert.equal(nfDetectPaymentHold('<p>no pudimos procesar tu pago</p>'), true);
    // French
    assert.equal(nfDetectPaymentHold("<p>nous n'avons pas pu traiter votre paiement</p>"), true);
  });

  it('clean Thai active page (no hold phrases) is not a false hold', () => {
    const html = '<p>การชำระเงินครั้งถัดไป 6 มิถุนายน 2570</p><p>จัดการสมาชิก</p>';
    assert.equal(nfDetectPaymentHold(html), false);
  });
});
