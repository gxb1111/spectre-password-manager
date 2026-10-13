/**
 * popup.js —— 插件主界面
 *
 * 职责边界：
 *   - 主密钥 / userKey 全部交给 worker，popup 自己不留副本；
 *   - 落盘的只有「站点名 / 模板 / 用户名 / 计数器 / 分类」，绝不含密码或密钥；
 *   - 生成是纯函数式的：同一组输入 → 同一个密码，没有隐藏状态。
 */

import * as Store from './storage.js';

const els = {};
const TYPES = [
  { value: 'long',    label: 'Long — 长密码（14 位，含符号）' },
  { value: 'maximum', label: 'Maximum — 最长（20 位，含符号）' },
  { value: 'medium',  label: 'Medium — 中等（8 位，含符号）' },
  { value: 'basic',   label: 'Basic — 基础（8 位，不含符号）' },
  { value: 'short',   label: 'Short — 短（4 位）' },
  { value: 'pin',     label: 'PIN — 纯数字（4 位）' },
  { value: 'name',    label: 'Name — 姓名式' },
  { value: 'phrase',  label: 'Phrase — 短语（好记）' },
];
const PURPOSES = {
  authentication: '登录',
  identification: '账号',
  recovery: '密保',
};
const TYPE_TO_NUM = { maximum: 16, long: 17, medium: 18, short: 19, basic: 20, pin: 21, name: 30, phrase: 31 };

const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
const pending = new Map();
let msgSeq = 0;

let store = null;
let state = null;
let unlocked = false;
let lastResult = null;
let activeCategory = null;
let activeTab = 'favorites';

// ------------------------------------------------------------------ worker 桥

/**
 * 给 worker 发一条指令。
 *
 * 注意 `kind` 与 payload 字段的冲突：外壳的 `type` 是**指令名**，密码模板必须走
 * `resultType`。早先这里写成 `call('generate', { type })`，payload 的 `type`
 * 会把指令名覆盖成 'long'，worker 直接抛「未知指令: long」。测试里踩过一次，
 * 改 worker 契约时两处必须同时改。
 */
function call(kind, payload) {
  const id = ++msgSeq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage(Object.assign({ id, type: kind }, payload || {}));
  });
}

worker.onmessage = function (ev) {
  const msg = ev.data || {};
  const slot = pending.get(msg.id);
  if (!slot) return;
  pending.delete(msg.id);
  if (msg.ok) slot.resolve(msg);
  else slot.reject(new Error(msg.error || '未知错误'));
};

worker.onerror = function (ev) {
  setStatus('后台线程出错：' + (ev.message || '未知'), 'err');
};

// ------------------------------------------------------------------ 小工具

function $(id) { return document.getElementById(id); }

function setStatus(text, kind) {
  els.status.textContent = text || '';
  els.status.className = 'status' + (kind ? ' ' + kind : '');
}

function showError(el, msg) {
  if (!msg) { el.hidden = true; el.textContent = ''; return; }
  el.hidden = false;
  el.textContent = msg;
}

function setBusy(busy, label) {
  els.btnUnlock.disabled = busy;
  els.btnGenerate.disabled = busy;
  els.btnUnlock.textContent = busy ? (label || '计算中…') : '解锁';
  els.unlockProgress.hidden = !busy;
}

let statusTimer = null;
function flash(text, kind) {
  setStatus(text, kind || 'ok');
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => setStatus(''), 2600);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    // 无剪贴板权限时的兜底：临时 textarea + execCommand
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e2) { return false; }
  }
}

// ------------------------------------------------------------------ 初始化

