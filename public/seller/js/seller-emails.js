'use strict';
// Seller workspace — Emails: account picker + mail cards
// Split from seller.js. Classic script: shares global scope with the other seller-*.js files.

// ── Email view ──
let emailAccounts = [];
let pickedEmailAccount = null;

async function loadEmailAccounts() {
  const d = await api('/api/seller/emails');
  if (!d.success) return;
  emailAccounts = (d.emails || []).map((e) => ({ email: e.email, latestExpires: e.latestExpires, orderCount: e.orderCount }));
  $('emailBanner')?.classList.add('hidden');
  $('mailList').innerHTML = '';
  $('emailPicker').value = '';
  pickedEmailAccount = null;
  renderEmailDropdown('');
}

function renderEmailDropdown(q) {
  const dd = $('emailPickerDropdown');
  if (!dd) return;
  const ql = q.toLowerCase();
  const list = emailAccounts.filter((e) => !ql || e.email.toLowerCase().includes(ql)).slice(0, 50);
  if (!list.length) {
    dd.innerHTML = '<div class="email-opt" style="cursor:default;color:#94a3b8">' + tt('seller.emails.noAcc') + '</div>';
  } else {
    dd.innerHTML = list.map((e) => `
      <div class="email-opt" data-email="${esc(e.email)}">
        <span>${esc(e.email)}</span>
        <span class="meta">HSD: ${fmtTs(e.latestExpires)}</span>
      </div>`).join('');
  }
  dd.classList.add('is-open');
  dd.querySelectorAll('[data-email]').forEach((opt) => {
    opt.addEventListener('click', () => {
      const em = opt.dataset.email;
      pickedEmailAccount = em;
      $('emailPicker').value = em;
      dd.classList.remove('is-open');
    });
  });
}

async function fetchSellerMail() {
  const email = ($('emailPicker').value || '').trim();
  if (!email) return toast(tt('seller.emails.pickFirst'));
  const btn = $('fetchMailBtn');
  btn.disabled = true;
  const orig = btn.innerHTML;
  btn.innerHTML = `<span class="form-spinner"></span><span>${tt('common.searching')}</span>`;
  try {
    const d = await api('/api/seller/mail', { email });
    if (!d.success) throw new Error(d.error || 'error');
    renderMailList(d.emails || [], email);
  } catch (e) {
    toast(tt('common.error') + ': ' + e.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = orig;
  }
}

function renderMailList(emails, accountEmail) {
  const banner = $('emailBanner');
  const banText = $('emailBannerText');
  if (banner) {
    if (emails.length) {
      banner.classList.remove('hidden');
      banText.textContent = tt('seller.emails.found').replace('{n}', emails.length);
    } else {
      banner.classList.remove('hidden');
      banText.textContent = tt('seller.emails.none');
    }
  }
  const list = $('mailList');
  if (!emails.length) {
    list.innerHTML = `<div class="sw-empty"><h3>${tt('me.noCode')}</h3><p>${tt('me.tryAgain')}</p></div>`;
    return;
  }
  list.innerHTML = emails.map((m, i) => mailCardHtml(m, i, emails.length, accountEmail)).join('');
  list.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', () => copyText(b.dataset.copy)));
}

function mailCardHtml(m, i, total, accountEmail) {
  const code = m.extracted_code || '';
  const fam = m.family_code || '';
  const reset = m.reset_link || '';
  const time = m.time ? new Date(m.time).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
  const tag = i === 0 ? tt('seller.emails.latest') : `#${i + 1}`;

  let body = '';
  let label = '';
  let value = '';
  if (code) { label = tt('me.loginCode'); value = code; }
  else if (fam) { label = tt('me.household'); value = fam; }
  else if (reset) { label = tt('me.resetLink'); value = reset.length > 40 ? reset.slice(0, 40) + '…' : reset; }
  else { value = esc(m.subject || ''); }

  if (value) {
    const spaced = code ? value.split('').join(' ') : value;
    body = `
      <div class="mc-body">
        <div>
          <div class="mc-label">${label}</div>
          <div class="mc-code">${esc(spaced)}</div>
        </div>
        <button type="button" class="mc-copy" data-copy="${esc(value)}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          ${tt('common.copy')}
        </button>
      </div>`;
  }

  return `
    <div class="sw-mail-card">
      <div class="mc-head">
        <span class="mc-tag">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
          ${tag} / ${total}
        </span>
        <span class="mc-time">${esc(time)}</span>
      </div>
      <div class="mc-meta">Email: ${esc(accountEmail)} · ${esc(m.subject || 'Netflix')}</div>
      ${body}
    </div>`;
}
