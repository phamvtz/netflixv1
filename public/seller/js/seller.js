'use strict';

const PAGE_META = {
  stats: { title: 'Thống kê', caption: 'Tổng quan đơn hàng, key và số dư.' },
  orders: { title: 'Đơn hàng của bạn', caption: 'Quản lý tài khoản đã mua — gia hạn, copy, bật quyền mã cho khách.' },
  keys: { title: 'Quản lý Keys', caption: 'Tạo key gắn tài khoản đã mua, gán quyền truy cập. Thay thế email khi cần.' },
  store: { title: 'Cửa hàng', caption: 'Mua tài khoản Netflix — trừ số dư, tạo đơn tự động.' },
  emails: { title: 'Quản lý email', caption: 'Danh sách email từ đơn đã mua.' },
  transactions: { title: 'Lịch sử giao dịch', caption: 'Nạp tiền, mua hàng và số dư.' },
  profile: { title: 'Thông tin tài khoản', caption: 'Liên hệ hỗ trợ khách.' },
  checker: { title: 'Checker cookie', caption: 'Kiểm tra cookie tài khoản còn LIVE hay không.' },
};

const PERM_DEFS = [
  { field: 'permLogin', label: 'Mã đăng nhập' },
  { field: 'permReset', label: 'Đổi mật khẩu' },
  { field: 'permFamily', label: 'Hộ gia đình' },
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
    toast('Đã sao chép');
  } catch { toast('Copy thủ công: ' + s); }
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
  return `Quyền admin: ${ok(sellerPerms.permLogin)} Mã ĐN · ${ok(sellerPerms.permReset)} Reset · ${ok(sellerPerms.permFamily)} Mã GĐ`;
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
  if (!d.success) return toast(d.error || 'Lỗi tải đơn');
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
        <h3>Chưa có đơn hàng</h3>
        <p>Mua tại Cửa hàng hoặc nhờ admin cấp đơn.</p>
        <button type="button" class="sw-btn sw-btn--primary" style="margin-top:14px" onclick="switchView('store')">Tới cửa hàng</button>
      </div>`;
    $('ordersPagination').innerHTML = '';
    return;
  }

  box.innerHTML = allOrders.map((o) => orderCardHtml(o)).join('');
  bindOrderEvents();

  const p = pagination || { page: 1, pages: 1, total: allOrders.length };
  $('ordersPagination').innerHTML = `
    <span>Trang ${p.page}/${p.pages} — ${p.total} đơn</span>
    <span>
      ${p.page > 1 ? `<button type="button" class="sw-btn sw-btn--outline" data-page="${p.page - 1}">← Trước</button> ` : ''}
      ${p.page < p.pages ? `<button type="button" class="sw-btn sw-btn--outline" data-page="${p.page + 1}">Sau →</button>` : ''}
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
    ? '<span class="sw-order-badge sw-order-badge--expired">HẾT HẠN</span>'
    : '<span class="sw-order-badge">ĐANG CÒN HẠN</span>';
  const dur = o.durationLabel ? `<span class="perm-badge perm-badge--on" style="margin-left:6px">${esc(o.durationLabel)}</span>` : '';
  const keys = o.keys || [];
  const keyBtn = keys.length
    ? `<button type="button" class="sw-btn sw-btn--outline" data-act="keys" data-id="${esc(o.id)}">Quản lý key (${keys.length})</button>`
    : `<button type="button" class="sw-btn sw-btn--outline" data-act="createkey" data-id="${esc(o.id)}">Tạo key</button>`;

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
            <label>Mã định danh</label>
            <div class="sw-field-val mono">${esc(o.publicCode)} <button type="button" class="sw-icon-btn" data-copy="${esc(o.publicCode)}">⎘</button></div>
          </div>
          <div class="sw-field">
            <label>Email</label>
            <div class="sw-field-val">${esc(o.accountEmail)} <button type="button" class="sw-icon-btn" data-copy="${esc(o.accountEmail)}">⎘</button></div>
          </div>
          <div class="sw-field">
            <label>Mật khẩu</label>
            <div class="sw-pwd-row">
              <input type="text" class="panel-input" data-pwd="${esc(o.id)}" value="${esc(o.accountPassword || '')}" placeholder="—" style="margin:0" />
              <button type="button" class="sw-icon-btn" data-act="savepwd" data-id="${esc(o.id)}" title="Lưu">✓</button>
            </div>
          </div>
          <div class="sw-field">
            <label>Hết hạn</label>
            <div class="sw-field-val">Tới: ${fmtTs(o.expiresAt)}<br><span style="font-size:0.78rem;color:#64748b">Đã gia hạn ${o.renewalCount} lần</span></div>
          </div>
        </div>
        <div class="sw-perm-section">
          <label class="sw-toggle">
            <input type="checkbox" data-act="via" data-id="${esc(o.id)}" ${o.viaEmail ? 'checked' : ''} />
            <span class="sw-toggle-track"></span>
            <span><strong>Lấy mã qua email</strong></span>
          </label>
          <div class="title" style="margin-top:12px">Loại mã khách được xem</div>
          <div class="sw-perm-pills">${permPills}</div>
          <p class="sw-perm-note">Khách lấy mã bằng key/email sẽ chỉ nhận các loại mã bạn bật ở trên.</p>
        </div>
        <div class="sw-order-foot">
          <button type="button" class="sw-btn sw-btn--primary" data-act="renew" data-id="${esc(o.id)}">Gia hạn ngay</button>
          <button type="button" class="sw-btn sw-btn--outline" data-act="history" data-id="${esc(o.id)}">Lịch sử</button>
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
      if (d.success) toast('Đã cập nhật'); else { toast(d.error || 'Lỗi'); inp.checked = !inp.checked; }
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
      if (d.success) { toast('Đã cập nhật quyền'); loadOrders(); loadKeys(); }
      else toast(d.error || 'Lỗi');
    });
  });

  box.querySelectorAll('[data-act="savepwd"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const inp = box.querySelector(`[data-pwd="${id}"]`);
      const d = await api(`/api/seller/orders/${encodeURIComponent(id)}`, { accountPassword: inp?.value || '' }, 'PATCH');
      if (d.success) toast('Đã lưu mật khẩu');
      else toast(d.error || 'Lỗi');
    });
  });

  box.querySelectorAll('[data-act="renew"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Gia hạn đơn này? (cộng thêm thời hạn theo gói)')) return;
      const d = await api(`/api/seller/orders/${encodeURIComponent(btn.dataset.id)}/renew`, {}, 'POST');
      if (d.success) { toast('Đã gia hạn'); loadOrders(); loadDashboard(); }
      else toast(d.error || 'Lỗi gia hạn');
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
  if (!d.success) return toast(d.error || 'Lỗi');
  $('histTitle').textContent = 'Lịch sử · ' + orderId;
  $('histList').innerHTML = (d.events || []).length
    ? d.events.map((e) => `<div class="sw-history-item"><b>${esc(e.eventType)}</b> · ${fmtTs(e.createdAt)}${e.detail ? '<br>' + esc(e.detail) : ''}</div>`).join('')
    : '<p class="sub">Chưa có sự kiện.</p>';
  $('historyModal').classList.add('show');
}
function closeHistoryModal() { $('historyModal')?.classList.remove('show'); }

