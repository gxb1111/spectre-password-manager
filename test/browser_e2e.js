/**
 * test/browser_e2e.js —— 真浏览器端到端测试（零依赖，用 Node 内置 WebSocket + CDP）
 *
 * 为什么不走 agent-browser：`--extension` 在 Windows 上启动极慢且会挂住；
 * 直接用 Chrome for Testing 的 `--load-extension` 更可控。
 *
 * 覆盖：
 *   1. 插件能被 Chrome 加载（service worker 起来了、无加载错误）；
 *   2. popup.html 在扩展上下文里能跑起来（脚本、worker 都能加载）；
 *   3. 浏览器里跑 scrypt（WebCrypto 后端）得到与官方一致的 userKey 指纹；
 *   4. 端到端一条链：derive → generate，结果等于官方向量。
 *
 * 用法：node test/browser_e2e.js [--headed]
 */

import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');

// 浏览器可换：默认 Chrome for Testing；用 SPECTRE_CHROME 指到 msedge.exe 即可在 Edge 上跑同一套断言。
const CHROME = process.env.SPECTRE_CHROME
  || 'C:\\Users\\gxb\\.agent-browser\\browsers\\chrome-155.0.8059.39\\chrome.exe';
// 进程名跟着二进制走，否则清理残留时会漏掉 msedge.exe（edge 的渲染进程同样会占据 devtools 端口）。
const PROC_NAME = /msedge/i.test(CHROME) ? 'msedge.exe' : 'chrome.exe';
// 端口可配：Chrome 与 Edge 用不同端口就能并行，不怕抢 9333。
const PORT = Number(process.env.SPECTRE_PORT || 9333);
const HEADED = process.argv.indexOf('--headed') !== -1;

// JSON 用 fs 读，不用 `import ... from '*.json'`（在 ESM 里需要 import attributes，Node 24 会直接语法报错）
const VECTORS = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'generated_vectors.json'), 'utf8'));
const MANIFEST = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'manifest.json'), 'utf8'));
// 旧版的真数据（含那条 site="1" 的测试垃圾）：第 5 步拿它走一遍真实导入
const LEGACY = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'spectre_data.legacy.json'), 'utf8'));

/**
 * 扩展 ID 由 manifest.key 唯一决定 —— 不靠运行时去"猜"。
 *
 * 这一条踩过大坑：没有 manifest.key 的 unpacked 扩展，Chrome 会按加载路径派生 ID，
 * 而本机派生出的 ID 正好撞上 Chrome 自带的组件扩展「Contextual Tasks」。
 * 撞车时内置扩展优先，popup.html 直接 404，但 service worker 还能起，
 * 极容易误判成"页面代码有问题"。tools/set_extension_key.js 负责写 key。
 */
function extensionIdFromKey(keyB64) {
  const der = Buffer.from(keyB64, 'base64');
  const digest = crypto.createHash('sha256').update(der).digest();
  let out = '';
  for (let i = 0; i < 16; i++) {
    out += String.fromCharCode(97 + (digest[i] >> 4));
    out += String.fromCharCode(97 + (digest[i] & 0x0f));
  }
  return out;
}
const EXTENSION_ID = extensionIdFromKey(MANIFEST.key);

let pass = 0, fail = 0;
function ok(name, extra) { pass++; console.log('  ok   ' + name + (extra ? '  ' + extra : '')); }
function bad(name, why) { fail++; console.log('  FAIL ' + name + '\n       ' + why); }

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function httpJson(url) {
  const res = await fetch(url);
  return res.json();
}

// ------------------------------------------------------------------ CDP

class CDP {
  constructor(wsUrl) {    this.ws = new WebSocket(wsUrl);
    this.seq = 0;
    this.waiting = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve());
      this.ws.addEventListener('error', e => reject(new Error('ws error: ' + (e.message || 'unknown'))));
    });
    this.ws.addEventListener('message', ev => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.id && this.waiting.has(msg.id)) {
        const slot = this.waiting.get(msg.id);
        this.waiting.delete(msg.id);
        if (msg.error) slot.reject(new Error(msg.error.message));
        else slot.resolve(msg.result);
      }
    });
  }
  send(method, params, timeoutMs) {
    const id = ++this.seq;
    this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.waiting.has(id)) {
          this.waiting.delete(id);
          reject(new Error('CDP 超时: ' + method));
        }
      }, timeoutMs || 60000);
    });
  }
  connect() { return this.ready; }
  close() { try { this.ws.close(); } catch (e) { /* ignore */ } }
}

