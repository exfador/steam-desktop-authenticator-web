const $ = (sel) => document.querySelector(sel);
let accounts = [];
let selectedId = null;
let lastCodes = {};
let acctFilter = '';

const ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none"><path d="M5 12.5l4.5 4.5L19 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_X = '<svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const ICON_DOWNLOAD = '<svg viewBox="0 0 24 24" fill="none"><path d="M12 3v12m0 0l-4-4m4 4l4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 17v2a1 1 0 001 1h14a1 1 0 001-1v-2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
const ICON_TRASH = '<svg viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-9 0l1 13a1 1 0 001 1h8a1 1 0 001-1l1-13" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_COPY = '<svg viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" stroke-width="1.7"/><path d="M5 15V5a2 2 0 012-2h8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
const ICON_EYE = '<svg viewBox="0 0 24 24" fill="none"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.7"/></svg>';
const ICON_EYE_OFF = '<svg viewBox="0 0 24 24" fill="none"><path d="M3 3l18 18" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M10.6 6.2A9.8 9.8 0 0112 6c6.5 0 10 7 10 7a17 17 0 01-3 3.8M6.2 6.3A17 17 0 002 13s3.5 7 10 7a9.6 9.6 0 004-.9" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_DOTS = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/></svg>';
const credsCache = {};

async function api(url, opts) {
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}

const dropzone = $('#dropzone');
const fileInput = $('#fileInput');

dropzone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  readFiles([...fileInput.files]);
  fileInput.value = '';
});

['dragenter', 'dragover'].forEach((e) =>
  dropzone.addEventListener(e, (ev) => {
    ev.preventDefault();
    dropzone.classList.add('drag');
  })
);
['dragleave', 'drop'].forEach((e) =>
  dropzone.addEventListener(e, (ev) => {
    ev.preventDefault();
    dropzone.classList.remove('drag');
  })
);
dropzone.addEventListener('drop', (ev) => readFiles([...ev.dataTransfer.files]));

document.addEventListener('paste', (ev) => {
  const text = ev.clipboardData.getData('text');
  if (text && text.trim().startsWith('{')) {
    importFiles([{ name: `pasted-${Date.now()}.maFile`, content: text }]);
  }
});

const acctSearch = $('#acctSearch');
if (acctSearch) {
  acctSearch.addEventListener('input', () => {
    acctFilter = acctSearch.value.trim().toLowerCase();
    renderAccounts();
  });
}

function readFiles(files) {
  const payloads = [];
  let pending = files.length;
  if (!pending) return;
  files.forEach((file) => {
    const reader = new FileReader();
    reader.onload = () => {
      payloads.push({ name: file.name, content: reader.result });
      if (--pending === 0) importFiles(payloads);
    };
    reader.readAsText(file);
  });
}

async function importFiles(files, password) {
  try {
    const { results, needPassword } = await api('/api/accounts/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files, password }),
    });

    if (needPassword && !password) {
      const pw = prompt('Этот mafile зашифрован SDA. Введите пароль:');
      if (pw) return importFiles(files, pw);
      toast('Импорт отменён (нужен пароль)');
      return;
    }
    const ok = results.filter((r) => r.ok).length;
    const fail = results.filter((r) => !r.ok && r.error !== 'encrypted');
    toast(`Импортировано: ${ok}${fail.length ? `, ошибок: ${fail.length}` : ''}`);
    if (fail.length) console.warn('Import errors:', fail);
    await loadAccounts();
  } catch (e) {
    toast('Ошибка импорта: ' + e.message);
  }
}

async function loadAccounts() {
  const { accounts: list } = await api('/api/accounts');
  accounts = list;
  if (selectedId && !accounts.find((a) => a.id === selectedId)) selectedId = null;
  if (!selectedId && accounts.length) selectedId = accounts[0].id;
  renderAccounts();
  renderDetail();
}

