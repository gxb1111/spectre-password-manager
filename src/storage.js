/**
 * storage.js —— 插件的状态层（纯逻辑，不碰密码）
 *
 * 设计要点（也是原版 server.py 的坑的修正）：
 *   1. 这里**只存站点名 / 模板 / 用户名 / 计数器 / 分类**，任何跟密码或主密钥有关的
 *      字节都不落盘 —— 原版 WebUI 的数据文件就是这个形状，保持一致。
 *   2. 原版 server.py 每次生成都 `rm -rf ~/.spectre.d` 去清状态，却又用真实 HOME，
 *      残留在别处；这个插件根本不存在中间状态，所有派生都是无状态纯函数。
 *   3. 内存兜底：Node 下跑测试时没有 chrome.storage，用一个 Map 顶上。
 */


'use strict';

const SCHEMA_VERSION = 1;
const STORAGE_KEY = 'spectre_state';
const RECENT_LIMIT = 30;
const UNCATEGORIZED = '未分类';

function emptyState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    favorites: [],   // [{ site, userName, type, counter, algorithm, category }]
    categories: [],  // [string]
    recent: [],      // [{ site, userName, type, at }]
    settings: {
      defaultType: 'long',
      algorithm: 3,
      autoFill: true,
      userName: '',
    },
  };
}

// ---------------------------------------------------------------- 站点名归一

/**
 * 常见多段公共后缀。不追求 PSL 的完整性 —— 只为了让 `mail.google.com`
 * 和 `www.google.com` 归成同一个 `google.com`，判错也不会泄露任何东西，
 * 顶多是分类归类不准。真正的 PSL 有几万行，塞进插件是杀鸡用牛刀。
 */
const MULTI_PART_SUFFIX = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'net.uk', 'sch.uk',
  'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn', 'ac.cn',
  'com.hk', 'org.hk', 'edu.hk', 'gov.hk', 'com.tw', 'org.tw', 'edu.tw',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au',
  'com.br', 'com.mx', 'com.ar', 'com.sg', 'com.my', 'com.tr',
  'co.jp', 'or.jp', 'ne.jp', 'ac.jp', 'go.jp',
  'co.kr', 'or.kr', 'com.ru', 'co.in', 'net.in', 'org.in',
  'co.za', 'co.nz', 'com.ua', 'com.pl', 'com.es', 'com.it', 'com.de',
]);

/**
 * 从 URL / 主机名 / 用户手输里提取站点名。
 * 这是**唯一**决定密码的站点名来源，所以它必须稳定、可复现、可手改。
 */
