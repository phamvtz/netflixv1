'use strict';

const PAGE_META = {
  stats: { title: 'Stats', caption: 'Overview of orders, keys and balance.' },
  orders: { title: 'Your orders', caption: 'Manage purchased accounts — renew, copy, enable code permissions for customers.' },
  keys: { title: 'Manage Keys', caption: 'Create keys tied to purchased accounts and assign access permissions. Replace email when needed.' },
  store: { title: 'Store', caption: 'Buy Netflix accounts — deducts balance, creates orders automatically.' },
  emails: { title: 'Manage email', caption: 'List of emails from purchased orders.' },
  transactions: { title: 'Transaction history', caption: 'Top ups, purchases and balance.' },
  profile: { title: 'Profile', caption: 'Customer support contact.' },
  checker: { title: 'Cookie checker', caption: 'Check whether account cookies are still LIVE.' },
};

const PERM_DEFS = [
  { field: 'permLogin', label: 'Login code' },
  { field: 'permReset', label: 'Password reset' },
  { field: 'permFamily', label: 'Household' },
];

let pendingAccountId = null;
let sellerPerms = { permLogin: true, permReset: false, permFamily: true };
let dashboard = null;
let allOrders = [];
let allKeys = [];
let products = [];
let orderPage = 1;
let buyProduct = null;
let orderDebounce;

const $ = (id) => document.getElementById(id);

function show(el, on) {
  const node = typeof el === 'string' ? $(el) : el;
  if (node) node.classList.toggle('hidden', !on);
}

function fmtVnd(n) {
  return new Intl.NumberFormat('vi-VN').format(n || 0) + ' đ';
}

