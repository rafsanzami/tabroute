// TabRoute — background service worker
//
// Modes:
//   off       – no proxy
//   all       – every request goes to Burp (FoxyProxy style)
//   patterns  – only hosts matching your domain patterns go to Burp
//   tabs      – only hosts seen in the tabs you picked go to Burp,
//               and those tabs' requests get tagged with a header
//   incognito – only incognito windows go to Burp (strict isolation)

const DEFAULTS = {
  mode: 'off',
  host: '127.0.0.1',
  port: 8080,
  patterns: ['*.example.com'],
  bypass: ['<local>'],
  tagHeader: true,
  headerName: 'X-Burp-Tab',
  reloadOnCapture: true,
  lastMode: 'all',
};

const RESOURCE_TYPES = [
  'main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'object',
  'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'other',
];

let settings = { ...DEFAULTS };
let tabs = {};          // tabId -> [hostnames seen in that tab]
let lastError = null;

const ready = (async () => {
  const { settings: s } = await chrome.storage.local.get('settings');
  settings = { ...DEFAULTS, ...(s || {}) };
  const { tabs: t, lastError: e } = await chrome.storage.session.get(['tabs', 'lastError']);
  tabs = t || {};
  lastError = e || null;
})();

// ---------- PAC generation ----------

function hostCond(p) {
  p = String(p).trim().toLowerCase();
  if (!p) return null;
  if (p === '<local>') return 'isPlainHostName(host)';
  if (p.startsWith('*.')) {
    // "*.example.com" also matches "example.com"
    return `(host === ${JSON.stringify(p.slice(2))} || shExpMatch(host, ${JSON.stringify(p)}))`;
  }
  return `shExpMatch(host, ${JSON.stringify(p)})`;
}

function buildPac() {
  const proxy = `PROXY ${settings.host}:${settings.port}`;
  const lines = ['host = host.toLowerCase();'];

  const bypass = settings.bypass.map(hostCond).filter(Boolean);
  if (bypass.length) lines.push(`if (${bypass.join(' || ')}) return "DIRECT";`);

  if (settings.mode === 'all') {
    lines.push(`return ${JSON.stringify(proxy)};`);
  } else if (settings.mode === 'patterns') {
    const inc = settings.patterns.map(hostCond).filter(Boolean);
    if (inc.length) lines.push(`if (${inc.join(' || ')}) return ${JSON.stringify(proxy)};`);
    lines.push('return "DIRECT";');
  } else if (settings.mode === 'tabs') {
    const set = {};
    for (const list of Object.values(tabs)) for (const h of list) set[h] = 1;
    lines.push(`var H = ${JSON.stringify(set)};`);
    lines.push(`if (Object.prototype.hasOwnProperty.call(H, host)) return ${JSON.stringify(proxy)};`);
    lines.push('return "DIRECT";');
  } else {
    lines.push('return "DIRECT";');
  }
  return `function FindProxyForURL(url, host) {\n  ${lines.join('\n  ')}\n}`;
}

// ---------- Apply proxy ----------

async function applyProxy() {
  await chrome.proxy.settings.clear({ scope: 'regular' });
  try { await chrome.proxy.settings.clear({ scope: 'incognito_persistent' }); } catch (_) {}

  if (settings.mode === 'incognito') {
    const allowed = await chrome.extension.isAllowedIncognitoAccess();
    if (!allowed) {
      await setError('Incognito mode needs "Allow in Incognito" turned on for this extension.');
    } else {
      await chrome.proxy.settings.set({
        scope: 'incognito_persistent',
        value: {
          mode: 'fixed_servers',
          rules: {
            singleProxy: { scheme: 'http', host: settings.host, port: Number(settings.port) },
            bypassList: settings.bypass.filter(Boolean),
          },
        },
      });
    }
  } else if (settings.mode !== 'off') {
    await chrome.proxy.settings.set({
      scope: 'regular',
      value: { mode: 'pac_script', pacScript: { data: buildPac() } },
    });
  }
  await syncTagRules();
  await updateBadges();
}

