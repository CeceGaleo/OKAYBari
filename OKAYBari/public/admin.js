// =====================================================
// CONFIG
// =====================================================
const API_URL = window.OKAY_API_URL || '/api';

// =====================================================
// STATE
// =====================================================
let token    = localStorage.getItem('okayToken') || null;
let userInfo = JSON.parse(localStorage.getItem('okayUser') || 'null');
let currentPage = 'reservations';
let resvFilters = { date:'', status:'', search:'', page:1 };

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }[char]));
}

function jsString(value) {
  return JSON.stringify(String(value ?? '')).replace(/</g, '\\u003c');
}

function safeStatus(value) {
  return ['pending', 'confirmed', 'cancelled'].includes(value) ? value : 'pending';
}

function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function formatDateTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('it-IT');
}

// =====================================================
// BOOT
// =====================================================
window.addEventListener('DOMContentLoaded', () => {
  setupAdminEvents();

  if (token && userInfo) {
    showApp();
    showPage('reservations', document.querySelector('[data-page="reservations"]'));
  }
});

function setupAdminEvents() {
  document.getElementById('login-btn')?.addEventListener('click', doLogin);
  document.getElementById('logout-btn')?.addEventListener('click', logout);
  document.getElementById('login-password')?.addEventListener('keydown', event => {
    if (event.key === 'Enter') doLogin();
  });

  document.querySelectorAll('.nav-item[data-page]').forEach(item => {
    item.addEventListener('click', () => showPage(item.dataset.page, item));
  });

  document.addEventListener('click', event => {
    const modalAction = event.target.closest('[data-modal-action]');
    if (modalAction?.dataset.modalAction === 'close') {
      closeModal();
      return;
    }

    if (event.target === document.getElementById('modal-bg')) {
      closeModal();
      return;
    }

    const actionEl = event.target.closest('[data-admin-action]');
    if (!actionEl) return;

    event.preventDefault();
    const { adminAction, id, name, status, page } = actionEl.dataset;

    if (adminAction === 'detail') openDetail(id);
    if (adminAction === 'status') quickStatus(id, status);
    if (adminAction === 'delete-prompt') confirmDelete(id, name || 'cliente');
    if (adminAction === 'delete') deleteReservation(id);
    if (adminAction === 'save-detail') saveDetail(id);
    if (adminAction === 'new-user') openNewUser();
    if (adminAction === 'create-user') createUser();
    if (adminAction === 'reset-password') openPasswordModal(id, actionEl.dataset.email || '');
    if (adminAction === 'save-password') updateUserPassword(id);
    if (adminAction === 'reset-filters') resetFilters();
    if (adminAction === 'page') {
      resvFilters.page = Number(page) || 1;
      loadAndRenderTable();
    }
  });

  document.addEventListener('input', event => {
    const field = event.target.dataset.resvFilter;
    if (field !== 'search') return;

    resvFilters.search = event.target.value;
    resvFilters.page = 1;
    loadAndRenderTable();
  });

  document.addEventListener('change', event => {
    const field = event.target.dataset.resvFilter;
    if (field === 'date' || field === 'status') {
      resvFilters[field] = event.target.value;
      resvFilters.page = 1;
      loadAndRenderTable();
      return;
    }

    if (event.target.matches('[data-summary-date]')) {
      loadSummary(event.target.value);
    }
  });
}

