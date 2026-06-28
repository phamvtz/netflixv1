'use strict';
// Seller workspace — Dashboard: stats KPIs + recent tx/orders
// Split from seller.js. Classic script: shares global scope with the other seller-*.js files.

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
        <td><span class="sw-order-status ${o.status === 'expired' ? 'sw-order-status--expired' : 'sw-order-status--active'}">${o.status === 'expired' ? tt('seller.order.statusExpired') : tt('seller.order.statusActive')}</span></td>
      </tr>`).join('') : `<tr><td colspan="3" class="panel-empty">${tt('seller.orders.empty')}</td></tr>`;
  }
}