/** 在页面里求值，返回 JSON 化结果。timeoutMs 只在跑重活时显式放大。 */
async function evaluate(cdp, expression, awaitPromise, timeoutMs) {
  const res = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: !!awaitPromise,
    userGesture: true,
  }, timeoutMs);
  if (res.exceptionDetails) {
    const d = res.exceptionDetails;
    const text = (d.exception && (d.exception.description || d.exception.value)) || d.text || '未知异常';
    throw new Error(text);
  }
  return res.result.value;
}

async function waitForTarget(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const list = await httpJson('http://127.0.0.1:' + PORT + '/json/list').catch(() => []);
    const hit = (list || []).find(predicate);
    if (hit) return hit;
    await sleep(300);
  }
  return null;
}

// ------------------------------------------------------------------ 主流程

(async function main() {
  if (!fs.existsSync(CHROME)) {
    console.error('找不到 Chrome: ' + CHROME + '\n可用 SPECTRE_CHROME 指定路径');
    process.exit(2);
  }

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'spectre-e2e-'));
  const args = [
    '--remote-debugging-port=' + PORT,
    '--remote-allow-origins=*',
    '--user-data-dir=' + profile,
    '--no-first-run',
    '--no-default-browser-check',
    '--allow-file-access-from-files',
    '--disable-background-networking',
    '--disable-component-update',
    '--load-extension=' + ROOT,
    '--disable-extensions-except=' + ROOT,
    'about:blank',
  ];
  if (!HEADED) args.unshift('--headless=new');
  else args.splice(1, 0, '--headless=new');

  console.log('启动 Chrome（' + (HEADED ? 'headed' : 'headless=new') + '）…');
  const chrome = spawn(CHROME, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let chromeErr = '';
  chrome.stderr.on('data', d => { chromeErr += d.toString(); });

  let killed = false;
  const cleanup = () => {
    if (killed) return;
    killed = true;
    try { chrome.kill(); } catch (e) { /* ignore */ }
    // Chrome 会留下渲染/GPU 子进程，kill 主进程后必须再扫一遍同 user-data-dir 的残留，
    // 否则残留进程会污染下一次运行的 /json/list（曾误把组件扩展当成我们的插件）。
    setTimeout(() => {
      try {
        const ps = 'Get-CimInstance Win32_Process -Filter "Name=\'' + PROC_NAME + '\'" | Where-Object { $_.CommandLine -like \'*'
          + profile.replace(/\\/g, '\\\\') + '*\' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }';
        execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { stdio: 'ignore', timeout: 15000 });
      } catch (e) { /* ignore */ }
      try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
    }, 500);
  };
  process.on('exit', cleanup);

  try {
    // 等 devtools 端口
    let version = null;
    for (let i = 0; i < 60; i++) {
      version = await httpJson('http://127.0.0.1:' + PORT + '/json/version').catch(() => null);
      if (version) break;
      await sleep(300);
    }
    if (!version) throw new Error('devtools 端口没起来\nstderr: ' + chromeErr.slice(-1500));
    console.log((version.Browser || 'browser') + ' 就绪\n');

    // ---- 1. service worker（证明插件被加载且没在启动时炸掉）
    console.log('== 1) 插件加载 ==');
    // 用 manifest.key 推导出来的确定 ID 去找，而不是"列表里第一个 chrome-extension://"。
    // 后者会命中 Chrome 自带的 Hangouts（thunk.js）或 Contextual Tasks 组件，误判成插件已加载。
    const swTarget = await waitForTarget(
      t => t.type === 'service_worker' && (t.url || '').indexOf(EXTENSION_ID) !== -1,
      15000
    );
    if (!swTarget) {
      bad('service worker 启动', '没找到 chrome-extension:// 的 service_worker 目标；Chrome stderr 末尾:\n       ' + chromeErr.slice(-800));
    } else {
      ok('service worker 启动', swTarget.url);
      const extensionId = EXTENSION_ID;
      console.log('  扩展 ID（由 manifest.key 决定）: ' + extensionId);

      const swCdp = new CDP(swTarget.webSocketDebuggerUrl);
      await swCdp.connect();
      try {
        await swCdp.send('Runtime.enable');
      } catch (e) { /* 非致命 */ }
      try {
        // 注意：CDP 用主世界求值，chrome.storage 等扩展 API 在隔离世界才可见，
        // 所以这里只确认 runtime 存在；扩展页能否打开才是更强的判据（见第 2 节）。
        const swProbe = await evaluate(swCdp,
          'JSON.stringify({ok:true, runtime: typeof (globalThis.chrome && chrome.runtime)})');
        const parsed = JSON.parse(swProbe);
        if (parsed.runtime === 'object') ok('service worker 的 chrome.runtime 可用');
        else bad('service worker 的 chrome.runtime 可用', swProbe);
      } catch (e) {
        console.log('  note  SW 探针跳过（' + e.message.split('\n')[0] + '）');
      }

      // ---- 2. popup 页面
      // 两个坑叠在一起：
      //   a) Chrome 155 起 HTTP 端点 /json/new 默认禁用
      //      （"Using unsafe HTTP verb GET to invoke /json/new"）；
      //   b) 从浏览器级会话 Target.createTarget('chrome-extension://…') 会被拒，
      //      表现为打开了 chrome-error://chromewebdata/。
      // 解决办法：从 **service worker 这个目标自己的会话**里建 popup 目标 ——
      // 这一手是扩展上下文发起的导航，Chrome 才放行。
      console.log('\n== 2) popup 页面 ==');
      const popupUrl = 'chrome-extension://' + extensionId + '/src/popup.html';
      const created = await swCdp.send('Target.createTarget', { url: popupUrl });
      swCdp.close();
      if (!created || !created.targetId) throw new Error('Target.createTarget 没返回 targetId: ' + JSON.stringify(created));
      console.log('  popup 目标已建: ' + created.targetId + '  ' + popupUrl);
      await sleep(2500);

      let popupTarget = null;
      try {
        const info = await httpJson('http://127.0.0.1:' + PORT + '/json/list');
        popupTarget = (info || []).find(t => t.id === created.targetId)
          || (info || []).find(t => (t.url || '').indexOf('/src/popup.html') !== -1);
      } catch (e) { /* 下面统一报错 */ }
      if (!popupTarget) throw new Error('popup 目标没出现在 /json/list 里');
      console.log('  popup url: ' + popupTarget.url);
      if (/^chrome-error:/.test(popupTarget.url || '')) {
        throw new Error('扩展页被拒，落到 ' + popupTarget.url + '（检查 manifest / _locales / 图标路径）');
      }
      const newTarget = popupTarget;

      const popupCdp = new CDP(newTarget.webSocketDebuggerUrl);
      await popupCdp.connect();
      await popupCdp.send('Runtime.enable');

      const domReady = await waitForEval(popupCdp,
        'JSON.stringify({title:document.title, hasUnlock:!!document.getElementById("btn-unlock"), types:document.querySelectorAll("#in-type option").length})',
        15000);
      const dom = JSON.parse(domReady);
      if (dom.hasUnlock) ok('popup DOM 渲染完成', '模板下拉 ' + dom.types + ' 项 · ' + dom.title);
      else bad('popup DOM 渲染完成', domReady);

      // popup.js 是 ES module，语法错误会让它整体不执行 —— 用 init 的副作用判断
      // popup.js 是 ES module，语法错误会让它整体不执行 —— 用副作用判断
      const wired = await evaluate(popupCdp, 'String(document.getElementById("in-type").options.length > 5)');
      if (wired === 'true') ok('popup.js 模块成功执行');
      else bad('popup.js 模块成功执行', '模板下拉没有被填充，说明模块没跑起来');

      // 扩展页上下文里 chrome.storage 必须存在 —— 这是"跑在扩展里"而非"跑在网页里"的判据
      const extApi = await evaluate(popupCdp,
        'JSON.stringify({url:location.protocol, storage:typeof (globalThis.chrome&&chrome.storage), action:typeof (globalThis.chrome&&chrome.action)})');
      const extInfo = JSON.parse(extApi);
      if (extInfo.storage === 'object' && extInfo.url === 'chrome-extension:') ok('popup 运行在真正的扩展上下文');
      else bad('popup 运行在真正的扩展上下文', extApi);

      // ---- 3. 浏览器内 scrypt + 官方向量
      console.log('\n== 3) 扩展上下文里的算法（WebCrypto 后端）==');
      // 每条向量都要跑一次 N=32768 的 scrypt（约 0.7-1s），68 条串起来要 50s+，
      // 单次 Runtime.evaluate 很容易撞上 CDP 超时（Chrome 上实测踩过一次）。
      // 所以分批跑：每批 8 条，批量超时给足 120s。
      const BATCH = 8;
      const allVec = [];
      let prims = null, userKeyId = null;
      for (let start = 0; start < VECTORS.length; start += BATCH) {
        const slice = VECTORS.slice(start, start + BATCH);
        const chunk = await evaluate(popupCdp, `(async () => {
          const S = await import('./spectre.js');
          const out = { primitives: {}, vectors: [] };
          out.primitives.sha256 = S.toHex(S.sha256(S.utf8Bytes('abc')));
          out.primitives.hmac = S.toHex(S.hmacSha256(S.utf8Bytes('key'), S.utf8Bytes('The quick brown fox jumps over the lazy dog')));
          const uk = S.userKeyBytes('Robert Lee Mitchell', 'banana colored duckling', 3);
          out.userKeyId = S.keyIdOf(uk);
          for (const v of ${JSON.stringify(slice)}) {
            let got = null, err2 = null;
            try {
              got = S.generate({
                userName: 'Robert Lee Mitchell',
                userSecret: 'banana colored duckling',
                siteName: v.siteName,
                counter: v.counter,
                type: v.type,
                purpose: v.purpose === 'a' ? 'authentication' : v.purpose === 'i' ? 'identification' : 'recovery',
                keyContext: v.context,
                algorithm: v.algorithm,
              }).password;
            } catch (e) { err2 = e.message; }
            out.vectors.push({ id: 'v' + v.algorithm + '-' + v.type + '-c' + v.counter + '-' + v.purpose, got: err2 || got, want: v.result, pass: !err2 && got === v.result });
          }
          return out;
        })()`, true, 120000);
        if (!prims) { prims = chunk.primitives; userKeyId = chunk.userKeyId; }
        allVec.push(...chunk.vectors);
        process.stdout.write('    向量进度 ' + Math.min(start + BATCH, VECTORS.length) + '/' + VECTORS.length + '\r');
      }
      process.stdout.write(' '.repeat(40) + '\r');
      const pr = { primitives: prims, userKeyId, vectors: allVec };
      const wantSha = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
      if (String(pr.primitives.sha256).toLowerCase() === wantSha) ok('SHA-256（浏览器）', pr.primitives.sha256.slice(0, 16) + '…');
      else bad('SHA-256（浏览器）', pr.primitives.sha256 + ' ≠ ' + wantSha);

      const wantHmac = 'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8';
      if (String(pr.primitives.hmac).toLowerCase() === wantHmac) ok('HMAC-SHA256（浏览器）');
      else bad('HMAC-SHA256（浏览器）', pr.primitives.hmac);

      if (String(pr.userKeyId).toUpperCase() === '98EEF4D1DF46D849574A82A03C3177056B15DFFCA29BB3899DE4628453675302') {
        ok('scrypt（浏览器自实现）与官方一致', 'v3 userKeyId=' + pr.userKeyId.slice(0, 16) + '…');
      } else {
        bad('scrypt（浏览器自实现）与官方一致', '得到 ' + pr.userKeyId);
      }

      const vPass = pr.vectors.filter(v => v.pass).length;
      if (vPass === pr.vectors.length) ok('官方向量全部通过（浏览器内）', vPass + '/' + pr.vectors.length);
      else {
        bad('官方向量（浏览器内）', vPass + '/' + pr.vectors.length + '；失败：' +
          pr.vectors.filter(v => !v.pass).slice(0, 5).map(v => v.id + ' got=' + v.got + ' want=' + v.want).join(' | '));
      }

      // ---- 4. 一条链：真的走 worker 的 derive → generate
      console.log('\n== 4) popup 的 worker 链路（derive → generate）==');
      const chain = await evaluate(popupCdp, `(async () => {
        const w = new Worker('chrome-extension://' + chrome.runtime.id + '/src/worker.js', { type: 'module' });
        const call = (kind, payload) => new Promise((resolve, reject) => {
          const id = Math.random().toString(36).slice(2);
          const t = setTimeout(() => reject(new Error('worker 超时: ' + kind)), 30000);
          const onMsg = (ev) => {
            if (ev.data && ev.data.id === id) {
              clearTimeout(t); w.removeEventListener('message', onMsg);
              ev.data.ok ? resolve(ev.data) : reject(new Error(ev.data.error));
            }
          };
          w.addEventListener('message', onMsg);
          w.postMessage(Object.assign({ id, type: kind }, payload));
        });
        const t0 = performance.now();
        const un = await call('derive', { userName: 'Robert Lee Mitchell', userSecret: 'banana colored duckling', algorithm: 3 });
        const ms = Math.round(performance.now() - t0);
        const gen = await call('generate', { siteName: 'masterpasswordapp.com', resultType: 'long', counter: 1, algorithm: 3 });
        const v0 = await call('generate', { siteName: 'masterpasswordapp.com', resultType: 'long', counter: 1, algorithm: 0 });
        w.terminate();
        return JSON.stringify({ ms, userKeyId: un.userKeyId, v3: gen.password, v0: v0.password });
      })()`, true);

      // 注意 generated_vectors.json 的字段是 type / counter（不是 resultType/keyCounter），
      // 而且里面没有 masterpasswordapp.com+long 的条目，所以期望值直接写官方 CLI 实测结果。
      const ch = JSON.parse(chain);
      const WANT = { v3: 'Jejr5[RepuSosp', v0: 'Feji5@ReduWosh' };
      if (ch.v3 === WANT.v3) ok('worker 链路 v3', ch.v3 + '（scrypt ' + ch.ms + ' ms）');
      else bad('worker 链路 v3', ch.v3 + ' 期望 ' + WANT.v3);
      if (ch.v0 === WANT.v0) ok('worker 链路 v0', ch.v0);
      else bad('worker 链路 v0', ch.v0 + ' 期望 ' + WANT.v0);
      if (ch.userKeyId === '98EEF4D1DF46D849574A82A03C3177056B15DFFCA29BB3899DE4628453675302') {
        ok('worker 的 keyID 与官方一致', ch.userKeyId.slice(0, 16) + '…');
      } else bad('worker 的 keyID 与官方一致', ch.userKeyId);

      popupCdp.close();

      // ---- 5. options 页的导入链路（真的过一遍 chrome.storage）
      console.log('\n== 5) 设置页：旧版收藏导入 ==');
      const optUrl = 'chrome-extension://' + EXTENSION_ID + '/src/options.html';
      const optCdp = await openExtensionPage(optUrl);

      await waitForEval(optCdp, `(() => {
        const t = document.getElementById('op-import-text');
        return t && document.getElementById('op-import-run') ? 'ready' : '';
      })()`, 20000);

      // 先把状态清干净，保证这次导入的统计是可断言的
      await evaluate(optCdp, `(async () => {
        const S = await import('./storage.js');
        const store = S.getStore();
        await store.save(S.emptyState());
        return 'cleared';
      })()`, true);

      // 走真实 DOM：往文本框里塞旧版 spectre_data.json，点「导入」，读回 storage
      const importOut = await evaluate(optCdp, `(async () => {
        const S = await import('./storage.js');
        const legacy = ${JSON.stringify(LEGACY)};
        document.getElementById('op-import-text').value = JSON.stringify(legacy);
        document.getElementById('op-import-run').click();
        // 等导入落盘（persist 是异步的）
        for (let i = 0; i < 60; i++) {
          await new Promise(r => setTimeout(r, 100));
          const st = await S.getStore().load();
          if (st.favorites.length >= legacy.favorites.length) break;
        }
        const st = await S.getStore().load();
        return {
          count: st.favorites.length,
          sites: st.favorites.map(f => f.site),
          types: Object.fromEntries(st.favorites.map(f => [f.site, f.type])),
          algorithm: st.favorites[0] && st.favorites[0].algorithm,
          userName: st.settings.userName,
          categories: st.categories,
          recent: st.recent.map(r => r.site),
          status: document.getElementById('op-status').textContent,
        };
      })()`, true, 60000);

      if (importOut.count === LEGACY.favorites.length) {
        ok('旧版收藏导入落盘', importOut.count + ' 项');
      } else {
        bad('旧版收藏导入落盘', '得到 ' + importOut.count + ' 项，期望 ' + LEGACY.favorites.length);
      }
      // 这条是整个迁移的关键：中文/大写站点名一个都不能被改写
      const MUST = ['普通话', 'AI安全', '补天漏洞', '程序员客栈', 'gitee', '攻防世界',
                    'hackbyte', 'bugku', 'CTF', 'U+', 'acbug', '远程', '西北民族大学', '微软', '安卓'];
      const missing = MUST.filter(s => importOut.sites.indexOf(s) === -1);
      if (!missing.length) ok('站点名原样保留', MUST.length + ' 个全在（含 AI安全 / CTF / U+）');
      else bad('站点名原样保留', '缺失或被改写：' + missing.join('、'));

      if (importOut.types['补天漏洞'] === 'maximum' && importOut.types['微软'] === 'pin') {
        ok('旧版 template 正确映射为 type');
      } else {
        bad('旧版 template 正确映射为 type', JSON.stringify(importOut.types));
      }
      if (importOut.algorithm === 3 && importOut.userName === '苏星豪') {
        ok('算法 v3 + 姓名从旧数据补上', 'userName=' + importOut.userName);
      } else {
        bad('算法 v3 + 姓名从旧数据补上',
            'algorithm=' + importOut.algorithm + ' userName=' + importOut.userName);
      }
      if (importOut.recent.indexOf('skyeye') !== -1) ok('最近记录一并带过来');
      else bad('最近记录一并带过来', importOut.recent.join(','));
      if (/新增|覆盖/.test(importOut.status)) ok('设置页给出了导入结果提示', importOut.status.slice(0, 40));
      else bad('设置页给出了导入结果提示', importOut.status);

      optCdp.close();
    }
  } catch (e) {
    bad('端到端流程', e.message);
  } finally {
    cleanup();
  }

  console.log('\n' + '='.repeat(52));
  console.log('通过 ' + pass + ' / 失败 ' + fail);
  if (fail) process.exit(1);
  console.log('全部通过 ✅');
  process.exit(0);
})();

