/*
 * spectre.js — Spectre / Master Password 算法（v0–v3）纯 JavaScript 实现
 *
 * 算法来源：Spectre 官方 C 实现（api-main/c/spectre-algorithm*.c、spectre-types.c），
 * 并用官方测试套件 spectre_tests.xml（215 条结果向量 + 240 条 keyID 向量）逐条校验。
 * 本文件零依赖：scrypt / HMAC-SHA256 / SHA-256 全部自带，因此同一份代码可以跑在
 * Node（测试）与浏览器扩展（MV3 Service Worker）里。
 *
 * ── 派生链 ─────────────────────────────────────────────────────────────────
 *   userKeySalt = "com.lyndir.masterpassword" | uint32BE(len(userName)) | userName
 *   userKey     = scrypt(userSecret, userKeySalt, N=32768, r=8, p=2, dkLen=64)   ← 64 字节原样使用
 *   keyID       = SHA-256(userKey)                     ← 只是指纹，不参与派生
 *   siteSalt    = scope | uint32BE(len(siteName)) | siteName | uint32BE(counter)
 *   siteKey     = HMAC-SHA256(userKey, siteSalt)       ← 32 字节
 *   密码[c]     = 字符类表[ template[c] ][ siteKey[c+1] % 字符集长度 ]
 *
 * ── 四个版本的真实差异（来自官方枚举注释 + 实测逐条核对）──────────────────
 *   官方 spectre-types.h 对每个版本都写明了它「修掉了上一版的哪个 bug」：
 *     v0 (2012-03-05)  用 host-endian 做 16 位换算（把单字节写成大端再按本机序读回）
 *     v1 (2012-07-17)  站点名/上下文的长度按字符数算，而不是字节数
 *     v2 (2014-09-24)  用户名的长度按字符数算，而不是字节数
 *     v3 (2015-01-15)  当前版本
 *
 *   于是实际行为是：
 *
 *   | 版本 | 用户名长度 | 站点名/上下文长度 | 索引换算             |
 *   |------|------------|-------------------|----------------------|
 *   | v0   | 码点数     | 码点数            | 单字节 × 256 再取模  |
 *   | v1   | 码点数     | 码点数            | 直取单字节           |
 *   | v2   | 码点数     | UTF-8 字节数      | 直取单字节           |
 *   | v3   | 字节数     | UTF-8 字节数      | 直取单字节           |
 *
 *   v0 的「×256」不是玄学：C 里 `(uint16_t)b` 经 spectre_uint16 写成大端 [0,b]，
 *   再用 `*(uint16_t*)&seedByte` 按小端读回就是 b<<8。所以 v0 的密码跑在小端机器上
 *   才是官方向量里的那个值（历史上就是 x86 生成的），大端机器上会不一样。
 *
 * ── 三个最容易踩的坑 ───────────────────────────────────────────────────────
 * 1. userKey 是 scrypt 的 64 字节原始输出，**千万别再套一层 SHA-256**。
 *    套了照样「看起来很正常」，但生成的密码和 Spectre 官方 App 全线不一致。
 * 2. 模板数组的顺序和条目数必须和官方一模一样（Long 是 21 条，不是 20 条），
 *    因为用的是 `idx % count`；少一条、错一位，选中的模板就全变了。
 * 3. 各版本的「长度按字节还是按码点」别想当然——见上表，v1/v2 的差别正好在
 *    站点名（v1 码点、v2 字节），而用户名到 v3 才改成字节。
 */


'use strict';

// ---------------------------------------------------------------- utilities

function utf8Bytes(str) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
  return Uint8Array.from(Buffer.from(str, 'utf8'));
}

function utf8CharCount(str) {
  return Array.from(str).length;
}