function permBadgesHtml(k) {
  const b = (on, l) => `<span class="perm-badge ${on ? 'perm-badge--on' : 'perm-badge--off'}">${l}</span>`;
  return `<div class="perm-badges">${b(k.permLogin, 'ĐN')}${b(k.permReset, 'Reset')}${b(k.permFamily, 'GĐ')}</div>`;
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
      <button type="button" class="sw-btn sw-btn--primary" style="margin-top:12px;width:100%" data-buy="${esc(p.id)}">Mua ngay</button>
    </div>`).join('');
  grid.querySelectorAll('[data-buy]').forEach((btn) => {
    btn.addEventListener('click', () => openBuyModal(btn.dataset.buy));
  });
}

function openBuyModal(productId) {
  buyProduct = products.find((p) => p.id === productId);
  if (!buyProduct) return;
  $('buyTitle').textContent = buyProduct.name;
  $('buyPrice').textContent = 'Giá: ' + fmtVnd(buyProduct.price);
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
  if (!email.includes('@')) return setErr('buyErr', 'Nhập email hợp lệ');
  $('buyBtn').disabled = true;
  const d = await api('/api/seller/store/buy', {
    productId: buyProduct.id,
    accountEmail: email,
    accountPassword: pass || null,
  });
  $('buyBtn').disabled = false;
  if (!d.success) return setErr('buyErr', d.error || 'Mua thất bại');
  toast('Mua thành công · ' + d.order.id);
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
    : '<tr><td colspan="4" class="panel-empty">Chưa có email</td></tr>';
}

async function loadTransactions() {
  const d = await api('/api/seller/transactions');
  if (!d.success) return;
  const s = d.summary || {};
  $('txnSummary').innerHTML = `
    <div class="sw-stat"><div class="n">${fmtVnd(s.totalTopup)}</div><div class="l">Tổng nạp</div></div>
    <div class="sw-stat"><div class="n accent">${fmtVnd(s.balance)}</div><div class="l">Số dư hiện tại</div></div>
    <div class="sw-stat"><div class="n">${fmtVnd(s.totalMinus)}</div><div class="l">Tổng trừ</div></div>
    <div class="sw-stat"><div class="n">${(d.transactions || []).length}</div><div class="l">Giao dịch</div></div>`;
  dashboard.balance = s.balance;
  updateBalanceUI();
  const typeLabel = { topup: 'Nạp tiền', purchase: 'Mua hàng', admin_adjust: 'Điều chỉnh' };
  $('txnBody').innerHTML = (d.transactions || []).map((t) => {
    const pos = t.amount >= 0;
    return `<tr>
      <td>${fmtTs(t.createdAt)}</td>
      <td>${typeLabel[t.type] || t.type}</td>
      <td style="color:${pos ? '#15803d' : '#b91c1c'}">${pos ? '+' : ''}${fmtVnd(t.amount)}</td>
      <td>${fmtVnd(t.balanceAfter)}</td>
      <td>${esc(t.description || '')}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="5" class="panel-empty">Chưa có giao dịch</td></tr>';
}

