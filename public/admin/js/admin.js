'use strict';

const tt = (k, v) => (typeof I18n !== 'undefined' ? I18n.t(k, v) : k);

let TOKEN = sessionStorage.getItem('adminToken') || '';
let allKeys = [];
let allSellers = [];
let allProducts = [];
let allUnmatchedDeposits = [];
let keyStatusFilter = 'all';
let sellerStatusFilter = 'all';
let productStatusFilter = 'all';
let keyChips;
let sellerChips;
let productChips;
let editingProductId = null;

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
    return new Date(sec * 1000).toLocaleDateString(window.I18n?.locale?.() || 'vi-VN');
  } catch {
    return '—';
  }
}

function fmtVnd(n) {
  return new Intl.NumberFormat('vi-VN').format(n || 0) + ' đ';
}

async function jget(url) {
  const r = await fetch(url, { headers: authHeaders() });
  if (r.status === 401) { forceLogout(); return { success: false, status: 401 }; }
  return r.ok ? r.json() : { success: false, status: r.status };
}

async function jpost(url, body) {
  const h = authHeaders({ 'Content-Type': 'application/json' });
  const r = await fetch(url, { method: 'POST', headers: h, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401) { forceLogout(); return { success: false, status: 401 }; }
  return r.ok ? r.json() : { success: false, status: r.status };
}

async function jpatch(url, body) {
  const r = await fetch(url, {
    method: 'PATCH',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  if (r.status === 401) { forceLogout(); return { success: false, status: 401 }; }
  return r.ok ? r.json() : { success: false, status: r.status };
}

// Xoá token lỗi thời và quay về màn login
function forceLogout() {
  sessionStorage.removeItem('adminToken');
  TOKEN = '';
  show('dash', false);
  show('loginCard', true);
  const err = $('loginErr');
  if (err) {
    err.textContent = 'Phiên đã hết hạn hoặc token không hợp lệ. Vui lòng đăng nhập lại.';
    err.style.display = 'block';
  }
  // Restore URL
  history.replaceState(null, '', '/admin');
}

function sellerPermBadges(s) {
  const b = (on, l) => `<span class="perm-badge ${on ? 'perm-badge--on' : 'perm-badge--off'}">${l}</span>`;
  return `<div class="perm-badges">${b(s.permLogin, tt('perm.login'))}${b(s.permReset, tt('perm.reset'))}${b(s.permFamily, tt('perm.family'))}</div>`;
}

function toggleTokenMode(on) {
  show('acctLogin', !on);
  show('tokenLogin', on);
  const errEl = $('loginErr');
  if (errEl) errEl.style.display = 'none';
  $('tabAcct')?.classList.toggle('active', !on);
  $('tabTok')?.classList.toggle('active', !!on);
}

async function login() {
  const username = $('username').value.trim();
  const password = $('password').value;
  const err = $('loginErr');
  err.style.display = 'none';
  if (!username || !password) {
    err.textContent = 'Enter username and password.';
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
    if (!d.success) throw new Error(d.error || 'Log in failed');
    if (d.account.role !== 'admin') throw new Error('This account is not an admin.');
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
    if (r.status === 401) throw new Error('Invalid token');
    if (!r.ok) throw new Error('Error ' + r.status);
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

// ── URL Routing ─────────────────────────────────────────────────
const TAB_SLUGS = {
  overview: 'overview',
  sellers:  'sellers',
  products: 'products',
  keys:     'keys',
  users:    'users',
};
const SLUG_TO_TAB = Object.fromEntries(Object.entries(TAB_SLUGS).map(([k, v]) => [v, k]));

function getTabFromUrl() {
  const path = window.location.pathname;           // e.g. /admin/sellers
  const parts = path.split('/').filter(Boolean);   // ['admin', 'sellers']
  const slug = parts[1] || 'overview';
  return SLUG_TO_TAB[slug] || 'overview';
}

function setTabUrl(tabName) {
  const slug = TAB_SLUGS[tabName] || 'overview';
  const newPath = `/admin/${slug}`;
  if (window.location.pathname !== newPath) {
    history.pushState({ tab: tabName }, '', newPath);
  }
}

// Handle browser back/forward
window.addEventListener('popstate', (e) => {
  const tab = e.state?.tab || getTabFromUrl();
  switchAdminTab(tab, false); // false = don't push URL again
});

async function showDash() {
  show('loginCard', false);
  show('dash', true);
  // Load tab hiện tại ngay lập tức, load phần còn lại nền
  const tab = getTabFromUrl();
  switchAdminTab(tab, false);
  await loadTabData(tab);           // load data của tab đang hiện
  loadAll();                        // load phần còn lại ở nền
}

// Load data chỉ cho tab đang active
async function loadTabData(tabName) {
  if (tabName === 'overview') return Promise.all([loadStats(), loadSellers()]);
  if (tabName === 'sellers')  return Promise.all([loadStats(), loadSellers()]);
  if (tabName === 'products') return loadProducts();
  if (tabName === 'keys')     return loadKeys();
  if (tabName === 'deposits') return loadDeposits();
  if (tabName === 'users')    return loadUsers();
}

function switchAdminTab(tabName, pushUrl = true) {
  if (pushUrl) setTabUrl(tabName);
  sessionStorage.setItem('activeAdminTab', tabName);

  const buttons = document.querySelectorAll('#adminSubNav .subnav-btn');
  buttons.forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-target') === tabName);
  });

  const showOverview = tabName === 'overview';
  const showSellers  = tabName === 'sellers';
  const showProducts = tabName === 'products';
  const showKeys     = tabName === 'keys';
  const showDeposits = tabName === 'deposits';
  const showUsers    = tabName === 'users';

  show('stats', showOverview);
  const pendingCount = parseInt($('pendCount')?.textContent || '0', 10);
  show('pendingSec', (showOverview || showSellers) && pendingCount > 0);
  show('secSellers',  showSellers);
  show('secProducts', showProducts);
  show('secKeys',     showKeys);
  show('secDeposits', showDeposits);
  show('secUsers',    showUsers);

  // Lazy load: nếu data chưa được load cho tab này
  loadTabData(tabName);
}
async function loadAll() {
  await Promise.all([loadStats(), loadSellers(), loadKeys(), loadUsers(), loadProducts()]);
}

async function loadStats() {
  const d = await jget('/api/admin/stats');
  const s = d.stats || {};
  const labels = typeof I18n !== 'undefined' ? I18n.adminStatLabels() : [];
  const vals = [s.users, s.profiles, s.sessions, s.content, s.keys, s.keysUsed, s.sellers, s.pendingSellers];
  const items = labels.map((l, i) => [l, vals[i], i === 7 && s.pendingSellers > 0]);
  $('stats').innerHTML = items
    .map(
      ([l, n, hot]) =>
        `<div class="panel-stat"><div class="panel-stat-num ${hot ? 'hot' : ''}">${n ?? 0}</div><div class="panel-stat-label">${l}</div></div>`
    )
    .join('');

  // Render 3D charts with real data
  initCharts3D(s, labels, vals);
}

// ── 3D ECharts ──────────────────────────────────────────────────
let _chart3dBar = null;
let _chart3dPie = null;

function initCharts3D(s, labels, vals) {
  if (typeof echarts === 'undefined') return;

  // ── Chart 1: 3D Bar ───────────────────────────────────────────
  const barEl = $('chart3dBar');
  if (barEl) {
    if (_chart3dBar) _chart3dBar.dispose();
    _chart3dBar = echarts.init(barEl, null, { renderer: 'canvas' });

    const categories = labels.slice(0, 7);  // bỏ pendingSellers
    const barData = vals.slice(0, 7);

    // Màu gradient cho từng cột
    const colors = [
      ['#3b82f6', '#1d4ed8'],
      ['#8b5cf6', '#6d28d9'],
      ['#06b6d4', '#0e7490'],
      ['#10b981', '#059669'],
      ['#f59e0b', '#d97706'],
      ['#ef4444', '#dc2626'],
      ['#ec4899', '#db2777'],
    ];

    _chart3dBar.setOption({
      backgroundColor: 'transparent',
      grid3D: {
        boxWidth: 200,
        boxHeight: 80,
        boxDepth: 60,
        viewControl: {
          autoRotate: true,
          autoRotateSpeed: 5,
          distance: 220,
          beta: 20,
          alpha: 22,
          rotateSensitivity: 1,
          zoomSensitivity: 0.5,
        },
        light: {
          main: { intensity: 1.5, shadow: true, shadowQuality: 'high' },
          ambient: { intensity: 0.4 },
        },
        postEffect: {
          enable: true,
          bloom: { enable: true, bloomIntensity: 0.08 },
          SSAO: { enable: true, radius: 4, quality: 'medium', intensity: 1.2 },
        },
      },
      xAxis3D: {
        type: 'category',
        data: categories,
        axisLabel: { fontSize: 10, color: '#a3a3a3', margin: 8 },
        axisLine: { lineStyle: { color: '#2a2a2a' } },
        axisTick: { show: false },
        splitLine: { show: false },
      },
      yAxis3D: {
        type: 'value',
        axisLabel: { fontSize: 9, color: '#6b6b6b' },
        axisLine: { lineStyle: { color: '#2a2a2a' } },
        splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
      },
      zAxis3D: { type: 'value', show: false },
      series: [{
        type: 'bar3D',
        data: categories.map((cat, i) => ({
          value: [i, barData[i] ?? 0, 0],
          itemStyle: {
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: colors[i][0] },
                { offset: 1, color: colors[i][1] },
              ],
            },
            opacity: 0.92,
          },
        })),
        label: {
          show: true,
          position: 'top',
          formatter: (p) => p.value[1],
          fontSize: 11,
          fontWeight: 700,
          color: '#f5f5f5',
          distance: 2,
        },
        shading: 'lambert',
        barSize: 18,
      }],
      tooltip: {
        show: true,
        formatter: (p) => `<b>${p.value[0] !== undefined ? categories[p.value[0]] : ''}</b>: ${p.value[1]}`,
        backgroundColor: '#141414',
        borderColor: '#2a2a2a',
        textStyle: { color: '#f5f5f5', fontSize: 12 },
      },
    });

    window.addEventListener('resize', () => _chart3dBar?.resize());
  }

  // ── Chart 2: 3D Pie (keys used vs unused) ─────────────────────
  const pieEl = $('chart3dPie');
  if (pieEl) {
    if (_chart3dPie) _chart3dPie.dispose();
    _chart3dPie = echarts.init(pieEl, null, { renderer: 'canvas' });

    const keysTotal  = s.keys      ?? 0;
    const keysUsed   = s.keysUsed  ?? 0;
    const keysUnused = Math.max(0, keysTotal - keysUsed);

    const pieColors = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444'];
    const pieSlices = [
      { name: 'Key đã dùng',   value: keysUsed,                  color: '#3b82f6' },
      { name: 'Key chưa dùng', value: keysUnused,                color: '#10b981' },
      { name: 'Users',         value: s.users    ?? 0,           color: '#8b5cf6' },
      { name: 'Sellers',       value: s.sellers  ?? 0,           color: '#f59e0b' },
      { name: 'Sessions',      value: s.sessions ?? 0,           color: '#06b6d4' },
    ].filter(p => p.value > 0);

    _chart3dPie.setOption({
      backgroundColor: 'transparent',
      legend: {
        orient: 'vertical',
        right: '5%',
        top: 'center',
        textStyle: { fontSize: 11, color: '#64748b' },
        icon: 'circle',
        itemWidth: 10,
        itemHeight: 10,
      },
      series: [{
        type: 'pie',
        radius: ['38%', '68%'],
        center: ['42%', '52%'],
        data: pieSlices.map((p) => ({
          name: p.name,
          value: p.value,
          itemStyle: { color: p.color, borderRadius: 6 },
        })),
        label: {
          show: true,
          formatter: '{b}\n{d}%',
          fontSize: 10,
          color: '#f5f5f5',
          fontWeight: 600,
        },
        labelLine: { length: 12, length2: 8 },
        emphasis: {
          scale: true,
          scaleSize: 8,
          itemStyle: { shadowBlur: 20, shadowColor: 'rgba(0,0,0,0.2)' },
        },
        animationType: 'scale',
        animationEasing: 'elasticOut',
        animationDelay: (i) => i * 60,
      }],
      tooltip: {
        trigger: 'item',
        formatter: '{b}: {c} ({d}%)',
        backgroundColor: '#141414',
        borderColor: '#2a2a2a',
        textStyle: { color: '#f5f5f5', fontSize: 12 },
      },
    });

    window.addEventListener('resize', () => _chart3dPie?.resize());
  }
}

