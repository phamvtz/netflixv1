'use strict';
// Seller workspace — Profile: contact info + change password
// Split from seller.js. Classic script: shares global scope with the other seller-*.js files.

async function changePassword() {
  const oldP = $('pfPwOld').value;
  const newP = $('pfPwNew').value;
  const newP2 = $('pfPwNew2').value;
  setErr('pfPwErr');
  setOk('pfPwOk');
  if (newP.length < 6) return setErr('pfPwErr', tt('seller.errPassword'));
  if (newP !== newP2) return setErr('pfPwErr', tt('seller.errPassMismatch'));
  const d = await api('/api/seller/change-password', { oldPassword: oldP, newPassword: newP }, 'POST');
  if (!d.success) return setErr('pfPwErr', d.error || tt('common.error'));
  setOk('pfPwOk', tt('seller.profile.pwOk'));
  $('pfPwOld').value = $('pfPwNew').value = $('pfPwNew2').value = '';
}

function fillProfile() {
  const p = dashboard?.profile;
  if (!p) return;
  $('pfName').value = p.contactName || '';
  $('pfType').value = p.contactType || 'telegram';
  $('pfContact').value = p.contactInfo || '';
  $('pfUser').textContent = p.username || '—';
  $('pfEmail').textContent = p.email || '—';
}

async function saveProfile() {
  const d = await api('/api/seller/profile', {
    contactName: $('pfName').value.trim(),
    contactType: $('pfType').value,
    contactInfo: $('pfContact').value.trim(),
  }, 'PATCH');
  if (d.success) { toast('Saved'); dashboard.profile = d.profile; }
  else toast(d.error || 'Error');
}

function togglePfPw(inputId, btn) {
  const el = $(inputId);
  if (!el || !btn) return;
  const revealing = el.type === 'password';
  el.type = revealing ? 'text' : 'password';
  if (revealing) {
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
    btn.setAttribute('aria-label', 'Hide password');
  } else {
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
    btn.setAttribute('aria-label', 'Show password');
  }
}
window.togglePfPw = togglePfPw;
