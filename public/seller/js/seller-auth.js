'use strict';
// Seller workspace — Auth: login, register, verify, Turnstile
// Split from seller.js. Classic script: shares global scope with the other seller-*.js files.

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
