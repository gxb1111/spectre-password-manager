/**
 * storage.js —— 插件的状态层（纯逻辑，不碰密码）
 *
 * 设计要点：
 *   1. 这里**只存站点名 / 模板 / 用户名 / 计数器 / 分类**，任何跟密码或主密钥有关的
 *      字节都不落盘 —— 与旧版数据文件同形状，方便迁移。
 *   2. 派生全部是无状态纯函数：官方 CLI 那套 `~/.spectre.d` 状态目录在这里压根不存在，
 *      没有需要清理、也不可能残留的东西。
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
 *
 * 注意：**保留大小写**。Spectre 的站点名是区分大小写的输入 ——
 * `CTF` 和 `ctf` 推导出来是两套完全不同的密码，旧版就是把用户
 * 手输的原样喂给 spectre 二进制。只有 URL 里的 host 天生小写（URL 规范使然）。
 * 「是不是同一个站点」这类判断请用 siteLookupKey()，绝不要在这里折叠大小写。
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
  return stripWww(s, true);
}

/** 去掉尾部点与开头的 www.；keepCase 时不动大小写（手输的站点名要走这里）。 */
function stripWww(host, keepCase) {
  let h = String(host || '').trim();
  if (!keepCase) h = h.toLowerCase();
  return h.replace(/\.+$/, '').replace(/^www\./i, '');
}

/**
 * 站点名的**查找键**：归一化后再折叠大小写。
 * 只用来回答「这是不是同一个站点」，永远不参与密码推导。
 */