async function loadSellers() {
  const d = await jget('/api/admin/sellers');
  const pending = d.pending || [];
  allSellers = d.sellers || [];

  const pendingCount = pending.length;
  $('pendCount').textContent = pendingCount;
  const activeTab = sessionStorage.getItem('activeAdminTab') || 'overview';
  show('pendingSec', (activeTab === 'overview' || activeTab === 'sellers') && pendingCount > 0);
  $('pendBody').innerHTML = pending
    .map(
      (s) => `
        <tr>
          <td>${esc(s.username)}</td><td>${esc(s.email)}</td><td>${fmtTs(s.createdAt)}</td>
          <td style="white-space:nowrap">
            <button class="panel-btn panel-btn--sm panel-btn--green" onclick="approve('${esc(s.id)}', '${esc(s.username)}')">✓ Approve</button>
            <button class="panel-btn panel-btn--sm panel-btn--red" onclick="reject('${esc(s.id)}')">✕ Reject</button>
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
    body.innerHTML = `<tr><td colspan="4" class="panel-empty">${allSellers.length ? 'No matches for filter' : 'No sellers yet'}</td></tr>`;
    return;
  }
  body.innerHTML = rows
    .map((s) => {
      const cls =
        s.status === 'active' ? 'panel-badge--active' : s.status === 'rejected' ? 'panel-badge--rejected' : 'panel-badge--pending';
      const act =
        s.status !== 'active'
          ? `<button class="panel-btn panel-btn--sm panel-btn--green" onclick="approve('${esc(s.id)}', '${esc(s.username)}')">Approve</button>`
          : `<button class="panel-btn panel-btn--sm panel-btn--ghost" onclick="editSellerPerms('${esc(s.id)}', '${esc(s.username)}')">Permissions</button>
             <button class="panel-btn panel-btn--sm panel-btn--ghost" onclick="openGrantOrder('${esc(s.id)}', '${esc(s.username)}')">${tt('admin.grantOrder')}</button>
             <button class="panel-btn panel-btn--sm panel-btn--green" onclick="topupSeller('${esc(s.id)}', '${esc(s.username)}')">Top up</button>
             <button class="panel-btn panel-btn--sm panel-btn--red" onclick="reject('${esc(s.id)}')">Lock</button>`;
      const perms = s.status === 'active' ? sellerPermBadges(s) : '';
      return `<tr><td>${esc(s.username)}</td><td>${esc(s.email)}</td>
              <td><span class="panel-badge ${cls}">${s.status}${s.emailVerified ? '' : ' · not verified'}</span>${perms ? '<br>' + perms : ''}</td>
              <td>${act}</td></tr>`;
    })
    .join('');
}

// ── Permissions Modal (replaces ugly confirm() dialogs) ─────────
let _permsResolve = null;

function openPermsModal(title, sub, defaults = {}) {
  return new Promise((resolve) => {
    _permsResolve = resolve;
    $('permsModalTitle').textContent = title;
    $('permsModalSub').textContent = sub || 'Chọn quyền truy cập cho seller.';
    $('permLoginCheck').checked  = !!defaults.permLogin;
    $('permResetCheck').checked  = !!defaults.permReset;
    $('permFamilyCheck').checked = !!defaults.permFamily;
    $('permsModal').classList.add('show');
  });
}

function closePermsModal() {
  $('permsModal').classList.remove('show');
  if (_permsResolve) { _permsResolve(null); _permsResolve = null; }
}

function confirmPerms() {
  const result = {
    permLogin:  $('permLoginCheck').checked,
    permReset:  $('permResetCheck').checked,
    permFamily: $('permFamilyCheck').checked,
  };
  $('permsModal').classList.remove('show');
  if (_permsResolve) { _permsResolve(result); _permsResolve = null; }
}

async function approve(id, username) {
  const perms = await openPermsModal(
    `Duyệt: ${username}`,
    `Cấp quyền cho seller "${username}". Có thể thay đổi sau.`,
    { permLogin: true, permReset: true, permFamily: true }
  );
  if (!perms) return; // cancelled
  const d = await jpost('/api/admin/sellers/' + encodeURIComponent(id) + '/approve', perms);
  if (d.success) { toast('✓ Seller đã được duyệt'); loadSellers(); loadStats(); }
  else toast('Lỗi: ' + (d.error || 'Approve failed'));
}

async function editSellerPerms(id, username) {
  const seller = allSellers.find((s) => s.id === id) || {};
  const perms = await openPermsModal(
    `Quyền: ${username}`,
    `Chỉnh sửa quyền truy cập cho seller "${username}".`,
    { permLogin: seller.permLogin, permReset: seller.permReset, permFamily: seller.permFamily }
  );
  if (!perms) return;
  const d = await jpatch('/api/admin/sellers/' + encodeURIComponent(id) + '/perms', perms);
  if (d.success) { toast('✓ Cập nhật quyền thành công'); loadSellers(); }
  else toast(d.error || 'Update failed');
}

async function reject(id) {
  if (!confirm('Khóa / từ chối seller này?')) return;
  const d = await jpost('/api/admin/sellers/' + encodeURIComponent(id) + '/reject');
  if (d.success) { toast('Đã cập nhật'); loadSellers(); loadStats(); }
  else toast('Lỗi');
}

async function topupSeller(id, username) {
  const raw = prompt(`Nạp tiền cho seller "${username}" (VND):`, '300000');
  if (raw == null) return;
  const amount = parseInt(String(raw).replace(/\D/g, ''), 10);
  if (!amount || amount < 1000) return toast('Tối thiểu 1.000đ');
  const r = await fetch('/api/admin/sellers/' + encodeURIComponent(id) + '/topup', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ amount, description: 'Admin nạp tiền' }),
  });
  const d = await r.json();
  if (d.success) toast('✓ Đã nạp ' + amount.toLocaleString('vi-VN') + 'đ — số dư: ' + (d.balance || 0).toLocaleString('vi-VN') + 'đ');
  else toast(d.error || 'Top up thất bại');
}

// ─── Grant order to seller (admin creates an order directly) ──────────────────
let grantSellerId = null;

function openGrantOrder(id, username) {
  grantSellerId = id;
  $('grantTitle').textContent = tt('admin.grantTitle', { seller: username });
  // Populate product dropdown from the products already loaded (load if empty).
  const fill = () => {
    const sel = $('goProduct');
    const none = tt('admin.grantProductNone');
    sel.innerHTML = `<option value="">${esc(none)}</option>` +
      allProducts.map((p) => `<option value="${esc(p.id)}">${esc(p.name)} · ${fmtVnd(p.price)}</option>`).join('');
  };
  if (!allProducts.length) { loadProducts().then(fill); } else { fill(); }
  $('goProductName').value = '';
  $('goEmail').value = '';
  $('goPassword').value = '';
  $('goNote').value = '';
  $('goPermLogin').checked = true;
  $('goPermReset').checked = false;
  $('goPermFamily').checked = true;
  $('goViaEmail').checked = true;
  $('goErr').style.display = 'none';
  $('grantOrderModal').classList.add('show');
}

function closeGrantOrder() {
  $('grantOrderModal').classList.remove('show');
  grantSellerId = null;
}

// When a product is picked, prefill the product name (still editable).
function onGrantProductChange() {
  const id = $('goProduct').value;
  const p = allProducts.find((x) => x.id === id);
  if (p) $('goProductName').value = p.name;
}

async function confirmGrantOrder() {
  const err = $('goErr');
  err.style.display = 'none';
  const productId = $('goProduct').value || null;
  const productName = $('goProductName').value.trim();
  const accountEmail = $('goEmail').value.trim();
  if (!accountEmail.includes('@')) {
    err.textContent = tt('admin.grantErrEmail');
    err.style.display = 'block';
    return;
  }
  if (!productId && !productName) {
    err.textContent = tt('admin.grantErrName');
    err.style.display = 'block';
    return;
  }
  const payload = {
    productId,
    productName: productName || undefined,
    accountEmail,
    accountPassword: $('goPassword').value.trim() || undefined,
    note: $('goNote').value.trim() || undefined,
    permLogin: $('goPermLogin').checked,
    permReset: $('goPermReset').checked,
    permFamily: $('goPermFamily').checked,
    viaEmail: $('goViaEmail').checked,
  };
  $('goSaveBtn').disabled = true;
  const d = await jpost('/api/admin/sellers/' + encodeURIComponent(grantSellerId) + '/orders', payload);
  $('goSaveBtn').disabled = false;
  if (d.success) {
    const seller = allSellers.find((s) => s.id === grantSellerId);
    toast(tt('admin.grantOk', { seller: seller ? seller.username : '' }));
    closeGrantOrder();
  } else {
    err.textContent = d.error || 'Grant failed';
    err.style.display = 'block';
  }
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
    body.innerHTML = `<tr><td colspan="5" class="panel-empty">${allKeys.length ? 'No matches' : 'No keys yet'}</td></tr>`;
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
          <td><button class="panel-btn panel-btn--sm panel-btn--red" onclick="delKey('${esc(k.key)}')">Delete</button></td>
        </tr>`
    )
    .join('');
}

