'use strict';

// Auto-detect which port has the live API
// If on port 3000 (old static server), API calls go to port 3002 (new server)
const API_PORT = 3002;
const API_BASE = window.location.port === String(API_PORT) ? '' : `http://localhost:${API_PORT}`;

const NFLX = { CT: 'BgjHlOvcAx', MAC: 'AQEAEQABAB', CH: 'AQEAEAABAB' };

const DEFS = [
  { name:'NetflixId',                    req:true,  grp:'session', lbl:'User identity token' },
  { name:'SecureNetflixId',              req:true,  grp:'session', lbl:'Secure session (HttpOnly)' },
  { name:'flwssn',                       req:true,  grp:'session', lbl:'Flow Session UUID' },
  { name:'gsid',                         req:true,  grp:'session', lbl:'Global Session UUID' },
  { name:'OTSessionTracking',            req:false, grp:'session', lbl:'OneTrust session UUID' },
  { name:'profilesNewSession',           req:false, grp:'session', lbl:'Profile selected marker' },
  { name:'nfvdid',                       req:false, grp:'device',  lbl:'Virtual Device ID' },
  { name:'tmx_guid',                     req:false, grp:'device',  lbl:'ThreatMetrix token' },
  { name:'thx_guid',                     req:false, grp:'device',  lbl:'Analytics GUID (32 hex)' },
  { name:'OptanonConsent',               req:false, grp:'consent', lbl:'OneTrust GDPR consent' },
  { name:'netflix-sans-normal-3-loaded', req:false, grp:'misc',    lbl:'Font marker (Normal)' },
  { name:'netflix-sans-bold-3-loaded',   req:false, grp:'misc',    lbl:'Font marker (Bold)' },
];

// ── Analyzers ────────────────────────────────────────────────────────────────
function analyzeNfId(raw) {
  const iss = [];
  try {
    const p = new URLSearchParams(decodeURIComponent(raw));
    const v=p.get('v'), ct=p.get('ct'), pg=p.get('pg'), ch=p.get('ch');
    if (v!=='3') iss.push(`v=${v} must be 3`);
    if (!ct)     iss.push('missing ct');
    else {
      if (!ct.startsWith(NFLX.CT)) iss.push(`unexpected ct preamble (expected: ${NFLX.CT}…)`);
      if (ct.length<120)           iss.push(`ct too short: ${ct.length} chars`);
    }
    if (!pg)                          iss.push('missing pg');
    else if (!/^[A-Z2-7]{26}$/.test(pg)) iss.push(`invalid pg: "${pg}"`);
    if (!ch)                          iss.push('missing ch');
    else if (!ch.endsWith('.'))       iss.push('ch missing trailing dot');
    else if (!ch.replace(/\.$/,'').startsWith(NFLX.CH)) iss.push('unexpected ch preamble');
    return { ok: iss.length===0, fmt:'v=3&ct=…&pg=BASE32&ch=…', iss };
  } catch(e) { return { ok:false, fmt:'?', iss:[e.message] }; }
}
function analyzeSnfId(raw) {
  const iss = [];
  let ageMs=null;
  try {
    const p = new URLSearchParams(decodeURIComponent(raw));
    const v=p.get('v'), mac=p.get('mac'), dt=p.get('dt');
    if (v!=='3') iss.push(`v=${v} must be 3`);
    if (!mac)    iss.push('missing mac');
    else {
      if (!mac.endsWith('.'))                              iss.push('mac missing trailing dot');
      if (!mac.replace(/\.$/,'').startsWith(NFLX.MAC))    iss.push('unexpected mac preamble');
    }
    if (!dt) iss.push('missing dt');
    else {
      ageMs = Date.now()-parseInt(dt);
      if (isNaN(ageMs))             iss.push('dt is not a number');
      else if (ageMs<0)             iss.push('dt is in the future');
      else if (ageMs>30*86400000)   iss.push(`Expired: ${fmt_age(ageMs)}`);
    }
    return { ok:iss.length===0, fmt:'v=3&mac=AQEAEQABAB….&dt=ts', iss, ageMs };
  } catch(e) { return { ok:false, fmt:'?', iss:[e.message], ageMs:null }; }
}
function analyzeUUID(v) {
  const ok=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
  return { ok, fmt:'UUID v4', iss: ok?[]:['Not a UUID'] };
}
function analyzePNS(v)    { return { ok:v==='0', fmt:'"0"=profile selected', iss:v!=='0'?[`"${v}"≠"0"`]:[] }; }
function analyzeNfvdid(v) { return { ok:isB64u(v)&&v.length>60, fmt:'base64url ~72 bytes', iss:!isB64u(v)?['Not base64url']:v.length<60?['Too short']:[] }; }
function analyzeTmx(v)    { return { ok:isB64u(v)&&v.length>50, fmt:'base64url ~64 bytes', iss:!isB64u(v)?['Not base64url']:v.length<50?['Too short']:[] }; }
function analyzeThx(v)    { const ok=/^[0-9a-f]{32}$/i.test(v); return { ok, fmt:'32 hex chars', iss:ok?[]:['Not 32-hex'] }; }
function analyzeOpt(v) {
  const iss=[];
  try {
    const p=new URLSearchParams(decodeURIComponent(v));
    const id=p.get('consentId'), cr=parseInt(p.get('crTime'));
    if (!id) iss.push('missing consentId');
    else if (!/^[0-9a-f-]{36}$/i.test(id)) iss.push('consentId is not a UUID');
    if (!isNaN(cr) && Date.now()-cr > 365*86400000) iss.push('crTime > 1 year');
  } catch { iss.push('parse error'); }
  return { ok:iss.length===0, fmt:'query-string (OneTrust)', iss };
}
function analyzeBool(v) { return { ok:v==='true', fmt:'"true"', iss:v!=='true'?[`"${v}"≠"true"`]:[] }; }

