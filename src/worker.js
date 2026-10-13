/**
 * worker.js —— 把 scrypt 挪到 worker 里跑（N=32768,r=8,p=2 在主线程会把 popup 卡住）
 *
 * 协议：
 *   → { id, type: 'derive',  userName, userSecret, algorithm }
 *   ← { id, ok: true, userKeyId, algorithm }        // 只回指纹，不回密钥字节
 *   ← { id, ok: false, error }
 *
 *   → { id, type: 'reset' }                          // 换主密钥
 *   ← { id, ok: true }
 *
 *   → { id, type: 'generate', siteName, type, counter, purpose, keyContext }
 *   ← { id, ok: true, password, template, siteKeyHex }
 *
 * userKey 只活在 worker 的内存里，popup 关掉即消失 —— 不落盘、不回传。
 */

import * as Spectre from './spectre.js';

let userKeyBytes = null;
let cachedUserName = '';
let cachedAlgorithm = 3;

self.onmessage = function (ev) {
  const msg = ev.data || {};
  const id = msg.id;
  try {
    switch (msg.type) {
      case 'derive': {
        const algorithm = msg.algorithm === undefined ? 3 : msg.algorithm;
        const uk = Spectre.userKeyBytes(msg.userName, msg.userSecret, algorithm);
        userKeyBytes = uk;
        cachedUserName = msg.userName;
        cachedAlgorithm = algorithm;
        post(id, { ok: true, userKeyId: Spectre.keyIdOf(uk), algorithm });
        break;
      }
      case 'reset': {
        if (userKeyBytes) userKeyBytes.fill(0);
        userKeyBytes = null;
        cachedUserName = '';
        post(id, { ok: true });
        break;
      }
      case 'generate': {
        if (!userKeyBytes) throw new Error('还没解锁');
        const algorithm = msg.algorithm === undefined ? cachedAlgorithm : msg.algorithm;
        const res = Spectre.generate({
          userName: cachedUserName,
          userKeyBytes: userKeyBytes,
          siteName: msg.siteName,
          // 注意：外壳的 msg.type 是「指令名」(derive/generate)，密码模板走 resultType
          type: msg.resultType,
          counter: msg.counter,
          purpose: msg.purpose,
          keyContext: msg.keyContext,
          algorithm: algorithm,
        });
        post(id, {
          ok: true,
          password: res.password,
          template: res.template,
          type: res.type,
          counter: res.counter,
          algorithm: res.algorithm,
          siteKeyHex: res.siteKeyHex,
        });
        break;
      }
      default:
        throw new Error('未知指令: ' + msg.type);
    }
  } catch (e) {
    post(id, { ok: false, error: (e && e.message) || String(e) });
  }
};

function post(id, payload) {
  payload.id = id;
  self.postMessage(payload);
}
