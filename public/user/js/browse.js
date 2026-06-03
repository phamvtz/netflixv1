// ─── State ─────────────────────────────────────────────────────────────────────
let allContent  = [];
let isPlaying   = false;
let playerTimer = null;

const ROW_CONFIG = [
  { key: 'continue_watching', title: '▶  Tiếp tục xem' },
  { key: 'trending',          title: '🔥  Thịnh hành trên Netflix' },
  { key: 'new_releases',      title: '✨  Mới phát hành' },
  { key: 'action',            title: '⚡  Hành động & Phiêu lưu' },
  { key: 'drama',             title: '🎭  Phim truyền hình hay' },
  { key: 'horror',            title: '👻  Kinh dị' },
  { key: 'scifi',             title: '🚀  Khoa học viễn tưởng' },
  { key: 'comedy',            title: '😂  Hài hước' },
  { key: 'romance',           title: '💕  Tình cảm' },
  { key: 'animation',         title: '🎨  Hoạt hình' },
  { key: 'documentary',       title: '📽  Phim tài liệu' },
];

// Cookie metadata for the inspector panel
// Formats verified against real Netflix cookies (May 2026)
const COOKIE_META = [
  {
    name: 'nfvdid',
    purpose: 'Netflix Fixed Virtual Device ID – base64url(72 random bytes). Nhận diện thiết bị ẩn danh, tồn tại qua logout.',
    scope: 'device',  scopeLabel: 'Device · 1 năm',
    format: 'base64url ~96 chars',
  },
  {
    name: 'OptanonConsent',
    purpose: 'OneTrust GDPR/CCPA consent state – chứa consentId (UUID), groups, timestamp, browserGpcFlag…',
    scope: 'consent', scopeLabel: 'Consent · 1 năm',
    format: 'query-string',
  },
  {
    name: 'tmx_guid',
    purpose: 'ThreatMetrix device fingerprint token – base64url(64 random bytes). Dùng cho fraud detection.',
    scope: 'device',  scopeLabel: 'Device · 30 ngày',
    format: 'base64url ~86 chars',
  },
  {
    name: 'thx_guid',
    purpose: 'Analytics/ThousandEyes GUID – 32 hex chars không có dấu gạch (UUID không dashes).',
    scope: 'device',  scopeLabel: 'Device · 30 ngày',
    format: '32-char hex',
  },
  {
    name: 'NetflixId',
    purpose: 'User identity token. Format: v=3&ct=<protobuf-base64url>&pg=<BASE32-26>&ch=<hmac-base64url>.',
    scope: 'session', scopeLabel: 'Session · 30 ngày',
    format: 'v=3&ct=…&pg=…&ch=…',
  },
  {
    name: 'SecureNetflixId',
    purpose: 'Phiên bản bảo mật hơn. Format: v=3&mac=<hmac-base64url>.&dt=<timestamp>. HttpOnly – JS không đọc được.',
    scope: 'http',    scopeLabel: 'HttpOnly · Strict · 30 ngày',
    format: 'v=3&mac=…&dt=…',
  },
  {
    name: 'flwssn',
    purpose: 'Flow Session ID – UUID. Theo dõi một "luồng" cụ thể (chọn hồ sơ, xem phim…). Được làm mới sau mỗi luồng.',
    scope: 'flow',    scopeLabel: 'Session-scoped',
    format: 'UUID v4',
  },
  {
    name: 'gsid',
    purpose: 'Global Session ID – UUID. Định danh toàn bộ phiên làm việc. Tồn tại 30 ngày.',
    scope: 'session', scopeLabel: 'Session · 30 ngày',
    format: 'UUID v4',
  },
  {
    name: 'OTSessionTracking',
    purpose: 'OneTrust session tracking – UUID. Theo dõi phiên consent cụ thể.',
    scope: 'flow',    scopeLabel: 'Session-scoped',
    format: 'UUID v4',
  },
  {
    name: 'profilesNewSession',
    purpose: 'Đánh dấu đã hoàn thành bước chọn hồ sơ. Giá trị = "0" sau khi chọn xong.',
    scope: 'session', scopeLabel: 'Session-scoped',
    format: '"0" | null',
  },
  {
    name: 'netflix-sans-normal-3-loaded',
    purpose: 'Font loading marker – set khi Netflix Sans font đã load thành công trên trang browse.',
    scope: 'device',  scopeLabel: 'Session-scoped',
    format: '"true"',
  },
];

// ─── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  initHeader();
  initAccountMenu();
  initSearch();
  await loadContent();
  initCookieInspector();
  updateActiveProfile();
});

// ─── Header scroll effect ─────────────────────────────────────────────────────
function initHeader() {
  const header = document.getElementById('browseHeader');
  window.addEventListener('scroll', () => {
    if (window.scrollY > 80) header.classList.add('scrolled');
    else header.classList.remove('scrolled');
  }, { passive: true });
}

// ─── Account menu ─────────────────────────────────────────────────────────────
function initAccountMenu() {
  document.getElementById('logoutBtn').addEventListener('click', async (e) => {
    e.preventDefault();
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/';
  });
}