const AZ = {
  'NetflixId':analyzeNfId,'SecureNetflixId':analyzeSnfId,'flwssn':analyzeUUID,'gsid':analyzeUUID,
  'OTSessionTracking':analyzeUUID,'profilesNewSession':analyzePNS,'nfvdid':analyzeNfvdid,
  'tmx_guid':analyzeTmx,'thx_guid':analyzeThx,'OptanonConsent':analyzeOpt,
  'netflix-sans-normal-3-loaded':analyzeBool,'netflix-sans-bold-3-loaded':analyzeBool,
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function isB64u(s) { return /^[A-Za-z0-9_-]+$/.test(s); }
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function trunc(s,n=60) { return s&&s.length>n?s.substring(0,n)+'…':String(s||''); }
function fmt_age(ms) {
  const s=Math.floor(Math.abs(ms)/1000);
  if(s<60)return s+'s'; const m=Math.floor(s/60);
  if(m<60)return m+'m'; const h=Math.floor(m/60);
  if(h<24)return h+'h'+m%60+'m'; return Math.floor(h/24)+'d'+h%24+'h';
}
function fmt_ts(ms) { try { return new Date(ms).toLocaleString('vi-VN',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}); } catch { return ''; } }
function parse_ck(str) {
  const o={};
  str.split(';').forEach(p=>{ const i=p.indexOf('='); if(i<0)return; const k=p.substring(0,i).trim(),v=p.substring(i+1).trim(); if(k)o[k]=v; });
  return o;
}
// ── Cookie Editor JSON → cookie string ────────────────────────────────────────
// Cookie Editor extension exports: [ { name, value, domain, ... }, ... ]
function cookieEditorToString(jsonArr) {
  return jsonArr
    .filter(c => c && c.name && c.value !== undefined)
    .map(c => `${c.name}=${c.value}`)
    .join('; ');
}

// ── Auto-detect input format and normalize to array of cookie strings ─────────
function detect_sets(input) {
  input = input.trim();

  // Case 1: Cookie Editor JSON (starts with "[")
  if (input.startsWith('[')) {
    try {
      const parsed = JSON.parse(input);
      if (Array.isArray(parsed)) {
        // Single export → one set
        if (parsed.length && parsed[0] && 'name' in parsed[0]) {
          return [cookieEditorToString(parsed)];
        }
        // Array of exports → multiple sets
        if (parsed.length && Array.isArray(parsed[0])) {
          return parsed.map(arr => cookieEditorToString(arr)).filter(s => s.includes('NetflixId='));
        }
      }
    } catch {}
  }

  // Case 2: Multiple JSON blocks (one JSON array per line)
  const jsonLines = input.split(/\n+/).map(l => l.trim()).filter(l => l.startsWith('['));
  if (jsonLines.length > 1) {
    const converted = jsonLines.map(line => {
      try {
        const arr = JSON.parse(line);
        return Array.isArray(arr) ? cookieEditorToString(arr) : null;
      } catch { return null; }
    }).filter(Boolean).filter(s => s.includes('NetflixId=') || s.includes('flwssn='));
    if (converted.length > 0) return converted;
  }

  // Case 3: Normal cookie string (one per line or single line)
  const lines = input.split(/\n+/).map(l => l.trim()).filter(l => l.length > 20);
  const sets  = lines.filter(l => l.includes('NetflixId=') || l.includes('flwssn='));
  return sets.length > 1 ? sets : [input];
}
function process_set(raw) {
  const ck = parse_ck(raw);
  const known = new Set(DEFS.map(d=>d.name));
  const rows = DEFS.map(d => {
    const val=ck[d.name], a=(val && AZ[d.name]) ? AZ[d.name](val) : { ok:false, fmt:'—', iss:d.req?['Required, missing!']:[] };
    return {...d, present:!!val, val:val||null, a};
  });
  Object.keys(ck).filter(k=>!known.has(k)).forEach(name=>rows.push({name,req:false,grp:'unknown',lbl:'Unknown',present:true,val:ck[name],a:{ok:null,fmt:'?',iss:[]}}));
  const req=rows.filter(r=>r.req), allOk=req.every(r=>r.a.ok===true);
  const hasNf=rows.find(r=>r.name==='NetflixId')?.present;
  const phase=!hasNf?'anon':allOk?'ok':'warn';
  let ageMs=null;
  try { const p=new URLSearchParams(decodeURIComponent(ck['SecureNetflixId']||'')); const dt=parseInt(p.get('dt')); if(!isNaN(dt)) ageMs=Date.now()-dt; } catch {}
  return {rows,phase,ageMs,ck};
}

// ── State ────────────────────────────────────────────────────────────────────
let sets=[], rawSets=[], liveResults=[], activeDetail=-1, doneChecks=0;