function siteLookupKey(input) {
  return normalizeSite(input).toLowerCase();
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
  const key = siteLookupKey(site);
  if (!key) return -1;
  for (let i = 0; i < list.length; i++) {
    if (siteLookupKey(list[i].site) === key) return i;
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
  const key = siteLookupKey(site);
  next.recent = (next.recent || []).filter(function (r) {
    return siteLookupKey(r.site) !== key;
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
      const key = siteLookupKey(site);
      if (out.recent.some(function (x) { return siteLookupKey(x.site) === key; })) return;
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

// ---------------------------------------------------------------- 导入 / 迁移

/** 插件已知的密码模板（personal 不在其中，见 README）。 */
const KNOWN_TYPES = ['maximum', 'long', 'medium', 'short', 'basic', 'pin', 'name', 'phrase'];

/** 把一条外部记录折成内部收藏记录；站点名拿不到就返回 null。 */
function coerceEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const site = normalizeSite(raw.site || raw.siteName || raw.name || '');
  if (!site) return null;
  // 旧版用 template / user，本插件用 type / userName
  let type = String(raw.type || raw.template || 'long').trim().toLowerCase();
  if (KNOWN_TYPES.indexOf(type) === -1) type = 'long';
  const counter = Math.max(1, parseInt(raw.counter, 10) || 1);
  let algorithm = parseInt(raw.algorithm, 10);
  if (!(algorithm >= 0 && algorithm <= 3)) algorithm = 3;
  const category = String(raw.category || raw.categoryName || '').trim() || UNCATEGORIZED;
  return {
    site: site,
    userName: String(raw.userName || raw.user || '').trim(),
    type: type,
    counter: counter,
    algorithm: algorithm,
    category: category,
  };
}

/**
 * 解析导入载荷，两种格式都吃：
 *   A) 本插件「导出 JSON」：{ favorites:[{site,userName,type,counter,algorithm,category}], categories:[…] }
 *   B) 旧版的 spectre_data.json：
 *      { favorites:[{site,template,category,user}], categories:{ "默认":[…] }, recent:[…] }
 * 识别旧版的两个特征：categories 是**对象**、条目上用 template/user 而不是 type/userName。
 *
 * 旧版调 spectre 时没带 -a，所以那批数据一律是 v3、counter 恒为 1；
 * 但如果有条目显式带了 algorithm/counter，这里也照收。
 */
function parseImport(payload) {
  let data = payload;
  if (typeof data === 'string') data = JSON.parse(data);
  if (Array.isArray(data)) data = { favorites: data };
  if (!data || typeof data !== 'object') throw new Error('导入内容不是 JSON 对象');

  const legacyCats = (data.categories && !Array.isArray(data.categories) && typeof data.categories === 'object')
    ? Object.keys(data.categories) : null;
  const legacy = !!(legacyCats || (Array.isArray(data.favorites) && data.favorites.some(function (f) {
    return f && (f.template !== undefined || f.user !== undefined);
  })));

  const entries = (Array.isArray(data.favorites) ? data.favorites : []).map(coerceEntry).filter(Boolean);

  const categories = [];
  const pushCat = function (c) {
    const s = String(c == null ? '' : c).trim();
    if (s && categories.indexOf(s) === -1) categories.push(s);
  };
  (Array.isArray(data.categories) ? data.categories : (legacyCats || [])).forEach(pushCat);
  entries.forEach(function (e) { pushCat(e.category); });

  const recent = (Array.isArray(data.recent) ? data.recent : []).map(function (r) {
    const e = coerceEntry(r);
    return e ? { site: e.site, userName: e.userName, type: e.type, at: parseInt(r.at, 10) || 0 } : null;
  }).filter(Boolean);

  return {
    source: legacy ? 'legacy-webui' : 'spectre-plugin',
    entries: entries,
    categories: categories,
    recent: recent,
    settings: (data.settings && typeof data.settings === 'object') ? data.settings : null,
  };
}

/**
 * 把导入载荷并进现有状态，返回 `{ state, stats }`。
 * 同站点以**导入的**为准（这是一次显式导入），其余已有收藏原样保留；
 * 站点名原样保留大小写，只按 siteLookupKey 判重。
 */
function importMetadata(state, payload) {
  const parsed = parseImport(payload);
  let next = cloneState(state);

  parsed.categories.forEach(function (c) {
    if (next.categories.indexOf(c) === -1) next.categories.push(c);
  });

  let added = 0, updated = 0;
  parsed.entries.forEach(function (e) {
    const existed = findBySite(next.favorites, e.site) !== -1;
    next = addFavorite(next, e);
    if (existed) updated++; else added++;
  });

  // 旧数据里没有「记住姓名」时，顺手从导入条目里取一个（多数决），省得用户再打一遍
  if (!next.settings.userName) {
    const tally = {};
    parsed.entries.forEach(function (e) {
      if (e.userName) tally[e.userName] = (tally[e.userName] || 0) + 1;
    });
    let best = '', bestN = 0;
    Object.keys(tally).forEach(function (k) {
      if (tally[k] > bestN) { best = k; bestN = tally[k]; }
    });
    if (best) next.settings.userName = best;
  }

  if (parsed.settings) {
    const s = parsed.settings;
    if (KNOWN_TYPES.indexOf(String(s.defaultType || '')) !== -1) next.settings.defaultType = s.defaultType;
    const a = parseInt(s.algorithm, 10);
    if (a >= 0 && a <= 3) next.settings.algorithm = a;
    if (typeof s.userName === 'string' && s.userName.trim()) next.settings.userName = s.userName.trim();
  }

  const beforeRecent = next.recent.map(function (r) { return siteLookupKey(r.site); });
  let recentAdded = 0;
  // 输入是「新的在前」，pushRecent 是 unshift，所以倒着喂才能把顺序摆正
  parsed.recent.slice().reverse().forEach(function (r) {
    if (beforeRecent.indexOf(siteLookupKey(r.site)) === -1) recentAdded++;
    next = pushRecent(next, r);
  });

  return {
    state: next,
    stats: {
      source: parsed.source,
      total: parsed.entries.length,
      added: added,
      updated: updated,
      categories: parsed.categories.length,
      recentAdded: recentAdded,
    },
  };
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
export { siteLookupKey };
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
export { KNOWN_TYPES };
export { parseImport };
export { importMetadata };
export { memoryBackend };
export { chromeBackend };
export { createStore };
export { getStore };