function updateActiveProfile() {
  const raw = sessionStorage.getItem('activeProfile');
  if (!raw) return;
  try {
    const p = JSON.parse(raw);
    document.getElementById('accountAvatar').textContent = p.initial;
    document.getElementById('accountAvatar').style.background = p.color;
    document.getElementById('dropAvatar').textContent = p.initial;
    document.getElementById('dropAvatar').style.background = p.color;
    document.getElementById('dropName').textContent = p.name;
  } catch {}
}

// ─── Search ───────────────────────────────────────────────────────────────────
function initSearch() {
  const toggle = document.getElementById('searchToggle');
  const box    = document.getElementById('searchBox');
  const input  = document.getElementById('searchInput');

  toggle.addEventListener('click', () => {
    const visible = box.style.display !== 'none';
    box.style.display = visible ? 'none' : 'flex';
    if (!visible) { input.focus(); renderSearch(''); }
    else { renderSearch(null); }
  });

  input.addEventListener('input', () => renderSearch(input.value.trim()));
}

function renderSearch(query) {
  const content = document.getElementById('browseContent');
  let searchEl  = document.getElementById('searchResultsEl');

  if (query === null) {
    if (searchEl) searchEl.remove();
    return;
  }

  if (!searchEl) {
    searchEl = document.createElement('div');
    searchEl.id = 'searchResultsEl';
    searchEl.className = 'search-results active';
    content.prepend(searchEl);
  }
  searchEl.style.display = 'block';

  if (!query) {
    searchEl.innerHTML = '<p class="search-results-title">Tìm kiếm phim, TV shows...</p>';
    return;
  }

  const q       = query.toLowerCase();
  const matched = allContent.filter(c =>
    c.title.toLowerCase().includes(q) ||
    c.genres.some(g => g.toLowerCase().includes(q))
  );

  if (!matched.length) {
    searchEl.innerHTML = `<p class="search-results-title">Không tìm thấy kết quả cho "<strong>${query}</strong>"</p>`;
    return;
  }

  searchEl.innerHTML = `
    <p class="search-results-title">Kết quả cho "<strong>${query}</strong>" — ${matched.length} nội dung</p>
    <div class="search-grid">${matched.map(c => buildCardHTML(c, false)).join('')}</div>
  `;
}

// ─── Content loading ──────────────────────────────────────────────────────────
async function loadContent() {
  const container = document.getElementById('browseContent');
  container.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  try {
    const res  = await fetch('/api/content');
    const data = await res.json();
    if (!data.success) { window.location.href = '/login'; return; }
    allContent = data.content;
    renderBrowse(allContent);
    renderHero(allContent.find(c => c.featured) || allContent[0]);
  } catch {
    container.innerHTML = '<p style="padding:40px;color:#888;">Lỗi tải nội dung.</p>';
  }
}

function renderHero(item) {
  if (!item) return;
  document.getElementById('browseHero').style.background = item.gradient;
  document.getElementById('heroTitle').textContent = item.title;
  document.getElementById('heroDesc').textContent  = item.description;
  document.getElementById('heroMeta').innerHTML = `
    <span class="meta-match">97% phù hợp</span>
    <span>${item.year}</span>
    <span class="meta-maturity">${item.maturity}</span>
    <span>${item.type === 'series' ? item.seasons + ' mùa' : item.duration}</span>
  `;
  document.getElementById('heroInfoBtn').onclick = () => showToast(`📋 ${item.title}: ${item.description}`);
}

function renderBrowse(items) {
  const container = document.getElementById('browseContent');
  container.innerHTML = '';

  ROW_CONFIG.forEach(({ key, title }) => {
    const rowItems = items.filter(c => c.rows && c.rows.includes(key));
    if (!rowItems.length) return;

    const section = document.createElement('div');
    section.className = 'content-row';
    section.innerHTML = `
      <div class="row-title">${title}</div>
      <div class="row-slider">
        <button class="row-arrow left" onclick="scrollRow(this,-1)">‹</button>
        <div class="row-items" id="row-${key}">
          ${rowItems.map(c => buildCardHTML(c, key === 'continue_watching')).join('')}
        </div>
        <button class="row-arrow right" onclick="scrollRow(this,1)">›</button>
      </div>
    `;
    container.appendChild(section);
  });
}