function concat(parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function u32be(n) {
  return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}

function toHex(bytes) {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s.toUpperCase();
}

function fromHex(hex) {
  const clean = String(hex).replace(/[^0-9a-fA-F]/g, '');
  if (clean.length % 2) throw new Error('十六进制长度必须是偶数');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

// --------------------------------------------------------------- SHA-256

const K256 = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const sha256W = new Uint32Array(64);

function sha256(msg) {
  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const len = msg.length;
  const padded = new Uint8Array((((len + 9) >> 6) + 1) << 6);
  padded.set(msg);
  padded[len] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, Math.floor(len / 0x20000000));
  dv.setUint32(padded.length - 4, (len << 3) >>> 0);

  const w = sha256W;
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15], b = w[i - 2];
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K256[i] + w[i]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) ov.setUint32(i * 4, H[i]);
  return out;
}

function hmacSha256(key, msg) {
  let k = key;
  if (k.length > 64) k = sha256(k);
  const ipad = new Uint8Array(64 + msg.length);
  const opad = new Uint8Array(96);
  for (let i = 0; i < 64; i++) {
    const b = i < k.length ? k[i] : 0;
    ipad[i] = b ^ 0x36;
    opad[i] = b ^ 0x5c;
  }
  ipad.set(msg, 64);
  opad.set(sha256(ipad), 64);
  return sha256(opad);
}

// ------------------------------------------------------------------ scrypt

function pbkdf2Sha256(password, salt, iterations, dkLen) {
  const blocks = Math.ceil(dkLen / 32);
  const out = new Uint8Array(blocks * 32);
  for (let i = 1; i <= blocks; i++) {
    let u = hmacSha256(password, concat([salt, u32be(i)]));
    const t = u.slice();
    for (let j = 1; j < iterations; j++) {
      u = hmacSha256(password, u);
      for (let k = 0; k < 32; k++) t[k] ^= u[k];
    }
    out.set(t, (i - 1) * 32);
  }
  return out.subarray(0, dkLen);
}

function rotl(v, n) { return ((v << n) | (v >>> (32 - n))) >>> 0; }

function salsa208(input, inputOff, out, outOff, scratch) {
  const x = scratch;
  for (let i = 0; i < 16; i++) x[i] = input[inputOff + i];
  let a0 = x[0], a1 = x[1], a2 = x[2], a3 = x[3], a4 = x[4], a5 = x[5], a6 = x[6], a7 = x[7];
  let a8 = x[8], a9 = x[9], a10 = x[10], a11 = x[11], a12 = x[12], a13 = x[13], a14 = x[14], a15 = x[15];
  for (let i = 0; i < 8; i += 2) {
    a4 ^= rotl((a0 + a12) >>> 0, 7); a8 ^= rotl((a4 + a0) >>> 0, 9);
    a12 ^= rotl((a8 + a4) >>> 0, 13); a0 ^= rotl((a12 + a8) >>> 0, 18);
    a9 ^= rotl((a5 + a1) >>> 0, 7); a13 ^= rotl((a9 + a5) >>> 0, 9);
    a1 ^= rotl((a13 + a9) >>> 0, 13); a5 ^= rotl((a1 + a13) >>> 0, 18);
    a14 ^= rotl((a10 + a6) >>> 0, 7); a2 ^= rotl((a14 + a10) >>> 0, 9);
    a6 ^= rotl((a2 + a14) >>> 0, 13); a10 ^= rotl((a6 + a2) >>> 0, 18);
    a3 ^= rotl((a15 + a11) >>> 0, 7); a7 ^= rotl((a3 + a15) >>> 0, 9);
    a11 ^= rotl((a7 + a3) >>> 0, 13); a15 ^= rotl((a11 + a7) >>> 0, 18);
    a1 ^= rotl((a0 + a3) >>> 0, 7); a2 ^= rotl((a1 + a0) >>> 0, 9);
    a3 ^= rotl((a2 + a1) >>> 0, 13); a0 ^= rotl((a3 + a2) >>> 0, 18);
    a6 ^= rotl((a5 + a4) >>> 0, 7); a7 ^= rotl((a6 + a5) >>> 0, 9);
    a4 ^= rotl((a7 + a6) >>> 0, 13); a5 ^= rotl((a4 + a7) >>> 0, 18);
    a11 ^= rotl((a10 + a9) >>> 0, 7); a8 ^= rotl((a11 + a10) >>> 0, 9);
    a9 ^= rotl((a8 + a11) >>> 0, 13); a10 ^= rotl((a9 + a8) >>> 0, 18);
    a12 ^= rotl((a15 + a14) >>> 0, 7); a13 ^= rotl((a12 + a15) >>> 0, 9);
    a14 ^= rotl((a13 + a12) >>> 0, 13); a15 ^= rotl((a14 + a13) >>> 0, 18);
  }
  out[outOff] = (a0 + x[0]) >>> 0; out[outOff + 1] = (a1 + x[1]) >>> 0;
  out[outOff + 2] = (a2 + x[2]) >>> 0; out[outOff + 3] = (a3 + x[3]) >>> 0;
  out[outOff + 4] = (a4 + x[4]) >>> 0; out[outOff + 5] = (a5 + x[5]) >>> 0;
  out[outOff + 6] = (a6 + x[6]) >>> 0; out[outOff + 7] = (a7 + x[7]) >>> 0;
  out[outOff + 8] = (a8 + x[8]) >>> 0; out[outOff + 9] = (a9 + x[9]) >>> 0;
  out[outOff + 10] = (a10 + x[10]) >>> 0; out[outOff + 11] = (a11 + x[11]) >>> 0;
  out[outOff + 12] = (a12 + x[12]) >>> 0; out[outOff + 13] = (a13 + x[13]) >>> 0;
  out[outOff + 14] = (a14 + x[14]) >>> 0; out[outOff + 15] = (a15 + x[15]) >>> 0;
}