function getCheckPace() {
  return document.getElementById('checkPace')?.value || localStorage.getItem('checkerPace') || 'stealth';
}

function liveCheckBody(cookie) {
  return { cookie, pace: getCheckPace() };
}

function persistCheckPace() {
  const v = getCheckPace();
  try { localStorage.setItem('checkerPace', v); } catch {}
  return v;
}

function estimateCheckEta(count, pace) {
  const sec = { normal: 5, slow: 35, stealth: 55 }[pace] || 55;
  return Math.ceil((count * sec) / 60);
}

function isSafePace() {
  const p = getCheckPace();
  return p === 'stealth' || p === 'slow';
}

// ── Safe JSON fetch (never throws on non-JSON responses) ─────────────────────
async function safePost(url, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    mode: url.startsWith('http') ? 'cors' : 'same-origin',
  });
  if (r.headers.get('content-type')?.includes('application/json')) {
    return await r.json();
  }
  // Server returned HTML (crash / 500) — parse status and return error object
  const text = await r.text().catch(() => '');
  return { alive: false, error: `HTTP ${r.status} – server error (see server console)`, profiles: [], _raw: text.substring(0, 80) };
}

// ── Ping server API on load ───────────────────────────────────────────────────
(async () => {
  try {
    const p = await fetch(`${API_BASE}/api/checker/ping`).then(r => r.json());
    if (!p.ok) throw new Error('ping failed');
  } catch {
    const banner = document.createElement('div');
    banner.style.cssText = 'position:fixed;top:60px;left:50%;transform:translateX(-50%);background:#8b0000;color:#fff;padding:10px 20px;border-radius:6px;font-size:.82rem;z-index:999;font-family:monospace';
    banner.textContent = '⚠ Server API not responding – restart: node server.js';
    document.body.appendChild(banner);
    setTimeout(() => banner.remove(), 8000);
  }
})();

// ── Filter state ──────────────────────────────────────────────────────────────
let currentFilter = 'all';
let autoTimer = null;

function setFilter(f) {
  currentFilter = f;
  document.querySelectorAll('.stat-card').forEach(c => c.classList.remove('active-filter'));
  const cardMap = { live: 'sc-live', dead: 'sc-dead', cancelled: 'sc-cancel', pending: 'sc-pending', all: 'sc-total' };
  if (cardMap[f]) document.getElementById(cardMap[f])?.classList.add('active-filter');
  applyFilter();
}

function rowMatchesStatus(live, filter) {
  if (filter === 'all') return true;
  if (filter === 'live') return live?.alive === true && !live?.cancelled && !live?.planLost;
  if (filter === 'dead') return live != null && live.alive === false && !live?.planLost;
  if (filter === 'cancelled') return !!live?.planLost || !!live?.cancelled || (!!live?.paymentError && !!live?.plan);
  if (filter === 'pending') return live === null || live === undefined;
  return true;
}

function applyFilter() {
  const q = (document.getElementById('resultSearch')?.value || '').trim().toLowerCase();
  const rows = document.querySelectorAll('#ckBody tr');
  let visible = 0;
  rows.forEach(tr => {
    const idx  = parseInt(tr.dataset.idx, 10);
    const live = liveResults[idx];
    let show = rowMatchesStatus(live, currentFilter);
    if (show && q) {
      const email = (live?.email || '').toLowerCase();
      const plan = (live?.plan || '').toLowerCase();
      const line = String(idx + 1);
      show = email.includes(q) || plan.includes(q) || line === q;
    }
    tr.style.display = show ? '' : 'none';
    if (show) visible++;
  });
  const empty = document.getElementById('tableEmpty');
  if (empty) empty.style.display = visible === 0 && rows.length > 0 ? 'block' : 'none';
}

// ── Stats cards update ─────────────────────────────────────────────────────────
function updateStatCards() {
  const total    = sets.length;
  const live     = liveResults.filter(r => r?.alive === true && !r?.cancelled && !r?.planLost).length;
  const dead     = liveResults.filter(r => r != null && r.alive === false && !r?.planLost).length;
  const cancelled= liveResults.filter(r => r?.planLost || r?.cancelled || (r?.paymentError && r?.plan)).length;
  const pending  = liveResults.filter(r => r === null).length;

  document.getElementById('sc-total-n').textContent  = total;
  document.getElementById('sc-live-n').textContent   = live;
  document.getElementById('sc-dead-n').textContent   = dead;
  document.getElementById('sc-cancel-n').textContent = cancelled;
  document.getElementById('sc-pending-n').textContent= pending;
  document.getElementById('statCards').style.display = 'grid';
  document.getElementById('toolbar').style.display   = 'flex';
}

// ── Export ────────────────────────────────────────────────────────────────────
function toggleDropdown() {
  document.getElementById('dropdownMenu').classList.toggle('open');
}
document.addEventListener('click', e => {
  if (!e.target.closest('#exportDropdown')) {
    document.getElementById('dropdownMenu')?.classList.remove('open');
  }
});