async function init() {
  els.btnLock = $('btn-lock');
  els.btnOptions = $('btn-options');
  els.btnEye = $('btn-eye');
  els.viewUnlock = $('view-unlock');
  els.viewMain = $('view-main');
  els.inUser = $('in-user');
  els.inSecret = $('in-secret');
  els.inAlgorithmUnlock = $('in-algorithm-unlock');
  els.inRemember = $('in-remember');
  els.unlockError = $('unlock-error');
  els.btnUnlock = $('btn-unlock');
  els.unlockProgress = $('unlock-progress');
  els.tagUser = $('tag-user');
  els.tagAlg = $('tag-alg');
  els.tagKeyId = $('tag-keyid');
  els.inSite = $('in-site');
  els.btnSite = $('btn-site');
  els.inType = $('in-type');
  els.inCounter = $('in-counter');
  els.btnCounterDown = $('btn-counter-down');
  els.btnCounterUp = $('btn-counter-up');
  els.inPurpose = $('in-purpose');
  els.fieldContext = $('field-context');
  els.inContext = $('in-context');
  els.genError = $('gen-error');
  els.result = $('result');
  els.outPassword = $('out-password');
  els.resultMeta = $('result-meta');
  els.btnCopy = $('btn-copy');
  els.btnFill = $('btn-fill');
  els.btnFav = $('btn-fav');
  els.btnRegen = $('btn-regen');
  els.btnGenerate = $('btn-generate');
  els.catTabs = $('cat-tabs');
  els.favList = $('fav-list');
  els.favEmpty = $('fav-empty');
  els.recentList = $('recent-list');
  els.recentEmpty = $('recent-empty');
  els.btnClearRecent = $('btn-clear-recent');
  els.btnManage = $('btn-manage');
  els.status = $('status');

  TYPES.forEach(t => {
    const o = document.createElement('option');
    o.value = t.value;
    o.textContent = t.label;
    els.inType.appendChild(o);
  });

  store = Store.getStore();
  state = await store.load();

  els.inUser.value = state.settings.userName || '';
  els.inRemember.checked = !!state.settings.rememberUserName;
  els.inType.value = state.settings.defaultType || 'long';
  els.inAlgorithmUnlock.value = String(state.settings.algorithm === undefined ? 3 : state.settings.algorithm);

  bindEvents();
  await prefillSite();
  renderPanels();
  els.inSecret.focus();
}

function bindEvents() {
  els.btnEye.addEventListener('click', () => {
    const show = els.inSecret.type === 'password';
    els.inSecret.type = show ? 'text' : 'password';
    els.btnEye.textContent = show ? 'hide' : 'show';
    els.btnEye.setAttribute('aria-pressed', String(show));
    els.inSecret.focus();
  });

  els.btnUnlock.addEventListener('click', unlock);
  els.inSecret.addEventListener('keydown', e => { if (e.key === 'Enter') unlock(); });
  els.inUser.addEventListener('keydown', e => { if (e.key === 'Enter') els.inSecret.focus(); });

  els.btnLock.addEventListener('click', lock);
  els.btnOptions.addEventListener('click', () => chrome.runtime.openOptionsPage());

  els.btnSite.addEventListener('click', async () => {
    await prefillSite(true);
  });

  els.inSite.addEventListener('keydown', e => { if (e.key === 'Enter') generate(); });
  els.inCounter.addEventListener('keydown', e => { if (e.key === 'Enter') generate(); });
  els.inContext.addEventListener('keydown', e => { if (e.key === 'Enter') generate(); });
  els.inType.addEventListener('change', generate);
  els.inPurpose.addEventListener('change', () => {
    els.fieldContext.hidden = els.inPurpose.value !== 'recovery';
    generate();
  });

  els.btnCounterDown.addEventListener('click', () => bumpCounter(-1));
  els.btnCounterUp.addEventListener('click', () => bumpCounter(1));

  els.btnGenerate.addEventListener('click', generate);
  els.btnRegen.addEventListener('click', () => {
    bumpCounter(1);
    generate();
  });

  els.btnCopy.addEventListener('click', async () => {
    if (!lastResult) return;
    const ok = await copyText(lastResult.password);
    flash(ok ? '已复制到剪贴板' : '复制失败，请手动选中', ok ? 'ok' : 'err');
  });
  els.outPassword.addEventListener('click', async () => {
    if (!lastResult) return;
    const ok = await copyText(lastResult.password);
    flash(ok ? '已复制' : '复制失败', ok ? 'ok' : 'err');
  });

  els.btnFill.addEventListener('click', doFill);
  els.btnFav.addEventListener('click', toggleFavorite);
  els.btnClearRecent.addEventListener('click', async () => {
    state = await store.save(Store.clearRecent(state));
    renderPanels();
    flash('已清空最近记录');
  });
  els.btnManage.addEventListener('click', () => chrome.runtime.openOptionsPage());

  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      activeTab = btn.dataset.tab;
      document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b === btn));
      $('tab-favorites').hidden = activeTab !== 'favorites';
      $('tab-recent').hidden = activeTab !== 'recent';
    });
  });
}

function bumpCounter(delta) {
  const cur = parseInt(els.inCounter.value, 10);
  const next = Math.max(1, Math.min(4294967295, (isNaN(cur) ? 1 : cur) + delta));
  els.inCounter.value = String(next);
}