function renderAccounts() {
  const el = $('#accounts');
  el.innerHTML = '';

  const wrap = $('#acctSearchWrap');
  if (wrap) wrap.hidden = accounts.length <= 5;
  const f = acctFilter;
  const list = f
    ? accounts.filter((a) => (a.accountName || '').toLowerCase().includes(f) || (a.steam64 || '').includes(f))
    : accounts;
  const countEl = $('#acctCount');
  if (countEl) countEl.textContent = f ? `${list.length}/${accounts.length}` : String(accounts.length);

  if (!list.length) {
    if (accounts.length) el.innerHTML = '<div class="acct-empty">ничего не найдено</div>';
    return;
  }

  list.forEach((a) => {
    const div = document.createElement('div');
    div.className = 'acct' + (a.id === selectedId ? ' active' : '');
    div.innerHTML = `
      <div class="acct-main">
        <div class="name">${escapeHtml(a.accountName)}</div>
        <div class="meta"><span class="sid">${a.steam64 || 'нет SteamID'}</span>
          ${a.hasSession ? '<span class="pill ok">сессия</span>' : '<span class="pill">только коды</span>'}
        </div>
      </div>
      <div class="acct-right">
        <div class="mini-code" data-code="${a.id}">${lastCodes[a.id] || '·····'}</div>
        <button class="acct-kebab" aria-label="Меню аккаунта" title="Меню аккаунта">${ICON_DOTS}</button>
      </div>`;
    div.addEventListener('click', () => selectAccount(a.id));
    div.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      selectAccount(a.id);
      showAcctMenu(ev.clientX, ev.clientY, a.id);
    });
    div.querySelector('.acct-kebab').addEventListener('click', (ev) => {
      ev.stopPropagation();
      const r = ev.currentTarget.getBoundingClientRect();
      const mx = r.right;
      const my = r.bottom + 4;
      selectAccount(a.id);
      showAcctMenu(mx, my, a.id, { anchorRight: true });
    });
    el.appendChild(div);
  });
}

function selectAccount(id) {
  selectedId = id;
  renderAccounts();
  renderDetail();
}