function fmtTs(sec) {
  if (!sec) return '—';
  try {
    return new Date(sec * 1000).toLocaleString('vi-VN', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch { return '—'; }
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.style.display = 'block';
  clearTimeout(t._t);
  t._t = setTimeout(() => { t.style.display = 'none'; }, 2800);
}

async function copyText(s) {
  try {
    await navigator.clipboard.writeText(s);
    toast('Copied');
  } catch { toast('Copy manually: ' + s); }
}

function customerGetCodeUrl() {
  const host = location.host.replace(/^seller\./, '');
  if (location.host.startsWith('seller.')) return `${location.protocol}//me.${host}/`;
  return `${location.origin}/`;
}

async function api(url, body, method) {
  const m = method || (body != null ? 'POST' : 'GET');
  const opt = { method: m, headers: {} };
  if (body != null && m !== 'GET') {
    opt.headers['Content-Type'] = 'application/json';
    opt.body = JSON.stringify(body);
  }
  const r = await fetch(url, opt);
  let d = {};
  try { d = await r.json(); } catch {}
  return { status: r.status, ...d };
}

function adminPermHint() {
  const ok = (v) => (v ? '✔' : '✘');
  return `Admin permissions: ${ok(sellerPerms.permLogin)} Login code · ${ok(sellerPerms.permReset)} Reset · ${ok(sellerPerms.permFamily)} Household code`;
}

function canPerm(field) {
  return !!sellerPerms[field];
}

function toggleSidebar() {
  $('swSidebar')?.classList.toggle('open');
  $('swOverlay')?.classList.toggle('show');
}
function closeSidebar() {
  $('swSidebar')?.classList.remove('open');
  $('swOverlay')?.classList.remove('show');
}

const VIEWS = ['stats', 'orders', 'keys', 'store', 'emails', 'transactions', 'profile', 'checker'];

function switchView(v) {
  closeSidebar();
  document.querySelectorAll('.sw-nav a[data-view]').forEach((a) => {
    a.classList.toggle('is-active', a.dataset.view === v);
  });
  VIEWS.forEach((id) => show('view' + id.charAt(0).toUpperCase() + id.slice(1), id === v));
  const meta = PAGE_META[v] || PAGE_META.orders;
  $('pageTitle').textContent = meta.title;
  $('pageCaption').textContent = meta.caption;
  if (v === 'orders') loadOrders();
  if (v === 'keys') window.SellerKeys?.loadKeys();
  if (v === 'store') loadStore();
  if (v === 'emails') loadEmails();
  if (v === 'transactions') loadTransactions();
  if (v === 'stats') renderStats();
  if (v === 'profile') fillProfile();
}

function loadKeys() {
  return window.SellerKeys?.loadKeys();
}
function debounceRenderKeys() {
  return window.SellerKeys?.debounceRenderKeys();
}

function updateBalanceUI() {
  const b = dashboard?.balance ?? 0;
  if ($('hdrBalance')) $('hdrBalance').textContent = fmtVnd(b);
  if ($('storeBalance')) $('storeBalance').textContent = fmtVnd(b);
}

async function loadDashboard() {
  const d = await api('/api/seller/dashboard');
  if (!d.success) return;
  dashboard = d;
  sellerPerms = d.sellerPerms || sellerPerms;
  updateBalanceUI();
  const s = d.stats || {};
  if ($('stTotal')) $('stTotal').textContent = s.ordersTotal ?? 0;
  if ($('stUsed')) $('stUsed').textContent = s.keysUsed ?? 0;
  if ($('stUnused')) $('stUnused').textContent = s.keysUnused ?? 0;
  if ($('stFamily')) $('stFamily').textContent = s.withFamily ?? 0;
  if ($('statsPermHint')) $('statsPermHint').textContent = adminPermHint();
}

function debounceLoadOrders() {
  clearTimeout(orderDebounce);
  orderDebounce = setTimeout(() => { orderPage = 1; loadOrders(); }, 300);
}

async function loadOrders() {
  const q = $('orderSearch')?.value || '';
  const status = $('orderStatusSelect')?.value || 'active';
  const d = await api(`/api/seller/orders?q=${encodeURIComponent(q)}&status=${status}&page=${orderPage}&perPage=20`);
  if (!d.success) return toast(d.error || 'Failed to load orders');
  allOrders = d.orders || [];
  sellerPerms = d.sellerPerms || sellerPerms;
  renderOrders(d.pagination);
}

function renderOrders(pagination) {
  const box = $('ordersList');
  if (!box) return;

  if (!allOrders.length) {
    box.innerHTML = `
      <div class="sw-empty">
        <h3>No orders yet</h3>
        <p>Buy from the Store or ask the admin to grant an order.</p>
        <button type="button" class="sw-btn sw-btn--primary" style="margin-top:14px" onclick="switchView('store')">Go to store</button>
      </div>`;
    $('ordersPagination').innerHTML = '';
    return;
  }

  box.innerHTML = allOrders.map((o) => orderCardHtml(o)).join('');
  bindOrderEvents();

  const p = pagination || { page: 1, pages: 1, total: allOrders.length };
  $('ordersPagination').innerHTML = `
    <span>Page ${p.page}/${p.pages} — ${p.total} orders</span>
    <span>
      ${p.page > 1 ? `<button type="button" class="sw-btn sw-btn--outline" data-page="${p.page - 1}">← Prev</button> ` : ''}
      ${p.page < p.pages ? `<button type="button" class="sw-btn sw-btn--outline" data-page="${p.page + 1}">Next →</button>` : ''}
    </span>`;
  $('ordersPagination').querySelectorAll('[data-page]').forEach((btn) => {
    btn.addEventListener('click', () => {
      orderPage = parseInt(btn.dataset.page, 10);
      loadOrders();
    });
  });
}

function orderCardHtml(o) {
  const expired = o.status === 'expired';
  const badge = expired
    ? '<span class="sw-order-badge sw-order-badge--expired">EXPIRED</span>'
    : '<span class="sw-order-badge">ACTIVE</span>';
  const dur = o.durationLabel ? `<span class="perm-badge perm-badge--on" style="margin-left:6px">${esc(o.durationLabel)}</span>` : '';
  const keys = o.keys || [];
  const keyBtn = keys.length
    ? `<button type="button" class="sw-btn sw-btn--outline" data-act="keys" data-id="${esc(o.id)}">Manage keys (${keys.length})</button>`
    : `<button type="button" class="sw-btn sw-btn--outline" data-act="createkey" data-id="${esc(o.id)}">Create key</button>`;

  const permPills = PERM_DEFS.map((d) => {
    const allowed = canPerm(d.field);
    const on = o[d.field];
    const dis = allowed ? '' : ' off-disabled';
    return `<button type="button" class="sw-perm-pill${on ? ' on' : ''}${dis}" data-act="perm" data-id="${esc(o.id)}" data-field="${d.field}" ${allowed ? '' : 'disabled'}>${d.label}</button>`;
  }).join('');

  return `
    <article class="sw-order" data-order="${esc(o.id)}">
      <div class="sw-order-head">
        <div>
          <div class="sw-order-title">${esc(o.productName)} ${dur}</div>
          <div class="sw-order-meta">${esc(o.id)} · ${fmtTs(o.createdAt)}</div>
        </div>
        ${badge}
      </div>
      <div class="sw-order-body">
        <div class="sw-field-grid">
          <div class="sw-field">
            <label>Public code</label>
            <div class="sw-field-val mono">${esc(o.publicCode)} <button type="button" class="sw-icon-btn" data-copy="${esc(o.publicCode)}">⎘</button></div>
          </div>
          <div class="sw-field">
            <label>Email</label>
            <div class="sw-field-val">${esc(o.accountEmail)} <button type="button" class="sw-icon-btn" data-copy="${esc(o.accountEmail)}">⎘</button></div>
          </div>
          <div class="sw-field">
            <label>Password</label>
            <div class="sw-pwd-row">
              <input type="text" class="panel-input" data-pwd="${esc(o.id)}" value="${esc(o.accountPassword || '')}" placeholder="—" style="margin:0" />
              <button type="button" class="sw-icon-btn" data-act="savepwd" data-id="${esc(o.id)}" title="Save">✓</button>
            </div>
          </div>
          <div class="sw-field">
            <label>Expiry</label>
            <div class="sw-field-val">Until: ${fmtTs(o.expiresAt)}<br><span style="font-size:0.78rem;color:#64748b">Renewed ${o.renewalCount} times</span></div>
          </div>
        </div>
        <div class="sw-perm-section">
          <label class="sw-toggle">
            <input type="checkbox" data-act="via" data-id="${esc(o.id)}" ${o.viaEmail ? 'checked' : ''} />
            <span class="sw-toggle-track"></span>
            <span><strong>Get code via email</strong></span>
          </label>
          <div class="title" style="margin-top:12px">Code types the customer can view</div>
          <div class="sw-perm-pills">${permPills}</div>
          <p class="sw-perm-note">Customers getting codes by key/email will only receive the code types you enable above.</p>
        </div>
        <div class="sw-order-foot">
          <button type="button" class="sw-btn sw-btn--primary" data-act="renew" data-id="${esc(o.id)}">Renew now</button>
          <button type="button" class="sw-btn sw-btn--outline" data-act="history" data-id="${esc(o.id)}">History</button>
          ${keyBtn}
        </div>
      </div>
    </article>`;
}

function bindOrderEvents() {
  const box = $('ordersList');
  if (!box) return;

  box.querySelectorAll('[data-copy]').forEach((b) => {
    b.addEventListener('click', () => copyText(b.dataset.copy));
  });

  box.querySelectorAll('[data-act="via"]').forEach((inp) => {
    inp.addEventListener('change', async () => {
      const id = inp.dataset.id;
      const d = await api(`/api/seller/orders/${encodeURIComponent(id)}`, { viaEmail: inp.checked }, 'PATCH');
      if (d.success) toast('Updated'); else { toast(d.error || 'Error'); inp.checked = !inp.checked; }
    });
  });

  box.querySelectorAll('[data-act="perm"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      const o = allOrders.find((x) => x.id === btn.dataset.id);
      if (!o) return;
      const field = btn.dataset.field;
      const payload = { [field]: !o[field] };
      const d = await api(`/api/seller/orders/${encodeURIComponent(o.id)}`, payload, 'PATCH');
      if (d.success) { toast('Permissions updated'); loadOrders(); loadKeys(); }
      else toast(d.error || 'Error');
    });
  });

  box.querySelectorAll('[data-act="savepwd"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const inp = box.querySelector(`[data-pwd="${id}"]`);
      const d = await api(`/api/seller/orders/${encodeURIComponent(id)}`, { accountPassword: inp?.value || '' }, 'PATCH');
      if (d.success) toast('Password saved');
      else toast(d.error || 'Error');
    });
  });

  box.querySelectorAll('[data-act="renew"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Renew this order? (adds duration per the plan)')) return;
      const d = await api(`/api/seller/orders/${encodeURIComponent(btn.dataset.id)}/renew`, {}, 'POST');
      if (d.success) { toast('Renewed'); loadOrders(); loadDashboard(); }
      else toast(d.error || 'Renewal failed');
    });
  });

  box.querySelectorAll('[data-act="history"]').forEach((btn) => {
    btn.addEventListener('click', () => openHistory(btn.dataset.id));
  });

  box.querySelectorAll('[data-act="createkey"]').forEach((btn) => {
    btn.addEventListener('click', () => createKeyForOrder(btn.dataset.id));
  });

  box.querySelectorAll('[data-act="keys"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      switchView('keys');
      if ($('kSearch')) $('kSearch').value = btn.dataset.id;
      window.SellerKeys?.debounceRenderKeys();
    });
  });
}

