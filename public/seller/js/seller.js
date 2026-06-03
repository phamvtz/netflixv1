'use strict';

const meHost = location.host.replace(/^seller\./, 'me.');
const meUrl = location.protocol + '//' + meHost + '/';

let pendingAccountId = null;
let allKeys = [];
let keyStatusFilter = 'all';
let keyChips;

const $ = (id) => document.getElementById(id);

function show(el, on) {
  $(el).classList.toggle('hidden', !on);
}

function setErr(id, msg) {
  const e = $(id);
  e.textContent = msg || '';
  e.style.display = msg ? 'block' : 'none';
}

function setOk(id, msg) {
  const e = $(id);
  e.textContent = msg || '';
  e.style.display = msg ? 'block' : 'none';
}

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.style.display = 'block';
  clearTimeout(t._t);
  t._t = setTimeout(() => { t.style.display = 'none'; }, 2600);
}

async function copyText(s) {
  try {
    await navigator.clipboard.writeText(s);
    toast('Đã sao chép');
  } catch {}
}

async function api(url, body, method) {
  const opt = { method: method || (body ? 'POST' : 'GET'), headers: {} };
  if (body) {
    opt.headers['Content-Type'] = 'application/json';
    opt.body = JSON.stringify(body);
  }
  const r = await fetch(url, opt);
  let d = {};
  try {
    d = await r.json();
  } catch {}
  return { status: r.status, ...d };
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&#39;');
}

function showTab(t) {
  $('tabLogin').classList.toggle('active', t === 'login');
  $('tabReg').classList.toggle('active', t === 'reg');
  show('paneLogin', t === 'login');
  show('paneReg', t === 'reg');
  show('paneVerify', false);
}

async function doLogin() {
  setErr('lgErr');
  setOk('lgOk');
  const username = $('lgUser').value.trim();
  const password = $('lgPass').value;
  if (!username || !password) return setErr('lgErr', 'Nhập username và mật khẩu.');
  $('lgBtn').disabled = true;
  const d = await api('/api/panel/login', { username, password });
  $('lgBtn').disabled = false;
  if (d.success) {
    if (d.account.role !== 'seller') return setErr('lgErr', 'Tài khoản này không phải seller.');
    return enterDash(d.account);
  }
  if (d.needVerify) {
    pendingAccountId = d.accountId;
    openVerify($('lgUser').value);
    return setErr('lgErr', 'Tài khoản chưa xác minh email — nhập mã bên dưới.');
  }
  setErr('lgErr', d.error || 'Đăng nhập thất bại.');
}

async function doRegister() {
  setErr('rgErr');
  const username = $('rgUser').value.trim();
  const email = $('rgEmail').value.trim();
  const password = $('rgPass').value;
  if (username.length < 3) return setErr('rgErr', 'Username tối thiểu 3 ký tự.');
  if (!email.includes('@')) return setErr('rgErr', 'Email không hợp lệ.');
  if (password.length < 6) return setErr('rgErr', 'Mật khẩu tối thiểu 6 ký tự.');
  $('rgBtn').disabled = true;
  const d = await api('/api/seller/register', { username, email, password });
  $('rgBtn').disabled = false;
  if (!d.success) return setErr('rgErr', d.error || 'Đăng ký thất bại.');
  pendingAccountId = d.accountId;
  openVerify(email);
  if (!d.emailSent) toast('SMTP chưa cấu hình — xem mã trong console server.');
}

function openVerify(email) {
  show('paneLogin', false);
  show('paneReg', false);
  show('paneVerify', true);
  $('vEmail').textContent = email || '';
  setErr('vErr');
  setOk('vOk');
}

async function doVerify() {
  setErr('vErr');
  setOk('vOk');
  const code = $('vCode').value.trim();
  if (!/^\d{6}$/.test(code)) return setErr('vErr', 'Mã gồm 6 chữ số.');
  $('vBtn').disabled = true;
  const d = await api('/api/seller/verify-email', { accountId: pendingAccountId, code });
  $('vBtn').disabled = false;
  if (!d.success) return setErr('vErr', d.error || 'Xác minh thất bại.');
  setOk('vOk', '✓ Xác minh thành công! Tài khoản đang chờ admin duyệt.');
  setTimeout(() => {
    showTab('login');
    setErr('lgErr');
    setOk('lgOk', 'Đã xác minh — chờ admin duyệt rồi đăng nhập.');
  }, 1800);
}