function exportData(filter, format) {
  document.getElementById('dropdownMenu').classList.remove('open');
  const rows = sets.map((s, i) => {
    const live = liveResults[i];
    const status = !live ? 'PENDING'
      : live.planLost ? 'PLAN_LOST'
      : live.alive && !live.cancelled ? 'LIVE'
      : live.alive && live.cancelled  ? 'CANCELLED'
      : live.paymentError && live.plan ? 'PLAN_LOST'
      : 'DEAD';
    return {
      idx: i + 1, status,
      plan:     live?.plan     || '',
      email:    live?.email    || '',
      profiles: (live?.profiles || []).join(' | '),
      billing:  live?.billingText || '',
      cookie:   rawSets[i] || '',
    };
  });
  const q = (document.getElementById('resultSearch')?.value || '').trim().toLowerCase();
  const filtered = rows.filter(r => {
    if (filter === 'live' && r.status !== 'LIVE') return false;
    const idx = r.idx - 1;
    const live = liveResults[idx];
    if (!rowMatchesStatus(live, currentFilter)) return false;
    if (q) {
      const email = (r.email || '').toLowerCase();
      const plan = (r.plan || '').toLowerCase();
      if (!email.includes(q) && !plan.includes(q) && String(r.idx) !== q) return false;
    }
    return true;
  });
  const rowsOut = filtered;

  if (!rowsOut.length) { alert('No data to export.'); return; }

  let content = '', ext = format, mime = 'text/plain';

  if (format === 'txt') {
    content = rowsOut.map(r => r.cookie).join('\n');
  } else if (format === 'csv') {
    const headers = ['#','Status','Plan','Email','Profiles','Billing','Cookie'];
    const escape = v => `"${String(v).replace(/"/g,'""')}"`;
    content = [headers.join(','), ...rowsOut.map(r =>
      [r.idx, r.status, r.plan, r.email, r.profiles, r.billing, r.cookie].map(escape).join(',')
    )].join('\n');
    mime = 'text/csv';
  } else if (format === 'json') {
    content = JSON.stringify(rowsOut.map(({ cookie, ...rest }) => rest), null, 2);
    mime = 'application/json';
  }

  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type: mime }));
  a.download = `netflix_${filter}_${new Date().toISOString().slice(0,10)}.${ext}`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── Copy cookie per row ────────────────────────────────────────────────────────
async function copyRowCookie(idx, btn) {
  try {
    await navigator.clipboard.writeText(rawSets[idx] || '');
    btn.textContent = '✓ Copied';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 1500);
  } catch {
    alert('Could not copy. Try manually.');
  }
}

// ── Auto recheck ───────────────────────────────────────────────────────────────
function toggleAutoCheck() {
  const on = document.getElementById('autoCheck').checked;
  const nextEl = document.getElementById('autoNext');
  if (on && isSafePace()) {
    const mins = parseInt(document.getElementById('autoInterval').value) || 30;
    if (mins < 30) {
      alert('Stealth/Slow mode: Auto interval must be at least 30 minutes to avoid IP scanning.');
      document.getElementById('autoCheck').checked = false;
      return;
    }
  }
  if (on) {
    scheduleAutoCheck();
  } else {
    clearTimeout(autoTimer);
    autoTimer = null;
    nextEl.style.display = 'none';
  }
}

function scheduleAutoCheck() {
  const mins = parseInt(document.getElementById('autoInterval').value) || 30;
  const ms   = mins * 60 * 1000;
  const nextEl = document.getElementById('autoNext');
  clearTimeout(autoTimer);
  const fireAt = Date.now() + ms;
  nextEl.style.display = 'inline';
  const tick = () => {
    const rem = fireAt - Date.now();
    if (rem <= 0) {
      nextEl.textContent = 'Checking…';
      checkAllLive().then(() => {
        if (document.getElementById('autoCheck').checked) scheduleAutoCheck();
      });
    } else {
      const m = Math.floor(rem / 60000), s = Math.floor((rem % 60000) / 1000);
      nextEl.textContent = `next: ${m}m${s}s`;
      autoTimer = setTimeout(tick, 1000);
    }
  };
  tick();
}

// ── Main ─────────────────────────────────────────────────────────────────────
function runCheck() {
  const input = document.getElementById('cookieInput').value.trim();
  const demo  = document.getElementById('useDemoCheck').checked;
  if (demo) { fetchDemo(); return; }
  if (!input) { alert('Paste a cookie string first!'); return; }
  rawSets = detect_sets(input);
  sets    = rawSets.map(process_set);
  liveResults = new Array(sets.length).fill(null);
  doneChecks  = 0;
  render();
}

async function fetchDemo() {
  try {
    const d = await fetch('/api/session/info').then(r=>r.json());
    if (!d.authenticated) { alert('Not logged in!'); return; }
    const str = Object.entries(d.cookies).filter(([,v])=>v).map(([k,v])=>`${k}=${v}`).join('; ');
    document.getElementById('cookieInput').value = str;
    rawSets=[str]; sets=[process_set(str)]; liveResults=[null]; doneChecks=0;
    render();
  } catch { alert('Demo server error.'); }
}

async function pasteClip() {
  try { document.getElementById('cookieInput').value = await navigator.clipboard.readText(); }
  catch { alert('Use Ctrl+V.'); }
}