function blockMixSalsa8(X, Y, r, scratch, tmp) {
  const lastOff = (2 * r - 1) * 16;
  for (let k = 0; k < 16; k++) tmp[k] = X[lastOff + k];
  for (let i = 0; i < 2 * r; i++) {
    const off = i * 16;
    for (let k = 0; k < 16; k++) scratch[k] = X[off + k] ^ tmp[k];
    const dst = (i % 2 === 0 ? i / 2 : r + (i - 1) / 2) * 16;
    salsa208(scratch, 0, Y, dst, scratch);
    for (let k = 0; k < 16; k++) tmp[k] = Y[dst + k];
  }
}

function scrypt(password, salt, N, r, p, dkLen) {
  const blockSizeBytes = 128 * r;
  const words = blockSizeBytes / 4;
  const V = new Uint32Array(N * words);
  const X = new Uint32Array(words);
  const Y = new Uint32Array(words);
  const scratch = new Uint32Array(16);
  const tmp = new Uint32Array(16);
  const B = pbkdf2Sha256(password, salt, 1, p * blockSizeBytes);
  const bdv = new DataView(B.buffer, B.byteOffset, B.byteLength);

  for (let i = 0; i < p; i++) {
    const off = i * blockSizeBytes;
    for (let k = 0; k < words; k++) X[k] = bdv.getUint32(off + k * 4, true);
    for (let j = 0; j < N; j++) {
      V.set(X, j * words);
      blockMixSalsa8(X, Y, r, scratch, tmp);
      X.set(Y);
    }
    for (let j = 0; j < N; j++) {
      const idx = X[(2 * r - 1) * 16] % N;
      const base = idx * words;
      for (let k = 0; k < words; k++) Y[k] = X[k] ^ V[base + k];
      blockMixSalsa8(Y, X, r, scratch, tmp);
    }
    for (let k = 0; k < words; k++) bdv.setUint32(off + k * 4, X[k], true);
  }
  return pbkdf2Sha256(password, B, 1, dkLen);
}

// ------------------------------------------------------ 模板与字符类（照抄官方）

const CHARACTER_CLASSES = {
  V: 'AEIOU',
  C: 'BCDFGHJKLMNPQRSTVWXYZ',
  v: 'aeiou',
  c: 'bcdfghjklmnpqrstvwxyz',
  A: 'AEIOUBCDFGHJKLMNPQRSTVWXYZ',
  a: 'AEIOUaeiouBCDFGHJKLMNPQRSTVWXYZbcdfghjklmnpqrstvwxyz',
  n: '0123456789',
  o: "@&%?,=[]_:-+*$#!'^~;()/.",
  x: 'AEIOUaeiouBCDFGHJKLMNPQRSTVWXYZbcdfghjklmnpqrstvwxyz0123456789!@#$%^&*()',
  ' ': ' ',
};

