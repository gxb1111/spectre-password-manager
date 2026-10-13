/**
 * tools/set_extension_key.js —— 给 unpacked 扩展钉死一个确定的 ID
 *
 * 为什么必须做这件事（踩过的坑，别撤）：
 *   manifest 里没有 `key` 的 unpacked 扩展，Chrome 会从「加载路径」派生出 ID。
 *   本机实测 `D:\desktop\1\dsh\spectre-plugin` 派生出的 ID 是
 *   `glbjnfimcajjenihimblfaponejbkoph` —— 正好和 Chrome 自带的组件扩展
 *   「Contextual Tasks」撞车。撞车时内置扩展优先，我们的 popup.html /
 *   spectre.js 一律 404（页面上显示 ERR_FILE_NOT_FOUND、"无法访问您的文件"），
 *   但 service worker 居然还能起来，非常容易误判成"页面代码有问题"。
 *   加了 `key` 之后 ID 由公钥决定，既稳定又不会撞。
 *
 * 做法：生成一把 RSA-1024 密钥，把 SPKI DER 的 base64 写进 manifest.key，
 *       ID = 公钥 SHA-256 的前 16 字节，按 0-f → a-p 映射成 32 个字母。
 *
 * 用法：node tools/set_extension_key.js [--force]
 *       已存在 key 时默认保留并只打印 ID；--force 才重新生成。
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MANIFEST = path.join(__dirname, '..', 'manifest.json');

function idFromSpkiDer(der) {
  const digest = crypto.createHash('sha256').update(der).digest();
  let out = '';
  for (let i = 0; i < 16; i++) {
    out += String.fromCharCode(97 + (digest[i] >> 4));
    out += String.fromCharCode(97 + (digest[i] & 0x0f));
  }
  return out;
}

function main() {
  const force = process.argv.includes('--force');
  const raw = fs.readFileSync(MANIFEST, 'utf8');
  const manifest = JSON.parse(raw);

  let key = manifest.key;
  if (key && !force) {
    const der = Buffer.from(key, 'base64');
    console.log('manifest.key 已存在，保留。');
    console.log('extension id = ' + idFromSpkiDer(der));
    return;
  }

  const { publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 });
  const der = publicKey.export({ type: 'spki', format: 'der' });
  key = der.toString('base64');

  // 保持文件原有的字段顺序：在 version 之后插入 key
  manifest.key = key;
  const ordered = {};
  for (const k of Object.keys(manifest)) ordered[k] = manifest[k];
  if (!('key' in ordered)) ordered.key = key;

  fs.writeFileSync(MANIFEST, JSON.stringify(ordered, null, 2) + '\n', 'utf8');
  console.log('已写入 manifest.key');
  console.log('extension id = ' + idFromSpkiDer(der));
}

main();