let acctMenuEl = null;
function closeAcctMenu() {
  if (acctMenuEl) { acctMenuEl.remove(); acctMenuEl = null; }
}
function showAcctMenu(x, y, id, opts = {}) {
  closeAcctMenu();
  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.innerHTML = `
    <button class="ctx-item" data-act="download">${ICON_DOWNLOAD}<span>Скачать .maFile</span></button>
    <button class="ctx-item danger" data-act="delete">${ICON_TRASH}<span>Удалить из списка</span></button>`;
  document.body.appendChild(menu);
  const r = menu.getBoundingClientRect();
  const left = opts.anchorRight ? x - r.width : x;
  menu.style.left = Math.max(8, Math.min(left, window.innerWidth - r.width - 8)) + 'px';
  menu.style.top = Math.max(8, Math.min(y, window.innerHeight - r.height - 8)) + 'px';
  menu.querySelector('[data-act="download"]').addEventListener('click', () => { closeAcctMenu(); downloadVault(id); });
  menu.querySelector('[data-act="delete"]').addEventListener('click', () => { closeAcctMenu(); removeAccount(id); });
  acctMenuEl = menu;
}
window.addEventListener('click', closeAcctMenu);
window.addEventListener('scroll', closeAcctMenu, true);
window.addEventListener('resize', closeAcctMenu);
window.addEventListener('contextmenu', (e) => { if (!e.target.closest('.acct')) closeAcctMenu(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAcctMenu(); });

function downloadVault(id) {
  const link = document.createElement('a');
  link.href = '/api/accounts/' + encodeURIComponent(id) + '/file';
  link.download = '';
  document.body.appendChild(link);
  link.click();
  link.remove();
  toast('Скачивание .maFile…');
}

async function getCredentials(id) {
  if (credsCache[id]) return credsCache[id];
  const c = await api('/api/accounts/' + encodeURIComponent(id) + '/credentials');
  credsCache[id] = c;
  return c;
}

function renderDetail() {
  const el = $('#detail');
  const a = accounts.find((x) => x.id === selectedId);
  if (!a) {
    el.innerHTML = '<div class="empty"><p>Выберите аккаунт слева или импортируйте .maFile</p></div>';
    return;
  }
  el.innerHTML = `
    <div class="reactor-wrap">
      <div class="acct-title">${escapeHtml(a.accountName)}</div>
      <div class="acct-id">${a.steam64 || ''}</div>
      <div class="reactor">
        <svg class="ring" viewBox="0 0 240 240" aria-hidden="true">
          <circle class="ring-track" cx="120" cy="120" r="110"/>
          <circle class="ring-progress" id="ringProgress" cx="120" cy="120" r="110"
                  stroke-dasharray="691.15" stroke-dashoffset="0"/>
        </svg>
        <div class="reactor-center">
          <div class="big-code" id="bigCode" title="Нажмите, чтобы скопировать"
               role="button" tabindex="0" aria-label="Код Steam Guard, нажмите чтобы скопировать">${lastCodes[a.id] || '·····'}</div>
          <div class="reactor-secs" id="reactorSecs">—</div>
        </div>
      </div>
      <div class="copy-hint">нажмите на код, чтобы скопировать</div>
      <div class="creds">
        <div class="cred-row">
          <span class="cred-key">Логин</span>
          <span class="cred-val" id="credLogin">${escapeHtml(a.accountName || '—')}</span>
          <button class="cred-act" id="copyLogin" title="Скопировать логин" aria-label="Скопировать логин">${ICON_COPY}</button>
        </div>
        <div class="cred-row">
          <span class="cred-key">Пароль</span>
          <span class="cred-val masked" id="credPass">${a.hasPassword ? '••••••••' : '—'}</span>
          ${a.hasPassword ? `<button class="cred-act" id="togglePass" title="Показать пароль" aria-label="Показать пароль">${ICON_EYE}</button>
          <button class="cred-act" id="copyPass" title="Скопировать пароль" aria-label="Скопировать пароль">${ICON_COPY}</button>` : ''}
        </div>
      </div>
    </div>
    <div class="divider"></div>
    <div class="row">
      <h3>Подтверждения</h3>
      <div>
        <button class="btn" id="refreshConf">Обновить</button>
        ${a.hasRevocationCode ? '<button class="btn-red" id="unlinkAcct">Снять аутентификатор</button>' : ''}
        <button class="btn-ghost" id="removeAcct">Удалить из списка</button>
      </div>
    </div>
    <div class="proxy-row">
      <input id="proxyInput" placeholder="прокси: http://user:pass@host:port или socks5://host:port"
             value="${escapeAttr(a.proxy || '')}" />
      <button class="btn" id="saveProxy">Сохранить</button>
    </div>
    <div id="confArea">
      ${a.hasSession
        ? '<p class="muted">Нажмите «Обновить», чтобы загрузить подтверждения.</p>'
        : '<p class="warn">В этом mafile нет сессии — доступны только коды Steam Guard. Переимпортируйте mafile со свежей сессией для подтверждений.</p>'}
    </div>`;

  const bc = $('#bigCode');
  bc.addEventListener('click', () => copyCode(a.id));
  bc.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); copyCode(a.id); } });
  $('#removeAcct').addEventListener('click', () => removeAccount(a.id));
  $('#saveProxy').addEventListener('click', () => saveProxy(a.id));
  const unlink = $('#unlinkAcct');
  if (unlink) unlink.addEventListener('click', () => unlinkAuthenticator(a.id));
  const rc = $('#refreshConf');
  if (rc) rc.addEventListener('click', () => loadConfirmations(a.id));

  const copyLoginBtn = $('#copyLogin');
  if (copyLoginBtn) copyLoginBtn.addEventListener('click', async () => {
    const c = await getCredentials(a.id).catch(() => ({ login: a.accountName }));
    const login = (c && c.login) || a.accountName || '';
    if (!login) return;
    navigator.clipboard.writeText(login).then(() => toast('Логин скопирован'));
  });

  const passEl = $('#credPass');
  const toggleBtn = $('#togglePass');
  let passShown = false;
  if (toggleBtn) toggleBtn.addEventListener('click', async () => {
    try {
      const c = await getCredentials(a.id);
      passShown = !passShown;
      if (passShown) {
        passEl.textContent = c.password || '—';
        passEl.classList.remove('masked');
        toggleBtn.innerHTML = ICON_EYE_OFF;
        toggleBtn.title = 'Скрыть пароль';
      } else {
        passEl.textContent = '••••••••';
        passEl.classList.add('masked');
        toggleBtn.innerHTML = ICON_EYE;
        toggleBtn.title = 'Показать пароль';
      }
    } catch (e) {
      toast('Ошибка: ' + e.message);
    }
  });

  const copyPassBtn = $('#copyPass');
  if (copyPassBtn) copyPassBtn.addEventListener('click', async () => {
    try {
      const c = await getCredentials(a.id);
      if (!c.password) { toast('Пароль не сохранён в mafile'); return; }
      navigator.clipboard.writeText(c.password).then(() => toast('Пароль скопирован'));
    } catch (e) {
      toast('Ошибка: ' + e.message);
    }
  });
}

