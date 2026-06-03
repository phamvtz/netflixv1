// Pre-fill email if coming from landing page
const prefill = sessionStorage.getItem('prefillEmail');
if (prefill) {
  document.getElementById('email').value = prefill;
  sessionStorage.removeItem('prefillEmail');
}

// Password visibility toggle
document.getElementById('pwdToggle').addEventListener('click', () => {
  const pwd  = document.getElementById('password');
  const icon = document.getElementById('eyeIcon');
  const show = pwd.type === 'password';
  pwd.type = show ? 'text' : 'password';
  icon.innerHTML = show
    ? `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>`
    : `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`;
});

// One-click fill for demo accounts
function fillCredentials(email, password) {
  document.getElementById('email').value    = email;
  document.getElementById('password').value = password;
  // Trigger label float
  document.getElementById('email').dispatchEvent(new Event('input'));
  document.getElementById('password').dispatchEvent(new Event('input'));
}

// Submit handler
document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn      = document.getElementById('signInBtn');
  const btnText  = document.getElementById('btnText');
  const spinner  = document.getElementById('btnSpinner');
  const errEl    = document.getElementById('errorMsg');
  const errText  = document.getElementById('errorText');
  const email    = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;

  if (!email || !password) {
    showError('Vui lòng nhập email và mật khẩu.');
    return;
  }

  btn.disabled    = true;
  btnText.style.display  = 'none';
  spinner.style.display  = 'block';
  errEl.style.display    = 'none';

  try {
    const res  = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();

    if (!data.success) {
      showError(data.message || 'Email hoặc mật khẩu không đúng.');
      return;
    }
    window.location.href = data.redirect || '/profiles';
  } catch {
    showError('Lỗi kết nối. Vui lòng thử lại.');
  } finally {
    btn.disabled          = false;
    btnText.style.display = 'inline';
    spinner.style.display = 'none';
  }
});

function showError(msg) {
  const el   = document.getElementById('errorMsg');
  const text = document.getElementById('errorText');
  text.textContent = msg;
  el.style.display = 'flex';
  // Shake animation
  el.style.animation = 'none';
  el.offsetHeight;
  el.style.animation = 'shake .4s ease';
}
