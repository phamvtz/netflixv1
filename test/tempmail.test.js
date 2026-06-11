'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { mailListOf, mailBodyOf, mailAddressOf, mailIdOf } = require('../lib/tempmail');

describe('tempmail response normalization', () => {
  it('mailListOf handles the tempmail.id.vn nested { data: { items } } shape', () => {
    // Regression: this shape previously reached `.slice` as a non-array → 500.
    const payload = {
      success: true,
      message: 'ok',
      data: {
        items: [{ id: 1, subject: 'Netflix: Your sign-in code' }],
        pagination: { total: 1, per_page: 15, current_page: 1, last_page: 1 },
      },
    };
    const list = mailListOf(payload);
    assert.ok(Array.isArray(list), 'must return an array');
    assert.equal(list.length, 1);
    assert.equal(list[0].subject, 'Netflix: Your sign-in code');
  });

  it('mailListOf handles a flat array', () => {
    const list = mailListOf([{ id: 1 }, { id: 2 }]);
    assert.deepEqual(list.map((m) => m.id), [1, 2]);
  });

  it('mailListOf handles { data: [...] } and { messages: [...] } wrappers', () => {
    assert.equal(mailListOf({ data: [{ id: 1 }] }).length, 1);
    assert.equal(mailListOf({ messages: [{ id: 2 }] }).length, 1);
    assert.equal(mailListOf({ emails: [{ id: 3 }] }).length, 1);
    assert.equal(mailListOf({ mails: [{ id: 4 }] }).length, 1);
  });

  it('mailListOf always returns an array for empty / malformed input', () => {
    assert.deepEqual(mailListOf(null), []);
    assert.deepEqual(mailListOf(undefined), []);
    assert.deepEqual(mailListOf({}), []);
    assert.deepEqual(mailListOf({ data: { pagination: {} } }), []);
    assert.deepEqual(mailListOf({ data: 'oops' }), []);
  });

  it('mailBodyOf unwraps { data } and { message } objects', () => {
    assert.deepEqual(mailBodyOf({ data: { body: 'hi' } }), { body: 'hi' });
    assert.deepEqual(mailBodyOf({ message: { body: 'yo' } }), { body: 'yo' });
    assert.deepEqual(mailBodyOf({ body: 'flat' }), { body: 'flat' });
    assert.equal(mailBodyOf(null), null);
  });

  it('mailBodyOf does not return the string "message" as a body', () => {
    // tempmail.id.vn message-detail = { success, message: "Success", data: {...} }
    const payload = { success: true, message: 'Success', data: { body: 'real' } };
    assert.deepEqual(mailBodyOf(payload), { body: 'real' });
  });

  it('mailAddressOf reads common address fields and lowercases', () => {
    assert.equal(mailAddressOf({ email: 'A@B.VN' }), 'a@b.vn');
    assert.equal(mailAddressOf({ address: 'x@y.io' }), 'x@y.io');
    assert.equal(mailAddressOf({ user: 'u', domain: 'D.com' }), 'u@d.com');
  });

  it('mailIdOf reads common id fields', () => {
    assert.equal(mailIdOf({ id: 7 }), 7);
    assert.equal(mailIdOf({ message_id: 'abc' }), 'abc');
    assert.equal(mailIdOf({}), null);
  });
});