function copyCode(id) {
  const code = lastCodes[id];
  if (!code) return;
  navigator.clipboard.writeText(code).then(() => toast('Код скопирован: ' + code));
}

async function saveProxy(id) {
  const val = $('#proxyInput').value.trim();
  try {
    await api('/api/accounts/' + encodeURIComponent(id), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proxy: val }),
    });
    const a = accounts.find((x) => x.id === id);
    if (a) a.proxy = val || null;
    toast(val ? 'Прокси сохранён' : 'Прокси убран');
  } catch (e) {
    toast('Ошибка: ' + e.message);
  }
}

async function unlinkAuthenticator(id) {
  if (!confirm('Снять мобильный аутентификатор с аккаунта Steam?\n\nЭто отвяжет Steam Guard от аккаунта. Действие необратимо без повторной привязки. Убедитесь, что у вас есть доступ к аккаунту.')) return;
  toast('Снятие аутентификатора…');
  try {
    const res = await api('/api/accounts/' + encodeURIComponent(id) + '/revoke', { method: 'POST' });
    if (res.success) {
      toast('Аутентификатор снят');
      if (selectedId === id) selectedId = null;
      delete lastCodes[id];
      await loadAccounts();
    } else {
      toast('Не удалось снять' + (res.attemptsRemaining != null ? ` (осталось попыток: ${res.attemptsRemaining})` : ''));
    }
  } catch (e) {
    toast('Ошибка: ' + e.message);
  }
}

async function removeAccount(id) {
  if (!confirm('Убрать аккаунт из списка и удалить его mafile с диска?\n\n(Аутентификатор НЕ снимается со Steam — для этого используйте «Снять аутентификатор».)')) return;
  await api('/api/accounts/' + encodeURIComponent(id), { method: 'DELETE' });
  if (selectedId === id) selectedId = null;
  delete lastCodes[id];
  delete credsCache[id];
  toast('Аккаунт удалён (mafile перемещён в .trash)');
  await loadAccounts();
}

async function loadConfirmations(id) {
  const area = $('#confArea');
  if (!area) return;
  area.innerHTML = '<p class="muted"><span class="spinner"></span> Загрузка…</p>';
  try {
    const { actions: confirmations } = await api(`/api/accounts/${encodeURIComponent(id)}/actions`);
    if (!confirmations.length) {
      area.innerHTML = '<p class="muted">Нет ожидающих подтверждений.</p>';
      return;
    }
    area.innerHTML = `
      <div class="row">
        <span class="muted">${confirmations.length} шт.</span>
        <div>
          <button class="btn-green" id="allowAll">Принять все</button>
          <button class="btn-red" id="cancelAll">Отклонить все</button>
        </div>
      </div>
      <div class="confs" id="confList"></div>`;
    const listEl = $('#confList');
    confirmations.forEach((c) => listEl.appendChild(renderConf(id, c)));
    $('#allowAll').addEventListener('click', () => actAll(id, confirmations, true));
    $('#cancelAll').addEventListener('click', () => actAll(id, confirmations, false));
  } catch (e) {
    area.innerHTML = `<p class="warn">${escapeHtml(e.message)}</p>
      <button class="btn" id="retryConf" style="margin-top:10px">Повторить</button>`;
    const r = $('#retryConf');
    if (r) r.addEventListener('click', () => loadConfirmations(id));
  }
}

