/**
 * lint.js —— 语法体检（零依赖）
 *
 * 为什么需要：src/ 下同时存在 ES module（popup/options/worker/spectre/storage）与
 * 经典脚本（background.js），本机 node 默认按 CJS 解析，直接 `node --check foo.js`
 * 会把 `import`/`export` 当成语法错误。
 *
 * 做法：按文件内容自动判定模块类型 —— 含顶层 `import`/`export` 的复制成 .mjs 再查，
 * 其余直接查。另外校验 JSON 与 HTML 的本地引用。
 *
 * 用法：node tools/lint.js
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const os = require('os');

const root = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spectre-lint-'));

let failed = 0;

/** 按内容判断是不是 ES module（顶层 import/export）。 */
function isEsm(file) {
  const src = fs.readFileSync(file, 'utf8');
  return /^\s*(?:import|export)\s/m.test(src);
}

function check(rel) {
  const src = path.join(root, rel);
  if (!fs.existsSync(src)) {
    failed++;
    console.log('  FAIL ' + rel + '\n       文件不存在');
    return;
  }
  let target = src;
  if (isEsm(src)) {
    target = path.join(tmp, rel.replace(/[\\/]/g, '_') + '.mjs');
    fs.copyFileSync(src, target);
  }
  try {
    execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' });
    console.log('  ok   ' + rel + (target !== src ? '  (esm)' : ''));
  } catch (e) {
    failed++;
    const out = (e.stderr || e.stdout || Buffer.from('')).toString().trim();
    console.log('  FAIL ' + rel + '\n       ' + out.split('\n').slice(0, 6).join('\n       '));
  }
}

function checkJson(rel) {
  const file = path.join(root, rel);
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    // manifest 的基本形状检查
    if (rel === 'manifest.json') {
      const need = ['manifest_version', 'name', 'version', 'action', 'background'];
      need.forEach(k => {
        if (data[k] === undefined) throw new Error('manifest 缺少字段: ' + k);
      });
      if (data.manifest_version !== 3) throw new Error('manifest_version 必须是 3');
      if (data.default_locale && !fs.existsSync(path.join(root, '_locales', data.default_locale, 'messages.json'))) {
        throw new Error('default_locale 指向的 _locales 文件不存在: ' + data.default_locale);
      }
      const files = [data.action && data.action.default_popup, data.background && data.background.service_worker]
        .filter(Boolean);
      files.forEach(f => {
        if (!fs.existsSync(path.join(root, f))) throw new Error('manifest 指向的文件不存在: ' + f);
      });
      Object.keys(data.icons || {}).forEach(size => {
        const f = data.icons[size];
        if (!fs.existsSync(path.join(root, f))) throw new Error('图标不存在: ' + f);
      });
    }
    if (rel.endsWith('generated_vectors.json')) {
      if (!Array.isArray(data) || data.length === 0) throw new Error('基准向量必须是数组且非空');
      const bad = data.filter(v => !v.result || v.algorithm === undefined);
      if (bad.length) throw new Error('有 ' + bad.length + ' 条向量缺 result/algorithm');
    }
    console.log('  ok   ' + rel);
  } catch (e) {
    failed++;
    console.log('  FAIL ' + rel + '\n       ' + e.message);
  }
}

console.log('== JS 语法 ==');
[
  'src\\spectre.js',
  'src\\storage.js',
  'src\\worker.js',
  'src\\popup.js',
  'src\\options.js',
  'src\\background.js',
  'tools\\make_icons.js',
  'tools\\set_extension_key.js',
  'tools\\lint.js',
  'test\\storage.test.js',
  'test\\verify_vectors.js',
  'test\\vectors.test.js',
  'test\\browser_e2e.js',
].forEach(check);

console.log('\n== JSON ==');
['manifest.json', 'test\\generated_vectors.json', '_locales\\zh_CN\\messages.json'].forEach(checkJson);

console.log('\n== HTML 引用 ==');
['src\\popup.html', 'src\\options.html'].forEach(function (rel) {
  const html = fs.readFileSync(path.join(root, rel), 'utf8');
  const refs = [];
  const re = /(?:src|href)="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) {
    if (/^(https?:|data:|#)/.test(m[1])) continue;
    refs.push(m[1]);
  }
  let bad = 0;
  refs.forEach(function (r) {
    if (!fs.existsSync(path.join(root, 'src', r))) { bad++; console.log('  FAIL ' + rel + ' 引用不存在: ' + r); }
  });
  if (bad) failed += bad;
  else console.log('  ok   ' + rel + '（' + refs.length + ' 个本地引用都在）');
});

fs.rmSync(tmp, { recursive: true, force: true });

console.log('\n' + '='.repeat(52));
if (failed) { console.log('失败 ' + failed + ' 项'); process.exit(1); }
console.log('全部通过 ✅');