function clearAll() {
  document.getElementById('cookieInput').value='';
  document.getElementById('tableWrap').style.display='none';
  document.getElementById('statCards').style.display='none';
  document.getElementById('toolbar').style.display='none';
  document.getElementById('detailWrap').style.display='none';
  document.getElementById('emptyState').style.display='flex';
  document.getElementById('checkAllBtn').style.display='none';
  document.getElementById('exportDropdown').style.display='none';
  document.getElementById('autoWrap').style.display='none';
  document.getElementById('autoCheck').checked = false;
  clearTimeout(autoTimer); autoTimer = null;
  sets=[]; rawSets=[]; liveResults=[]; activeDetail=-1;
  const rs = document.getElementById('resultSearch');
  if (rs) rs.value = '';
  setFilter('all');
}

// ── Render ───────────────────────────────────────────────────────────────────
function render() {
  document.getElementById('emptyState').style.display='none';
  document.getElementById('tableWrap').style.display='block';
  document.getElementById('checkAllBtn').style.display='inline-flex';
  document.getElementById('exportDropdown').style.display='block';
  document.getElementById('autoWrap').style.display='flex';
  updateStatCards();

  // (old stats bar removed — now using stat-cards above)

  // Table body
  const tbody = document.getElementById('ckBody');
  tbody.innerHTML='';
  sets.forEach((s,i) => {
    const tr = document.createElement('tr');
    tr.id = `row-${i}`; tr.dataset.idx = String(i);
    tr.innerHTML = buildRow(s,i);
    tr.querySelector('.row-detail-btn')?.addEventListener('click', e=>{ e.stopPropagation(); toggleDetail(i); });
    tr.querySelector('.row-check-btn')?.addEventListener('click', e=>{ e.stopPropagation(); liveCheckOne(i); });
    tr.addEventListener('click', ()=>toggleDetail(i));
    tbody.appendChild(tr);
  });
}

function buildRow(s, i, live) {
  const {phase, ageMs, ck} = s;

  // Status cell
  let statusCell;
  if (live===undefined) {
    statusCell = phase==='ok'
      ? `<span class="badge badge-pending">FORMAT ✓</span>`
      : phase==='anon'
        ? `<span class="badge badge-pending">ANON</span>`
        : `<span class="badge badge-cancelled">FORMAT ⚠</span>`;
  } else if (live===null) {
    statusCell = `<span class="badge badge-checking"><div class="spin"></div></span>`;
  } else {
    statusCell = buildStatusBadge(live);
  }

  // Plan cell
  let planCell = `<span class="td-plan empty">—</span>`;
  if (live?.plan) {
    const bill = live.billingText ? `<div class="td-billing">${esc(live.billingText)}</div>` : '';
    const pay  = live.planLost
      ? `<div class="td-payerr">⚠ Plan name present but inaccessible (payment error / access lost)</div>`
      : live.paymentError ? `<div class="td-payerr">⚠ Payment error</div>` : '';
    planCell = `<div class="td-plan">${esc(live.plan)}</div>${bill}${pay}`;
  }

  const screens = live?.screens ? ` <span style="font-size:.65rem;color:var(--t3)"> ·${live.screens}🖥</span>` : '';
  const email   = live?.email   ? `<span class="td-email">${esc(live.email)}</span>` : `<span class="td-email empty">—</span>`;

  let profs = `<span class="profiles-empty">—</span>`;
  if (live?.profiles?.length) {
    profs = `<div class="profiles-wrap">${live.profiles.map(p=>`<span class="pchip">${esc(p)}</span>`).join('')}</div>`;
  }

  const age1 = ageMs!=null ? `<div>${fmt_age(ageMs)} ago</div>` : '<div style="color:var(--t3)">—</div>';
  const age2 = ageMs!=null ? `<div class="td-age-sub">${fmt_ts(Date.now()-ageMs)}</div>` : '';

  let ctOk=false;
  try { const p=new URLSearchParams(decodeURIComponent(ck['NetflixId']||'')); ctOk=(p.get('ct')||'').startsWith(NFLX.CT); } catch {}
  const fmtCell = ctOk ? `<span class="fmt-ok">✓</span>` : `<span class="fmt-warn">⚠</span>`;
  const checkBtn = live!==undefined ? '' : `<button class="btn-check" onclick="event.stopPropagation();liveCheckOne(${i})">Check</button>`;

  return `
    <td class="td-num">${i+1}</td>
    <td id="status-${i}">${statusCell}</td>
    <td>${planCell}${screens}</td>
    <td>${email}</td>
    <td id="profiles-${i}">${profs}</td>
    <td class="td-age">${age1}${age2}</td>
    <td class="td-fmt">${fmtCell}</td>
    <td><div class="row-actions">
      ${checkBtn}
      <button class="btn-copy" onclick="event.stopPropagation();copyRowCookie(${i},this)">Copy</button>
      <button class="btn-detail" onclick="event.stopPropagation();toggleDetail(${i})">Detail</button>
    </div></td>
  `;
}

function buildStatusBadge(live) {
  if (!live) return `<span class="badge badge-pending">—</span>`;
  const src = live.source ? `<span class="badge-src">${live.source}</span>` : '';
  if (live.planLost)                   return `<span class="badge badge-cancelled">⚠ PLAN LOST</span><div class="badge-err">Has plan · no access</div>${src}`;
  if (live.error && !live.alive)       return `<span class="badge badge-dead">✗ DEAD</span><div class="badge-err">${esc(live.error.substring(0,40))}</div>`;
  if (live.paymentError && live.plan)  return `<span class="badge badge-cancelled">⚠ PLAN LOST</span>${src}`;
  if (live.alive && live.paymentError) return `<span class="badge badge-cancelled">⚠ PAYMENT ERROR</span>${src}`;
  if (live.alive && live.cancelled)    return `<span class="badge badge-cancelled">🔚 CANCELLED</span>${src}`;
  if (live.alive)                      return `<span class="badge badge-live">✓ LIVE</span>${src}`;
  return `<span class="badge badge-dead">✗ DEAD</span>${src}`;
}

