'use strict';
// Seller workspace — Orders: list, card, events, history
// Split from seller.js. Classic script: shares global scope with the other seller-*.js files.

function setOrderStatus(status, btn) {
  // Update hidden input
  const inp = $('orderStatusSelect');
  if (inp) inp.value = status;
  // Update active tab styling
  document.querySelectorAll('#orderStatusTabs .sw-filter-tab').forEach((b) => b.classList.remove('is-active'));
  if (btn) btn.classList.add('is-active');
  orderPage = 1;
  loadOrders();
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
        <h3>${tt('seller.orders.empty')}</h3>
        <p>${tt('seller.orders.emptySub')}</p>
        <button type="button" class="sw-btn sw-btn--primary" style="margin-top:14px" onclick="switchView('store')">${tt('seller.navStore')}</button>
      </div>`;
    $('ordersPagination').innerHTML = '';
    return;
  }

  box.innerHTML = allOrders.map((o) => orderCardHtml(o)).join('');
  bindOrderEvents();

  const p = pagination || { page: 1, pages: 1, total: allOrders.length };
  $('ordersPagination').innerHTML = `
    <span>${tt('seller.order.pageLabel').replace('{p}', p.page).replace('{t}', p.pages).replace('{n}', p.total)}</span>
    <span>
      ${p.page > 1 ? `<button type="button" class="sw-btn sw-btn--outline sw-btn--sm" data-page="${p.page - 1}">← ${tt('seller.tx.prev')}</button> ` : ''}
      ${p.page < p.pages ? `<button type="button" class="sw-btn sw-btn--outline sw-btn--sm" data-page="${p.page + 1}">${tt('seller.tx.next')} →</button>` : ''}
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
    ? `<span class="sw-order-status sw-order-status--expired">${tt('seller.order.statusExpired')}</span>`
    : `<span class="sw-order-status sw-order-status--active">${tt('seller.order.statusActive')}</span>`;
  const dur = o.durationLabel ? `<span class="sw-order-dur">${esc(o.durationLabel)}</span>` : '';
  const keys = o.keys || [];
  const keyBtn = keys.length
    ? `<button type="button" class="sw-btn sw-btn--outline sw-btn--sm" data-act="keys" data-id="${esc(o.id)}">${tt('seller.order.manageKeys').replace('{n}', keys.length)}</button>`
    : `<button type="button" class="sw-btn sw-btn--outline sw-btn--sm" data-act="createkey" data-id="${esc(o.id)}">${tt('seller.order.createKey')}</button>`;

  const PERM_LABELS = {
    permLogin: tt('seller.order.permLogin'),
    permReset: tt('seller.order.permReset'),
    permFamily: tt('seller.order.permFamily'),
  };
  const permPills = PERM_DEFS.map((d) => {
    const allowed = canPerm(d.field);
    const on = o[d.field];
    const dis = allowed ? '' : ' off-disabled';
    return `<button type="button" class="sw-perm-pill${on ? ' on' : ''}${dis}" data-act="perm" data-id="${esc(o.id)}" data-field="${d.field}" ${allowed ? '' : 'disabled'}>${PERM_LABELS[d.field]}</button>`;
  }).join('');

  return `
    <article class="sw-order" data-order="${esc(o.id)}">
      <div class="sw-order-head">
        <div class="sw-order-headline">
          <div class="sw-order-title">${esc(o.productName)}</div>
          ${dur}
        </div>
        <div class="sw-order-headend">
          <span class="sw-order-id">${esc(o.id)}</span>
          ${badge}
        </div>
      </div>
      <div class="sw-order-body">
        <div class="sw-field-grid">
          <div class="sw-field">
            <label>${tt('seller.order.publicCode')}</label>
            <div class="sw-field-val mono">${esc(o.publicCode)} <button type="button" class="sw-icon-btn" data-copy="${esc(o.publicCode)}" title="${tt('common.copy')}">⎘</button></div>
          </div>
          <div class="sw-field">
            <label>${tt('seller.order.email')}</label>
            <div class="sw-field-val">${esc(o.accountEmail)} <button type="button" class="sw-icon-btn" data-copy="${esc(o.accountEmail)}" title="${tt('common.copy')}">⎘</button></div>
          </div>
          <div class="sw-field">
            <label>${tt('seller.order.password')}</label>
            <div class="sw-pwd-row">
              <input type="text" class="panel-input" data-pwd="${esc(o.id)}" value="${esc(o.accountPassword || '')}" placeholder="—" style="margin:0" />
              <button type="button" class="sw-icon-btn" data-act="savepwd" data-id="${esc(o.id)}" title="${tt('seller.order.savePwd')}">✓</button>
            </div>
          </div>
          <div class="sw-field">
            <label>${tt('seller.order.expiry')}</label>
            <div class="sw-field-val">${tt('seller.order.until')}: ${fmtTs(o.expiresAt)}<br><span class="sw-field-sub">${tt('seller.order.renewed').replace('{n}', o.renewalCount)}</span></div>
          </div>
        </div>
        <div class="sw-perm-section">
          <label class="sw-toggle">
            <input type="checkbox" data-act="via" data-id="${esc(o.id)}" ${o.viaEmail ? 'checked' : ''} />
            <span class="sw-toggle-track"></span>
            <span><strong>${tt('seller.order.viaEmail')}</strong></span>
          </label>
          <div class="title" style="margin-top:12px">${tt('seller.order.codeTypes')}</div>
          <div class="sw-perm-pills">${permPills}</div>
          <p class="sw-perm-note">${tt('seller.order.codeNote')}</p>
        </div>
        <div class="sw-order-foot">
          <button type="button" class="sw-btn sw-btn--primary sw-btn--sm" data-act="renew" data-id="${esc(o.id)}">${tt('seller.order.renew')}</button>
          <button type="button" class="sw-btn sw-btn--outline sw-btn--sm" data-act="history" data-id="${esc(o.id)}">${tt('seller.order.history')}</button>
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

// ── History event type labels ──────────────────────────────────
const HISTORY_LABELS = {
  renewed:           '🔄 Gia hạn',
  perm_changed:      '🔑 Thay đổi quyền',
  password_changed:  '🔒 Đổi mật khẩu',
  created:           '✅ Tạo đơn',
  purchased:         '🛒 Mua hàng',
  expired:           '⏰ Hết hạn',
  revoked:           '❌ Thu hồi',
  via_email_changed: '📧 Đổi cài đặt mail',
};

// Parse history event detail into readable HTML
function formatHistoryDetail(eventType, raw) {
  if (!raw) return '';
  let obj;
  try { obj = JSON.parse(raw); } catch { return `<span class="hist-detail">${esc(raw)}</span>`; }

  if (eventType === 'renewed') {
    const days = obj.daysAdded || obj.days || '';
    const exp  = obj.newExpiry || obj.expiresAt || '';
    const parts = [];
    if (days) parts.push(`+${days} ngày`);
    if (exp)  parts.push(`Hết hạn mới: <b>${fmtTs(exp)}</b>`);
    return parts.length ? `<span class="hist-detail">${parts.join(' · ')}</span>` : '';
  }

  if (eventType === 'perm_changed') {
    const pills = [];
    const yn = (v) => v ? '<span class="hpill hpill--on">✓</span>' : '<span class="hpill hpill--off">✗</span>';
    if (obj.permLogin   !== undefined) pills.push(`${yn(obj.permLogin)} Login code`);
    if (obj.permReset   !== undefined) pills.push(`${yn(obj.permReset)} Reset mật khẩu`);
    if (obj.permFamily  !== undefined) pills.push(`${yn(obj.permFamily)} Household`);
    if (obj.viaEmail    !== undefined) pills.push(`📧 Gửi qua email: ${obj.viaEmail ? 'Bật' : 'Tắt'}`);
    return pills.length ? `<span class="hist-detail">${pills.join(' &nbsp;·&nbsp; ')}</span>` : '';
  }

  if (eventType === 'password_changed') {
    return '<span class="hist-detail">Mật khẩu đã được cập nhật.</span>';
  }

  if (eventType === 'via_email_changed') {
    const on = obj.viaEmail;
    return `<span class="hist-detail">Nhận code qua email: <b>${on ? 'Bật' : 'Tắt'}</b></span>`;
  }

  // fallback: show key-value pairs (skip internal/large fields)
  const skip = new Set(['id','sellerId','accountEmail','accountPassword','publicCode','productId']);
  const pairs = Object.entries(obj)
    .filter(([k]) => !skip.has(k) && typeof obj[k] !== 'object')
    .map(([k, v]) => `${esc(k)}: <b>${esc(String(v))}</b>`);
  return pairs.length ? `<span class="hist-detail">${pairs.join(' · ')}</span>` : '';
}

async function openHistory(orderId) {
  const d = await api(`/api/seller/orders/${encodeURIComponent(orderId)}/history`);
  if (!d.success) return toast(d.error || 'Error');
  $('histTitle').textContent = 'Lịch sử · ' + orderId;
  const events = d.events || [];
  if (!events.length) {
    $('histList').innerHTML = '<p class="sub" style="padding:12px 0;color:var(--sw-muted)">Chưa có sự kiện nào.</p>';
  } else {
    $('histList').innerHTML = events.map((e) => {
      const label  = HISTORY_LABELS[e.eventType] || esc(e.eventType);
      const detail = formatHistoryDetail(e.eventType, e.detail);
      return `<div class="sw-history-item">
        <div class="hist-row">
          <span class="hist-label">${label}</span>
          <span class="hist-time">${fmtTs(e.createdAt)}</span>
        </div>
        ${detail ? `<div class="hist-body">${detail}</div>` : ''}
      </div>`;
    }).join('');
  }
  $('historyModal').classList.add('show');
}
function closeHistoryModal() { $('historyModal')?.classList.remove('show'); }

function permBadgesHtml(k) {
  const b = (on, l) => `<span class="perm-badge ${on ? 'perm-badge--on' : 'perm-badge--off'}">${l}</span>`;
  return `<div class="perm-badges">${b(k.permLogin, 'Login')}${b(k.permReset, 'Reset')}${b(k.permFamily, 'Household')}</div>`;
}
