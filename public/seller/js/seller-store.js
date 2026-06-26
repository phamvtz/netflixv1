'use strict';
// Seller workspace — Store: products grid + buy modal
// Split from seller.js. Classic script: shares global scope with the other seller-*.js files.

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

  grid.innerHTML = list.map((p) => {
    // "NEW" badge for products created within the last 14 days.
    const ageDays = p.createdAt ? (Date.now() / 1000 - p.createdAt) / 86400 : 999;
    const badgeHtml = ageDays <= 14
      ? `<span class="prod-tag" style="background:#f5f5f5 !important;color:#0a0a0a !important">${tt('seller.store.tagNew')}</span>`
      : '';

    return `
    <div class="sw-product-card">
      <div class="prod-banner">
        <div class="nf-mark">NETFLIX</div>
        ${badgeHtml}
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