// ------------------------------------------------------------------ 站点预填

async function prefillSite(force) {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs && tabs[0];
    if (!tab || !tab.url) return;
    if (!/^https?:/i.test(tab.url)) {
      if (force) flash('当前页面不是 http(s)，请手动填站点名', 'warn');
      return;
    }
    const site = Store.normalizeSite(tab.url);
    if (!site) return;
    // 已解锁后点「当前页」要真的换过去；未解锁时只在输入框为空时预填。
    // 注意：这里**不**写「最近」—— 光打开 popup 不算用过，只有真的生成过一次才记。
    if (force || !els.inSite.value) els.inSite.value = site;
  } catch (e) {
    // 拿不到 tab 不是致命错误，手动输入照样能用
  }
}

// ------------------------------------------------------------------ 解锁

async function unlock() {
  showError(els.unlockError, '');
  const userName = els.inUser.value.trim();
  const userSecret = els.inSecret.value;
  const algorithm = parseInt(els.inAlgorithmUnlock.value, 10);

  if (!userName) { showError(els.unlockError, '请先填姓名'); els.inUser.focus(); return; }
  if (!userSecret) { showError(els.unlockError, '请先填主密钥'); els.inSecret.focus(); return; }

  setBusy(true, '解锁中…');
  setStatus('正在跑 scrypt（N=32768）…');
  const t0 = performance.now();
  try {
    const res = await call('derive', { userName, userSecret, algorithm });
    const ms = Math.round(performance.now() - t0);
    unlocked = true;

    state = await store.save(Object.assign({}, state, {
      settings: Object.assign({}, state.settings, {
        userName: userName,
        rememberUserName: !!els.inRemember.checked,
        algorithm: algorithm,
      }),
    }));

    els.inSecret.value = '';
    els.viewUnlock.hidden = true;
    els.viewMain.hidden = false;
    els.btnLock.hidden = false;
    els.tagUser.textContent = userName;
    els.tagAlg.textContent = 'v' + algorithm;
    els.tagKeyId.textContent = res.userKeyId;
    els.tagKeyId.title = 'userKey 指纹 = SHA-256(64 字节 userKey)\n' + res.userKeyId;

    setStatus('已解锁 · scrypt 用时 ' + ms + ' ms', 'ok');
    els.inSite.focus();
    if (els.inSite.value) generate();
  } catch (e) {
    showError(els.unlockError, e.message);
    setStatus('解锁失败', 'err');
  } finally {
    setBusy(false);
  }
}

async function lock() {
  try { await call('reset'); } catch (e) { /* 已经没了也无所谓 */ }
  unlocked = false;
  lastResult = null;
  els.viewUnlock.hidden = false;
  els.viewMain.hidden = true;
  els.btnLock.hidden = true;
  els.result.hidden = true;
  els.inSecret.value = '';
  setStatus('已锁定，内存中的密钥已清除');
  els.inSecret.focus();
}

// ------------------------------------------------------------------ 生成

async function generate() {
  if (!unlocked) return;
  const site = Store.normalizeSite(els.inSite.value);
  if (els.inSite.value.trim() && !site) {
    showError(els.genError, '站点名不合法');
    return;
  }
  if (!site) { showError(els.genError, '请先填站点名'); return; }
  showError(els.genError, '');

  const type = els.inType.value;
  const counter = Math.max(1, parseInt(els.inCounter.value, 10) || 1);
  const purpose = els.inPurpose.value;
  const keyContext = purpose === 'recovery' ? (els.inContext.value || null) : null;

  try {
    const res = await call('generate', { siteName: site, resultType: type, counter, purpose, keyContext });
    lastResult = res;
    lastResult.site = site;
    lastResult.keyContext = keyContext;
    els.outPassword.textContent = res.password;
    els.result.hidden = false;
    const parts = [res.type, 'c=' + res.counter, 'v' + res.algorithm, res.template];
    if (purpose !== 'authentication') parts.push(PURPOSES[purpose] || purpose);
    els.resultMeta.textContent = parts.join(' · ');
    els.btnFav.classList.toggle('active', !!Store.findFavorite(state, site));

    const next = Store.pushRecent(state, {
      site: site,
      userName: state.settings.userName,
      type: type,
      at: Date.now(),
    });
    state = await store.save(next);
    renderPanels();
    setStatus('密码已按 ' + site + ' 推导（' + res.type + '）', 'ok');
  } catch (e) {
    showError(els.genError, e.message);
  }
}

