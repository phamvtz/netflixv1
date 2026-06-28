'use strict';
// Seller workspace — Transactions + Deposit views
// Split from seller.js. Classic script: shares global scope with the other seller-*.js files.

let allTransactions = [];
let txPage = 1;
const TX_PER_PAGE = 12;

async function loadTransactions() {
  const d = await api('/api/seller/transactions');
  if (!d.success) return;
  const s = d.summary || {};
  $('txnSummary').innerHTML = `
    <div class="sw-stat" data-accent="orange">
      <div class="l">${tt('seller.tx.totalTopup')}</div>
      <div class="n">${fmtVnd(s.totalTopup)}</div>
    </div>
    <div class="sw-stat" data-accent="amber">
      <div class="l">${tt('seller.tx.totalPlus')}</div>
      <div class="n">${fmtVnd(s.totalPlus ?? s.totalTopup)}</div>
    </div>
    <div class="sw-stat" data-accent="red">
      <div class="l">${tt('seller.tx.totalMinus')}</div>
      <div class="n">${fmtVnd(s.totalMinus)}</div>
    </div>
    <div class="sw-stat" data-accent="blue">
      <div class="l">${tt('seller.tx.balance')}</div>
      <div class="n accent">${fmtVnd(s.balance)}</div>
    </div>`;
  if (dashboard) { dashboard.balance = s.balance; updateBalanceUI(); }
  allTransactions = d.transactions || [];
  txPage = 1;
  renderTransactions();
}

function renderTransactions() {
  if (!$('txnBody')) return;
  const typeF = $('txTypeFilter')?.value || 'all';
  const q = ($('txSearch')?.value || '').toLowerCase();
  const from = $('txDateFrom')?.value ? Date.parse($('txDateFrom').value) / 1000 : null;
  const to = $('txDateTo')?.value ? Date.parse($('txDateTo').value) / 1000 + 86400 : null;
  let rows = allTransactions.filter((t) => {
    if (typeF !== 'all' && t.type !== typeF) return false;
    if (q && !((t.id || '') + (t.description || '')).toLowerCase().includes(q)) return false;
    if (from && t.createdAt < from) return false;
    if (to && t.createdAt > to) return false;
    return true;
  });
  const pages = Math.max(1, Math.ceil(rows.length / TX_PER_PAGE));
  if (txPage > pages) txPage = pages;
  const pageRows = rows.slice((txPage - 1) * TX_PER_PAGE, txPage * TX_PER_PAGE);
  const typeLabel = {
    topup: { txt: tt('seller.tx.typeTopup'), cls: 'perm-badge--on' },
    purchase: { txt: tt('seller.tx.typePurchase'), cls: 'perm-badge--off' },
  };
  $('txnBody').innerHTML = pageRows.length ? pageRows.map((t) => {
    const pos = t.amount >= 0;
    const tl = typeLabel[t.type] || { txt: t.type, cls: 'perm-badge--off' };
    return `<tr>
      <td>${fmtTs(t.createdAt)}</td>
      <td><span class="perm-badge ${tl.cls}">${tl.txt}</span></td>
      <td style="color:${pos ? '#15803d' : '#b91c1c'};font-weight:700">${pos ? '+' : ''}${fmtVnd(t.amount)}</td>
      <td>${fmtVnd(t.balanceAfter)}</td>
      <td style="font-family:var(--sw-mono);font-size:0.78rem;color:#dc2626">${esc(t.id || '—')}</td>
      <td>${esc(t.description || '')}</td>
      <td><span class="perm-badge perm-badge--on">${tt('seller.tx.statusDone')}</span></td>
    </tr>`;
  }).join('') : `<tr><td colspan="7" class="panel-empty">${tt('seller.tx.empty')}</td></tr>`;
  const pag = $('txnPagination');
  if (pag) {
    pag.innerHTML = `<span>${tt('seller.tx.pageLabel').replace('{p}', txPage).replace('{t}', pages).replace('{n}', rows.length)}</span>
      <span>
        ${txPage > 1 ? `<button type="button" class="sw-btn sw-btn--outline sw-btn--sm" id="txPrev">← ${tt('seller.tx.prev')}</button>` : ''}
        ${txPage < pages ? `<button type="button" class="sw-btn sw-btn--outline sw-btn--sm" id="txNext">${tt('seller.tx.next')} →</button>` : ''}
      </span>`;
    $('txPrev')?.addEventListener('click', () => { txPage--; renderTransactions(); });
    $('txNext')?.addEventListener('click', () => { txPage++; renderTransactions(); });
  }
}