// ── Checker cookie ──
function checkerBadge(r) {
  if (r.rateLimited) return '<span class="sw-order-badge sw-order-badge--expired">GIỚI HẠN</span>';
  if (r.planLost || (r.paymentError && r.plan)) return '<span class="sw-order-badge sw-order-badge--expired">MẤT GÓI</span>';
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
  if (!lines.length) return toast('Dán cookie (có NetflixId=) trước');

  const pace = $('chkPace')?.value || 'stealth';
  const btn = $('chkBtn');
  btn.disabled = true;
  btn.textContent = 'Đang kiểm tra…';
  // Render hàng "đang chờ" trước, rồi check tuần tự cập nhật từng dòng
  $('chkResults').innerHTML = lines
    .map((_, i) => `<tr id="chk-${i}"><td>${i + 1}</td><td><span class="sw-order-badge">…</span></td><td>—</td><td>—</td></tr>`)
    .join('');

  for (let i = 0; i < lines.length; i++) {
    let r;
    try { r = await api('/api/checker/live-check', { cookie: lines[i], pace }); }
    catch (e) { r = { alive: false, error: e.message }; }
    updateCheckerRow(i, r);
    if (r.rateLimited) { toast(r.error || 'Đã đạt giới hạn check/giờ'); break; }
  }

  btn.disabled = false;
  btn.textContent = 'Kiểm tra';
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
  if (d.success) { toast('Đã lưu'); dashboard.profile = d.profile; }
  else toast(d.error || 'Lỗi');
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
  if (!username || !password) return setErr('lgErr', 'Nhập username và mật khẩu.');
  $('lgBtn').disabled = true;
  const d = await api('/api/panel/login', { username, password });
  $('lgBtn').disabled = false;
  if (d.success) {
    if (d.account.role !== 'seller') return setErr('lgErr', 'Không phải seller.');
    return enterDash(d.account);
  }
  if (d.needVerify) {
    pendingAccountId = d.accountId;
    openVerify(username);
    return setErr('lgErr', 'Chưa xác minh email.');
  }
  setErr('lgErr', d.error || 'Đăng nhập thất bại.');
}

async function doRegister() {
  setErr('rgErr');
  const d = await api('/api/seller/register', {
    username: $('rgUser').value.trim(),
    email: $('rgEmail').value.trim(),
    password: $('rgPass').value,
  });
  if (!d.success) return setErr('rgErr', d.error || 'Lỗi');
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
  if (!/^\d{6}$/.test(code)) return setErr('vErr', 'Mã 6 số');
  const d = await api('/api/seller/verify-email', { accountId: pendingAccountId, code });
  if (!d.success) return setErr('vErr', d.error || 'Lỗi');
  setOk('vOk', 'OK — chờ admin duyệt');
  setTimeout(() => showTab('login'), 1500);
}

async function doResend() {
  const d = await api('/api/seller/resend-code', { accountId: pendingAccountId });
  toast(d.success ? 'Đã gửi lại mã' : (d.error || 'Lỗi'));
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
