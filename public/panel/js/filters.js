'use strict';

/** Lọc client-side + chip bar dùng chung admin/seller */
function normalizeQ(q) {
  return (q || '').trim().toLowerCase();
}

function matchesSearch(item, q, fields) {
  if (!q) return true;
  return fields.some((f) => {
    const v = typeof f === 'function' ? f(item) : item[f];
    return String(v ?? '').toLowerCase().includes(q);
  });
}

function filterListEx(items, { q = '', status = 'all', searchFields = [], getStatus }) {
  const nq = normalizeQ(q);
  return items.filter((item) => {
    if (getStatus && status !== 'all' && getStatus(item) !== status) return false;
    return matchesSearch(item, nq, searchFields);
  });
}

function bindChipBar(root, chips, onSelect) {
  let active = 'all';
  root.innerHTML = chips
    .map((c) => `<button type="button" class="chip" data-status="${c.id}">${c.label}</button>`)
    .join('');

  const setActive = (id) => {
    active = id;
    root.querySelectorAll('.chip').forEach((b) => {
      b.classList.toggle('active', b.dataset.status === id);
    });
    onSelect(id);
  };

  root.querySelectorAll('.chip').forEach((btn) => {
    btn.addEventListener('click', () => setActive(btn.dataset.status));
  });
  setActive('all');

  return { getStatus: () => active, setStatus: setActive };
}

window.PanelFilters = { normalizeQ, filterListEx, bindChipBar };