async function loadDeposit() {
  const balance = dashboard?.balance ?? 0;
  if ($('depBalance')) $('depBalance').textContent = fmtVnd(balance);

  // Bank info comes from server config (.env) — no hardcoded values
  const cfg = await api('/api/deposit/config');
  const realtime = $('viewDeposit')?.querySelector('.perm-badge');
  if (cfg && cfg.success && cfg.configured) {
    if ($('depBank')) $('depBank').textContent = cfg.bankName || '—';
    if ($('depAcct')) $('depAcct').textContent = cfg.accountNo || '—';
    if ($('depHolder')) $('depHolder').textContent = cfg.holder || '—';
    if ($('depMemo')) $('depMemo').textContent = cfg.memo || '—';
    const qr = $('depositQr');
    if (qr && cfg.qrUrl) qr.src = cfg.qrUrl;
  } else {
    // Not configured in .env → show clear placeholder, no fake numbers
    ['depBank', 'depAcct', 'depHolder', 'depMemo'].forEach((id) => {
      if ($(id)) $(id).textContent = tt('seller.deposit.notConfigured');
    });
    const qr = $('depositQr');
    if (qr) { qr.removeAttribute('src'); qr.alt = tt('seller.deposit.notConfigured'); }
  }

  document.querySelectorAll('[data-copy-from]').forEach((b) => {
    if (b._bound) return;
    b._bound = true;
    b.addEventListener('click', () => {
      const tgt = $(b.getAttribute('data-copy-from'));
      if (tgt) copyText(tgt.textContent.trim());
    });
  });
  const d = await api('/api/seller/transactions');
  const rows = (d?.transactions || []).slice(0, 10);
  const body = $('depRecentBody');
  if (body) {
    body.innerHTML = rows.length ? rows.map((t) => {
      const pos = t.amount >= 0;
      const typeTxt = t.type === 'topup' ? tt('seller.tx.typeTopup') : t.type === 'purchase' ? tt('seller.tx.typePurchase') : tt('seller.tx.typeAdjust');
      return `<tr>
        <td>${fmtTs(t.createdAt)}</td>
        <td><span class="perm-badge ${pos ? 'perm-badge--on' : 'perm-badge--off'}">${typeTxt}</span></td>
        <td style="color:${pos ? '#16A34A' : '#DC2626'};font-weight:700">${pos ? '+' : ''}${fmtVnd(t.amount)}</td>
        <td>${fmtVnd(t.balanceAfter)}</td>
        <td style="font-family:var(--sw-mono);font-size:0.78rem;color:#dc2626">${esc(t.id || '—')}</td>
      </tr>`;
    }).join('') : `<tr><td colspan="5" class="panel-empty">${tt('seller.tx.empty')}</td></tr>`;
  }
  await loadDepositHistory();
}

// Status badge for a deposit intent (credited / pending / unmatched / error)
function depStatusBadge(status) {
  const map = {
    credited: { cls: 'perm-badge--on', txt: tt('seller.deposit.stCredited') },
    pending: { cls: 'perm-badge--off', txt: tt('seller.deposit.stPending') },
    unmatched: { cls: 'perm-badge--off', txt: tt('seller.deposit.stUnmatched') },
    error: { cls: 'perm-badge--off', txt: tt('seller.deposit.stError') },
  };
  const m = map[status] || { cls: 'perm-badge--off', txt: status || '—' };
  return `<span class="perm-badge ${m.cls}">${m.txt}</span>`;
}

async function loadDepositHistory() {
  const body = $('depHistoryBody');
  if (!body) return;
  const d = await api('/api/seller/deposits');
  const rows = d?.deposits || [];
  body.innerHTML = rows.length ? rows.map((dep) => `<tr>
    <td>${fmtTs(dep.creditedAt || dep.receivedAt)}</td>
    <td>${esc(dep.provider || '—')}</td>
    <td style="font-family:var(--sw-mono);font-size:0.78rem">${esc(dep.txRef || '—')}</td>
    <td style="color:#16A34A;font-weight:700">+${fmtVnd(dep.amount)}</td>
    <td>${esc(dep.memo || '')}</td>
    <td>${depStatusBadge(dep.status)}</td>
  </tr>`).join('') : `<tr><td colspan="6" class="panel-empty">${tt('seller.deposit.historyEmpty')}</td></tr>`;
}
