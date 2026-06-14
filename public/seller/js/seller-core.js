'use strict';
// Seller workspace — Core: shared state, helpers, api(), switchView, sidebar
// Split from seller.js. Classic script: shares global scope with the other seller-*.js files.

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
    return new Date(sec * 1000).toLocaleString(window.I18n?.locale?.() || 'vi-VN', {
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

// Map view name → URL segment (and reverse)
const VIEW_SLUG = {
  stats: 'dashboard',
  orders: 'orders',
  keys: 'keys',
  store: 'store',
  emails: 'emails',
  deposit: 'deposit',
  transactions: 'transactions',
  profile: 'profile',
};
const SLUG_VIEW = Object.fromEntries(Object.entries(VIEW_SLUG).map(([k, v]) => [v, k]));

function viewFromPath() {
  // e.g. /seller/orders  →  'orders'
  const m = location.pathname.match(/\/seller\/([\w-]+)/);
  if (m) {
    const slug = m[1];
    return SLUG_VIEW[slug] || (VIEWS.includes(slug) ? slug : null);
  }
  return null;
}

function switchView(v, { push = true } = {}) {
  closeSidebar();
  document.querySelectorAll('.sw-nav a[data-view]').forEach((a) => {
    a.classList.toggle('is-active', a.dataset.view === v);
  });
  VIEWS.forEach((id) => show('view' + id.charAt(0).toUpperCase() + id.slice(1), id === v));
  const meta = pageMeta(v);
  if ($('pageTitle')) $('pageTitle').textContent = meta.title;

  // Update browser URL
  if (push) {
    const slug = VIEW_SLUG[v] || v;
    const newPath = '/seller/' + slug;
    if (location.pathname !== newPath) {
      history.pushState({ view: v }, '', newPath);
    }
  }

  if (v === 'orders') loadOrders();
  if (v === 'keys') window.SellerKeys?.loadKeys();
  if (v === 'store') loadStore();
  if (v === 'emails') loadEmailAccounts();
  if (v === 'transactions') loadTransactions();
  if (v === 'deposit') loadDeposit();
  if (v === 'stats') renderStats();
  if (v === 'profile') fillProfile();
}

// Handle browser back/forward
window.addEventListener('popstate', (e) => {
  const v = (e.state && e.state.view) || viewFromPath() || 'stats';
  switchView(v, { push: false });
});

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