// ── Live check ───────────────────────────────────────────────────────────────
async function liveCheckOne(idx) {
  const btn = document.querySelector(`#row-${idx} .row-check-btn`);
  if (btn) { btn.disabled=true; btn.innerHTML='<div class="spin" style="display:inline-block"></div>'; }
  setStatusCell(idx, null); // spinner
  try {
    const d = await safePost(`${API_BASE}/api/checker/live-check`, liveCheckBody(rawSets[idx]));
    if (d.rateLimited) {
      alert(d.error || 'Hourly check limit reached — wait and try again');
      if (btn) { btn.disabled = false; btn.textContent = 'Check'; }
      return;
    }
    liveResults[idx] = d;
    updateRow(idx, d);
    if (btn) btn.remove();
  } catch (e) {
    liveResults[idx] = { alive: false, error: e.message };
    updateRow(idx, liveResults[idx]);
    if (btn) { btn.disabled = false; btn.textContent = '🔴 Check'; }
  }
  updateStats();
}

async function checkAllLive() {
  const allBtn = document.getElementById('checkAllBtn');
  const pace = persistCheckPace();
  const todo = rawSets.map((_,i)=>i).filter(i=>liveResults[i]===null);
  if (!todo.length) return;
  if (isSafePace() && todo.length > 15) {
    const label = pace === 'stealth' ? 'Stealth' : 'Slow';
    if (!confirm(`${label}: ~${estimateCheckEta(todo.length, pace)} min · ${todo.length} cookie(s) · 1 Netflix IP/cookie.\nContinue?`)) return;
  }
  if (pace === 'normal' && todo.length > 20) {
    if (!confirm('Fast mode has a higher Netflix scan risk. Stealth/Slow is recommended. Continue anyway?')) return;
  }
  allBtn.disabled=true;
  doneChecks=0;
  showProgress(true, 0, todo.length);
  // Set all to checking state
  todo.forEach(i => { liveResults[i]=null; setStatusCell(i, null); const b=document.querySelector(`#row-${i} .row-check-btn`); if(b){b.disabled=true;} });

  // CONC=1 — server cũng nghỉ theo pace; client chỉ hiển thị progress.
  const CONC=1;
  // Server đã nghỉ dài — client chỉ thêm chút jitter (tránh double-wait quá lâu ở stealth)
  const gapMs = { normal: 1500, slow: 500, stealth: 0 }[pace] ?? 0;
  const wait = ms => new Promise(r=>setTimeout(r, ms));
  for (let i=0;i<todo.length;i+=CONC) {
    const batch=todo.slice(i,i+CONC);
    await Promise.all(batch.map(async idx => {
      try {
        const d = await safePost(`${API_BASE}/api/checker/live-check`, liveCheckBody(rawSets[idx]));
        if (d.rateLimited) {
          alert(d.error || 'Hourly check limit reached');
          showProgress(false);
          allBtn.disabled = false;
          return;
        }
        liveResults[idx] = d; updateRow(idx, d);
      } catch (e) {
        liveResults[idx] = { alive: false, error: e.message }; updateRow(idx, liveResults[idx]);
      }
      doneChecks++;
      showProgress(true, doneChecks, todo.length);
    }));
    if (gapMs > 0 && i + CONC < todo.length) await wait(gapMs * (0.85 + Math.random() * 0.35));
  }
  showProgress(false);
  allBtn.disabled=false;
  updateStats();
}

function setStatusCell(idx, live) {
  const td = document.getElementById(`status-${idx}`);
  if (!td) return;
  if (live===null) { td.innerHTML=`<span class="badge badge-checking"><div class="spin"></div> Checking…</span>`; return; }
  td.innerHTML = buildStatusBadge(live);
}

function updateRow(idx, live) {
  setStatusCell(idx, live);
  const tr = document.getElementById(`row-${idx}`);
  if (!tr) return;
  // Update plan cell (3rd td)
  const tds = tr.querySelectorAll('td');
  // Plan + billing
  if (live.plan) {
    const bill = live.billingText ? `<div class="td-billing">${esc(live.billingText)}</div>` : '';
    const pay  = live.planLost
      ? `<div class="td-payerr">⚠ Plan name present but inaccessible (payment error / access lost)</div>`
      : live.paymentError ? `<div class="td-payerr">⚠ Payment error</div>` : '';
    const scr  = live.screens ? ` <span style="font-size:.65rem;color:var(--t3)"> ·${live.screens}🖥</span>` : '';
    tds[2].innerHTML = `<div class="td-plan">${esc(live.plan)}</div>${bill}${pay}${scr}`;
  } else {
    tds[2].innerHTML = `<span class="td-plan empty">—</span>`;
  }
  tds[3].innerHTML = live.email ? `<span class="td-email">${esc(live.email)}</span>` : `<span class="td-email empty">—</span>`;
  // Profiles
  const pc = document.getElementById(`profiles-${idx}`);
  if (pc) {
    pc.innerHTML = live.profiles?.length
      ? `<div class="profiles-wrap">${live.profiles.map(p=>`<span class="pchip">${esc(p)}</span>`).join('')}</div>`
      : `<span class="profiles-empty">—</span>`;
  }
  tr.classList.remove('row-live','row-dead','row-cancel');
  if (live.planLost)                   tr.classList.add('row-cancel');
  else if (live.alive && !live.cancelled) tr.classList.add('row-live');
  else if (!live.alive)                tr.classList.add('row-dead');
  else if (live.alive && live.cancelled) tr.classList.add('row-cancel');
  // Remove check btn
  tr.querySelector('.row-check-btn')?.remove();
  // Refresh detail if open
  if (activeDetail===idx) toggleDetail(idx, true);
}