/** 轮询求值直到返回非空字符串。 */
async function waitForEval(cdp, expression, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    try {
      const v = await evaluate(cdp, expression);
      if (typeof v === 'string' && v) return v;
      last = String(v);
    } catch (e) { last = '异常: ' + e.message; }
    await sleep(300);
  }
  throw new Error('等待页面就绪超时；最后一次取值: ' + last);
}

/**
 * 打开一个扩展内页面并返回已连好的 CDP。
 *
 * 为什么要绕 service worker 这一圈：Chrome 155 起，
 *   * HTTP 端点 `/json/new` 被默认禁用；
 *   * 浏览器级会话发 `Target.createTarget('chrome-extension://…')` 有时会被拒，
 *     落地成 `chrome-error://chromewebdata/`。
 *
 * 另一件必须防的事：**MV3 的 service worker 空闲会被回收**，跑完第 4 步之后
 * 它常常已经不在 /json/list 里了。所以这里两条路都试：
 *   ① 找到 SW 目标 → 从扩展自己的会话建目标（最稳）；
 *   ② 找不到 → 回退到浏览器级会话（顺便把 SW 唤醒），落地页不是错误页就走。
 */
async function openExtensionPage(url) {
  const attempts = [];

  const sw = await waitForServiceWorker(8000);
  if (sw) attempts.push({ how: 'service_worker', ws: sw.webSocketDebuggerUrl });

  const ver = await httpJson('http://127.0.0.1:' + PORT + '/json/version').catch(() => null);
  if (ver && ver.webSocketDebuggerUrl) {
    attempts.push({ how: 'browser', ws: ver.webSocketDebuggerUrl });
  }
  if (!attempts.length) throw new Error('既没有 service worker，也没有浏览器级 CDP 会话');

  const errors = [];
  for (const a of attempts) {
    let cdp = null;
    try {
      cdp = new CDP(a.ws);
      await cdp.connect();
      const created = await cdp.send('Target.createTarget', { url: url });
      cdp.close();
      cdp = null;
      if (!created || !created.targetId) throw new Error('Target.createTarget 没返回 targetId');

      const target = await waitForTarget(t => t.id === created.targetId, 20000);
      if (/^chrome-error:/.test(target.url || '')) {
        throw new Error('落地成 ' + target.url);
      }
      const page = new CDP(target.webSocketDebuggerUrl);
      await page.connect();
      await page.send('Runtime.enable');
      try { await page.send('Log.enable'); } catch (e) { /* 可选 */ }
      return page;
    } catch (e) {
      errors.push(a.how + ': ' + e.message.split('\n')[0]);
      if (cdp) cdp.close();
    }
  }
  throw new Error('打不开 ' + url + ' —— ' + errors.join(' | '));
}

/** 等扩展的 service worker 出现在目标列表里（MV3 会被回收，所以要轮询）。 */
async function waitForServiceWorker(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const list = await httpJson('http://127.0.0.1:' + PORT + '/json/list').catch(() => []);
    const sw = (list || []).find(t => t.type === 'service_worker' && (t.url || '').indexOf(EXTENSION_ID) !== -1);
    if (sw) return sw;
    await sleep(250);
  }
  return null;
}
