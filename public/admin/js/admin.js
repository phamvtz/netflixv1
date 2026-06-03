'use strict';

let TOKEN = sessionStorage.getItem('adminToken') || '';
let allKeys = [];
let allSellers = [];
let keyStatusFilter = 'all';
let sellerStatusFilter = 'all';
let keyChips;
let sellerChips;

const $ = (id) => document.getElementById(id);

function show(el, on) {
  $(el).classList.toggle('hidden', !on);
}

function toast(m) {
  const t = $('toast');
  t.textContent = m;
  t.style.display = 'block';
  clearTimeout(t._t);
  t._t = setTimeout(() => { t.style.display = 'none'; }, 2600);
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&#39;');
}

function authHeaders(extra) {
  const h = Object.assign({}, extra || {});
  if (TOKEN) h['X-Admin-Token'] = TOKEN;
  return h;
}

function fmtTs(sec) {
  try {
    return new Date(sec * 1000).toLocaleDateString('vi-VN');
  } catch {
    return '—';
  }
}

async function jget(url) {
  const r = await fetch(url, { headers: authHeaders() });
  return r.ok ? r.json() : { success: false, status: r.status };
}

async function jpost(url, body) {
  const h = authHeaders({ 'Content-Type': 'application/json' });
  const r = await fetch(url, { method: 'POST', headers: h, body: body ? JSON.stringify(body) : undefined });
  return r.ok ? r.json() : { success: false, status: r.status };
}