async function delKey(key) {
  if (!confirm('Delete key ' + key + '?')) return;
  await fetch('/api/admin/keys/' + encodeURIComponent(key), { method: 'DELETE', headers: authHeaders() });
  await loadKeys();
  await loadStats();
}

// ─── Deposits (bank webhook review) ───────────────────────────────────────────
function depStatusPill(status) {
  const map = {
    credited: 'panel-pill--green',
    pending: 'panel-pill--amber',
    unmatched: 'panel-pill--amber',
    error: 'panel-pill--red',
  };
  const label = (typeof I18n !== 'undefined' && I18n.t)
    ? I18n.t('admin.deposits.st_' + status) : null;
  return `<span class="panel-pill ${map[status] || ''}">${esc(label || status || '—')}</span>`;
}

async function loadDeposits() {
  // Make sure we have the seller list for the assign dropdowns.
  if (!allSellers.length) {
    const s = await jget('/api/admin/sellers');
    allSellers = s.sellers || [];
  }
  const [unmatched, recent] = await Promise.all([
    jget('/api/admin/deposit-intents/unmatched'),
    jget('/api/admin/deposit-intents'),
  ]);
  allUnmatchedDeposits = unmatched.intents || [];
  renderUnmatchedDeposits();
  renderRecentDeposits(recent.intents || []);
}

