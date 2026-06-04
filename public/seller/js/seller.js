'use strict';

const tt = (k, v) => (typeof I18n !== 'undefined' ? I18n.t(k, v) : k);

function pageMeta(view) {
  return typeof I18n !== 'undefined' ? I18n.sellerMeta(view) : { title: view, caption: '' };
}

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
    toast(tt('common.copied'));
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

const VIEWS = ['stats', 'orders', 'keys', 'store', 'emails', 'deposit', 'transactions', 'profile'];

function switchView(v) {
  closeSidebar();
  document.querySelectorAll('.sw-nav a[data-view]').forEach((a) => {
    a.classList.toggle('is-active', a.dataset.view === v);
  });
  VIEWS.forEach((id) => show('view' + id.charAt(0).toUpperCase() + id.slice(1), id === v));
  const meta = pageMeta(v);
  if ($('pageTitle')) $('pageTitle').textContent = meta.title;
  if (v === 'orders') loadOrders();
  if (v === 'keys') window.SellerKeys?.loadKeys();
  if (v === 'store') loadStore();
  if (v === 'emails') loadEmailAccounts();
  if (v === 'transactions') loadTransactions();
  if (v === 'deposit') loadDeposit();
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
  renderStats();
}

function renderStats() {
  const s = dashboard?.stats || {};
  const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  set('stBalance', fmtVnd(dashboard?.balance ?? 0));
  set('stTotal', s.ordersTotal ?? 0);
  set('stKeysSold', s.keysUsed ?? s.keysTotal ?? 0);
  set('stEmailsSold', s.ordersTotal ?? 0);
  renderDashRecent();
}

function startOfMonthSec() {
  const d = new Date();
  return Math.floor(new Date(d.getFullYear(), d.getMonth(), 1).getTime() / 1000);
}
function startOfDaySec() {
  const d = new Date();
  return Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 1000);
}

async function renderDashRecent() {
  const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  const d = await api('/api/seller/transactions');
  const txns = d?.transactions || [];

  const monthStart = startOfMonthSec();
  const dayStart = startOfDaySec();
  const spentMonth = txns.filter((t) => t.type === 'purchase' && t.createdAt >= monthStart)
    .reduce((sum, t) => sum + Math.abs(t.amount || 0), 0);
  const spentToday = txns.filter((t) => t.type === 'purchase' && t.createdAt >= dayStart)
    .reduce((sum, t) => sum + Math.abs(t.amount || 0), 0);
  set('stSpentMonth', fmtVnd(spentMonth));
  set('stSpentToday', fmtVnd(spentToday));

  const txBody = $('dashTxBody');
  if (txBody) {
    const rows = txns.slice(0, 5);
    txBody.innerHTML = rows.length ? rows.map((t) => {
      const pos = t.amount >= 0;
      const typeTxt = t.type === 'topup' ? tt('seller.tx.typeTopup') : t.type === 'purchase' ? tt('seller.tx.typePurchase') : tt('seller.tx.typeAdjust');
      return `<tr>
        <td>${fmtTs(t.createdAt)}</td>
        <td><span class="perm-badge ${pos ? 'perm-badge--on' : 'perm-badge--off'}">${typeTxt}</span></td>
        <td style="color:${pos ? '#16A34A' : '#DC2626'};font-weight:600">${pos ? '+' : ''}${fmtVnd(t.amount)}</td>
      </tr>`;
    }).join('') : `<tr><td colspan="3" class="panel-empty">${tt('seller.tx.empty')}</td></tr>`;
  }
  const odBody = $('dashOrdersBody');
  if (odBody) {
    const rows = (allOrders || []).slice(0, 5);
    odBody.innerHTML = rows.length ? rows.map((o) => `
      <tr>
        <td>${esc(o.accountEmail || '—')}</td>
        <td>${esc(o.productName || '')}</td>
        <td><span class="sw-order-badge ${o.status === 'expired' ? 'sw-order-badge--expired' : ''}">${o.status === 'expired' ? tt('seller.orders.expired') : tt('chip.active')}</span></td>
      </tr>`).join('') : `<tr><td colspan="3" class="panel-empty">${tt('seller.orders.empty')}</td></tr>`;
  }
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
  renderStoreGrid();
}