// ------------------------------------------------------------------ 填入页面

async function doFill() {
  if (!lastResult) return;
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs && tabs[0];
    if (!tab || !tab.id) { flash('找不到当前标签页', 'err'); return; }
    if (!/^https?:/i.test(tab.url || '')) { flash('当前页面不支持填入', 'warn'); return; }
    const res = await chrome.runtime.sendMessage({
      cmd: 'fill',
      tabId: tab.id,
      password: lastResult.password,
    });
    if (res && res.ok) {
      flash('已填入（' + res.count + ' 个输入框）');
      window.close();
    } else {
      flash((res && res.error) || '填入失败', 'err');
    }
  } catch (e) {
    flash('填入失败：' + e.message, 'err');
  }
}

// ------------------------------------------------------------------ 收藏

async function toggleFavorite() {
  if (!lastResult) return;
  const site = lastResult.site;
  const existing = Store.findFavorite(state, site);
  if (existing) {
    state = await store.save(Store.removeFavorite(state, site));
    flash('已取消收藏 ' + site);
  } else {
    state = await store.save(Store.addFavorite(state, {
      site: site,
      userName: state.settings.userName,
      type: lastResult.type,
      counter: lastResult.counter,
      algorithm: lastResult.algorithm,
      category: activeCategory || Store.UNCATEGORIZED,
    }));
    flash('已收藏 ' + site);
  }
  els.btnFav.classList.toggle('active', !!Store.findFavorite(state, site));
  renderPanels();
}

// ------------------------------------------------------------------ 列表渲染

function renderPanels() {
  const groups = Store.groupByCategory(state);
  const cats = groups.map(g => g.category);

  // 分类页签
  els.catTabs.innerHTML = '';
  const allBtn = document.createElement('button');
  allBtn.className = 'cat-tab' + (activeCategory ? '' : ' active');
  allBtn.textContent = '全部（' + state.favorites.length + '）';
  allBtn.addEventListener('click', () => { activeCategory = null; renderPanels(); });
  els.catTabs.appendChild(allBtn);
  cats.forEach(cat => {
    if (!cat) return;
    const count = groups.find(g => g.category === cat).items.length;
    const b = document.createElement('button');
    b.className = 'cat-tab' + (activeCategory === cat ? ' active' : '');
    b.textContent = cat + '（' + count + '）';
    b.addEventListener('click', () => { activeCategory = cat; renderPanels(); });
    els.catTabs.appendChild(b);
  });

  const favs = activeCategory
    ? state.favorites.filter(f => (f.category || Store.UNCATEGORIZED) === activeCategory)
    : state.favorites;

  els.favList.innerHTML = '';
  favs.forEach(fav => {
    els.favList.appendChild(siteRow({
      site: fav.site,
      sub: (TYPE_TO_NUM[fav.type] !== undefined ? fav.type : fav.type) + (fav.counter > 1 ? ' · c' + fav.counter : ''),
      type: fav.type,
      counter: fav.counter,
      algorithm: fav.algorithm,
      onDelete: async () => {
        state = await store.save(Store.removeFavorite(state, fav.site));
        renderPanels();
      },
    }));
  });
  els.favEmpty.hidden = favs.length > 0;

  els.recentList.innerHTML = '';
  (state.recent || []).forEach(r => {
    els.recentList.appendChild(siteRow({
      site: r.site,
      sub: r.type,
      type: r.type,
      counter: 1,
      onDelete: null,
    }));
  });
  els.recentEmpty.hidden = (state.recent || []).length > 0;
}

function siteRow(opts) {
  const li = document.createElement('li');
  li.className = 'site-item';

  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = opts.site;
  li.appendChild(name);

  const sub = document.createElement('span');
  sub.className = 'sub';
  sub.textContent = opts.sub || '';
  li.appendChild(sub);

  if (opts.onDelete) {
    const del = document.createElement('button');
    del.className = 'del';
    del.textContent = '×';
    del.title = '移除';
    del.addEventListener('click', e => { e.stopPropagation(); opts.onDelete(); });
    li.appendChild(del);
  }

  li.addEventListener('click', () => {
    els.inSite.value = opts.site;
    if (opts.type) els.inType.value = opts.type;
    if (opts.counter) els.inCounter.value = String(opts.counter);
    generate();
  });

  return li;
}

// ------------------------------------------------------------------ go

init().catch(e => {
  console.error(e);
  alert('初始化失败：' + e.message);
});
