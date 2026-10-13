/**
 * options.js —— 设置页
 *
 * 只读写「站点名 / 模板 / 用户名 / 计数器 / 分类」这类元数据；
 * 页面上没有任何密码输入框，也永远不会出现密码。
 */

import * as Store from './storage.js';

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

const $ = id => document.getElementById(id);
const store = Store.getStore();
let state = null;

function setStatus(text, kind) {
  const el = $('op-status');
  el.textContent = text || '';
  el.className = 'status' + (kind ? ' ' + kind : '');
  if (text) setTimeout(() => { el.textContent = ''; }, 3000);
}

async function persist(next, message) {
  state = await store.save(next);
  render();
  if (message) setStatus(message, 'ok');
}

function render() {
  $('op-type').value = state.settings.defaultType || 'long';
  $('op-algorithm').value = String(state.settings.algorithm === undefined ? 3 : state.settings.algorithm);
  $('op-user').value = state.settings.userName || '';

  // 分类
  const catList = $('op-cat-list');
  catList.innerHTML = '';
  if (!state.categories.length) {
    const li = document.createElement('li');
    li.innerHTML = '<span class="sub">还没有分类</span>';
    catList.appendChild(li);
  }
  state.categories.forEach(cat => {
    const count = state.favorites.filter(f => (f.category || Store.UNCATEGORIZED) === cat).length;
    const li = document.createElement('li');

    const input = document.createElement('input');
    input.type = 'text';
    input.value = cat;
    input.style.flex = '1';

    const sub = document.createElement('span');
    sub.className = 'sub';
    sub.textContent = count + ' 项';

    const save = document.createElement('button');
    save.className = 'mini';
    save.textContent = '改名';
    save.addEventListener('click', async () => {
      const next = input.value.trim();
      if (!next || next === cat) { input.value = cat; return; }
      await persist(Store.renameCategory(state, cat, next), '分类已改名');
    });

    const del = document.createElement('button');
    del.className = 'mini danger';
    del.textContent = '删除';
    del.addEventListener('click', async () => {
      await persist(Store.removeCategory(state, cat), '分类已删除，收藏退回未分类');
    });

    li.appendChild(input);
    li.appendChild(sub);
    li.appendChild(save);
    li.appendChild(del);
    catList.appendChild(li);
  });

  // 收藏
  $('op-fav-count').textContent = String(state.favorites.length);
  const favList = $('op-fav-list');
  favList.innerHTML = '';
  if (!state.favorites.length) {
    const li = document.createElement('li');
    li.innerHTML = '<span class="sub">还没有收藏，去 popup 里点「收藏」</span>';
    favList.appendChild(li);
  }
  state.favorites.forEach(fav => {
    const li = document.createElement('li');

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = fav.site;

    const sub = document.createElement('span');
    sub.className = 'sub';
    sub.textContent = fav.type + ' · c' + fav.counter + ' · v' + fav.algorithm;

    const cat = document.createElement('span');
    cat.className = 'cat';
    cat.textContent = fav.category || Store.UNCATEGORIZED;

    const del = document.createElement('button');
    del.className = 'mini danger';
    del.textContent = '移除';
    del.addEventListener('click', async () => {
      await persist(Store.removeFavorite(state, fav.site), '已移除 ' + fav.site);
    });

    li.appendChild(name);
    li.appendChild(sub);
    li.appendChild(cat);
    li.appendChild(del);
    favList.appendChild(li);
  });
}

function bind() {
  $('op-type').addEventListener('change', e => {
    persist(Object.assign({}, state, {
      settings: Object.assign({}, state.settings, { defaultType: e.target.value }),
    }), '默认模板已更新');
  });

  $('op-algorithm').addEventListener('change', e => {
    persist(Object.assign({}, state, {
      settings: Object.assign({}, state.settings, { algorithm: parseInt(e.target.value, 10) }),
    }), '算法版本已更新');
  });

  $('op-user').addEventListener('change', e => {
    persist(Object.assign({}, state, {
      settings: Object.assign({}, state.settings, { userName: e.target.value.trim() }),
    }), '姓名已保存');
  });

  $('op-add-cat').addEventListener('click', async () => {
    const v = $('op-new-cat').value.trim();
    if (!v) { setStatus('分类名不能为空', 'err'); return; }
    try {
      await persist(Store.addCategory(state, v), '已添加分类 ' + v);
      $('op-new-cat').value = '';
    } catch (err) { setStatus(err.message, 'err'); }
  });
  $('op-new-cat').addEventListener('keydown', e => { if (e.key === 'Enter') $('op-add-cat').click(); });

  $('op-clear-recent').addEventListener('click', async () => {
    await persist(Store.clearRecent(state), '最近记录已清空');
  });

  $('op-export').addEventListener('click', () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      note: '仅含站点元数据，不含任何密码或密钥',
      favorites: state.favorites,
      categories: state.categories,
      settings: state.settings,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'spectre-metadata.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    setStatus('已导出元数据', 'ok');
  });

  $('op-reset').addEventListener('click', async () => {
    if (!confirm('确定清空全部数据？收藏与分类都会删除，且无法恢复。\n（主密钥不在插件里，不受影响）')) return;
    await persist(Store.emptyState(), '已清空全部数据');
  });
}

async function main() {
  TYPES.forEach(t => {
    const o = document.createElement('option');
    o.value = t.value;
    o.textContent = t.label;
    $('op-type').appendChild(o);
  });
  $('op-version').textContent = 'v' + chrome.runtime.getManifest().version;
  state = await store.load();
  render();
  bind();
}

main().catch(e => {
  console.error(e);
  setStatus('初始化失败：' + e.message, 'err');
});