async function createKeyForOrder(orderId) {
  switchView('keys');
  await window.SellerKeys?.openCreateKeyModalForOrder?.(orderId);
}

async function openHistory(orderId) {
  const d = await api(`/api/seller/orders/${encodeURIComponent(orderId)}/history`);
  if (!d.success) return toast(d.error || 'Error');
  $('histTitle').textContent = 'History · ' + orderId;
  $('histList').innerHTML = (d.events || []).length
    ? d.events.map((e) => `<div class="sw-history-item"><b>${esc(e.eventType)}</b> · ${fmtTs(e.createdAt)}${e.detail ? '<br>' + esc(e.detail) : ''}</div>`).join('')
    : '<p class="sub">No events yet.</p>';
  $('historyModal').classList.add('show');
}
function closeHistoryModal() { $('historyModal')?.classList.remove('show'); }

function permBadgesHtml(k) {
  const b = (on, l) => `<span class="perm-badge ${on ? 'perm-badge--on' : 'perm-badge--off'}">${l}</span>`;
  return `<div class="perm-badges">${b(k.permLogin, 'Login')}${b(k.permReset, 'Reset')}${b(k.permFamily, 'Household')}</div>`;
}

async function loadStore() {
  const d = await api('/api/seller/products');
  if (!d.success) return;
  products = d.products || [];
  if (d.balance != null) {
    dashboard = dashboard || {};
    dashboard.balance = d.balance;
    updateBalanceUI();
  }
  const grid = $('storeGrid');
  if (!grid) return;
  grid.innerHTML = products.map((p) => `
    <div class="sw-product-card">
      <h3>${esc(p.name)}</h3>
      <p class="sub">${esc(p.durationLabel || '')} · ${esc(p.warrantyNote || '')}</p>
      <div class="sw-price">${fmtVnd(p.price)}</div>
      <button type="button" class="sw-btn sw-btn--primary" style="margin-top:12px;width:100%" data-buy="${esc(p.id)}">Buy now</button>
    </div>`).join('');
  grid.querySelectorAll('[data-buy]').forEach((btn) => {
    btn.addEventListener('click', () => openBuyModal(btn.dataset.buy));
  });
}

