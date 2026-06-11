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
    let stock = 10;
    let badgeHtml = '';
    let metaTagsHtml = '';
    
    if (p.id === 'prod_nf_fam_c1_1d') {
      stock = 5;
      badgeHtml = `<span class="prod-tag" style="background:#ef4444 !important;color:#fff !important">HOT</span>`;
      metaTagsHtml = `
        <div style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap">
          <span style="display:inline-flex;align-items:center;gap:4px;font-size:0.74rem;color:#4b5563;background:#f3f4f6;padding:3px 8px;border-radius:6px;border:1px solid #e5e7eb">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            1 user
          </span>
          <span style="display:inline-flex;align-items:center;gap:4px;font-size:0.74rem;color:#4b5563;background:#f3f4f6;padding:3px 8px;border-radius:6px;border:1px solid #e5e7eb">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
            2 giờ
          </span>
        </div>`;
    } else if (p.id === 'prod_nf_extra_full') {
      stock = 16;
      badgeHtml = `<span class="prod-tag" style="background:#10b981 !important;color:#fff !important">${tt('seller.store.tagNew')}</span>`;
      metaTagsHtml = `
        <div style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap">
          <span style="display:inline-flex;align-items:center;gap:4px;font-size:0.74rem;color:#4b5563;background:#f3f4f6;padding:3px 8px;border-radius:6px;border:1px solid #e5e7eb">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
            3 mức thời hạn
          </span>
        </div>`;
    } else if (p.id === 'prod_nf_fam_1m') {
      stock = 0;
      badgeHtml = `<span class="prod-tag" style="background:#10b981 !important;color:#fff !important">${tt('seller.store.tagNew')}</span>`;
    } else {
      const ageDays = p.createdAt ? (Date.now() / 1000 - p.createdAt) / 86400 : 999;
      badgeHtml = ageDays <= 14
        ? `<span class="prod-tag" style="background:#10b981 !important;color:#fff !important">${tt('seller.store.tagNew')}</span>`
        : '';
    }

    const priceText = p.id === 'prod_nf_extra_full' ? tt('seller.store.priceFrom', { price: fmtVnd(40000) }) : fmtVnd(p.price);
    const isOutOfStock = stock <= 0;
    
    const buyButtonHtml = isOutOfStock
      ? `<button type="button" class="sw-btn sw-btn--outline" style="flex:1.2;background:#f3f4f6 !important;color:#9ca3af !important;border-color:#e5e7eb !important;cursor:not-allowed" disabled>
           <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
           Hết hàng
         </button>`
      : `<button type="button" class="sw-btn sw-btn--primary" data-buy="${esc(p.id)}">
           <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
           ${tt('seller.store.buy')}
         </button>`;

    return `
    <div class="sw-product-card">
      <div class="prod-banner">
        <div class="prod-stock-badge">Kho ${stock}</div>
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
        ${metaTagsHtml}
        <div class="prod-price" style="${p.id === 'prod_nf_extra_full' ? 'color:#2563eb' : ''}">${priceText}</div>
        <div class="prod-actions">
          <button type="button" class="sw-btn sw-btn--outline" data-view-prod="${esc(p.id)}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>
            ${tt('seller.store.view')}
          </button>
          ${buyButtonHtml}
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