function renderStoreGrid() {
  const grid = $('storeGrid');
  if (!grid) return;
  const q = ($('storeSearch')?.value || '').toLowerCase();
  const sort = $('storeSort')?.value || 'featured';
  let list = products.filter((p) => !q || (p.name || '').toLowerCase().includes(q));
  if (sort === 'priceAsc') list = [...list].sort((a, b) => a.price - b.price);
  if (sort === 'priceDesc') list = [...list].sort((a, b) => b.price - a.price);

  const tags = ['HOT', 'NEW', 'NEW'];
  grid.innerHTML = list.map((p, i) => {
    const tagCls = i % 3 === 0 ? '' : 'prod-tag--new';
    const tag = tags[i % 3];
    return `
    <div class="sw-product-card">
      <div class="prod-banner">
        <div class="nf-mark">NETFLIX</div>
        <span class="prod-tag ${tagCls}">${tag}</span>
        <span class="prod-dur">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
          ${esc(p.durationLabel || '')}
        </span>
      </div>
      <div class="prod-body">
        <div class="prod-name">${esc(p.name)}</div>
        <div class="prod-desc">${esc(p.warrantyNote || tt('seller.store.fullWarranty'))}</div>
        <div class="prod-price">${fmtVnd(p.price)}</div>
        <div class="prod-actions">
          <button type="button" class="sw-btn sw-btn--outline" data-view-prod="${esc(p.id)}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>
            ${tt('seller.store.view')}
          </button>
          <button type="button" class="sw-btn sw-btn--primary" data-buy="${esc(p.id)}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
            ${tt('seller.store.buy')}
          </button>
        </div>
      </div>
    </div>`;
  }).join('');
  grid.querySelectorAll('[data-buy]').forEach((btn) => {
    btn.addEventListener('click', () => openBuyModal(btn.dataset.buy));
  });
  grid.querySelectorAll('[data-view-prod]').forEach((btn) => {
    btn.addEventListener('click', () => openBuyModal(btn.dataset.viewProd));
  });
}