function openBuyModal(productId) {
  buyProduct = products.find((p) => p.id === productId);
  if (!buyProduct) return;
  $('buyTitle').textContent = buyProduct.name;
  $('buyPrice').textContent = 'Price: ' + fmtVnd(buyProduct.price);
  $('buyEmail').value = '';
  $('buyPass').value = '';
  setErr('buyErr');
  $('buyModal').classList.add('show');
}
function closeBuyModal() { $('buyModal')?.classList.remove('show'); buyProduct = null; }

async function confirmBuy() {
  if (!buyProduct) return;
  const email = $('buyEmail').value.trim();
  const pass = $('buyPass').value.trim();
  if (!email.includes('@')) return setErr('buyErr', 'Enter a valid email');
  $('buyBtn').disabled = true;
  const d = await api('/api/seller/store/buy', {
    productId: buyProduct.id,
    accountEmail: email,
    accountPassword: pass || null,
  });
  $('buyBtn').disabled = false;
  if (!d.success) return setErr('buyErr', d.error || 'Purchase failed');
  toast('Purchase successful · ' + d.order.id);
  closeBuyModal();
  dashboard.balance = d.balance;
  updateBalanceUI();
  switchView('orders');
}

async function loadEmails() {
  const d = await api('/api/seller/emails');
  const body = $('emailsBody');
  if (!d.success || !body) return;
  const rows = d.emails || [];
  body.innerHTML = rows.length
    ? rows.map((e) => `<tr>
        <td>${esc(e.email)}</td>
        <td>${e.orderCount}</td>
        <td>${fmtTs(e.latestExpires)}</td>
        <td><button type="button" class="sw-btn sw-btn--outline" onclick="copyText('${esc(e.email)}')">Copy</button></td>
      </tr>`).join('')
    : '<tr><td colspan="4" class="panel-empty">No emails yet</td></tr>';
}