let pending = null;
function scheduleApply() {
  if (pending) return;
  pending = setTimeout(async () => {
    pending = null;
    await chrome.storage.session.set({ tabs });
    await applyProxy();
  }, 50);
}

// ---------- Header tagging (tab mode) ----------

async function syncTagRules() {
  const existing = await chrome.declarativeNetRequest.getSessionRules();
  const removeRuleIds = existing.map(r => r.id);
  const addRules = [];
  if (settings.mode === 'tabs' && settings.tagHeader && settings.headerName.trim()) {
    for (const id of Object.keys(tabs)) {
      addRules.push({
        id: Number(id),
        priority: 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [{ header: settings.headerName.trim(), operation: 'set', value: `tab-${id}` }],
        },
        condition: { tabIds: [Number(id)], resourceTypes: RESOURCE_TYPES },
      });
    }
  }
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds, addRules });
}

// ---------- Toolbar icon & badge ----------
// off   = gray icon        → proxy disabled
// idle  = orange icon      → proxy on, but THIS tab goes direct
// on    = orange + green ● → THIS tab goes through Burp

const BADGE = { all: 'ALL', patterns: 'DOM', tabs: 'TAB', incognito: 'INC' };
const iconSet = (name) => ({ 16: `icons/${name}16.png`, 32: `icons/${name}32.png`, 48: `icons/${name}48.png` });

function matchPat(host, p) {
  p = String(p).trim().toLowerCase();
  if (!p) return false;
  if (p === '<local>') return !host.includes('.');
  if (p.startsWith('*.') && host === p.slice(2)) return true;
  const re = new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
  return re.test(host);
}

function isRouted(tab) {
  const m = settings.mode;
  if (m === 'off' || !tab) return false;
  const h = hostOf(tab.url || tab.pendingUrl || '');
  if (!h || h === 'localhost' || h === '::1' || h.startsWith('127.')) return false;
  if (settings.bypass.some((p) => matchPat(h, p))) return false;
  if (m === 'incognito') return !!tab.incognito;
  if (m === 'all') return true;
  if (m === 'patterns') return settings.patterns.some((p) => matchPat(h, p));
  if (m === 'tabs') return !!tabs[tab.id];
  return false;
}

async function updateTabIndicator(tab) {
  const off = settings.mode === 'off';
  const routed = isRouted(tab);
  const name = off ? 'off' : routed ? 'on' : 'icon';
  const title = off ? 'TabRoute — proxy OFF'
    : routed ? `TabRoute — this tab → Burp (${settings.host}:${settings.port})`
    : 'TabRoute — proxy ON, this tab goes direct';
  const text = lastError ? 'ERR' : off ? '' : routed ? BADGE[settings.mode] : '';
  try {
    await chrome.action.setIcon({ tabId: tab.id, path: iconSet(name) });
    await chrome.action.setTitle({ tabId: tab.id, title });
    await chrome.action.setBadgeText({ tabId: tab.id, text });
  } catch (_) {}
}

async function updateBadges() {
  const off = settings.mode === 'off';
  await chrome.action.setBadgeBackgroundColor({ color: lastError ? '#dc2626' : '#16a34a' });
  await chrome.action.setBadgeTextColor?.({ color: '#ffffff' });
  await chrome.action.setIcon({ path: iconSet(off ? 'off' : settings.mode === 'all' ? 'on' : 'icon') });
  for (const t of await chrome.tabs.query({})) await updateTabIndicator(t);
}

chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (!info.url && info.status !== 'loading' && info.status !== 'complete') return;
  await ready;
  updateTabIndicator(tab);
});

async function setError(msg) {
  lastError = msg ? { msg, at: Date.now() } : null;
  await chrome.storage.session.set({ lastError });
}

// ---------- Tab capture ----------