function clearCart() {
  $('storeCart')?.classList.remove('is-open');
}
function checkoutCart() {
  toast(tt('seller.store.pickProduct'));
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

let allTransactions = [];
let txPage = 1;
const TX_PER_PAGE = 12;

async function loadTransactions() {
  const d = await api('/api/seller/transactions');
  if (!d.success) return;
  const s = d.summary || {};
  $('txnSummary').innerHTML = `
    <div class="sw-stat" data-accent="orange">
      <div class="l">${tt('seller.tx.totalTopup')}</div>
      <div class="n">${fmtVnd(s.totalTopup)}</div>
    </div>
    <div class="sw-stat" data-accent="amber">
      <div class="l">${tt('seller.tx.totalPlus')}</div>
      <div class="n">${fmtVnd(s.totalPlus ?? s.totalTopup)}</div>
    </div>
    <div class="sw-stat" data-accent="red">
      <div class="l">${tt('seller.tx.totalMinus')}</div>
      <div class="n">${fmtVnd(s.totalMinus)}</div>
    </div>
    <div class="sw-stat" data-accent="blue">
      <div class="l">${tt('seller.tx.balance')}</div>
      <div class="n accent">${fmtVnd(s.balance)}</div>
    </div>`;
  if (dashboard) { dashboard.balance = s.balance; updateBalanceUI(); }
  allTransactions = d.transactions || [];
  txPage = 1;
  renderTransactions();
}

function renderTransactions() {
  if (!$('txnBody')) return;
  const typeF = $('txTypeFilter')?.value || 'all';
  const q = ($('txSearch')?.value || '').toLowerCase();
  const from = $('txDateFrom')?.value ? Date.parse($('txDateFrom').value) / 1000 : null;
  const to = $('txDateTo')?.value ? Date.parse($('txDateTo').value) / 1000 + 86400 : null;
  let rows = allTransactions.filter((t) => {
    if (typeF !== 'all' && t.type !== typeF) return false;
    if (q && !((t.id || '') + (t.description || '')).toLowerCase().includes(q)) return false;
    if (from && t.createdAt < from) return false;
    if (to && t.createdAt > to) return false;
    return true;
  });
  const pages = Math.max(1, Math.ceil(rows.length / TX_PER_PAGE));
  if (txPage > pages) txPage = pages;
  const pageRows = rows.slice((txPage - 1) * TX_PER_PAGE, txPage * TX_PER_PAGE);
  const typeLabel = {
    topup: { txt: tt('seller.tx.typeTopup'), cls: 'perm-badge--on' },
    purchase: { txt: tt('seller.tx.typePurchase'), cls: 'perm-badge--off' },
    admin_adjust: { txt: tt('seller.tx.typeAdjust'), cls: 'perm-badge--off' },
  };
  $('txnBody').innerHTML = pageRows.length ? pageRows.map((t) => {
    const pos = t.amount >= 0;
    const tl = typeLabel[t.type] || { txt: t.type, cls: 'perm-badge--off' };
    return `<tr>
      <td>${fmtTs(t.createdAt)}</td>
      <td><span class="perm-badge ${tl.cls}">${tl.txt}</span></td>
      <td style="color:${pos ? '#15803d' : '#b91c1c'};font-weight:700">${pos ? '+' : ''}${fmtVnd(t.amount)}</td>
      <td>${fmtVnd(t.balanceAfter)}</td>
      <td style="font-family:var(--sw-mono);font-size:0.78rem;color:#dc2626">${esc(t.id || '—')}</td>
      <td>${esc(t.description || '')}</td>
      <td><span class="perm-badge perm-badge--on">${tt('seller.tx.statusDone')}</span></td>
    </tr>`;
  }).join('') : `<tr><td colspan="7" class="panel-empty">${tt('seller.tx.empty')}</td></tr>`;
  const pag = $('txnPagination');
  if (pag) {
    pag.innerHTML = `<span>${tt('seller.tx.pageLabel').replace('{p}', txPage).replace('{t}', pages).replace('{n}', rows.length)}</span>
      <span>
        ${txPage > 1 ? `<button type="button" class="sw-btn sw-btn--outline sw-btn--sm" id="txPrev">← ${tt('seller.tx.prev')}</button>` : ''}
        ${txPage < pages ? `<button type="button" class="sw-btn sw-btn--outline sw-btn--sm" id="txNext">${tt('seller.tx.next')} →</button>` : ''}
      </span>`;
    $('txPrev')?.addEventListener('click', () => { txPage--; renderTransactions(); });
    $('txNext')?.addEventListener('click', () => { txPage++; renderTransactions(); });
  }
}

async function loadDeposit() {
  const balance = dashboard?.balance ?? 0;
  if ($('depBalance')) $('depBalance').textContent = fmtVnd(balance);
  const username = ($('topUserName')?.textContent || 'seller').trim();
  if ($('depMemo')) $('depMemo').textContent = 'chuyen tien ' + username.toUpperCase();
  const qr = $('depositQr');
  if (qr) {
    const acct = $('depAcct')?.textContent.trim() || '';
    const holder = $('depHolder')?.textContent.trim() || '';
    qr.src = `https://img.vietqr.io/image/VCB-${acct}-compact.png?addInfo=${encodeURIComponent('chuyen tien ' + username.toUpperCase())}&accountName=${encodeURIComponent(holder)}`;
  }
  document.querySelectorAll('[data-copy-from]').forEach((b) => {
    if (b._bound) return;
    b._bound = true;
    b.addEventListener('click', () => {
      const tgt = $(b.getAttribute('data-copy-from'));
      if (tgt) copyText(tgt.textContent.trim());
    });
  });
  const d = await api('/api/seller/transactions');
  const rows = (d?.transactions || []).slice(0, 10);
  const body = $('depRecentBody');
  if (body) {
    body.innerHTML = rows.length ? rows.map((t) => {
      const pos = t.amount >= 0;
      const typeTxt = t.type === 'topup' ? tt('seller.tx.typeTopup') : t.type === 'purchase' ? tt('seller.tx.typePurchase') : tt('seller.tx.typeAdjust');
      return `<tr>
        <td>${fmtTs(t.createdAt)}</td>
        <td><span class="perm-badge ${pos ? 'perm-badge--on' : 'perm-badge--off'}">${typeTxt}</span></td>
        <td style="color:${pos ? '#15803d' : '#b91c1c'};font-weight:700">${pos ? '+' : ''}${fmtVnd(t.amount)}</td>
        <td>${fmtVnd(t.balanceAfter)}</td>
        <td style="font-family:var(--sw-mono);font-size:0.78rem;color:#dc2626">${esc(t.id || '—')}</td>
      </tr>`;
    }).join('') : `<tr><td colspan="5" class="panel-empty">${tt('seller.tx.empty')}</td></tr>`;
  }
}

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

// ── Auth ──
let sellerTurnstileToken = null;
let sellerTurnstileWidgetId = null;
let sellerTurnstileEnabled = true;
let sellerTurnstileInited = false;

function authT(key, fallback, vars) {
  if (typeof I18n === 'undefined') return fallback;
  const s = I18n.t(key, vars);
  return s === key ? fallback : s;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.defer = true;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

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

function togglePw(inputId, btn) {
  const el = $(inputId);
  if (!el || !btn) return;
  const revealing = el.type === 'password';
  el.type = revealing ? 'text' : 'password';
  btn.textContent = revealing ? authT('seller.hidePw', 'Hide') : authT('seller.showPw', 'Show');
  btn.setAttribute('aria-label', revealing ? authT('seller.hidePw', 'Hide password') : authT('seller.showPw', 'Show password'));
}

function updateRegSubmitState() {
  const btn = $('rgBtn');
  if (!btn) return;
  const termsOk = !!$('rgTerms')?.checked;
  const captchaOk = !sellerTurnstileEnabled || !!sellerTurnstileToken;
  btn.disabled = !(termsOk && captchaOk);
}

function resetSellerTurnstile() {
  sellerTurnstileToken = null;
  if (sellerTurnstileWidgetId != null && window.turnstile) {
    try { turnstile.reset(sellerTurnstileWidgetId); } catch { /* ignore */ }
  }
  updateRegSubmitState();
}

async function initSellerTurnstile() {
  if (sellerTurnstileInited) return;
  sellerTurnstileInited = true;
  const wrap = $('sellerTurnstileWrap');
  if (!wrap) return;
  try {
    const cfg = await fetch('/api/turnstile/config').then((r) => r.json());
    sellerTurnstileEnabled = !!cfg.enabled;
    if (!sellerTurnstileEnabled) {
      wrap.style.display = 'none';
      sellerTurnstileToken = 'disabled';
      updateRegSubmitState();
      return;
    }
    await loadScript('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit');
    if (cfg.testMode) wrap.classList.add('form-turnstile--test');
    sellerTurnstileWidgetId = turnstile.render('#sellerTurnstileWrap', {
      sitekey: cfg.siteKey,
      theme: 'light',
      size: 'normal',
      callback(token) {
        sellerTurnstileToken = token;
        updateRegSubmitState();
      },
      'expired-callback': resetSellerTurnstile,
      'error-callback': resetSellerTurnstile,
    });
  } catch (e) {
    setErr('rgErr', authT('me.errTurnstileLoad', `Could not load Turnstile: ${e.message}`, { msg: e.message }));
  }
}

function showTab(t) {
  const isLogin = t === 'login';
  const isReg = t === 'reg';
  show('authHeadLogin', isLogin);
  show('authHeadReg', isReg);
  show('authFootLogin', isLogin);
  show('authFootReg', isReg);
  show('paneLogin', isLogin);
  show('paneReg', isReg);
  show('paneVerify', false);
  setErr('lgErr');
  setErr('rgErr');
  setErr('vErr');
  if (isReg) initSellerTurnstile();
  if (typeof I18n !== 'undefined') I18n.apply();
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
  const contactName = $('rgName').value.trim();
  const contactType = $('rgContactType').value;
  const contactInfo = $('rgContact').value.trim();
  const username = $('rgUser').value.trim();
  const email = $('rgEmail').value.trim();
  const password = $('rgPass').value;
  const pass2 = $('rgPass2').value;

  if (!contactName) return setErr('rgErr', authT('seller.errFullName', 'Enter your full name.'));
  if (!contactType) return setErr('rgErr', authT('seller.errContactType', 'Select a contact type.'));
  if (!contactInfo) return setErr('rgErr', authT('seller.errContactInfo', 'Enter contact info.'));
  if (username.length < 3) return setErr('rgErr', authT('seller.errUsername', 'Username must be at least 3 characters.'));
  if (!email.includes('@')) return setErr('rgErr', authT('seller.errEmail', 'Enter a valid email.'));
  if (password.length < 6) return setErr('rgErr', authT('seller.errPassword', 'Password must be at least 6 characters.'));
  if (password !== pass2) return setErr('rgErr', authT('seller.errPassMismatch', 'Passwords do not match.'));
  if (!$('rgTerms')?.checked) return setErr('rgErr', authT('seller.errTerms', 'Accept the terms of service.'));
  if (sellerTurnstileEnabled && !sellerTurnstileToken) {
    return setErr('rgErr', authT('me.errTurnstile', 'Complete the Cloudflare verification.'));
  }

  $('rgBtn').disabled = true;
  const d = await api('/api/seller/register', {
    username,
    email,
    password,
    contactName,
    contactType,
    contactInfo,
    turnstileToken: sellerTurnstileToken,
  });
  $('rgBtn').disabled = false;
  updateRegSubmitState();
  if (!d.success) {
    resetSellerTurnstile();
    return setErr('rgErr', d.error || authT('common.error', 'Error'));
  }
  pendingAccountId = d.accountId;
  openVerify(email);
}

function openVerify(email) {
  show('authHeadLogin', false);
  show('authHeadReg', false);
  show('authFootLogin', false);
  show('authFootReg', false);
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

function mountSellerLangSwitchers() {
  if (typeof I18n === 'undefined') return;
  const dash = $('langSwitchDash');
  if (dash && !dash.querySelector('.lang-switch')) {
    I18n.mountSwitcher(dash);
    dash.dataset.mounted = '1';
  }
}

async function enterDash(acct) {
  show('authView', false);
  show('dashView', true);
  mountSellerLangSwitchers();
  $('userAvatar').textContent = (acct.username || 'S')[0].toUpperCase();
  $('topUserName').textContent = acct.username || '';
  await loadDashboard();
  await loadOrders();
  await window.SellerKeys?.loadKeys();
  switchView('stats');
}

async function logout() {
  await api('/api/panel/logout', {});
  location.reload();
}

function initFilters() {}

// exports
window.showTab = showTab;
window.togglePw = togglePw;
window.updateRegSubmitState = updateRegSubmitState;
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
window.changePassword = changePassword;
window.closeBuyModal = closeBuyModal;
window.confirmBuy = confirmBuy;
window.fetchSellerMail = fetchSellerMail;
window.loadTransactions = loadTransactions;
window.renderTransactions = renderTransactions;
window.clearCart = clearCart;
window.checkoutCart = checkoutCart;
window.closeHistoryModal = closeHistoryModal;
window.loadOrders = loadOrders;
window.loadKeys = loadKeys;
window.debounceLoadOrders = debounceLoadOrders;
window.debounceRenderKeys = debounceRenderKeys;

document.addEventListener('DOMContentLoaded', () => {
  initFilters();
  $('langSelect')?.addEventListener('change', (e) => onLangSelect(e.target.value));
  syncLangSelect();
  $('rgTerms')?.addEventListener('change', updateRegSubmitState);
  $('emailPicker')?.addEventListener('focus', (e) => renderEmailDropdown(e.target.value));
  $('emailPicker')?.addEventListener('input', (e) => renderEmailDropdown(e.target.value));
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.sw-email-picker')) $('emailPickerDropdown')?.classList.remove('is-open');
  });
  $('storeSearch')?.addEventListener('input', () => renderStoreGrid());
  $('storeSort')?.addEventListener('change', () => renderStoreGrid());
  if (location.search.includes('reg=1') || location.hash === '#reg') showTab('reg');
  else showTab('login');
  window.SellerApp = {
    api, toast, copyText, esc, fmtTs,
    get sellerPerms() { return sellerPerms; },
    set sellerPerms(v) { sellerPerms = v; },
    get allKeys() { return allKeys; },
    set allKeys(v) { allKeys = v; },
    loadOrders, loadDashboard,
  };

  mountSellerLangSwitchers();
  document.addEventListener('langchange', () => {
    const active = document.querySelector('.sw-nav a.is-active')?.dataset.view || 'orders';
    switchView(active);
    syncLangSelect();
    if (typeof I18n !== 'undefined') I18n.apply();
  });

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