function sellerOptions() {
  return allSellers
    .filter((s) => s.status === 'active')
    .map((s) => `<option value="${esc(s.id)}">${esc(s.username)}</option>`)
    .join('');
}

function renderUnmatchedDeposits() {
  const rows = allUnmatchedDeposits;
  $('depUnmatchedCount').textContent = rows.length;
  const opts = sellerOptions();
  $('depUnmatchedBody').innerHTML = rows.length ? rows.map((d) => `
    <tr data-dep="${d.id}">
      <td>${fmtTs(d.receivedAt)}</td>
      <td>${esc(d.provider || '—')}</td>
      <td style="font-family:monospace;font-size:0.8rem">${esc(d.txRef || '—')}</td>
      <td style="font-weight:700;color:#15803d">+${fmtVnd(d.amount)}</td>
      <td>${esc(d.memo || '')}</td>
      <td style="white-space:nowrap">
        <select class="panel-input panel-input--sm" id="depSel-${d.id}">
          <option value="">—</option>
          ${opts}
        </select>
        <button class="panel-btn panel-btn--sm panel-btn--green" onclick="assignDeposit(${d.id})" data-i18n="admin.deposits.assignBtn">Assign</button>
      </td>
    </tr>`).join('')
    : `<tr><td colspan="6" class="panel-empty" data-i18n="admin.deposits.noUnmatched">No unmatched deposits.</td></tr>`;
  if (typeof I18n !== 'undefined' && I18n.apply) I18n.apply();
}

