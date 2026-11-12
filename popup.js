const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);

const MODE_NAME = { all: 'All traffic', tabs: 'Selected tabs', patterns: 'Domains', incognito: 'Incognito windows' };

let state, curTab, tabStatus;

async function load() {
  [curTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  state = await send({ type: 'getState' });
  tabStatus = curTab ? await send({ type: 'tabStatus', tabId: curTab.id }) : { routed: false };
  render();
}

function hostOf(url) {
  try { return new URL(url).hostname || url; } catch { return url || ''; }
}

function render() {
  const s = state.settings;
  const on = s.mode !== 'off';
  const activeMode = on ? s.mode : s.lastMode || 'all';
  document.body.classList.toggle('off', !on);

  // Header + status card
  $('power').checked = on;
  $('logo').src = `icons/${on ? 'on' : 'off'}32.png`;
  $('statusCard').classList.toggle('on', on);
  $('statusTitle').textContent = on ? 'Proxy is ON' : 'Proxy is OFF';
  $('statusSub').textContent = on
    ? `${MODE_NAME[s.mode]} → ${s.host}:${s.port}`
    : 'Traffic goes direct. Flip the switch to start.';

  $('error').hidden = !state.lastError;
  if (state.lastError) $('errorMsg').textContent = state.lastError.msg;

  // This tab
  $('curHost').textContent = curTab ? hostOf(curTab.url) || 'New tab' : '—';
  const chip = $('routeChip');
  chip.textContent = tabStatus.routed ? '● Going to Burp' : 'Direct';
  chip.className = 'chip ' + (tabStatus.routed ? 'burp' : 'direct');

  const captured = s.mode === 'tabs' && !!state.tabs[curTab?.id];
  const showToggle = activeMode === 'tabs' || s.mode === 'off';
  $('toggleTab').hidden = !curTab || !showToggle || s.mode === 'incognito';
  $('toggleTab').textContent = captured ? 'Stop capturing this tab' : 'Capture this tab';
  $('toggleTab').className = 'btn block' + (captured ? ' secondary' : '');

  // Mode cards
  document.querySelectorAll('.mode').forEach((b) => b.classList.toggle('active', b.dataset.mode === activeMode));

  // Panels
  $('tabsPanel').hidden = !on || s.mode !== 'tabs';
  $('patternsPanel').hidden = activeMode !== 'patterns';
  $('incogPanel').hidden = activeMode !== 'incognito';
  $('incogWarn').hidden = state.incognitoAllowed;
  renderTabs();

  // Settings (fill once so typing isn't overwritten)
  if (!render.filled) {
    $('host').value = s.host;
    $('port').value = s.port;
    $('patterns').value = s.patterns.join('\n');
    $('bypass').value = s.bypass.join('\n');
    $('tagHeader').checked = s.tagHeader;
    $('headerName').value = s.headerName;
    $('reloadOnCapture').checked = s.reloadOnCapture;
    render.filled = true;
  }
  $('cert').href = `http://${s.host}:${s.port}/cert`;
}

async function renderTabs() {
  const list = $('capturedList');
  const ids = state.settings.mode === 'tabs' ? Object.keys(state.tabs) : [];
  $('noTabs').hidden = ids.length > 0;
  $('releaseAll').hidden = ids.length < 2;
  const rows = [];
  for (const id of ids) {
    let tab = null;
    try { tab = await chrome.tabs.get(Number(id)); } catch {}
    const row = document.createElement('div');
    row.className = 'item';
    const icon = document.createElement('img');
    icon.src = tab?.favIconUrl || 'icons/on16.png';
    icon.onerror = () => (icon.src = 'icons/on16.png');
    const t = document.createElement('div');
    t.className = 't';
    const a = document.createElement('div');
    a.textContent = tab?.title || `Tab ${id}`;
    const b = document.createElement('div');
    b.className = 'hosts';
    const hosts = state.tabs[id];
    b.textContent = hosts.length ? `${hosts.length} host${hosts.length > 1 ? 's' : ''}: ${hosts.join(', ')}` : 'No hosts yet';
    b.title = hosts.join('\n');
    t.append(a, b);
    const btn = document.createElement('button');
    btn.className = 'ghost small-btn';
    btn.textContent = 'Release';
    btn.onclick = async () => { await send({ type: 'releaseTab', tabId: Number(id) }); load(); };
    row.append(icon, t, btn);
    rows.push(row);
  }
  list.replaceChildren(...rows);
}

const lines = (v) => v.split('\n').map((x) => x.trim()).filter(Boolean);

// Power switch
$('power').onchange = async (e) => {
  const mode = e.target.checked ? state.settings.lastMode || 'all' : 'off';
  await send({ type: 'saveSettings', settings: { mode } });
  load();
};

// Mode cards: picking one also turns the proxy on
$('modes').onclick = async (e) => {
  const btn = e.target.closest('.mode');
  if (!btn) return;
  await send({ type: 'saveSettings', settings: { mode: btn.dataset.mode } });
  load();
};

$('toggleTab').onclick = async () => {
  const captured = state.settings.mode === 'tabs' && state.tabs[curTab.id];
  await send({ type: captured ? 'releaseTab' : 'captureTab', tabId: curTab.id });
  load();
};

$('releaseAll').onclick = async () => { await send({ type: 'releaseAll' }); load(); };
$('clearError').onclick = async () => { await send({ type: 'clearError' }); load(); };

$('savePatterns').onclick = async () => {
  await send({ type: 'saveSettings', settings: { patterns: lines($('patterns').value) } });
  $('savePatterns').textContent = 'Saved ✓';
  setTimeout(() => ($('savePatterns').textContent = 'Save domains'), 1200);
  load();
};

$('save').onclick = async () => {
  await send({
    type: 'saveSettings',
    settings: {
      host: $('host').value.trim() || '127.0.0.1',
      port: Number($('port').value) || 8080,
      bypass: lines($('bypass').value),
      tagHeader: $('tagHeader').checked,
      headerName: $('headerName').value.trim() || 'X-Burp-Tab',
      reloadOnCapture: $('reloadOnCapture').checked,
    },
  });
  $('saved').textContent = 'Saved ✓';
  setTimeout(() => ($('saved').textContent = ''), 1500);
  load();
};

$('test').onclick = async () => {
  const sub = $('statusSub');
  sub.textContent = 'Checking Burp…';
  const r = await send({ type: 'test' });
  sub.textContent = r.ok
    ? `✓ Burp is reachable at ${state.settings.host}:${state.settings.port}`
    : `✗ Burp not reachable at ${state.settings.host}:${state.settings.port}`;
};

$('openExt').onclick = () => chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
$('openIncog').onclick = () => chrome.windows.create({ incognito: true, url: 'about:blank' });

load();