// 顺序、条目数必须与官方 spectre_type_templates 完全一致（Long = 21 条）
const TEMPLATES = {
  maximum: ['anoxxxxxxxxxxxxxxxxx', 'axxxxxxxxxxxxxxxxxno'],
  long: [
    'CvcvnoCvcvCvcv', 'CvcvCvcvnoCvcv', 'CvcvCvcvCvcvno',
    'CvccnoCvcvCvcv', 'CvccCvcvnoCvcv', 'CvccCvcvCvcvno',
    'CvcvnoCvccCvcv', 'CvcvCvccnoCvcv', 'CvcvCvccCvcvno',
    'CvcvnoCvcvCvcc', 'CvcvCvcvnoCvcc', 'CvcvCvcvCvccno',
    'CvccnoCvccCvcv', 'CvccCvccnoCvcv', 'CvccCvccCvcvno',
    'CvcvnoCvccCvcc', 'CvcvCvccnoCvcc', 'CvcvCvccCvccno',
    'CvccnoCvcvCvcc', 'CvccCvcvnoCvcc', 'CvccCvcvCvccno',
  ],
  medium: ['CvcnoCvc', 'CvcCvcno'],
  short: ['Cvcn'],
  basic: ['aaanaaan', 'aannaaan', 'aaannaaa'],
  pin: ['nnnn'],
  name: ['cvccvcvcv'],
  phrase: ['cvcc cvc cvccvcv cvc', 'cvc cvccvcvcv cvcv', 'cv cvccv cvc cvcvccv'],
};

const TYPE_ALIASES = {
  x: 'maximum', max: 'maximum', maximum: 'maximum',
  l: 'long', long: 'long',
  m: 'medium', med: 'medium', medium: 'medium',
  s: 'short', short: 'short',
  b: 'basic', basic: 'basic',
  p: 'pin', pin: 'pin',
  n: 'name', name: 'name',
  ph: 'phrase', phrase: 'phrase',
};

// 类型编号 -> 名称（对应 SpectreResultType：16/17/18/19/20/21/30/31）
const TYPE_BY_CODE = {
  16: 'maximum', 17: 'long', 18: 'medium', 19: 'short',
  20: 'basic', 21: 'pin', 30: 'name', 31: 'phrase',
};

const PURPOSE_SCOPES = {
  authentication: 'com.lyndir.masterpassword',
  identification: 'com.lyndir.masterpassword.login',
  recovery: 'com.lyndir.masterpassword.answer',
};

const SCRYPT_N = 32768, SCRYPT_R = 8, SCRYPT_P = 2, USER_KEY_BYTES = 64;
const DEFAULT_VERSION = 3;
const VERSIONS = [0, 1, 2, 3];