function buildCardHTML(item, showProgress) {
  const progress  = item.progress ?? 0;
  const pBar      = showProgress && progress > 0
    ? `<div class="card-progress" style="width:${progress}%"></div>`
    : '';
  const genreText = item.genres.slice(0, 2).join(' • ');
  const duration  = item.type === 'series' ? `${item.seasons} mùa` : item.duration;

  return `
    <div class="content-card" onclick="showPlayer('${encodeURIComponent(item.title)}')">
      <div class="card-thumb" style="background:${item.gradient}">
        <div class="card-thumb-inner">
          <span class="card-title-bg" style="color:${item.accent}">${item.title}</span>
        </div>
        ${pBar}
        <div class="card-overlay">
          <div class="overlay-actions">
            <div class="ov-btn play">▶</div>
            <div class="ov-btn" title="Thêm vào danh sách">+</div>
            <div class="ov-btn" title="Thích">👍</div>
            <div class="ov-btn" title="Thêm thông tin" style="margin-left:auto">⌄</div>
          </div>
          <div class="ov-meta">
            <span class="ov-match">97%</span>
            <span class="ov-mat">${item.maturity}</span>
            <span>${duration}</span>
          </div>
          <div class="ov-genres">${genreText}</div>
        </div>
      </div>
    </div>
  `;
}

function scrollRow(arrowBtn, dir) {
  const slider = arrowBtn.parentElement.querySelector('.row-items');
  slider.scrollBy({ left: dir * 600, behavior: 'smooth' });
}

// ─── Player ───────────────────────────────────────────────────────────────────
function showPlayer(encodedTitle) {
  const title = decodeURIComponent(encodedTitle || 'Stranger Things');
  document.getElementById('playerTitle').textContent = title;
  document.getElementById('playerModal').style.display  = 'flex';
  document.getElementById('playerProgress').style.animationPlayState = 'running';
  isPlaying = true;
  document.getElementById('playPauseBtn').textContent = '⏸ Tạm dừng';

  let s = 0;
  clearInterval(playerTimer);
  playerTimer = setInterval(() => {
    if (!isPlaying) return;
    s++;
    const m = String(Math.floor(s / 60)).padStart(2, '0');
    const sc = String(s % 60).padStart(2, '0');
    document.getElementById('playerTime').textContent = `${m}:${sc} / 45:30`;
    if (s >= 2730) { clearInterval(playerTimer); }
  }, 1000);
}

function closePlayer() {
  document.getElementById('playerModal').style.display = 'none';
  clearInterval(playerTimer);
  isPlaying = false;
}

function togglePlay() {
  isPlaying = !isPlaying;
  const btn = document.getElementById('playPauseBtn');
  const prog = document.getElementById('playerProgress');
  btn.textContent = isPlaying ? '⏸ Tạm dừng' : '▶ Phát';
  prog.style.animationPlayState = isPlaying ? 'running' : 'paused';
}

// Close player on backdrop click
document.getElementById('playerModal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closePlayer();
});

// ─── Cookie Inspector ─────────────────────────────────────────────────────────
function initCookieInspector() {
  document.getElementById('cookieFab').addEventListener('click', () => {
    const panel = document.getElementById('cookiePanel');
    const open  = panel.style.display === 'none' || !panel.style.display;
    panel.style.display = open ? 'flex' : 'none';
    if (open) refreshCookiePanel();
  });
  document.getElementById('cpClose').addEventListener('click', () => {
    document.getElementById('cookiePanel').style.display = 'none';
  });
}

async function refreshCookiePanel() {
  try {
    const res  = await fetch('/api/session/info');
    const data = await res.json();
    renderCookieTable(data.cookies, data.phase);
    updatePhaseIndicator(data.phase);
  } catch {
    console.error('Cookie inspector error');
  }
}

function updatePhaseIndicator(phase) {
  const steps = ['ps1', 'ps2', 'ps3'];
  const lines = ['pl1', 'pl2'];
  const phaseMap = { anonymous: 0, authenticated: 1, profile_selected: 2 };
  const idx = phaseMap[phase] ?? 2;

  steps.forEach((id, i) => {
    const el = document.getElementById(id);
    el.classList.toggle('done',   i <= idx);
    el.classList.toggle('active', i === idx);
  });
  lines.forEach((id, i) => {
    document.getElementById(id).classList.toggle('done', i < idx);
  });
}

function renderCookieTable(cookies, phase) {
  const tbody = document.getElementById('cpTableBody');
  tbody.innerHTML = '';

  COOKIE_META.forEach(meta => {
    const raw = cookies[meta.name];
    const set = raw !== null && raw !== undefined;
    const tr  = document.createElement('tr');

    tr.innerHTML = `
      <td class="cookie-name">${meta.name}</td>
      <td class="cookie-val ${set ? 'cookie-set' : 'cookie-null'}">
        ${set ? escapeHtml(raw) : '—'}
      </td>
      <td style="font-size:.7rem;color:#aaa;line-height:1.4">${meta.purpose}</td>
      <td>
        <span class="scope-badge scope-${meta.scope}">${meta.scopeLabel}</span>
        ${meta.format ? `<div style="font-size:.6rem;color:#666;margin-top:3px">${meta.format}</div>` : ''}
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;');
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function showToast(msg) {
  const t = document.createElement('div');
  t.style.cssText = 'position:fixed;bottom:100px;left:50%;transform:translateX(-50%);background:rgba(20,20,20,.95);border:1px solid #333;padding:12px 20px;border-radius:4px;font-size:.85rem;z-index:500;max-width:400px;text-align:center;backdrop-filter:blur(8px)';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}