async function jpatch(url, body) {
  const r = await fetch(url, {
    method: 'PATCH',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  return r.ok ? r.json() : { success: false, status: r.status };
}

function sellerPermBadges(s) {
  const b = (on, l) => `<span class="perm-badge ${on ? 'perm-badge--on' : 'perm-badge--off'}">${l}</span>`;
  return `<div class="perm-badges">${b(s.permLogin, 'ĐN')}${b(s.permReset, 'Reset')}${b(s.permFamily, 'GĐ')}</div>`;
}

function toggleTokenMode(on) {
  show('acctLogin', !on);
  show('tokenLogin', on);
  $('loginErr').style.display = 'none';
}

async function login() {
  const username = $('username').value.trim();
  const password = $('password').value;
  const err = $('loginErr');
  err.style.display = 'none';
  if (!username || !password) {
    err.textContent = 'Nhập username và mật khẩu.';
    err.style.display = 'block';
    return;
  }
  try {
    const r = await fetch('/api/panel/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const d = await r.json();
    if (!d.success) throw new Error(d.error || 'Đăng nhập thất bại');
    if (d.account.role !== 'admin') throw new Error('Tài khoản này không phải admin.');
    TOKEN = '';
    sessionStorage.removeItem('adminToken');
    showDash();
  } catch (e) {
    err.textContent = e.message;
    err.style.display = 'block';
  }
}

async function loginToken() {
  const t = $('token').value.trim();
  const err = $('loginErr');
  err.style.display = 'none';
  try {
    const r = await fetch('/api/admin/stats', { headers: { 'X-Admin-Token': t } });
    if (r.status === 401) throw new Error('Token sai');
    if (!r.ok) throw new Error('Lỗi ' + r.status);
    TOKEN = t;
    sessionStorage.setItem('adminToken', t);
    showDash();
  } catch (e) {
    err.textContent = e.message;
    err.style.display = 'block';
  }
}

async function logout() {
  sessionStorage.removeItem('adminToken');
  TOKEN = '';
  try {
    await fetch('/api/panel/logout', { method: 'POST' });
  } catch {}
  location.reload();
}

async function showDash() {
  show('loginCard', false);
  show('dash', true);
  await loadAll();
}

async function loadAll() {
  await Promise.all([loadStats(), loadSellers(), loadKeys(), loadUsers()]);
}

async function loadStats() {
  const d = await jget('/api/admin/stats');
  const s = d.stats || {};
  const items = [
    ['Users', s.users, false],
    ['Profiles', s.profiles, false],
    ['Sessions', s.sessions, false],
    ['Content', s.content, false],
    ['Keys', s.keys, false],
    ['Keys đã dùng', s.keysUsed, false],
    ['Sellers', s.sellers, false],
    ['Chờ duyệt', s.pendingSellers, s.pendingSellers > 0],
  ];
  $('stats').innerHTML = items
    .map(
      ([l, n, hot]) =>
        `<div class="panel-stat"><div class="panel-stat-num ${hot ? 'hot' : ''}">${n ?? 0}</div><div class="panel-stat-label">${l}</div></div>`
    )
    .join('');
}

async function loadSellers() {
  const d = await jget('/api/admin/sellers');
  const pending = d.pending || [];
  allSellers = d.sellers || [];

  show('pendingSec', pending.length > 0);
  $('pendCount').textContent = pending.length;
  $('pendBody').innerHTML = pending
    .map(
      (s) => `
        <tr>
          <td>${esc(s.username)}</td><td>${esc(s.email)}</td><td>${fmtTs(s.createdAt)}</td>
          <td style="white-space:nowrap">
            <button class="panel-btn panel-btn--sm panel-btn--green" onclick="approve('${esc(s.id)}', '${esc(s.username)}')">✓ Duyệt</button>
            <button class="panel-btn panel-btn--sm panel-btn--red" onclick="reject('${esc(s.id)}')">✕ Từ chối</button>
          </td>
        </tr>`
    )
    .join('');

  renderSellers();
}

function renderSellers() {
  const q = $('sellerSearch')?.value || '';
  const rows = PanelFilters.filterListEx(allSellers, {
    q,
    status: sellerStatusFilter,
    searchFields: ['username', 'email', (s) => s.status],
    getStatus: (s) => s.status,
  });

  $('sellerCount').textContent = rows.length;
  const body = $('sellersBody');
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="4" class="panel-empty">${allSellers.length ? 'Không khớp filter' : 'Chưa có seller'}</td></tr>`;
    return;
  }
  body.innerHTML = rows
    .map((s) => {
      const cls =
        s.status === 'active' ? 'panel-badge--active' : s.status === 'rejected' ? 'panel-badge--rejected' : 'panel-badge--pending';
      const act =
        s.status !== 'active'
          ? `<button class="panel-btn panel-btn--sm panel-btn--green" onclick="approve('${esc(s.id)}', '${esc(s.username)}')">Duyệt</button>`
          : `<button class="panel-btn panel-btn--sm panel-btn--ghost" onclick="editSellerPerms('${esc(s.id)}', '${esc(s.username)}')">Quyền</button>
             <button class="panel-btn panel-btn--sm panel-btn--green" onclick="topupSeller('${esc(s.id)}', '${esc(s.username)}')">Nạp tiền</button>
             <button class="panel-btn panel-btn--sm panel-btn--red" onclick="reject('${esc(s.id)}')">Khoá</button>`;
      const perms = s.status === 'active' ? sellerPermBadges(s) : '';
      return `<tr><td>${esc(s.username)}</td><td>${esc(s.email)}</td>
              <td><span class="panel-badge ${cls}">${s.status}${s.emailVerified ? '' : ' · chưa verify'}</span>${perms ? '<br>' + perms : ''}</td>
              <td>${act}</td></tr>`;
    })
    .join('');
}

async function pickSellerPerms(username) {
  const login = confirm(`Seller "${username}" — cho phép Mã đăng nhập?\nOK = có, Cancel = không`);
  const reset = confirm(`Cho phép Link đổi mật khẩu?`);
  const family = confirm(`Cho phép Mã hộ gia đình?`);
  return { permLogin: login, permReset: reset, permFamily: family };
}

async function approve(id, username) {
  const perms = await pickSellerPerms(username || id);
  const d = await jpost('/api/admin/sellers/' + encodeURIComponent(id) + '/approve', perms);
  if (d.success) {
    toast('Đã duyệt seller');
    loadSellers();
    loadStats();
  } else toast('Lỗi duyệt');
}

async function topupSeller(id, username) {
  const raw = prompt(`Nạp tiền cho seller "${username}" (VNĐ):`, '300000');
  if (raw == null) return;
  const amount = parseInt(String(raw).replace(/\D/g, ''), 10);
  if (!amount || amount < 1000) return toast('Số tiền tối thiểu 1.000đ');
  const r = await fetch('/api/admin/sellers/' + encodeURIComponent(id) + '/topup', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ amount, description: 'Admin nạp tiền' }),
  });
  const d = await r.json();
  if (d.success) toast('Đã nạp ' + amount.toLocaleString('vi-VN') + 'đ — số dư: ' + (d.balance || 0).toLocaleString('vi-VN') + 'đ');
  else toast(d.error || 'Lỗi nạp');
}

async function editSellerPerms(id, username) {
  const perms = await pickSellerPerms(username || id);
  const d = await jpatch('/api/admin/sellers/' + encodeURIComponent(id) + '/perms', perms);
  if (d.success) {
    toast('Đã cập nhật quyền seller');
    loadSellers();
  } else toast(d.error || 'Lỗi cập nhật');
}

async function reject(id) {
  if (!confirm('Từ chối / khoá seller này?')) return;
  const d = await jpost('/api/admin/sellers/' + encodeURIComponent(id) + '/reject');
  if (d.success) {
    toast('Đã cập nhật');
    loadSellers();
    loadStats();
  } else toast('Lỗi');
}

async function loadKeys() {
  const d = await jget('/api/admin/keys');
  allKeys = d.keys || [];
  renderKeys();
}

function renderKeys() {
  const q = $('keySearch')?.value || '';
  const rows = PanelFilters.filterListEx(allKeys, {
    q,
    status: keyStatusFilter,
    searchFields: ['key', 'email', 'sellerUsername', 'note'],
    getStatus: (k) => (k.usedCount > 0 ? 'used' : 'unused'),
  });

  $('keyCount').textContent = rows.length;
  const body = $('keysBody');
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="5" class="panel-empty">${allKeys.length ? 'Không khớp' : 'Chưa có key'}</td></tr>`;
    return;
  }
  body.innerHTML = rows
    .map(
      (k) => `
        <tr>
          <td class="mono">${esc(k.key)}${k.keyName ? `<div class="note-sub">${esc(k.keyName)}</div>` : ''}${k.note ? `<div class="note-sub">${esc(k.note)}</div>` : ''}</td>
          <td>${esc(k.email)}<br>${sellerPermBadges(k)}</td>
          <td>${k.sellerUsername ? esc(k.sellerUsername) : '<span style="color:var(--t3)">—</span>'}</td>
          <td>${k.usedCount}</td>
          <td><button class="panel-btn panel-btn--sm panel-btn--red" onclick="delKey('${esc(k.key)}')">Xoá</button></td>
        </tr>`
    )
    .join('');
}

async function delKey(key) {
  if (!confirm('Xoá key ' + key + '?')) return;
  await fetch('/api/admin/keys/' + encodeURIComponent(key), { method: 'DELETE', headers: authHeaders() });
  await loadKeys();
  await loadStats();
}

async function loadUsers() {
  const d = await jget('/api/admin/users');
  const users = d.users || [];
  $('usersBody').innerHTML = users
    .map(
      (u) =>
        `<tr><td class="mono">${esc(u.id)}</td><td>${esc(u.email)}</td><td>${esc(u.name)}</td><td>${esc(u.plan)}</td></tr>`
    )
    .join('');
}

function initFilters() {
  keyChips = PanelFilters.bindChipBar($('keyFilterBar'), [
    { id: 'all', label: 'Tất cả' },
    { id: 'unused', label: 'Chưa dùng' },
    { id: 'used', label: 'Đã dùng' },
  ], (status) => {
    keyStatusFilter = status;
    renderKeys();
  });

  sellerChips = PanelFilters.bindChipBar($('sellerFilterBar'), [
    { id: 'all', label: 'Tất cả' },
    { id: 'active', label: 'Active' },
    { id: 'pending', label: 'Pending' },
    { id: 'rejected', label: 'Rejected' },
  ], (status) => {
    sellerStatusFilter = status;
    renderSellers();
  });
}

window.login = login;
window.loginToken = loginToken;
window.logout = logout;
window.toggleTokenMode = toggleTokenMode;
window.approve = approve;
window.editSellerPerms = editSellerPerms;
window.topupSeller = topupSeller;
window.reject = reject;
window.delKey = delKey;
window.renderKeys = renderKeys;
window.renderSellers = renderSellers;

document.addEventListener('DOMContentLoaded', () => {
  initFilters();
  (async () => {
    if (TOKEN) {
      showDash();
      return;
    }
    const r = await fetch('/api/panel/me');
    if (r.ok) {
      const d = await r.json();
      if (d.success && d.account.role === 'admin') showDash();
    }
  })();
});
