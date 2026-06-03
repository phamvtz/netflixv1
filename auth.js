'use strict';

const crypto = require('crypto');

// Tham số scrypt — cố định để hash/verify khớp nhau
const KEYLEN = 64;
const SCRYPT_PREFIX = 'scrypt$';

// Hash mật khẩu → "scrypt$<saltHex>$<hashHex>"
function hashPassword(plain) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(plain), salt, KEYLEN);
  return `${SCRYPT_PREFIX}${salt.toString('hex')}$${hash.toString('hex')}`;
}

// So khớp mật khẩu. Timing-safe khi so hash.
// Hỗ trợ bản ghi cũ lưu plaintext (DB đã seed trước khi hash hoá) để không phá login.
function verifyPassword(stored, plain) {
  if (typeof stored !== 'string' || !stored) return false;

  // Legacy: bản ghi cũ chưa hash → so trực tiếp (sẽ tự nâng cấp khi seed DB mới)
  if (!stored.startsWith(SCRYPT_PREFIX)) {
    return stored === plain;
  }

  const [, saltHex, hashHex] = stored.split('$');
  if (!saltHex || !hashHex) return false;

  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(String(plain), Buffer.from(saltHex, 'hex'), expected.length);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

module.exports = { hashPassword, verifyPassword };