function showProgress(show, done, total) {
  const el = document.getElementById('statProgress');
  el.style.display = show ? 'flex' : 'none';
  if (show) {
    document.getElementById('progressText').textContent = `Checking ${done}/${total}…`;
    document.getElementById('progressFill').style.width = `${Math.round(done/total*100)}%`;
  }
}

function updateStats() {
  updateStatCards();
  applyFilter();
}

// ── Detail panel ─────────────────────────────────────────────────────────────
function toggleDetail(idx, forceOpen) {
  const wrap = document.getElementById('detailWrap');
  if (activeDetail===idx && !forceOpen) {
    wrap.style.display='none'; activeDetail=-1;
    document.getElementById(`row-${idx}`)?.classList.remove('row-active');
    return;
  }
  document.querySelectorAll('.row-active').forEach(r=>r.classList.remove('row-active'));
  document.getElementById(`row-${idx}`)?.classList.add('row-active');
  activeDetail=idx;
  wrap.style.display='block';
  document.getElementById('detailTitle').textContent = `COOKIE DETAIL — SET #${idx+1}`;
  renderDetail(idx);
}

function closeDetail() {
  document.getElementById('detailWrap').style.display='none';
  document.querySelectorAll('.row-active').forEach(r=>r.classList.remove('row-active'));
  activeDetail=-1;
}

function renderDetail(idx) {
  const s    = sets[idx];
  const live = liveResults[idx];
  const body = document.getElementById('detailBody');
  body.innerHTML='';

  // Left: extracted data
  const left = document.createElement('div');
  left.className='detail-col';
  left.innerHTML=`<div class="detail-col-title">Extracted Data</div>`;
  const items=[];

  // From SecureNetflixId
  try {
    const p=new URLSearchParams(decodeURIComponent(s.ck['SecureNetflixId']||''));
    const dt=parseInt(p.get('dt')), mac=p.get('mac')||'';
    if (!isNaN(dt)) {
      items.push({ok:true, k:'Set at (dt)', v:`${fmt_ts(dt)} — ${fmt_age(Date.now()-dt)} ago`});
      items.push({ok:Date.now()<dt+30*86400000, k:'Expires', v:fmt_ts(dt+30*86400000)});
    }
    items.push({ok:mac.replace(/\.$/,'').startsWith(NFLX.MAC), k:'mac preamble', v:mac.substring(0,10)+'…'});
  } catch {}

  // From NetflixId
  try {
    const p=new URLSearchParams(decodeURIComponent(s.ck['NetflixId']||''));
    const ct=p.get('ct')||'', pg=p.get('pg')||'', ch=p.get('ch')||'';
    items.push({ok:ct.startsWith(NFLX.CT),          k:'ct preamble',   v:ct.substring(0,10)+'…'});
    items.push({ok:ct.length>=150,                    k:'ct size',       v:`${ct.length} chars`});
    items.push({ok:/^[A-Z2-7]{26}$/.test(pg),        k:'pg (BASE32)',   v:pg||'—'});
    items.push({ok:ch.replace(/\.$/,'').startsWith(NFLX.CH), k:'ch preamble', v:ch.substring(0,10)+'…'});
  } catch {}

  // From OptanonConsent
  try {
    const p=new URLSearchParams(decodeURIComponent(s.ck['OptanonConsent']||''));
    const id=p.get('consentId'), ver=p.get('version'), cr=parseInt(p.get('crTime'));
    if(id)  items.push({ok:true, k:'consentId',   v:id});
    if(ver) items.push({ok:true, k:'version',      v:ver});
    if(!isNaN(cr)) items.push({ok:true, k:'crTime', v:`${fmt_ts(cr)} (${fmt_age(Date.now()-cr)} ago)`});
  } catch {}

  ['flwssn','gsid','OTSessionTracking','thx_guid','nfvdid'].forEach(n=>{
    const v=s.ck[n]; if(v) items.push({ok:true,k:n,v:n==='nfvdid'?v.substring(0,30)+'…':v});
  });

  // Live data
  if (live) {
    if (live.plan)        items.push({ok:true, k:'Plan (live)',    v:live.plan});
    if (live.email)       items.push({ok:true, k:'Email (live)',   v:live.email});
    if (live.screens)     items.push({ok:true, k:'Screens (live)', v:String(live.screens)});
    if (live.billingText) items.push({ok:true, k:'Billing (live)', v:live.billingText});
    if (live.profiles?.length) items.push({ok:true, k:'Profiles (live)', v:live.profiles.join(', ')});
    if (live.planLost)     items.push({ok:false, k:'Plan lost',     v:'Plan name still shown on the site but inaccessible — usually due to a payment error'});
    if (live.paymentError) items.push({ok:false, k:'Payment error', v:'Payment method needs updating'});
    if (live.cancelled)    items.push({ok:false, k:'Cancelled',     v:'Membership has ended'});
  }

  items.forEach(({ok,k,v}) => {
    const d=document.createElement('div');
    d.className='detail-row';
    d.innerHTML=`<span class="dr-key">${esc(k)}</span><span class="dr-val ${ok?'dr-ok':'dr-bad'}">${esc(v)}</span>`;
    left.appendChild(d);
  });
  body.appendChild(left);

  // Right: cookie table
  const right = document.createElement('div');
  right.className='detail-col';
  right.innerHTML=`<div class="detail-col-title">Cookie Validation</div>`;
  const tbl=document.createElement('table');
  tbl.className='detail-tbl';
  tbl.innerHTML=`<thead><tr><th>Cookie</th><th>St</th><th>Value</th><th>Issues</th></tr></thead>`;
  const tb=document.createElement('tbody');
  s.rows.forEach(r=>{
    const {name,req,lbl,present,val,a}=r;
    const st = !present ? '<span style="color:var(--t3)">—</span>'
      : a.ok===true  ? '<span style="color:var(--green)">✓</span>'
      : a.ok===false ? `<span style="color:${req?'var(--red)':'var(--amber)'}">${req?'✗':'⚠'}</span>`
      : '<span style="color:var(--t3)">?</span>';
    const tr2=document.createElement('tr');
    tr2.innerHTML=`
      <td><div class="ck-name${req?' req':''}">${name}</div><div class="ck-lbl">${lbl}</div></td>
      <td style="text-align:center">${st}</td>
      <td class="ck-val">${val?esc(trunc(decodeURIComponent(val),55)):'<span style="color:var(--t3)">—</span>'}</td>
      <td>${a.iss.length?a.iss.map(i=>`<span class="ck-issue">✗ ${esc(i)}</span>`).join(''):(present?`<span class="ck-ok">✓ OK</span>`:'')}${a.fmt?`<div class="ck-fmt">${esc(a.fmt)}</div>`:''}</td>
    `;
    tb.appendChild(tr2);
  });
  tbl.appendChild(tb);
  right.appendChild(tbl);
  body.appendChild(right);
}

