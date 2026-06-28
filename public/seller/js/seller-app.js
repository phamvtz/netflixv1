'use strict';
// Seller workspace — Bootstrap: lang, enterDash, exports, DOMContentLoaded (load LAST)
// Split from seller.js. Classic script: shares global scope with the other seller-*.js files.

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
  try {
    await loadDashboard();
  } catch (e) {
    console.error('Failed to load dashboard:', e);
  }
  try {
    await loadOrders();
  } catch (e) {
    console.error('Failed to load orders:', e);
  }
  try {
    await window.SellerKeys?.loadKeys();
  } catch (e) {
    console.error('Failed to load keys:', e);
  }
  // Restore view from URL (e.g. /seller/orders) or default to stats
  const fromUrl = (typeof viewFromPath === 'function' ? viewFromPath() : null) || 'stats';
  switchView(fromUrl, { push: false });
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
    const active = (typeof viewFromPath === 'function' ? viewFromPath() : null)
      || document.querySelector('.sw-nav a.is-active')?.dataset.view
      || 'stats';
    switchView(active, { push: false });
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