function renderRecentDeposits(rows) {
  $('depRecentAdminBody').innerHTML = rows.length ? rows.map((d) => `
    <tr>
      <td>${fmtTs(d.creditedAt || d.receivedAt)}</td>
      <td>${esc(d.provider || '—')}</td>
      <td style="font-family:monospace;font-size:0.8rem">${esc(d.txRef || '—')}</td>
      <td style="font-weight:700;color:#15803d">+${fmtVnd(d.amount)}</td>
      <td>${esc(d.matchedUser || '—')}</td>
      <td>${depStatusPill(d.status)}</td>
    </tr>`).join('')
    : `<tr><td colspan="6" class="panel-empty" data-i18n="admin.deposits.noRecent">No deposits yet.</td></tr>`;
  if (typeof I18n !== 'undefined' && I18n.apply) I18n.apply();
}

async function assignDeposit(id) {
  const sel = $('depSel-' + id);
  const sellerId = sel?.value || '';
  if (!sellerId) { alert(I18n?.t?.('admin.deposits.pickSeller') || 'Pick a seller first.'); return; }
  const d = await jpost('/api/admin/deposit-intents/' + id + '/assign', { sellerId });
  if (!d.success) { alert(d.error || 'Assign failed'); return; }
  await loadDeposits();
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

// ─── Products ──────────────────────────────────────────────────────────────────
async function loadProducts() {
  const d = await jget('/api/admin/products');
  allProducts = d.products || [];
  renderProducts();
}

function renderProducts() {
  const q = $('productSearch')?.value || '';
  const rows = PanelFilters.filterListEx(allProducts, {
    q,
    status: productStatusFilter,
    searchFields: ['name', 'durationLabel', 'warrantyNote'],
    getStatus: (p) => (p.active ? 'active' : 'inactive'),
  });

  $('productCount').textContent = rows.length;
  const body = $('productsBody');
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="5" class="panel-empty">${allProducts.length ? 'No matches for filter' : 'No products yet'}</td></tr>`;
    return;
  }
  body.innerHTML = rows
    .map((p) => {
      const badge = p.active
        ? '<span class="panel-badge panel-badge--active">On sale</span>'
        : '<span class="panel-badge panel-badge--rejected">Hidden</span>';
      const dur = p.durationLabel ? esc(p.durationLabel) : `${p.durationDays} days`;
      return `<tr>
        <td>${esc(p.name)}${p.warrantyNote ? `<div class="note-sub">${esc(p.warrantyNote)}</div>` : ''}</td>
        <td>${dur}<div class="note-sub">${p.durationDays} days</div></td>
        <td>${fmtVnd(p.price)}</td>
        <td>${badge}</td>
        <td style="white-space:nowrap">
          <button class="panel-btn panel-btn--sm panel-btn--ghost" onclick="openProductModal('${esc(p.id)}')">Edit</button>
          <button class="panel-btn panel-btn--sm ${p.active ? 'panel-btn--red' : 'panel-btn--green'}" onclick="toggleProduct('${esc(p.id)}')">${p.active ? 'Hide' : 'Show'}</button>
        </td>
      </tr>`;
    })
    .join('');
}

function openProductModal(id) {
  editingProductId = id || null;
  const p = id ? allProducts.find((x) => x.id === id) : null;
  $('productModalTitle').textContent = p ? 'Edit product' : 'Add product';
  $('pmName').value = p?.name || '';
  $('pmDurationLabel').value = p?.durationLabel || '';
  $('pmDurationDays').value = p?.durationDays || 30;
  $('pmPrice').value = p?.price ?? '';
  $('pmWarranty').value = p?.warrantyNote || '';
  $('pmActive').checked = p ? !!p.active : true;
  $('pmErr').style.display = 'none';
  $('productModal').classList.add('show');
}

function closeProductModal() {
  $('productModal').classList.remove('show');
  editingProductId = null;
}

async function saveProduct() {
  const err = $('pmErr');
  err.style.display = 'none';
  const name = $('pmName').value.trim();
  const price = parseInt($('pmPrice').value, 10);
  const durationDays = parseInt($('pmDurationDays').value, 10) || 30;
  if (!name) { err.textContent = 'Enter product name.'; err.style.display = 'block'; return; }
  if (!Number.isFinite(price) || price < 0) { err.textContent = 'Invalid price.'; err.style.display = 'block'; return; }

  const payload = {
    name,
    durationLabel: $('pmDurationLabel').value.trim() || null,
    durationDays,
    price,
    warrantyNote: $('pmWarranty').value.trim() || null,
    active: $('pmActive').checked,
  };
  if (editingProductId) payload.id = editingProductId;

  $('pmSaveBtn').disabled = true;
  const d = await jpost('/api/admin/products', payload);
  $('pmSaveBtn').disabled = false;
  if (d.success) {
    toast(editingProductId ? 'Product updated' : 'Product added');
    closeProductModal();
    loadProducts();
  } else {
    err.textContent = d.error || 'Failed to save product';
    err.style.display = 'block';
  }
}

// Ẩn/hiện = upsert lại toàn bộ field với active đảo (API là upsert toàn phần, không patch lẻ)
async function toggleProduct(id) {
  const p = allProducts.find((x) => x.id === id);
  if (!p) return;
  const d = await jpost('/api/admin/products', {
    id: p.id,
    name: p.name,
    durationLabel: p.durationLabel,
    durationDays: p.durationDays,
    price: p.price,
    warrantyNote: p.warrantyNote,
    active: !p.active,
  });
  if (d.success) { toast(p.active ? 'Product hidden' : 'Product shown'); loadProducts(); }
  else toast(d.error || 'Error');
}

function initFilters() {
  const C = (id, key) => (typeof I18n !== 'undefined' ? I18n.chip(id, key) : { id, label: tt(key) });

  keyChips = PanelFilters.bindChipBar($('keyFilterBar'), [
    C('all', 'chip.all'),
    C('unused', 'chip.unused'),
    C('used', 'chip.used'),
  ], (status) => {
    keyStatusFilter = status;
    renderKeys();
  });

  sellerChips = PanelFilters.bindChipBar($('sellerFilterBar'), [
    C('all', 'chip.all'),
    C('active', 'chip.active'),
    C('pending', 'chip.pending'),
    C('rejected', 'chip.rejected'),
  ], (status) => {
    sellerStatusFilter = status;
    renderSellers();
  });

  productChips = PanelFilters.bindChipBar($('productFilterBar'), [
    C('all', 'chip.all'),
    C('active', 'chip.onSale'),
    C('inactive', 'chip.hidden'),
  ], (status) => {
    productStatusFilter = status;
    renderProducts();
  });
}

window.login = login;
window.loginToken = loginToken;
window.logout = logout;
window.forceLogout = forceLogout;
window.toggleTokenMode = toggleTokenMode;
window.approve = approve;
window.editSellerPerms = editSellerPerms;
window.closePermsModal = closePermsModal;
window.confirmPerms = confirmPerms;
window.topupSeller = topupSeller;
window.openGrantOrder = openGrantOrder;
window.closeGrantOrder = closeGrantOrder;
window.onGrantProductChange = onGrantProductChange;
window.confirmGrantOrder = confirmGrantOrder;
window.reject = reject;
window.delKey = delKey;
window.assignDeposit = assignDeposit;
window.loadDeposits = loadDeposits;
window.renderKeys = renderKeys;
window.renderSellers = renderSellers;
window.renderProducts = renderProducts;
window.loadProducts = loadProducts;
window.openProductModal = openProductModal;
window.closeProductModal = closeProductModal;
window.saveProduct = saveProduct;
window.toggleProduct = toggleProduct;
window.switchAdminTab = switchAdminTab;

function syncLangSelect() {
  const sel = $('langSelect');
  if (!sel) return;
  const saved = localStorage.getItem('ui_lang');
  sel.value = saved === 'en' || saved === 'vi' ? saved : 'auto';
}

function onLangSelect(value) {
  if (typeof I18n === 'undefined') return;
  if (value === 'auto') {
    localStorage.removeItem('ui_lang');
    const nav = (navigator.language || '').toLowerCase();
    I18n.setLang(nav.startsWith('vi') ? 'vi' : 'en');
  } else {
    I18n.setLang(value);
  }
  syncLangSelect();
}

function mountAdminLangSwitchers() {
  if (typeof I18n === 'undefined') return;
  const dash = $('langSwitchDash');
  if (dash && !dash.dataset.mounted) {
    I18n.mountSwitcher(dash);
    dash.dataset.mounted = '1';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  mountAdminLangSwitchers();
  syncLangSelect();
  $('langSelect')?.addEventListener('change', (e) => onLangSelect(e.target.value));
  document.addEventListener('langchange', syncLangSelect);
  initFilters();
  $('productModal')?.addEventListener('click', (e) => {
    if (e.target === $('productModal')) closeProductModal();
  });
  $('permsModal')?.addEventListener('click', (e) => {
    if (e.target === $('permsModal')) closePermsModal();
  });
  $('grantOrderModal')?.addEventListener('click', (e) => {
    if (e.target === $('grantOrderModal')) closeGrantOrder();
  });
  (async () => {
    // Kiểm tra token trong sessionStorage — có thể cũ sau khi server restart
    if (TOKEN) {
      const check = await fetch('/api/admin/stats', { headers: { 'X-Admin-Token': TOKEN } });
      if (check.ok) {
        showDash();
        return;
      }
      // Token hết hạn — xoá và thử tiếp
      sessionStorage.removeItem('adminToken');
      TOKEN = '';
    }
    // Thử session cookie (đăng nhập bằng tài khoản admin)
    try {
      const r = await fetch('/api/panel/me');
      if (r.ok) {
        const d = await r.json();
        if (d.success && d.account.role === 'admin') {
          showDash();
          return;
        }
      }
    } catch {}
    // Không có auth hợp lệ — hiển thị login
    show('loginCard', true);
  })();
});

document.addEventListener('langchange', () => {
  initFilters();
  if (TOKEN) loadStats();
  I18n.apply();
});