/** 各版本差异集中在这里，其他地方不再分叉。 */
function versionSpec(algorithm) {
  const v = algorithm === undefined || algorithm === null || algorithm < 0 ? DEFAULT_VERSION : Number(algorithm);
  if (!VERSIONS.includes(v)) throw new Error('不支持的算法版本: ' + algorithm);
  return {
    version: v,
    // v1 的 bug 是「站点名/上下文按字符数计长」，v2 修掉了；v3 又把用户名也改成按字节计长。
    // 于是：v0/v1 用码点数，v2/v3 用 UTF-8 字节数。
    lengthOf: v >= 2
      ? (s) => utf8Bytes(s).length
      : (s) => utf8CharCount(s),
    // 用户名长度只有 v3 改成按字节：v0/v1/v2 用码点数。
    userNameLengthOf: v >= 3
      ? (s) => utf8Bytes(s).length
      : (s) => utf8CharCount(s),
    // v0 与 v1–v3 的差别：读到的单字节先被**符号扩展成 16 位**，再拿去取模。
    //
    // 依据不是猜的，是官方 CLI 二进制的 `-v -v` trace（spectre.app / v0 / long）：
    //   template: 59903 => CvcvCvcvCvccno
    //     - class: C, index:  3328 (0xD00)  => N
    //     - class: v, index: 58111 (0xE2FF) => e
    //     - class: c, index: 13824 (0x3600) => j
    //     - class: v, index: 50943 (0xC6FF) => o
    //     ...
    // 对照 siteKey 首字节 E9 0D E2 36 C6 94 88 DC 45 …：
    //   0xE9 → 0xE9FF = 59903；59903 % 21 = 11 → 模板 "CvcvCvcvCvccno" ✅
    //   0x0D → 0x0D00 =  3328； 3328 % 21 = 13 → 'N' ✅
    //   0xE2 → 0xE2FF = 58111；58111 %  5 =  1 → class v → 'e' ✅
    //   0x36 → 0x3600 = 13824；13824 % 21 = 12 → 'j' ✅
    //   0xC6 → 0xC6FF = 50943；50943 % 21 = 11 → 'o' ✅
    // 也就是 `(b << 8) | (b >= 0x80 ? 0xFF : 0x00)`：
    //   高字节 = 原字节，低字节 = 符号位全 1（负数）或全 0。
    // 这个读法在「模板索引」和「第 c 个字符索引（取 siteKey[c+1]）」两处一致。
    signed16: (b) => (b << 8) | (b >= 0x80 ? 0xFF : 0x00),
    byteIndex: (k, c) => {
      const b = k[c + 1];
      return v === 0 ? ((b << 8) | (b >= 0x80 ? 0xFF : 0x00)) : b;
    },
    templateIndex: (siteKey) => {
      const b = siteKey[0];
      return v === 0 ? ((b << 8) | (b >= 0x80 ? 0xFF : 0x00)) : b;
    },
  };
}

// ------------------------------------------------------------------ 主流程

function userKeySaltFor(userName, algorithm) {
  const spec = versionSpec(algorithm);
  return concat([
    utf8Bytes(PURPOSE_SCOPES.authentication),
    u32be(spec.userNameLengthOf(userName)),
    utf8Bytes(userName),
  ]);
}

/** 64 字节 userKey（scrypt 原始输出，不套哈希）。 */
function userKeyBytes(userName, userSecret, algorithm) {
  return scrypt(
    utf8Bytes(userSecret),
    userKeySaltFor(userName, algorithm),
    SCRYPT_N, SCRYPT_R, SCRYPT_P, USER_KEY_BYTES
  );
}

/** keyID = SHA-256(userKey)，即 Spectre App 里显示的那串指纹。 */
function keyIdOf(userKey) {
  return toHex(sha256(userKey));
}

function siteSaltFor(siteName, counter, purpose, keyContext, algorithm) {
  const spec = versionSpec(algorithm);
  const scope = PURPOSE_SCOPES[purpose || 'authentication'];
  if (!scope) throw new Error('未知用途: ' + purpose);
  const parts = [
    utf8Bytes(scope),
    u32be(spec.lengthOf(siteName)),
    utf8Bytes(siteName),
    u32be(counter >>> 0),
  ];
  if (keyContext !== undefined && keyContext !== null && keyContext !== '') {
    parts.push(u32be(spec.lengthOf(keyContext)), utf8Bytes(keyContext));
  }
  return concat(parts);
}

function siteKeyFor(userKey, siteName, counter, purpose, keyContext, algorithm) {
  return hmacSha256(userKey, siteSaltFor(siteName, counter, purpose, keyContext, algorithm));
}

function normalizeType(type) {
  const name = TYPE_ALIASES[String(type === undefined || type === null ? 'long' : type).toLowerCase()];
  if (!name) throw new Error('未知密码类型: ' + type);
  return name;
}

function typeNameFromCode(code) {
  const name = TYPE_BY_CODE[Number(code)];
  if (!name) throw new Error('未知密码类型编号: ' + code);
  return name;
}