// =====================================================
// AUTH
// =====================================================
async function doLogin() {
  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl    = document.getElementById('login-error');
  const btn      = document.getElementById('login-btn');

  if (!email || !password) { errEl.textContent = 'Inserisci email e password'; return; }

  btn.disabled = true; btn.textContent = 'Accesso…';
  errEl.textContent = '';

  try {
    const res  = await fetch(`${API_URL}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error?.message || 'Errore login');

    token    = data.data.token;
    userInfo = data.data.user;
    localStorage.setItem('okayToken',  token);
    localStorage.setItem('okayUser',   JSON.stringify(userInfo));

    showApp();
    showPage('reservations', document.querySelector('[data-page="reservations"]'));
  } catch (err) {
    errEl.textContent = err.message;
  } finally {
    btn.disabled = false; btn.textContent = 'Accedi';
  }
}

function logout() {
  token = null; userInfo = null;
  localStorage.removeItem('okayToken');
  localStorage.removeItem('okayUser');
  document.getElementById('app').classList.remove('visible');
  document.getElementById('login-screen').style.display = 'flex';
}

function showApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').classList.add('visible');
  if (userInfo) document.getElementById('user-email-display').textContent = userInfo.email;

  // Nascondi voci admin solo per staff
  if (userInfo?.role !== 'admin') {
    document.querySelectorAll('[data-page="logs"],[data-page="users"]').forEach(el => {
      el.style.opacity = '0.35'; el.style.pointerEvents = 'none';
    });
  }
}

// =====================================================
// API HELPER
// =====================================================
async function api(path, method = 'GET', body = null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  };
  if (body) opts.body = JSON.stringify(body);

  const res  = await fetch(`${API_URL}${path}`, opts);
  const data = await res.json();

  if (res.status === 401) { logout(); return null; }
  if (!res.ok) throw new Error(data.error?.message || 'Errore API');
  return data;
}

// =====================================================
// PAGES
// =====================================================
function showPage(page, el) {
  currentPage = page;
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  if (el) el.classList.add('active');
  const content = document.getElementById('content');
  content.innerHTML = '<div class="loading">Caricamento…</div>';

  switch (page) {
    case 'reservations': renderReservations(); break;
    case 'summary':      renderSummary();      break;
    case 'logs':         renderLogs();         break;
    case 'users':        renderUsers();        break;
  }
}

// =====================================================
// PAGE: RESERVATIONS
// =====================================================
async function renderReservations() {
  const c = document.getElementById('content');

  // Carica stats + lista
  let summary, resData;
  try {
    const todayStr = new Date().toISOString().slice(0,10);
    [summary, resData] = await Promise.all([
      api(`/admin/summary?date=${todayStr}`),
      loadReservations(),
    ]);
  } catch(err) {
    c.innerHTML = `<div class="empty-state"><div class="icon">⚠️</div><p>${escapeHtml(err.message)}</p></div>`;
    return;
  }

  const s = summary?.data?.totals || {};

  c.innerHTML = `
    <div class="stats-row">
      <div class="stat-card" data-icon="📅">
        <div class="stat-label">Oggi — Totale</div>
        <div class="stat-value orange">${s.total || 0}</div>
      </div>
      <div class="stat-card" data-icon="✅">
        <div class="stat-label">Confermate</div>
        <div class="stat-value green">${s.confirmed || 0}</div>
      </div>
      <div class="stat-card" data-icon="⏳">
        <div class="stat-label">In Attesa</div>
        <div class="stat-value yellow">${s.pending || 0}</div>
      </div>
      <div class="stat-card" data-icon="👥">
        <div class="stat-label">Coperti Oggi</div>
        <div class="stat-value">${s.total_people || 0}</div>
      </div>
    </div>

    <div class="filters-bar">
      <input class="filter-input" type="date" id="f-date" data-resv-filter="date" placeholder="Data" value="${escapeHtml(resvFilters.date)}">
      <select class="filter-select" id="f-status" data-resv-filter="status">
        <option value="">Tutti gli stati</option>
        <option value="pending"   ${resvFilters.status==='pending'   ?'selected':''}>⏳ In attesa</option>
        <option value="confirmed" ${resvFilters.status==='confirmed' ?'selected':''}>✅ Confermata</option>
        <option value="cancelled" ${resvFilters.status==='cancelled' ?'selected':''}>❌ Cancellata</option>
      </select>
      <input class="filter-input" type="text" id="f-search" data-resv-filter="search" placeholder="🔍 Cerca nome, telefono…" value="${escapeHtml(resvFilters.search)}">
      <button class="filter-btn reset" data-admin-action="reset-filters">✕ Reset</button>
    </div>

    <div id="table-area"></div>
  `;

  renderTable(resData);
}

async function loadReservations() {
  const p = new URLSearchParams();
  if (resvFilters.date)   p.set('date',   resvFilters.date);
  if (resvFilters.status) p.set('status', resvFilters.status);
  if (resvFilters.search) p.set('search', resvFilters.search);
  p.set('page',  resvFilters.page);
  p.set('limit', 20);
  return api(`/admin/reservations?${p}`);
}

async function loadAndRenderTable() {
  document.getElementById('table-area').innerHTML = '<div class="loading">Caricamento…</div>';
  try {
    const data = await loadReservations();
    renderTable(data);
  } catch(err) {
    document.getElementById('table-area').innerHTML = `<div class="empty-state"><p>${escapeHtml(err.message)}</p></div>`;
  }
}

function renderTable(data) {
  const area = document.getElementById('table-area');
  if (!area) return;

  const rows = data?.data || [];
  const pag  = data?.pagination || {};

  if (!rows.length) {
    area.innerHTML = '<div class="empty-state"><div class="icon">📭</div><p>Nessuna prenotazione trovata</p></div>';
    return;
  }

  const tbody = rows.map(r => {
    const id = String(r.id || '');
    const status = safeStatus(r.status);
    const name = escapeHtml(r.name);
    const surname = r.surname ? ` ${escapeHtml(r.surname)}` : '';

    return `
      <tr>
        <td style="color:var(--muted);font-size:0.72rem">${escapeHtml(id.slice(0,8).toUpperCase())}</td>
        <td><strong>${name}</strong>${surname}</td>
        <td>${escapeHtml(r.phone)}</td>
        <td style="color:var(--accent);font-family:var(--font-d);font-size:1rem">${escapeHtml(r.date)}</td>
        <td style="color:var(--accent2)">${escapeHtml(r.time)}</td>
        <td>${safeNumber(r.people_count)} pers.</td>
        <td><span class="badge ${status}">${statusLabel(status)}</span></td>
        <td>
          <button class="action-btn" data-admin-action="detail" data-id="${escapeHtml(id)}">Dettagli</button>
          ${status !== 'confirmed' ? `<button class="action-btn confirm" data-admin-action="status" data-id="${escapeHtml(id)}" data-status="confirmed">✓ Conferma</button>` : ''}
          ${status !== 'cancelled' ? `<button class="action-btn cancel" data-admin-action="status" data-id="${escapeHtml(id)}" data-status="cancelled">✕ Cancella</button>` : ''}
          <button class="action-btn delete" data-admin-action="delete-prompt" data-id="${escapeHtml(id)}" data-name="${escapeHtml(r.name || 'cliente')}">Elimina</button>
        </td>
      </tr>
    `;
  }).join('');

  let pages = '';
  if (pag.pages > 1) {
    for (let i=1; i<=pag.pages; i++) {
      pages += `<button class="page-btn ${i===pag.page?'active':''}" data-admin-action="page" data-page="${i}">${i}</button>`;
    }
  }

  area.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>ID</th><th>Cliente</th><th>Telefono</th>
            <th>Data</th><th>Ora</th><th>Persone</th><th>Stato</th><th>Azioni</th>
          </tr>
        </thead>
        <tbody>${tbody}</tbody>
      </table>
    </div>
    ${pag.pages > 1 ? `<div class="pagination">
      <span class="page-info">${pag.total} prenotazioni · pagina ${pag.page}/${pag.pages}</span>
      ${pages}
    </div>` : `<div style="margin-top:12px;font-size:0.75rem;color:var(--muted)">${pag.total} prenotazione${pag.total!==1?'i':''}</div>`}
  `;
}

function resetFilters() {
  resvFilters = { date:'', status:'', search:'', page:1 };
  showPage('reservations', document.querySelector('[data-page="reservations"]'));
}

// =====================================================
// QUICK STATUS UPDATE
// =====================================================
async function quickStatus(id, status) {
  try {
    await api(`/admin/reservations/${id}`, 'PUT', { status });
    toast(`Stato aggiornato: ${statusLabel(status)}`);
    loadAndRenderTable();
  } catch(err) {
    toast(err.message, 'error');
  }
}

async function confirmDelete(id, name) {
  openModal('Elimina Prenotazione', `
    <p style="color:var(--muted);line-height:1.8">
      Stai per eliminare la prenotazione di <strong>${escapeHtml(name)}</strong>.<br>
      Questa azione non è reversibile.
    </p>
  `, [
    { label:'Annulla', cls:'secondary', attrs:'data-modal-action="close"' },
    { label:'Elimina', cls:'danger', attrs:`data-admin-action="delete" data-id="${escapeHtml(id)}"` },
  ]);
}

async function deleteReservation(id) {
  closeModal();
  try {
    await api(`/admin/reservations/${id}`, 'DELETE');
    toast('Prenotazione eliminata');
    loadAndRenderTable();
  } catch(err) {
    toast(err.message, 'error');
  }
}

// =====================================================
// DETAIL MODAL
// =====================================================
async function openDetail(id) {
  openModal('Caricamento…', '<div class="loading">…</div>', []);
  try {
    const data = await api(`/admin/reservations/${id}`);
    const r    = data.data;
    const status = safeStatus(r.status);

    document.getElementById('modal-title').textContent = `#${String(r.id || '').slice(0,8).toUpperCase()}`;
    document.getElementById('modal-body').innerHTML = `
      <div class="detail-row">
        <div class="detail-field"><label>Nome</label><div class="val">${escapeHtml(r.name)} ${escapeHtml(r.surname || '')}</div></div>
        <div class="detail-field"><label>Stato</label><span class="badge ${status}">${statusLabel(status)}</span></div>
      </div>
      <div class="detail-row">
        <div class="detail-field"><label>Telefono</label><div class="val">${escapeHtml(r.phone)}</div></div>
        <div class="detail-field"><label>Email</label><div class="val">${escapeHtml(r.email || '—')}</div></div>
      </div>
      <div class="detail-row">
        <div class="detail-field"><label>Data</label><div class="val" style="color:var(--accent);font-family:var(--font-d);font-size:1.2rem">${escapeHtml(r.date)}</div></div>
        <div class="detail-field"><label>Ora</label><div class="val" style="color:var(--accent2);font-family:var(--font-d);font-size:1.2rem">${escapeHtml(r.time)}</div></div>
        <div class="detail-field"><label>Persone</label><div class="val">${safeNumber(r.people_count)}</div></div>
      </div>
      ${r.notes ? `<div class="form-group" style="margin-top:12px"><label>Note cliente</label><div class="val" style="background:var(--bg);padding:10px;font-size:0.85rem;color:var(--muted2)">${escapeHtml(r.notes)}</div></div>` : ''}
      <div class="form-group" style="margin-top:16px">
        <label>Stato prenotazione</label>
        <select id="edit-status">
          <option value="pending"   ${status==='pending'  ?'selected':''}>⏳ In attesa</option>
          <option value="confirmed" ${status==='confirmed'?'selected':''}>✅ Confermata</option>
          <option value="cancelled" ${status==='cancelled'?'selected':''}>❌ Cancellata</option>
        </select>
      </div>
      <div class="form-group">
        <label>Note interne (solo staff)</label>
        <textarea id="edit-notes">${escapeHtml(r.internal_notes || '')}</textarea>
      </div>
      <div style="font-size:0.7rem;color:var(--muted);margin-top:8px">
        Creata: ${formatDateTime(r.created_at)} · 
        Aggiornata: ${formatDateTime(r.updated_at)}
      </div>
    `;
    document.getElementById('modal-footer').innerHTML = `
      <button class="btn-sm secondary" data-modal-action="close">Chiudi</button>
      <button class="btn-sm danger" data-admin-action="delete-prompt" data-id="${escapeHtml(r.id)}" data-name="${escapeHtml(r.name || 'cliente')}">Elimina</button>
      <button class="btn-sm primary" data-admin-action="save-detail" data-id="${escapeHtml(r.id)}">Salva modifiche</button>
    `;
  } catch(err) {
    toast(err.message, 'error'); closeModal();
  }
}

async function saveDetail(id) {
  const status = document.getElementById('edit-status')?.value;
  const notes  = document.getElementById('edit-notes')?.value;
  try {
    await api(`/admin/reservations/${id}`, 'PUT', { status, internal_notes: notes });
    toast('Prenotazione aggiornata ✓');
    closeModal();
    loadAndRenderTable();
  } catch(err) {
    toast(err.message, 'error');
  }
}

// =====================================================
// PAGE: SUMMARY
// =====================================================
async function renderSummary() {
  const c   = document.getElementById('content');
  const today = new Date().toISOString().slice(0,10);

  c.innerHTML = `
    <div class="summary-date-bar">
      <span style="font-size:0.72rem;letter-spacing:2px;text-transform:uppercase;color:var(--muted)">Data:</span>
      <input class="filter-input" type="date" id="sum-date" data-summary-date value="${today}">
    </div>
    <div id="sum-content"><div class="loading">Caricamento…</div></div>
  `;

  loadSummary(today);
}

async function loadSummary(date) {
  const el = document.getElementById('sum-content');
  try {
    const data = await api(`/admin/summary?date=${date}`);
    const d    = data.data;
    const t    = d.totals;
    const maxP = 8; // max per slot

    const slots = d.by_time.map(s => {
      const total = safeNumber(s.total);
      const pct = Math.round((total / maxP) * 100);
      const full = total >= maxP;
      return `
        <div class="slot-row">
          <div class="slot-time">${escapeHtml(s.time)}</div>
          <div>
            <div class="slot-bar"><div class="slot-fill" style="width:${Math.min(pct,100)}%;background:${full?'var(--red)':'var(--accent)'}"></div></div>
          </div>
          <div class="slot-count ${full?'red':''}" title="totale">${total}/${maxP}</div>
          <div class="slot-count green" title="confermati">✅ ${safeNumber(s.confirmed)}</div>
          <div class="slot-count" title="coperti">👥 ${safeNumber(s.total_people)}</div>
        </div>
      `;
    }).join('') || '<div class="empty-state"><div class="icon">📭</div><p>Nessuna prenotazione per questa data</p></div>';

    el.innerHTML = `
      <div class="stats-row" style="margin-bottom:24px">
        <div class="stat-card" data-icon="📅"><div class="stat-label">Totale</div><div class="stat-value orange">${safeNumber(t.total)}</div></div>
        <div class="stat-card" data-icon="✅"><div class="stat-label">Confermate</div><div class="stat-value green">${safeNumber(t.confirmed)}</div></div>
        <div class="stat-card" data-icon="⏳"><div class="stat-label">In attesa</div><div class="stat-value yellow">${safeNumber(t.pending)}</div></div>
        <div class="stat-card" data-icon="👥"><div class="stat-label">Coperti</div><div class="stat-value">${safeNumber(t.total_people)}</div></div>
      </div>
      <div style="font-size:0.65rem;letter-spacing:3px;text-transform:uppercase;color:var(--muted);margin-bottom:12px">Fasce orarie</div>
      ${slots}
    `;
  } catch(err) {
    el.innerHTML = `<div class="empty-state"><p>${escapeHtml(err.message)}</p></div>`;
  }
}

// =====================================================
// PAGE: LOGS
// =====================================================
async function renderLogs() {
  const c = document.getElementById('content');
  try {
    const data = await api('/admin/logs');
    const logs = data.data;
    if (!logs.length) {
      c.innerHTML = '<div class="empty-state"><div class="icon">📭</div><p>Nessun log disponibile</p></div>';
      return;
    }
    const rows = logs.map(l => `
      <tr>
        <td style="color:var(--muted);font-size:0.72rem">${formatDateTime(l.created_at)}</td>
        <td style="color:var(--muted2)">${escapeHtml(l.user_email)}</td>
        <td><span class="log-action">${escapeHtml(l.action)}</span></td>
        <td style="font-size:0.72rem;color:var(--muted)">${l.reservation_id ? escapeHtml(String(l.reservation_id).slice(0,8).toUpperCase()) : '—'}</td>
        <td style="font-size:0.8rem;color:var(--muted2)">${escapeHtml(l.details || '—')}</td>
      </tr>
    `).join('');
    c.innerHTML = `
      <div style="margin-bottom:20px">
        <div style="font-family:var(--font-d);font-size:2.5rem;letter-spacing:2px">Log Attività</div>
        <div style="font-size:0.75rem;color:var(--muted);margin-top:4px">Ultime ${logs.length} azioni</div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Data/Ora</th><th>Utente</th><th>Azione</th><th>ID Prenotazione</th><th>Dettagli</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  } catch(err) {
    c.innerHTML = `<div class="empty-state"><p>${escapeHtml(err.message)}</p></div>`;
  }
}

// =====================================================
// PAGE: USERS
// =====================================================
async function renderUsers() {
  const c = document.getElementById('content');
  try {
    const data  = await api('/admin/users');
    const users = data.data;
    const rows  = users.map(u => {
      const id = String(u.id || '');
      const email = String(u.email || '');
      return `
        <tr>
          <td style="color:var(--muted);font-size:0.72rem">${escapeHtml(id.slice(0,8))}</td>
          <td><strong>${escapeHtml(email)}</strong></td>
          <td><span class="badge ${u.role==='admin'?'confirmed':'pending'}">${escapeHtml(u.role)}</span></td>
          <td style="color:var(--muted);font-size:0.78rem">${formatDateTime(u.created_at)}</td>
          <td>
            <button class="action-btn" data-admin-action="reset-password" data-id="${escapeHtml(id)}" data-email="${escapeHtml(email)}">Password</button>
          </td>
        </tr>
      `;
    }).join('');

    c.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px">
        <div>
          <div style="font-family:var(--font-d);font-size:2.5rem;letter-spacing:2px">Utenti</div>
          <div style="font-size:0.75rem;color:var(--muted)">${users.length} utenti registrati</div>
        </div>
        <button class="filter-btn" data-admin-action="new-user">+ Nuovo utente</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>ID</th><th>Email</th><th>Ruolo</th><th>Creato</th><th>Azioni</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  } catch(err) {
    c.innerHTML = `<div class="empty-state"><p>${escapeHtml(err.message)}</p></div>`;
  }
}

function openNewUser() {
  openModal('Nuovo Utente', `
    <div class="modal-grid">
      <div class="form-group" style="grid-column:1/-1">
        <label>Email</label>
        <input type="email" id="nu-email" placeholder="staff@okaybari.it">
      </div>
      <div class="form-group">
        <label>Password</label>
        <input type="password" id="nu-pass" placeholder="Min 8 caratteri, 1 maiuscola, 1 numero">
      </div>
      <div class="form-group">
        <label>Ruolo</label>
        <select id="nu-role">
          <option value="staff">Staff (visualizza/modifica)</option>
          <option value="admin">Admin (accesso completo)</option>
        </select>
      </div>
    </div>
    <div id="nu-err" style="color:var(--red);font-size:0.82rem;margin-top:8px"></div>
  `, [
    { label:'Annulla', cls:'secondary', attrs:'data-modal-action="close"' },
    { label:'Crea utente', cls:'primary', attrs:'data-admin-action="create-user"' },
  ]);
}

async function createUser() {
  const email = document.getElementById('nu-email')?.value?.trim();
  const pass  = document.getElementById('nu-pass')?.value;
  const role  = document.getElementById('nu-role')?.value;
  const errEl = document.getElementById('nu-err');

  if (!email || !pass) { errEl.textContent = 'Compila tutti i campi'; return; }

  try {
    await api('/admin/users', 'POST', { email, password: pass, role });
    toast('Utente creato ✓');
    closeModal();
    renderUsers();
  } catch(err) {
    errEl.textContent = err.message;
  }
}

function openPasswordModal(id, email) {
  openModal('Cambia Password', `
    <div class="modal-grid">
      <div class="form-group" style="grid-column:1/-1">
        <label>Account</label>
        <input type="email" value="${escapeHtml(email)}" disabled>
      </div>
      <div class="form-group">
        <label>Nuova password</label>
        <input type="password" id="rp-pass" placeholder="Min 8 caratteri, 1 maiuscola, 1 numero" autocomplete="new-password">
      </div>
      <div class="form-group">
        <label>Conferma password</label>
        <input type="password" id="rp-pass2" placeholder="Ripeti password" autocomplete="new-password">
      </div>
    </div>
    <div id="rp-err" style="color:var(--red);font-size:0.82rem;margin-top:8px"></div>
  `, [
    { label:'Annulla', cls:'secondary', attrs:'data-modal-action="close"' },
    { label:'Aggiorna password', cls:'primary', attrs:`data-admin-action="save-password" data-id="${escapeHtml(id)}"` },
  ]);
}

async function updateUserPassword(id) {
  const pass = document.getElementById('rp-pass')?.value || '';
  const pass2 = document.getElementById('rp-pass2')?.value || '';
  const errEl = document.getElementById('rp-err');

  if (!pass || !pass2) {
    errEl.textContent = 'Compila entrambi i campi password';
    return;
  }
  if (pass !== pass2) {
    errEl.textContent = 'Le password non coincidono';
    return;
  }

  try {
    await api(`/admin/users/${id}/password`, 'PUT', { password: pass });
    toast('Password aggiornata');
    closeModal();
    renderUsers();
  } catch(err) {
    errEl.textContent = err.message;
  }
}

// =====================================================
// MODAL HELPERS
// =====================================================
function openModal(title, body, buttons) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML    = body;
  document.getElementById('modal-footer').innerHTML  = buttons.map(b =>
    `<button class="btn-sm ${escapeHtml(b.cls)}" ${b.attrs || ''}>${escapeHtml(b.label)}</button>`
  ).join('');
  document.getElementById('modal-bg').classList.add('open');
}

function closeModal() {
  document.getElementById('modal-bg').classList.remove('open');
}

function closeModalOnBg(e) {
  if (e.target === document.getElementById('modal-bg')) closeModal();
}

// =====================================================
// TOAST
// =====================================================
function toast(msg, type = 'success') {
  const c = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = `toast ${type==='error'?'error':type==='warn'?'warn':''}`;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

// =====================================================
// UTILS
// =====================================================
function statusLabel(s) {
  return { pending:'In attesa', confirmed:'Confermata', cancelled:'Cancellata' }[s] || 'Sconosciuto';
}
