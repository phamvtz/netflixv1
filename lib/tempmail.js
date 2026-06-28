'use strict';

// Helpers to normalize temp-mail provider responses into a stable shape.
// Kept separate from server.js so they can be unit-tested without booting the
// app. Providers disagree on envelope shape — these functions hide that.

// Always returns an array so callers can safely .slice/.map. tempmail.id.vn
// nests the message list as { success, message, data: { items: [...],
// pagination } }; older/other providers use a flat array or
// { data | emails | messages | mails: [...] }.
function mailListOf(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (data.data && Array.isArray(data.data.items)) return data.data.items;
  const inner = data.data || data.emails || data.messages || data.mails || data.items;
  if (Array.isArray(inner)) return inner;
  if (inner && Array.isArray(inner.items)) return inner.items;
  return [];
}

// A single message body can come back wrapped as { data: {...} }, { message:
// {...} }, or as the object itself. Returns the inner object (or null).
function mailBodyOf(payload) {
  if (!payload) return null;
  if (payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)) return payload.data;
  if (payload.message && typeof payload.message === 'object') return payload.message;
  return payload;
}

function mailAddressOf(m) {
  return String((m && (m.email || m.address || m.mail)) || `${(m && m.user) || ''}@${(m && m.domain) || ''}`).toLowerCase();
}

function mailIdOf(m) {
  return (m && (m.id || m._id || m.mail_id || m.message_id)) || null;
}

module.exports = { mailListOf, mailBodyOf, mailAddressOf, mailIdOf };