function hostOf(url) {
  try {
    const u = new URL(url);
    if (!/^(https?|wss?):$/.test(u.protocol)) return null;
    return u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  } catch (_) { return null; }
}

async function captureTab(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const h = hostOf(tab.url || tab.pendingUrl || '');
  tabs[tabId] = h ? [h] : [];
  if (settings.mode !== 'tabs') {
    settings.mode = settings.lastMode = 'tabs';
    await chrome.storage.local.set({ settings });
  }
  await chrome.storage.session.set({ tabs });
  await applyProxy();
  if (settings.reloadOnCapture && h) chrome.tabs.reload(tabId, { bypassCache: true });
}

async function releaseTab(tabId) {
  delete tabs[tabId];
  await chrome.storage.session.set({ tabs });
  await applyProxy();
}

// Learn every host a captured tab talks to (CDNs, APIs, iframes...)
chrome.webRequest.onBeforeRequest.addListener((d) => {
  learnHost(d.tabId, d.url);
}, { urls: ['<all_urls>'] });

// Catch navigations as early as possible
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.url) learnHost(tabId, info.url);
});

async function learnHost(tabId, url) {
  if (tabId < 0) return;
  await ready;
  if (settings.mode !== 'tabs') return;
  const list = tabs[tabId];
  if (!list) return;
  const h = hostOf(url);
  if (!h || list.includes(h)) return;
  list.push(h);
  scheduleApply();
}

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await ready;
  if (tabs[tabId]) releaseTab(tabId);
});

// Tab ID changes on prerender / instant swaps
chrome.tabs.onReplaced.addListener(async (added, removed) => {
  await ready;
  if (tabs[removed]) {
    tabs[added] = tabs[removed];
    delete tabs[removed];
    await chrome.storage.session.set({ tabs });
    await applyProxy();
  }
});

chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd !== 'toggle-current-tab') return;
  await ready;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  if (tabs[tab.id] && settings.mode === 'tabs') await releaseTab(tab.id);
  else await captureTab(tab.id);
});

// ---------- Errors ----------

chrome.proxy.onProxyError.addListener(async (e) => {
  await ready;
  await setError(`${e.error}${e.details ? ' — ' + e.details : ''}`);
  await updateBadges();
});

// ---------- Messages from popup ----------

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  (async () => {
    await ready;
    switch (msg.type) {
      case 'getState':
        return {
          settings, tabs, lastError,
          incognitoAllowed: await chrome.extension.isAllowedIncognitoAccess(),
          pac: buildPac(),
        };
      case 'saveSettings':
        settings = { ...settings, ...msg.settings };
        if (msg.settings.mode && msg.settings.mode !== 'off') settings.lastMode = msg.settings.mode;
        await chrome.storage.local.set({ settings });
        await setError(null);
        await applyProxy();
        return { ok: true };
      case 'captureTab':
        await captureTab(msg.tabId);
        return { ok: true };
      case 'tabStatus': {
        const t = await chrome.tabs.get(msg.tabId).catch(() => null);
        return { routed: isRouted(t), host: t ? hostOf(t.url || '') : null, incognito: !!t?.incognito };
      }
      case 'releaseTab':
        await releaseTab(msg.tabId);
        return { ok: true };
      case 'releaseAll':
        tabs = {};
        await chrome.storage.session.set({ tabs });
        await applyProxy();
        return { ok: true };
      case 'clearError':
        await setError(null);
        await updateBadges();
        return { ok: true };
      case 'test':
        try {
          const r = await fetch(`http://${settings.host}:${settings.port}/`, { cache: 'no-store' });
          const text = await r.text();
          return { ok: /burp/i.test(text), status: r.status };
        } catch (e) {
          return { ok: false, error: String(e) };
        }
    }
  })().then(reply, (e) => reply({ ok: false, error: String(e) }));
  return true;
});

chrome.runtime.onStartup.addListener(async () => { await ready; await applyProxy(); });
chrome.runtime.onInstalled.addListener(async () => { await ready; await applyProxy(); });
