'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { mergeCheckResults } = require('../server');

// Direct HTML result that looks perfectly LIVE (Netflix renders the payment-hold
// banner client-side, so the SSR HTML the checker downloads has no hold marker).
function liveLookingDirect() {
  return {
    reachable: true,
    alive: true,
    cancelled: false,
    planLost: false,
    plan: 'Premium plan',
    billingText: 'Next payment: July 5, 2026',
    profiles: ['siripornsom_tanphon5198'],
    paymentError: false,
    paymentHold: false,
    accountPaymentHold: false,
    futureBilling: true,
    emailFromHtml: 'a@b.com',
  };
}

describe('mergeCheckResults — verify-live with nftoken', () => {
  it('nftoken definitive DEAD overrides an HTML-only LIVE', () => {
    const nf = liveLookingDirect();
    const nft = {
      alive: false,
      definitiveDead: true,
      paymentError: false,
      plan: null,
      email: null,
      raw: { status: 'DEAD', message: 'Account is Dead or Expired.' },
      skipped: false,
    };
    const out = mergeCheckResults(nf, nft);
    assert.equal(out.alive, false);
    assert.equal(out.planLost, true);
    assert.equal(out.source, 'nftoken');
  });

  it('nftoken alive confirms a LIVE direct result', () => {
    const nf = liveLookingDirect();
    const nft = {
      alive: true, definitiveDead: false, paymentError: false,
      plan: 'Premium plan', email: 'a@b.com', hasPremium: true,
      raw: { status: 'SUCCESS' }, skipped: false,
    };
    const out = mergeCheckResults(nf, nft);
    assert.equal(out.alive, true);
    assert.equal(out.source, 'direct+nftoken');
  });

  it('skipped nftoken leaves HTML LIVE intact (no override)', () => {
    const nf = liveLookingDirect();
    const out = mergeCheckResults(nf, { skipped: true });
    assert.equal(out.alive, true);
    assert.equal(out.source, 'direct');
  });

  it('explicit account hold banner still beats HTML billing (no nftoken needed)', () => {
    const nf = { ...liveLookingDirect(), accountPaymentHold: true };
    const out = mergeCheckResults(nf, { skipped: true });
    assert.equal(out.alive, false);
    assert.equal(out.paymentHold, true);
    assert.equal(out.planLost, true);
  });
});
