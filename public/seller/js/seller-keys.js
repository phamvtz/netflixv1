'use strict';

/** Quản lý Keys — UI + API (modal tạo/sửa theo MMOJobs) */
(function () {
  const $ = (id) => document.getElementById(id);
  const MAX_KEYS_BATCH = 5;

  let ordersForKeys = [];
  let createRows = [{ id: 1 }];
  let createRowIdSeq = 1;
  let keySearchDebounce;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fmtTs(sec) {
    if (!sec) return '—';
    try {
      return new Date(sec * 1000).toLocaleString('vi-VN', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
      });
    } catch { return '—'; }
  }

  function toLocalInput(sec) {
    if (!sec) return '';
    return new Date(sec * 1000).toISOString().slice(0, 16);
  }

  function permBadgesHtml(k) {
    const b = (on, l) => `<span class="perm-badge ${on ? 'perm-badge--on' : 'perm-badge--off'}">${l}</span>`;
    return `<div class="perm-badges">${b(k.permLogin, 'Mã ĐN')}${b(k.permReset, 'Reset')}${b(k.permFamily, 'HGĐ')}</div>`;
  }

  function orderPermHint(orderPerms, sellerPerms) {
    const ok = (v) => (v ? '✔' : '✘');
    const o = orderPerms || sellerPerms;
    return `Quyền admin cấp cho tài khoản này: ${ok(o?.permLogin)} Mã ĐN · ${ok(o?.permReset)} Reset · ${ok(o?.permFamily)} HGĐ`;
  }

  function renderPermCheckboxes(containerId, values, orderPerms) {
    const el = $(containerId);
    if (!el) return;
    const sp = window.SellerApp?.sellerPerms || { permLogin: true, permReset: false, permFamily: true };
    const max = orderPerms || sp;
    const defs = [
      { field: 'permLogin', label: 'Mã đăng nhập' },
      { field: 'permReset', label: 'Link đổi mật khẩu' },
      { field: 'permFamily', label: 'Mã hộ gia đình' },
    ];
    el.innerHTML = defs.map((d) => {
      const allowed = !!max[d.field];
      const checked = allowed && !!(values?.[d.field]);
      return `<label><input type="checkbox" data-field="${d.field}" ${checked ? 'checked' : ''} ${allowed ? '' : 'disabled'} /><span>${d.label}</span></label>`;
    }).join('');
    const hint = $(containerId === 'edPermChecks' ? 'edPermHint' : null);
    if (hint) hint.textContent = orderPermHint(orderPerms, sp);
  }

  function readPermCheckboxes(containerId) {
    const out = { permLogin: false, permReset: false, permFamily: false };
    $(containerId)?.querySelectorAll('input[data-field]').forEach((inp) => {
      if (inp.checked) out[inp.dataset.field] = true;
    });
    return out;
  }

  async function loadKeys() {
    const d = await window.SellerApp.api('/api/seller/keys');
    if (d.success) {
      window.SellerApp.allKeys = d.keys || [];
      if (d.sellerPerms) window.SellerApp.sellerPerms = d.sellerPerms;
    }
    renderKeysTable();
  }

  function debounceRenderKeys() {
    clearTimeout(keySearchDebounce);
    keySearchDebounce = setTimeout(renderKeysTable, 280);
  }

  function renderKeysTable() {
    const q = ($('kSearch')?.value || '').trim().toLowerCase();
    let rows = window.SellerApp.allKeys || [];
    if (q) {
      rows = rows.filter((k) =>
        [k.key, k.email, k.keyName, k.note, k.orderId].some((f) => String(f || '').toLowerCase().includes(q)),
      );
    }
    const body = $('kBody');
    if (!body) return;
    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="6" class="panel-empty">${(window.SellerApp.allKeys || []).length ? 'Không khớp' : 'Chưa có key — bấm + Tạo Key'}</td></tr>`;
      return;
    }
    body.innerHTML = rows.map((k) => {
      const expOrder = k.orderExpiresAt ? fmtTs(k.orderExpiresAt) : null;
      const accLine = expOrder ? `<div class="acc-sub">Hạn đơn: ${expOrder}</div>` : '';
      return `<tr>
        <td><div>${esc(k.email)}</div>${accLine}</td>
        <td>${esc(k.keyName || '—')}</td>
        <td class="mono" style="font-size:0.78rem">${esc(k.key)}
          <button type="button" class="sw-icon-btn" style="margin-left:4px;vertical-align:middle" data-copy="${esc(k.key)}">⎘</button></td>
        <td><div>Tạo: <span class="time-sub">${fmtTs(k.createdAt)}</span></div>
            <div>Hết: <span class="time-sub">${fmtTs(k.expiresAt)}</span></div></td>
        <td>${permBadgesHtml(k)}</td>
        <td><div class="act-group">
          <button type="button" class="sw-act-btn" title="Sửa" data-edit="${esc(k.key)}">✎</button>
          <button type="button" class="sw-act-btn" title="Đồng bộ từ đơn" data-sync="${esc(k.key)}">↻</button>
          <button type="button" class="sw-act-btn sw-act-btn--danger" title="Xóa" data-del="${esc(k.key)}">🗑</button>
        </div></td>
      </tr>`;
    }).join('');

    body.querySelectorAll('[data-copy]').forEach((b) => {
      b.addEventListener('click', () => window.SellerApp.copyText(b.dataset.copy));
    });
    body.querySelectorAll('[data-edit]').forEach((b) => {
      b.addEventListener('click', () => openEditKey(b.dataset.edit));
    });
    body.querySelectorAll('[data-sync]').forEach((b) => {
      b.addEventListener('click', () => syncKey(b.dataset.sync));
    });
    body.querySelectorAll('[data-del]').forEach((b) => {
      b.addEventListener('click', () => deleteKey(b.dataset.del));
    });
  }

  async function syncKey(keyId) {
    const d = await window.SellerApp.api(`/api/seller/keys/${encodeURIComponent(keyId)}/sync`, {}, 'POST');
    if (d.success) {
      window.SellerApp.toast('Đã đồng bộ quyền & hạn từ đơn');
      loadKeys();
    } else window.SellerApp.toast(d.error || 'Lỗi đồng bộ');
  }

  async function deleteKey(keyId) {
    if (!confirm('Xóa key này? Khách sẽ không dùng được nữa.')) return;
    const d = await window.SellerApp.api(`/api/seller/keys/${encodeURIComponent(keyId)}`, null, 'DELETE');
    if (d.success) {
      window.SellerApp.toast('Đã xóa key');
      loadKeys();
      window.SellerApp.loadOrders?.();
    } else window.SellerApp.toast(d.error || 'Lỗi xóa');
  }

  let editingKeyId = null;

  function openEditKey(keyId) {
    const k = (window.SellerApp.allKeys || []).find((x) => x.key === keyId);
    if (!k) return;
    editingKeyId = keyId;
    $('editTitle').textContent = 'Sửa Key · ' + (k.keyName || k.key.slice(0, 12));
    $('edEmail').value = k.email;
    $('edName').value = k.keyName || '';
    $('edExpires').value = toLocalInput(k.expiresAt);
    renderPermCheckboxes('edPermChecks', k, k.orderPerms);
    $('editModal').classList.add('show');
  }

  function closeEditModal() {
    $('editModal')?.classList.remove('show');
    editingKeyId = null;
  }

  async function saveEditKey() {
    if (!editingKeyId) return;
    $('edSaveBtn').disabled = true;
    const perms = readPermCheckboxes('edPermChecks');
    const d = await window.SellerApp.api(`/api/seller/keys/${encodeURIComponent(editingKeyId)}`, {
      keyName: $('edName').value.trim(),
      expiresAt: $('edExpires').value || null,
      ...perms,
    }, 'PATCH');
    $('edSaveBtn').disabled = false;
    if (!d.success) return window.SellerApp.toast(d.error || 'Lỗi');
    window.SellerApp.toast('Đã lưu thay đổi');
    closeEditModal();
    loadKeys();
    window.SellerApp.loadOrders?.();
  }

  async function loadOrdersForPicker() {
    const d = await window.SellerApp.api('/api/seller/orders?status=active&perPage=200');
    ordersForKeys = d.success ? (d.orders || []) : [];
    const dl = $('crOrderList');
    if (dl) {
      dl.innerHTML = ordersForKeys.map((o) =>
        `<option value="${esc(o.id)}">${esc(o.accountEmail)} — ${esc(o.productName)}</option>`,
      ).join('');
    }
  }

  function resolveOrderFromSearch() {
    const q = ($('crOrderSearch')?.value || '').trim().toLowerCase();
    if (!q) return null;
    return ordersForKeys.find((o) =>
      o.id.toLowerCase() === q ||
      o.accountEmail.toLowerCase() === q ||
      o.publicCode?.toLowerCase() === q ||
      `${o.accountEmail} — ${o.productName}`.toLowerCase().includes(q),
    ) || ordersForKeys.find((o) => o.accountEmail.toLowerCase().includes(q));
  }

  function getSelectedOrder() {
    const id = $('crOrderId')?.value;
    if (id) return ordersForKeys.find((o) => o.id === id);
    return resolveOrderFromSearch();
  }

  function renderCreateRows() {
    const box = $('crKeyRows');
    if (!box) return;
    const order = getSelectedOrder();
    const expDefault = order ? toLocalInput(order.expiresAt) : '';
    const nameDefault = '';
    const syncName = $('crSyncName')?.checked;
    const syncExp = $('crSyncExpires')?.checked;

    box.innerHTML = createRows.map((row, idx) => {
      const showName = !syncName || idx === 0;
      const showExp = !syncExp || idx === 0;
      return `<div class="sw-key-row-block" data-row="${row.id}">
        <div class="row-title">Key ${idx + 1}${createRows.length > 1 ? ` <button type="button" class="sw-btn sw-btn--outline" style="padding:2px 8px;font-size:0.72rem;float:right" data-rm="${row.id}">Xóa</button>` : ''}</div>
        ${showName ? `<label class="panel-label">Tên Key</label><input type="text" class="panel-input cr-name" data-row="${row.id}" placeholder="VD: Key Khách A" style="margin-bottom:8px" />` : ''}
        ${showExp ? `<label class="panel-label">Thời hạn key</label><input type="datetime-local" class="panel-input cr-exp" data-row="${row.id}" value="${expDefault}" style="margin-bottom:8px" />` : ''}
        ${idx === 0 && $('crSyncPerms')?.checked !== false ? `
          <p class="panel-label" style="margin-top:4px">Quyền key</p>
          <div class="sw-perm-checks" id="crPermChecks"></div>
          <p class="sw-perm-note" id="crPermHint"></p>` : ''}
      </div>`;
    }).join('');

    if (order && $('crPermChecks')) {
      renderPermCheckboxes('crPermChecks', {
        permLogin: order.permLogin,
        permReset: order.permReset,
        permFamily: order.permFamily,
      }, order);
    }

    box.querySelectorAll('[data-rm]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const rid = parseInt(btn.dataset.rm, 10);
        if (createRows.length <= 1) return;
        createRows = createRows.filter((r) => r.id !== rid);
        updateCreateCount();
        renderCreateRows();
      });
    });

    $('crKeyCount').textContent = `${createRows.length}/${MAX_KEYS_BATCH} key`;
  }

  function updateCreateCount() {
    $('crAddRowBtn').disabled = createRows.length >= MAX_KEYS_BATCH;
    $('crKeyCount').textContent = `${createRows.length}/${MAX_KEYS_BATCH} key`;
  }

  function addCreateKeyRow() {
    if (createRows.length >= MAX_KEYS_BATCH) return;
    createRows.push({ id: ++createRowIdSeq });
    updateCreateCount();
    renderCreateRows();
  }

  async function openCreateKeyModal(preselectOrderId) {
    await loadOrdersForPicker();
    createRows = [{ id: ++createRowIdSeq }];
    const order = preselectOrderId
      ? ordersForKeys.find((o) => o.id === preselectOrderId)
      : null;
    $('crOrderSearch').value = order
      ? `${order.accountEmail} — ${order.productName || order.id}`
      : '';
    $('crOrderId').value = order?.id || '';
    $('crErr').style.display = 'none';
    $('crSyncName').checked = true;
    $('crSyncExpires').checked = true;
    $('crSyncPerms').checked = true;
    renderCreateRows();
    $('createKeyModal').classList.add('show');
  }

  function closeCreateKeyModal() {
    $('createKeyModal')?.classList.remove('show');
  }

  function collectCreatePayload() {
    const order = getSelectedOrder();
    if (!order) return { error: 'Chọn tài khoản (đơn hàng)' };
    $('crOrderId').value = order.id;

    const syncName = $('crSyncName').checked;
    const syncExpires = $('crSyncExpires').checked;
    const syncPerms = $('crSyncPerms').checked;
    const perms = syncPerms ? readPermCheckboxes('crPermChecks') : null;

    const items = createRows.map((row) => {
      const nameEl = document.querySelector(`.cr-name[data-row="${row.id}"]`);
      const expEl = document.querySelector(`.cr-exp[data-row="${row.id}"]`);
      return {
        keyName: nameEl?.value?.trim() || null,
        expiresAt: expEl?.value || null,
        ...(syncPerms ? {} : perms),
      };
    });

    const first = items[0] || {};
    return {
      orderId: order.id,
      items,
      syncName,
      syncExpires,
      syncPerms,
      keyName: first.keyName,
      expiresAt: first.expiresAt,
      permLogin: perms?.permLogin,
      permReset: perms?.permReset,
      permFamily: perms?.permFamily,
    };
  }

  async function saveCreateKeys() {
    const payload = collectCreatePayload();
    if (payload.error) {
      $('crErr').textContent = payload.error;
      $('crErr').style.display = 'block';
      return;
    }
    $('crSaveBtn').disabled = true;
    const d = await window.SellerApp.api('/api/seller/keys/batch', payload);
    $('crSaveBtn').disabled = false;
    if (!d.success) {
      $('crErr').textContent = d.error || 'Lỗi tạo key';
      $('crErr').style.display = 'block';
      return;
    }
    window.SellerApp.toast(`Đã tạo ${d.count} key`);
    if (d.keys?.[0]) window.SellerApp.copyText(d.keys[0].key);
    closeCreateKeyModal();
    loadKeys();
    window.SellerApp.loadOrders?.();
    window.SellerApp.loadDashboard?.();
  }

  function bindCreateModalEvents() {
    ['crSyncName', 'crSyncExpires', 'crSyncPerms'].forEach((id) => {
      $(id)?.addEventListener('change', renderCreateRows);
    });
    $('crOrderSearch')?.addEventListener('change', () => {
      const o = resolveOrderFromSearch();
      if (o) {
        $('crOrderId').value = o.id;
        renderCreateRows();
      }
    });
    $('crOrderSearch')?.addEventListener('blur', () => {
      const o = resolveOrderFromSearch();
      if (o) $('crOrderId').value = o.id;
      renderCreateRows();
    });
  }

  window.SellerKeys = {
    loadKeys,
    debounceRenderKeys,
    renderKeysTable,
    openCreateKeyModal,
    openCreateKeyModalForOrder: (orderId) => openCreateKeyModal(orderId),
    closeCreateKeyModal,
    openEditKey,
    closeEditModal,
    saveEditKey,
    saveCreateKeys,
    addCreateKeyRow,
  };

  document.addEventListener('DOMContentLoaded', bindCreateModalEvents);
})();