function renderConf(accId, c) {
  const div = document.createElement('div');
  div.className = 'conf';
  const sub = (c.summary && c.summary.filter(Boolean).join(' · ')) || c.typeName || '';
  div.innerHTML = `
    ${c.icon ? `<img src="${escapeAttr(c.icon)}" alt="" onerror="this.style.display='none'">` : '<div style="width:44px"></div>'}
    <div class="info">
      <div class="ctitle">${escapeHtml(c.headline || c.typeName || 'Подтверждение')}</div>
      <div class="csub">${escapeHtml(sub)}</div>
    </div>
    <div class="actions">
      <button class="btn-green" aria-label="Принять">${ICON_CHECK}</button>
      <button class="btn-red" aria-label="Отклонить">${ICON_X}</button>
    </div>`;
  const [allowBtn, cancelBtn] = div.querySelectorAll('button');
  allowBtn.addEventListener('click', () => actAll(accId, [c], true, div));
  cancelBtn.addEventListener('click', () => actAll(accId, [c], false, div));
  return div;
}

async function actAll(accId, confs, allow, singleEl) {
  try {
    const { ok } = await api(`/api/accounts/${encodeURIComponent(accId)}/actions/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: confs.map((c) => ({ id: c.id, nonce: c.nonce })),
        allow,
      }),
    });
    if (ok) {
      toast(allow ? 'Подтверждено' : 'Отклонено');
      if (singleEl && confs.length === 1) singleEl.remove();
      else loadConfirmations(accId);
    } else {
      toast('Steam отклонил операцию');
    }
  } catch (e) {
    toast('Ошибка: ' + e.message);
  }
}

const RING_CIRC = 2 * Math.PI * 110;

async function tickCodes() {
  try {
    const data = await api('/api/codes');
    data.codes.forEach((c) => {
      lastCodes[c.id] = c.code;
      document.querySelectorAll(`[data-code="${cssEsc(c.id)}"]`).forEach((el) => (el.textContent = c.code));
    });

    const secs = data.secondsRemaining;
    if (selectedId && lastCodes[selectedId]) {
      const big = $('#bigCode');
      if (big) big.textContent = lastCodes[selectedId];
    }
    const ring = $('#ringProgress');
    if (ring) ring.setAttribute('stroke-dashoffset', String(RING_CIRC * (1 - secs / 30)));
    const secEl = $('#reactorSecs');
    if (secEl) secEl.textContent = secs + 's';
  } catch {}
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}
const escapeAttr = escapeHtml;
function cssEsc(s) { return String(s).replace(/["\\]/g, '\\$&'); }

const linkOverlay = $('#linkOverlay');
const linkBody = $('#linkBody');
let linkId = null;
let linkPoll = null;

$('#createBtn').addEventListener('click', openLink);
$('#linkClose').addEventListener('click', closeLink);

function openLink() {
  linkId = null;
  linkOverlay.classList.remove('hidden');
  renderAuthStep();
}

function closeLink() {
  if (linkPoll) { clearInterval(linkPoll); linkPoll = null; }
  if (linkId) { fetch('/api/enroll/' + linkId + '/cancel', { method: 'POST' }).catch(() => {}); }
  linkId = null;
  linkOverlay.classList.add('hidden');
}

function renderAuthStep() {
  linkBody.innerHTML = `
    <p class="muted step-intro">Введите данные аккаунта Steam. Создаётся новый мобильный аутентификатор —
      на аккаунте не должно быть активного Steam Guard Mobile.</p>
    <label>Логин Steam</label>
    <input id="linkUser" autocomplete="off" />
    <label>Пароль</label>
    <input id="linkPass" type="password" autocomplete="off" />
    <label>Прокси (необязательно)</label>
    <input id="linkProxy" placeholder="http://user:pass@host:port или socks5://host:port" />
    <div class="warn-box"><span class="tag">Важно.</span> Сохраните revocation-код (R-код) после создания — без него снять аутентификатор нельзя.</div>
    <button class="btn-accent full" id="linkSubmit">Войти и создать</button>`;
  $('#linkSubmit').addEventListener('click', startLink);
}

async function startLink() {
  const username = $('#linkUser').value.trim();
  const password = $('#linkPass').value;
  const proxy = $('#linkProxy').value.trim();
  if (!username || !password) { toast('Укажите логин и пароль'); return; }
  linkBody.innerHTML = spinnerBlock('Вход в Steam…');
  try {
    const { id } = await api('/api/enroll/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, proxy, skipPhone: settings.skipPhone }),
    });
    linkId = id;
    linkPoll = setInterval(pollLink, 1500);
  } catch (e) {
    linkBody.innerHTML = errorBlock(e.message);
    wireRetry();
  }
}

async function pollLink() {
  if (!linkId) return;
  let state;
  try {
    ({ state } = await api('/api/enroll/' + linkId));
  } catch { return; }
  if (state.status === 'running') {
    linkBody.innerHTML = spinnerBlock('Ожидание ответа Steam…');
    return;
  }
  if (state.status === 'awaiting') {
    clearInterval(linkPoll); linkPoll = null;
    renderPrompt(state.pending, state.notice);
    return;
  }
  if (state.status === 'done') {
    clearInterval(linkPoll); linkPoll = null;
    renderDone(state.result);
    loadAccounts();
    return;
  }
  if (state.status === 'error') {
    clearInterval(linkPoll); linkPoll = null;
    linkBody.innerHTML = errorBlock(state.error);
    wireRetry();
  }
}

function renderPrompt(pending, notice) {
  const noticeHtml = notice ? `<div class="warn">${escapeHtml(notice)}</div>` : '';
  const prompts = {
    emailCode: {
      label: 'Введите код Steam Guard из письма на вашей почте',
      input: '<input id="promptVal" autocomplete="off" placeholder="ABCDE" />',
    },
    phoneNumber: {
      label: 'На аккаунте нет телефона. Введите номер в международном формате — или оставьте пустым, чтобы привязать аутентификатор без телефона (подтверждение придёт на email).',
      input: '<input id="promptVal" autocomplete="off" placeholder="+1XXXXXXXXXX (или пусто)" />',
    },
    confirmEmailLink: {
      label: 'Steam отправил письмо для подтверждения привязки телефона. Откройте письмо, нажмите ссылку подтверждения, затем продолжите.',
      input: '',
    },
    smsCode: {
      label: 'Введите код из SMS' + (pending.hint ? ` (номер ${escapeHtml(pending.hint)})` : ''),
      input: '<input id="promptVal" autocomplete="off" placeholder="XXXXX" />',
    },
    emailAuthCode: {
      label: 'Введите код подтверждения из письма',
      input: '<input id="promptVal" autocomplete="off" placeholder="XXXXX" />',
    },
  };
  const p = prompts[pending.type] || { label: pending.type, input: '<input id="promptVal" />' };
  linkBody.innerHTML = `
    ${noticeHtml}
    <p class="step-label">${escapeHtml(p.label)}</p>
    ${p.input}
    <button class="btn-accent full" id="promptSubmit">${
      pending.type === 'confirmEmailLink' ? 'Я подтвердил, продолжить'
      : pending.type === 'phoneNumber' ? 'Продолжить'
      : 'Отправить'}</button>`;
  const inp = $('#promptVal');
  if (inp) inp.focus();
  $('#promptSubmit').addEventListener('click', () => submitPrompt());
  if (inp) inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitPrompt(); });
}

async function submitPrompt() {
  const inp = $('#promptVal');
  const value = inp ? inp.value.trim() : '';
  linkBody.innerHTML = spinnerBlock('Отправка…');
  try {
    await api('/api/enroll/' + linkId + '/input', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    });
    linkPoll = setInterval(pollLink, 1500);
  } catch (e) {
    linkBody.innerHTML = errorBlock(e.message);
    wireRetry();
  }
}

function renderDone(result) {
  linkBody.innerHTML = `
    <div class="done-icon">${ICON_CHECK}</div>
    <p class="step-label">Аутентификатор создан для <b>${escapeHtml(result.accountName || result.steam64)}</b></p>
    <div class="creds">
      <div class="cred-row">
        <span class="cred-key">Логин</span>
        <span class="cred-val" id="doneLogin">${escapeHtml(result.login || result.accountName || '—')}</span>
        <button class="cred-act" id="copyDoneLogin" title="Скопировать логин" aria-label="Скопировать логин">${ICON_COPY}</button>
      </div>
      <div class="cred-row">
        <span class="cred-key">Пароль</span>
        <span class="cred-val masked" id="donePass">••••••••</span>
        <button class="cred-act" id="toggleDonePass" title="Показать пароль" aria-label="Показать пароль">${ICON_EYE}</button>
        <button class="cred-act" id="copyDonePass" title="Скопировать пароль" aria-label="Скопировать пароль">${ICON_COPY}</button>
      </div>
    </div>
    <p class="muted" style="text-align:center;margin-top:8px">Логин и пароль сохранены в .maFile</p>
    <div class="rcode-box">
      <div class="rcode-label">Revocation код (сохраните!)</div>
      <div class="rcode" id="rcode">${escapeHtml(result.revocationCode || '—')}</div>
    </div>
    <p class="warn">Без этого кода снять аутентификатор будет невозможно. Запишите его в надёжном месте.</p>
    <button class="btn full" id="copyRcode">Скопировать R-код</button>
    <button class="btn-accent full" id="linkDone">Готово</button>`;
  $('#copyDoneLogin').addEventListener('click', () => {
    navigator.clipboard.writeText(result.login || result.accountName || '').then(() => toast('Логин скопирован'));
  });
  const donePass = $('#donePass');
  const toggleDone = $('#toggleDonePass');
  let doneShown = false;
  toggleDone.addEventListener('click', () => {
    doneShown = !doneShown;
    donePass.textContent = doneShown ? (result.password || '—') : '••••••••';
    donePass.classList.toggle('masked', !doneShown);
    toggleDone.innerHTML = doneShown ? ICON_EYE_OFF : ICON_EYE;
    toggleDone.title = doneShown ? 'Скрыть пароль' : 'Показать пароль';
  });
  $('#copyDonePass').addEventListener('click', () => {
    if (!result.password) { toast('Пароль не сохранён'); return; }
    navigator.clipboard.writeText(result.password).then(() => toast('Пароль скопирован'));
  });
  $('#copyRcode').addEventListener('click', () => {
    navigator.clipboard.writeText(result.revocationCode || '').then(() => toast('R-код скопирован'));
  });
  $('#linkDone').addEventListener('click', closeLink);
}

function wireRetry() {
  const r = document.createElement('button');
  r.className = 'btn full';
  r.textContent = 'Начать заново';
  r.style.marginTop = '12px';
  r.addEventListener('click', renderAuthStep);
  linkBody.appendChild(r);
}

function spinnerBlock(text) {
  return `<div class="center-block"><span class="spinner"></span> ${escapeHtml(text)}</div>`;
}
function errorBlock(msg) {
  return `<div class="warn-box err">${escapeHtml(msg || 'Ошибка')}</div>`;
}

const settings = loadSettings();
function loadSettings() {
  try {
    return { skipPhone: false, welcome: true, ...JSON.parse(localStorage.getItem('coxerSettings') || '{}') };
  } catch {
    return { skipPhone: false, welcome: true };
  }
}
function saveSettings() {
  localStorage.setItem('coxerSettings', JSON.stringify(settings));
}

const settingsOverlay = $('#settingsOverlay');
$('#settingsBtn').addEventListener('click', () => {
  $('#setSkipPhone').checked = settings.skipPhone;
  $('#setWelcome').checked = settings.welcome;
  settingsOverlay.classList.remove('hidden');
});
$('#settingsClose').addEventListener('click', () => settingsOverlay.classList.add('hidden'));
settingsOverlay.addEventListener('click', (e) => {
  if (e.target === settingsOverlay) settingsOverlay.classList.add('hidden');
});
$('#setSkipPhone').addEventListener('change', (e) => {
  settings.skipPhone = e.target.checked;
  saveSettings();
  toast(settings.skipPhone ? 'Привязка телефона будет пропускаться' : 'Привязка телефона включена');
});
$('#setWelcome').addEventListener('change', (e) => {
  settings.welcome = e.target.checked;
  saveSettings();
  toast(settings.welcome ? 'Приветствие будет показываться' : 'Приветствие отключено');
  if (!settings.welcome) closeWelcome();
});

const welcomeEl = $('#welcome');
function closeWelcome() {
  if (!welcomeEl || welcomeEl.classList.contains('hidden')) return;
  welcomeEl.classList.add('closing');
  setTimeout(() => {
    welcomeEl.classList.add('hidden');
    welcomeEl.classList.remove('closing');
  }, 320);
}
function showWelcome() {
  if (!welcomeEl || !settings.welcome) return;
  setTimeout(() => welcomeEl.classList.remove('hidden'), 600);
}
$('#welcomeClose').addEventListener('click', closeWelcome);

showWelcome();
loadAccounts().then(tickCodes);
setInterval(tickCodes, 1000);