/** 按版本的字节语义渲染模板。 */
function renderPassword(siteKey, template, algorithm) {
  const byteIndex = versionSpec(algorithm).byteIndex;
  let out = '';
  for (let c = 0; c < template.length; c++) {
    const chars = CHARACTER_CLASSES[template[c]];
    if (!chars) throw new Error('未知字符类: ' + template[c]);
    out += chars[byteIndex(siteKey, c) % chars.length];
  }
  return out;
}

function templateFor(type, siteKey, algorithm) {
  const name = normalizeType(type);
  const list = TEMPLATES[name];
  return list[versionSpec(algorithm).templateIndex(siteKey) % list.length];
}

/**
 * 生成站点密码。
 * @param {object} opts
 * @param {string} opts.userName
 * @param {string} [opts.userSecret]      主密码；给了 userKeyBytes 可省略
 * @param {Uint8Array} [opts.userKeyBytes] 已算好的 64 字节 userKey（省掉 ~0.6s scrypt）
 * @param {string} opts.siteName
 * @param {number} [opts.counter=1]        计数器，改它等于换一个密码
 * @param {string|number} [opts.type='long'] 模板类型（名称或官方编号）
 * @param {string} [opts.purpose='authentication']
 * @param {string} [opts.keyContext=null]
 * @param {number} [opts.algorithm=3]      v0/v1/v2/v3
 */
function generate(opts) {
  const o = opts || {};
  const { userName, userSecret, siteName } = o;
  const counter = o.counter === undefined || o.counter === null ? 1 : o.counter;
  const purpose = o.purpose || 'authentication';
  const keyContext = o.keyContext === undefined ? null : o.keyContext;
  const algorithm = o.algorithm;
  const type = typeof o.type === 'number' ? typeNameFromCode(o.type) : normalizeType(o.type);

  if (!userName) throw new Error('缺少用户名');
  if (!siteName) throw new Error('缺少站点名');

  const spec = versionSpec(algorithm);
  let uk = o.userKeyBytes;
  if (!uk) {
    if (!userSecret) throw new Error('缺少主密码');
    uk = userKeyBytes(userName, userSecret, spec.version);
  }
  const siteKey = siteKeyFor(uk, siteName, counter, purpose, keyContext, spec.version);
  const list = TEMPLATES[type];
  const template = list[spec.templateIndex(siteKey) % list.length];
  return {
    password: renderPassword(siteKey, template, spec.version),
    template,
    type,
    algorithm: spec.version,
    counter,
    siteKeyHex: toHex(siteKey),
    userKeyId: keyIdOf(uk),
  };
}

/** 一次算好 userKey，之后换站点/换类型不用再跑 scrypt。 */
function derive(userName, userSecret, algorithm) {
  const spec = versionSpec(algorithm);
  const uk = userKeyBytes(userName, userSecret, spec.version);
  return {
    algorithm: spec.version,
    userKeyBytes: uk,
    userKeyId: keyIdOf(uk),
    generate: (opts) => generate(Object.assign({}, opts, {
      userName, userKeyBytes: uk, algorithm: spec.version,
    })),
  };
}


// ---------------------------------------------------------------- exports
export { sha256 };
export { hmacSha256 };
export { scrypt };
export { pbkdf2Sha256 };
export { versionSpec };
export { userKeySaltFor };
export { userKeyBytes };
export { keyIdOf };
export { siteSaltFor };
export { siteKeyFor };
export { renderPassword };
export { templateFor };
export { normalizeType };
export { typeNameFromCode };
export { generate };
export { derive };
export { CHARACTER_CLASSES };
export { TEMPLATES };
export { TYPE_ALIASES };
export { TYPE_BY_CODE };
export { PURPOSE_SCOPES };
export { SCRYPT_N };
export { SCRYPT_R };
export { SCRYPT_P };
export { USER_KEY_BYTES };
export { VERSIONS };
export { DEFAULT_VERSION };
export { toHex };
export { fromHex };
export { utf8CharCount };
export { utf8Bytes };
export { concat };
export { u32be };