async function doResend() {
  const d = await api('/api/seller/resend-code', { accountId: pendingAccountId });
  if (d.success) toast(d.emailSent ? 'Đã gửi lại mã.' : 'SMTP chưa cấu hình — xem mã ở console server.');
  else toast(d.error || 'Lỗi gửi lại mã.');
}

function enterDash(acct) {
  show('authView', false);
  show('dashView', true);
  show('logoutLink', true);
  $('acctName').textContent = acct.username;
  $('acctEmail').textContent = acct.email || '';
  loadDash();
}

async function loadDash() {
  const d = await api('/api/seller/keys');
  if (!d.success) {
    allKeys = [];
  } else {
    allKeys = d.keys || [];
    $('smTotal').textContent = d.summary.total;
    $('smUsed').textContent = d.summary.used;
    $('smUnused').textContent = d.summary.unused;
  }
  renderKeys();
}

function renderKeys() {
  const q = $('kSearch')?.value || '';
  const rows = PanelFilters.filterListEx(allKeys, {
    q,
    status: keyStatusFilter,
    searchFields: ['key', 'email', 'note'],
    getStatus: (k) => (k.usedCount > 0 ? 'used' : 'new'),
  });

  const body = $('kBody');
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="4" class="panel-empty">${allKeys.length ? 'Không khớp tìm kiếm' : 'Chưa có key nào'}</td></tr>`;
    return;
  }
  body.innerHTML = rows
    .map(
      (k) => `
        <tr>
          <td class="mono">${esc(k.key)}${k.note ? `<div class="note-sub">${esc(k.note)}</div>` : ''}</td>
          <td>${esc(k.email)}</td>
          <td><span class="panel-badge ${k.usedCount > 0 ? 'panel-badge--used' : 'panel-badge--new'}">${k.usedCount > 0 ? k.usedCount + '×' : 'mới'}</span></td>
          <td><button class="panel-btn panel-btn--sm" onclick="copyText('${esc(k.key)}')">Copy</button></td>
        </tr>`
    )
    .join('');
}

async function createKey() {
  setErr('ckErr');
  const email = $('ckEmail').value.trim();
  const note = $('ckNote').value.trim();
  if (!email.includes('@')) return setErr('ckErr', 'Email không hợp lệ.');
  $('ckBtn').disabled = true;
  const d = await api('/api/key/register', { email, note });
  $('ckBtn').disabled = false;
  if (!d.success) return setErr('ckErr', d.error || 'Lỗi tạo key.');
  $('ckKeyVal').textContent = d.key;
  show('ckResult', true);
  $('ckEmail').value = '';
  $('ckNote').value = '';
  toast('Đã tạo key. Khách nhập tại: ' + meUrl);
  loadDash();
}

async function logout() {
  await api('/api/panel/logout', {});
  location.reload();
}

function initFilters() {
  keyChips = PanelFilters.bindChipBar($('keyFilterBar'), [
    { id: 'all', label: 'Tất cả' },
    { id: 'new', label: 'Mới' },
    { id: 'used', label: 'Đã dùng' },
  ], (status) => {
    keyStatusFilter = status;
    renderKeys();
  });
}

window.showTab = showTab;
window.doLogin = doLogin;
window.doRegister = doRegister;
window.doVerify = doVerify;
window.doResend = doResend;
window.createKey = createKey;
window.logout = logout;
window.copyText = copyText;
window.renderKeys = renderKeys;

document.addEventListener('DOMContentLoaded', () => {
  $('meLink').href = meUrl;
  initFilters();
  (async () => {
    const d = await api('/api/panel/me');
    if (d.success && d.account.role === 'seller' && d.account.status === 'active') {
      enterDash(d.account);
    }
  })();
});