function normalizeSite(input) {
  if (!input) return '';
  let s = String(input).trim();
  if (!s) return '';

  // 带协议的直接取 host
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    try {
      return stripWww(new URL(s).hostname);
    } catch (e) { /* 落到下面的手工解析 */ }
  }
  // 各种「看着像 URL」的写法
  s = s.replace(/^\/+/, '');
  s = s.split(/[?#]/)[0];
  if (s.indexOf('/') !== -1) s = s.split('/')[0];
  if (s.indexOf('@') !== -1) s = s.split('@').pop();
  s = s.replace(/:\d+$/, '');          // 去端口
  return stripWww(s);
}

function stripWww(host) {
  return String(host || '').trim().toLowerCase().replace(/\.+$/, '').replace(/^www\./, '');
}

/** 把主机名折叠成 eTLD+1（尽力而为）。 */
function baseDomain(host) {
  const h = stripWww(host);
  if (!h) return '';
  if (h.indexOf('.') === -1) return h;                 // localhost / 单标签
  if (/^\d+(\.\d+){3}$/.test(h)) return h;             // IPv4 原样
  const parts = h.split('.');
  if (parts.length === 2) return h;
  const lastTwo = parts.slice(-2).join('.');
  const lastThree = parts.slice(-3).join('.');
  return MULTI_PART_SUFFIX.has(lastTwo) ? lastThree : lastTwo;
}

// ---------------------------------------------------------------- 状态操作（纯函数）

function findBySite(list, site) {
  const key = normalizeSite(site);
  if (!key) return -1;
  for (let i = 0; i < list.length; i++) {
    if (normalizeSite(list[i].site) === key) return i;
  }
  return -1;
}

function findFavorite(state, site) {
  const i = findBySite(state.favorites || [], site);
  return i === -1 ? null : state.favorites[i];
}

function cloneState(state) {
  return JSON.parse(JSON.stringify(state || emptyState()));
}

function addFavorite(state, entry) {
  const next = cloneState(state);
  const site = normalizeSite(entry.site);
  if (!site) throw new Error('收藏需要站点名');
  const record = {
    site: site,
    userName: entry.userName || '',
    type: entry.type || 'long',
    counter: entry.counter || 1,
    algorithm: entry.algorithm === undefined ? 3 : entry.algorithm,
    category: entry.category || UNCATEGORIZED,
  };
  const existing = findBySite(next.favorites, site);
  if (existing !== -1) next.favorites[existing] = record;
  else next.favorites.push(record);
  if (next.categories.indexOf(record.category) === -1) next.categories.push(record.category);
  return next;
}

function removeFavorite(state, site) {
  const next = cloneState(state);
  const i = findBySite(next.favorites, site);
  if (i !== -1) next.favorites.splice(i, 1);
  return next;
}

function addCategory(state, name) {
  const next = cloneState(state);
  const c = String(name || '').trim();
  if (!c) throw new Error('分类名不能为空');
  if (next.categories.indexOf(c) === -1) next.categories.push(c);
  return next;
}

function renameCategory(state, from, to) {
  const next = cloneState(state);
  const src = String(from || '').trim();
  const dst = String(to || '').trim();
  if (!dst) throw new Error('新分类名不能为空');
  next.categories = next.categories.map(function (c) { return c === src ? dst : c; });
  next.favorites.forEach(function (f) { if (f.category === src) f.category = dst; });
  next.categories = dedupe(next.categories);
  return next;
}

/** 删分类不删收藏：把里面的收藏退回「未分类」。 */
function removeCategory(state, name) {
  const next = cloneState(state);
  const c = String(name || '').trim();
  next.categories = next.categories.filter(function (x) { return x !== c; });
  next.favorites.forEach(function (f) { if (f.category === c) f.category = UNCATEGORIZED; });
  return next;
}

function dedupe(list) {
  const out = [];
  list.forEach(function (x) { if (out.indexOf(x) === -1) out.push(x); });
  return out;
}

function pushRecent(state, entry) {
  const next = cloneState(state);
  const site = normalizeSite(entry.site);
  if (!site) return next;
  next.recent = (next.recent || []).filter(function (r) {
    return normalizeSite(r.site) !== site;
  });
  next.recent.unshift({
    site: site,
    userName: entry.userName || '',
    type: entry.type || 'long',
    at: entry.at || Date.now(),
  });
  if (next.recent.length > RECENT_LIMIT) next.recent.length = RECENT_LIMIT;
  return next;
}

function clearRecent(state) {
  const next = cloneState(state);
  next.recent = [];
  return next;
}

/** 按分类分组收藏，返回 [{ category, items[] }]，分类顺序稳定。 */
function groupByCategory(state) {
  const cats = dedupe((state.categories || []).slice());
  (state.favorites || []).forEach(function (f) {
    const c = f.category || UNCATEGORIZED;
    if (cats.indexOf(c) === -1) cats.push(c);
  });
  return cats.map(function (c) {
    return {
      category: c,
      items: (state.favorites || []).filter(function (f) {
        return (f.category || UNCATEGORIZED) === c;
      }),
    };
  });
}

/** 兼容/修复从磁盘读回来的东西（缺字段、类型不对、旧版本都兜住）。 */
function migrate(raw) {
  const base = emptyState();
  if (!raw || typeof raw !== 'object') return base;
  const out = base;
  out.settings = Object.assign(base.settings, raw.settings || {});
  if (Array.isArray(raw.categories)) {
    out.categories = dedupe(raw.categories.map(function (c) { return String(c); }));
  }
  if (Array.isArray(raw.favorites)) {
    raw.favorites.forEach(function (f) {
      if (!f || !f.site) return;
      try {
        out.favorites = addFavorite(out, f).favorites;
        const c = f.category || UNCATEGORIZED;
        if (out.categories.indexOf(c) === -1) out.categories.push(c);
      } catch (e) { /* 单条坏数据不该拖垮整个文件 */ }
    });
  }
  if (Array.isArray(raw.recent)) {
    raw.recent.forEach(function (r) {
      if (!r || !r.site) return;
      const site = normalizeSite(r.site);
      if (!site) return;
      if (out.recent.some(function (x) { return x.site === site; })) return;
      out.recent.push({
        site: site,
        userName: r.userName || '',
        type: r.type || 'long',
        at: r.at || 0,
      });
    });
    out.recent.sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
    if (out.recent.length > RECENT_LIMIT) out.recent.length = RECENT_LIMIT;
  }
  return out;
}

// ---------------------------------------------------------------- 后端（chrome.storage / 内存）

function memoryBackend(seed) {
  let blob = seed === undefined ? null : seed;
  return {
    kind: 'memory',
    read: async function () { return blob; },
    write: async function (value) { blob = value; },
  };
}

function chromeBackend() {
  const area = (typeof chrome !== 'undefined' && chrome.storage && (chrome.storage.local || chrome.storage.sync));
  if (!area) return null;
  return {
    kind: 'chrome',
    read: function () {
      return new Promise(function (resolve, reject) {
        area.get(STORAGE_KEY, function (res) {
          const err = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.lastError;
          if (err) reject(new Error(err.message));
          else resolve(res ? res[STORAGE_KEY] : null);
        });
      });
    },
    write: function (value) {
      return new Promise(function (resolve, reject) {
        const payload = {};
        payload[STORAGE_KEY] = value;
        area.set(payload, function () {
          const err = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.lastError;
          if (err) reject(new Error(err.message));
          else resolve();
        });
      });
    },
  };
}

function createStore(backend) {
  const be = backend || chromeBackend() || memoryBackend(null);
  let cache = null;
  return {
    backend: be.kind,
    async load() {
      if (cache) return cache;
      cache = migrate(await be.read());
      return cache;
    },
    async save(state) {
      cache = migrate(state);
      await be.write(cache);
      return cache;
    },
    async update(fn) {
      const next = fn(await this.load());
      return this.save(next);
    },
  };
}

// 浏览器里挂一个默认实例，Node 里不自动建（避免 require 时碰 chrome）
let defaultStore = null;
function getStore() {
  if (!defaultStore) defaultStore = createStore(null);
  return defaultStore;
}


// ---------------------------------------------------------------- exports
export { SCHEMA_VERSION };
export { STORAGE_KEY };
export { RECENT_LIMIT };
export { UNCATEGORIZED };
export { emptyState };
export { normalizeSite };
export { baseDomain };
export { findBySite };
export { findFavorite };
export { addFavorite };
export { removeFavorite };
export { addCategory };
export { renameCategory };
export { removeCategory };
export { groupByCategory };
export { pushRecent };
export { clearRecent };
export { migrate };
export { memoryBackend };
export { chromeBackend };
export { createStore };
export { getStore };