// ── Debug: raw test ───────────────────────────────────────────────────────────
async function runDebug() {
  const input = document.getElementById('cookieInput').value.trim();
  if (!input) { alert('Paste a cookie first!'); return; }
  const sets = detect_sets(input);
  const btn  = document.getElementById('debugBtn');
  btn.disabled = true; btn.textContent = '⏳ Testing…';

  try {
    const d = await safePost(`${API_BASE}/api/checker/debug`, { cookie: sets[0] });
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:9999;display:flex;align-items:center;justify-content:center;';
    box.innerHTML = `
      <div style="background:#0d0d0d;border:1px solid #333;border-radius:8px;padding:24px;max-width:700px;width:90%;max-height:80vh;overflow-y:auto;font-family:monospace;font-size:.75rem;color:#ccc">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <span style="color:#ff4444;font-weight:700;letter-spacing:2px">🔬 DEBUG RESULT</span>
          <button onclick="this.closest('div[style]').remove()" style="background:transparent;border:none;color:#888;font-size:1.2rem;cursor:pointer">✕</button>
        </div>

        <div style="margin-bottom:12px">
          <div style="color:#888;font-size:.68rem;letter-spacing:2px;margin-bottom:6px">NETFLIX.COM /account</div>
          <div style="background:#0a0a0a;padding:10px;border-radius:4px;border:1px solid ${d.netflix_account?.live ? '#003300' : '#330000'}">
            <div>Status: <strong style="color:${d.netflix_account?.live ? '#00e676' : '#ff4444'}">${d.netflix_account?.status}</strong>
              ${d.netflix_account?.live ? ' → LIVE ✓' : ' → DEAD/REDIRECT'}
            </div>
            <div style="color:#555">HTML size: ${d.netflix_account?.html_len || 0} bytes</div>
          </div>
        </div>

        <div>
          <div style="color:#888;font-size:.68rem;letter-spacing:2px;margin-bottom:6px">NFTOKEN.SITE response</div>
          <div style="background:#0a0a0a;padding:10px;border-radius:4px;border:1px solid #222;white-space:pre-wrap;word-break:break-all;color:#5a9a5a">
${esc(JSON.stringify(d.nftoken_site, null, 2))}
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(box);
  } catch (e) {
    alert('Debug error: ' + e.message);
  } finally {
    btn.disabled = false; btn.textContent = '🔬 Debug';
  }
}

// ── Ctrl+Enter ────────────────────────────────────────────────────────────────
document.getElementById('cookieInput').addEventListener('keydown', e => {
  if (e.key==='Enter' && (e.ctrlKey||e.metaKey)) runCheck();
});

(function initPaceSelect() {
  const paceSel = document.getElementById('checkPace');
  if (!paceSel) return;
  const saved = localStorage.getItem('checkerPace');
  if (saved && [...paceSel.options].some(o => o.value === saved)) paceSel.value = saved;
  paceSel.addEventListener('change', persistCheckPace);
})();