async function loadTransactions() {
  const d = await api('/api/seller/transactions');
  if (!d.success) return;
  const s = d.summary || {};
  $('txnSummary').innerHTML = `
    <div class="sw-stat"><div class="n">${fmtVnd(s.totalTopup)}</div><div class="l">Total top up</div></div>
    <div class="sw-stat"><div class="n accent">${fmtVnd(s.balance)}</div><div class="l">Current balance</div></div>
    <div class="sw-stat"><div class="n">${fmtVnd(s.totalMinus)}</div><div class="l">Total deducted</div></div>
    <div class="sw-stat"><div class="n">${(d.transactions || []).length}</div><div class="l">Transactions</div></div>`;
  dashboard.balance = s.balance;
  updateBalanceUI();
  const typeLabel = { topup: 'Top up', purchase: 'Purchase', admin_adjust: 'Adjustment' };
  $('txnBody').innerHTML = (d.transactions || []).map((t) => {
    const pos = t.amount >= 0;
    return `<tr>
      <td>${fmtTs(t.createdAt)}</td>
      <td>${typeLabel[t.type] || t.type}</td>
      <td style="color:${pos ? '#15803d' : '#b91c1c'}">${pos ? '+' : ''}${fmtVnd(t.amount)}</td>
      <td>${fmtVnd(t.balanceAfter)}</td>
      <td>${esc(t.description || '')}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="5" class="panel-empty">No transactions yet</td></tr>';
}

// ── Checker cookie ──
function checkerBadge(r) {
  if (r.rateLimited) return '<span class="sw-order-badge sw-order-badge--expired">RATE LIMIT</span>';
  if (r.planLost || (r.paymentError && r.plan)) return '<span class="sw-order-badge sw-order-badge--expired">PLAN LOST</span>';
  if (r.alive && r.cancelled) return '<span class="sw-order-badge sw-order-badge--expired">CANCELLED</span>';
  if (r.alive) return '<span class="sw-order-badge">LIVE</span>';
  return '<span class="sw-order-badge sw-order-badge--expired">DEAD</span>';
}

function updateCheckerRow(i, r) {
  const tr = $('chk-' + i);
  if (!tr) return;
  tr.children[1].innerHTML = checkerBadge(r) + (r.error ? `<div class="note-sub">${esc(r.error)}</div>` : '');
  tr.children[2].textContent = r.plan || '—';
  tr.children[3].textContent = r.email || '—';
}

async function runChecker() {
  const lines = ($('chkInput').value || '')
    .split('\n').map((s) => s.trim())
    .filter((s) => s.includes('NetflixId=') || s.length > 30);
  if (!lines.length) return toast('Paste a cookie (containing NetflixId=) first');

  const pace = $('chkPace')?.value || 'stealth';
  const btn = $('chkBtn');
  btn.disabled = true;
  btn.textContent = 'Checking…';
  // Render hàng "đang chờ" trước, rồi check tuần tự cập nhật từng dòng
  $('chkResults').innerHTML = lines
    .map((_, i) => `<tr id="chk-${i}"><td>${i + 1}</td><td><span class="sw-order-badge">…</span></td><td>—</td><td>—</td></tr>`)
    .join('');

  for (let i = 0; i < lines.length; i++) {
    let r;
    try { r = await api('/api/checker/live-check', { cookie: lines[i], pace }); }
    catch (e) { r = { alive: false, error: e.message }; }
    updateCheckerRow(i, r);
    if (r.rateLimited) { toast(r.error || 'Hourly check limit reached'); break; }
  }

  btn.disabled = false;
  btn.textContent = 'Check';
}

function renderStats() {
  if ($('statsPermBadges')) $('statsPermBadges').innerHTML = permBadgesHtml(sellerPerms);
  if ($('statsPermHint')) $('statsPermHint').textContent = adminPermHint();
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

// ── Auth ──
function setErr(id, msg) {
  const e = $(id);
  if (!e) return;
  e.textContent = msg || '';
  e.style.display = msg ? 'block' : 'none';
}
function setOk(id, msg) {
  const e = $(id);
  if (!e) return;
  e.textContent = msg || '';
  e.style.display = msg ? 'block' : 'none';
}

function showTab(t) {
  $('tabLogin')?.classList.toggle('active', t === 'login');
  $('tabReg')?.classList.toggle('active', t === 'reg');
  show('paneLogin', t === 'login');
  show('paneReg', t === 'reg');
  show('paneVerify', false);
}

async function doLogin() {
  setErr('lgErr');
  const username = $('lgUser').value.trim();
  const password = $('lgPass').value;
  if (!username || !password) return setErr('lgErr', 'Enter username and password.');
  $('lgBtn').disabled = true;
  const d = await api('/api/panel/login', { username, password });
  $('lgBtn').disabled = false;
  if (d.success) {
    if (d.account.role !== 'seller') return setErr('lgErr', 'Not a seller.');
    return enterDash(d.account);
  }
  if (d.needVerify) {
    pendingAccountId = d.accountId;
    openVerify(username);
    return setErr('lgErr', 'Email not verified yet.');
  }
  setErr('lgErr', d.error || 'Login failed.');
}

async function doRegister() {
  setErr('rgErr');
  const d = await api('/api/seller/register', {
    username: $('rgUser').value.trim(),
    email: $('rgEmail').value.trim(),
    password: $('rgPass').value,
  });
  if (!d.success) return setErr('rgErr', d.error || 'Error');
  pendingAccountId = d.accountId;
  openVerify($('rgEmail').value.trim());
}

function openVerify(email) {
  show('paneLogin', false);
  show('paneReg', false);
  show('paneVerify', true);
  $('vEmail').textContent = email;
}

async function doVerify() {
  const code = $('vCode').value.trim();
  if (!/^\d{6}$/.test(code)) return setErr('vErr', '6-digit code');
  const d = await api('/api/seller/verify-email', { accountId: pendingAccountId, code });
  if (!d.success) return setErr('vErr', d.error || 'Error');
  setOk('vOk', 'OK — pending approval');
  setTimeout(() => showTab('login'), 1500);
}

async function doResend() {
  const d = await api('/api/seller/resend-code', { accountId: pendingAccountId });
  toast(d.success ? 'Code resent' : (d.error || 'Error'));
}

async function enterDash(acct) {
  show('authView', false);
  show('dashView', true);
  $('userAvatar').textContent = (acct.username || 'S')[0].toUpperCase();
  $('topUserName').textContent = acct.username || '';
  await loadDashboard();
  await window.SellerKeys?.loadKeys();
  switchView('orders');
}

async function logout() {
  await api('/api/panel/logout', {});
  location.reload();
}

function initFilters() {}

// exports
window.showTab = showTab;
window.switchView = switchView;
window.toggleSidebar = toggleSidebar;
window.closeSidebar = closeSidebar;
window.doLogin = doLogin;
window.doRegister = doRegister;
window.doVerify = doVerify;
window.doResend = doResend;
window.openCreateKeyModal = () => window.SellerKeys?.openCreateKeyModal();
window.closeCreateKeyModal = () => window.SellerKeys?.closeCreateKeyModal();
window.openEditKey = (id) => window.SellerKeys?.openEditKey(id);
window.closeEditModal = () => window.SellerKeys?.closeEditModal();
window.saveEditKey = () => window.SellerKeys?.saveEditKey();
window.saveCreateKeys = () => window.SellerKeys?.saveCreateKeys();
window.addCreateKeyRow = () => window.SellerKeys?.addCreateKeyRow();
window.logout = logout;
window.copyText = copyText;
window.saveProfile = saveProfile;
window.closeBuyModal = closeBuyModal;
window.confirmBuy = confirmBuy;
window.runChecker = runChecker;
window.closeHistoryModal = closeHistoryModal;
window.loadOrders = loadOrders;
window.loadKeys = loadKeys;
window.debounceLoadOrders = debounceLoadOrders;
window.debounceRenderKeys = debounceRenderKeys;

document.addEventListener('DOMContentLoaded', () => {
  initFilters();
  window.SellerApp = {
    api, toast, copyText, esc, fmtTs,
    get sellerPerms() { return sellerPerms; },
    set sellerPerms(v) { sellerPerms = v; },
    get allKeys() { return allKeys; },
    set allKeys(v) { allKeys = v; },
    loadOrders, loadDashboard,
  };

  ['editModal', 'createKeyModal', 'buyModal', 'historyModal'].forEach((id) => {
    $(id)?.addEventListener('click', (e) => {
      if (e.target === $(id)) {
        if (id === 'editModal') window.SellerKeys?.closeEditModal();
        if (id === 'createKeyModal') window.SellerKeys?.closeCreateKeyModal();
        if (id === 'buyModal') closeBuyModal();
        if (id === 'historyModal') closeHistoryModal();
      }
    });
  });
  (async () => {
    const d = await api('/api/panel/me');
    if (d.success && d.account.role === 'seller' && d.account.status === 'active') {
      sellerPerms = {
        permLogin: d.account.permLogin !== false,
        permReset: !!d.account.permReset,
        permFamily: d.account.permFamily !== false,
      };
      enterDash(d.account);
    }
  })();
});
