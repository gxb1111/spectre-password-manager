// [ESM] 用 Spectre 官方测试向量（spectre_tests.xml）逐条验证本实现。
//
/*
 * 向量来源：官方 CLI 仓库的测试套件
 *   https://gitlab.com/spectre.app/cli/-/raw/main/spectre_tests.xml
 * 含 userName / userSecret / siteName / keyCounter / resultType / keyPurpose /
 * keyContext，以及期望 result 与 userKey 的 keyID，并靠 parent= 继承 default。
 *
 * 两个必须注意的点（都踩过）：
 *
 * 1) algorithm 写在 case 上（<algorithm>0..3</algorithm>），不解析它的话所有用例
 *    都会按默认 v3 计算 —— v0/v1/v2 的用例会大面积假失败。曾经的“XML 有坏数据”
 *    结论就是这么来的，实际是测试脚本自己的锅。
 * 2) resultType=Personal 不是确定性模板，而是「用 resultParam 加密/解密用户自存
 *    的个人密码」，依赖一份持久化的加密状态。浏览器扩展不持有、也不打算持有这种
 *    状态（见 README「已知限制」），所以这类用例只统计、不计入通过率。
 *
 * 用法:
 *   node test/vectors.test.js          汇总
 *   node test/vectors.test.js -v       打印全部失败明细
 */
import fs from 'node:fs';
import path from 'node:path';
const S = await import('../src/spectre.js');

const XML = fs.readFileSync(path.join(import.meta.dirname, 'spectre_tests.xml'), 'utf8');

// 极简解析：本文件结构固定为 <case id= parent=> ... <tag>值</tag> ... </case>
function parseCases(xml) {
  const cases = [];
  const re = /<case\b([^>]*)>([\s\S]*?)<\/case>/g;
  let m;
  while ((m = re.exec(xml))) {
    const attrs = {};
    for (const a of m[1].matchAll(/(\w+)="([^"]*)"/g)) attrs[a[1]] = a[2];
    const fields = {};
    for (const f of m[2].matchAll(/<([\w-]+)>([\s\S]*?)<\/\1>/g)) fields[f[1]] = f[2];
    cases.push({ id: attrs.id, parent: attrs.parent, fields });
  }
  return cases;
}

const raw = parseCases(XML);
const byId = new Map(raw.map((c) => [c.id, c]));

function resolve(c, seen = new Set()) {
  if (!c) return {};
  if (seen.has(c.id)) throw new Error('parent cycle at ' + c.id);
  seen.add(c.id);
  return Object.assign({}, resolve(byId.get(c.parent), seen), c.fields);
}

const PURPOSE_MAP = {
  authentication: 'authentication',
  identification: 'identification',
  recovery: 'recovery',
};

/** 解析出的 algorithm：XML 顶层 default 是 -1（= Current），逐级覆盖。 */
function algorithmOf(r) {
  const a = Number(r.algorithm);
  return Number.isFinite(a) && a >= 0 && a <= 3 ? a : 3;
}

// ── 1) 结果向量 ────────────────────────────────────────────────────────────
const results = [];
const skipped = [];
for (const c of raw) {
  const r = resolve(c);
  if (r.result === undefined || r.result === '') continue;

  const type = String(r.resultType || 'long').toLowerCase();
  if (type === 'personal') {
    skipped.push({ id: c.id, why: 'Personal 需要持久化加密状态，扩展不实现（见 README）' });
    continue;
  }
  if (!r.userName || !r.userSecret || !r.siteName) continue;

  const expected = r.result;
  let actual = null, err = null;
  try {
    actual = S.generate({
      userName: r.userName,
      userSecret: r.userSecret,
      siteName: r.siteName,
      counter: Number(r.keyCounter || 1),
      type,
      purpose: PURPOSE_MAP[String(r.keyPurpose || 'authentication').toLowerCase()],
      keyContext: r.keyContext === undefined ? null : r.keyContext,
      algorithm: algorithmOf(r),
    }).password;
  } catch (e) { err = e.message; }
  results.push({ id: c.id, expected, actual, err });
}

// ── 2) userKey keyID 向量 ─────────────────────────────────────────────────
// keyID = SHA-256(userKey)，而 userKey 的盐里用户名的「长度」编码随算法版本变
// （v0–v2 用码点数，v3 用字节数），所以同一个多字节用户名在不同版本下 keyID 不同。
// 官方 XML 里 v0_mb_userName / v3_mb_userName 给的就是两个不同的值。
const keyChecks = [];
for (const c of raw) {
  const r = resolve(c);
  if (!r.keyID || !r.userName || !r.userSecret) continue;
  if (r.keyID === '-1') continue; // default 用例的占位值
  let actual;
  try { actual = S.keyIdOf(S.userKeyBytes(r.userName, r.userSecret, algorithmOf(r))); }
  catch (e) { actual = 'ERR ' + e.message; }
  keyChecks.push({ id: c.id, expected: r.keyID, actual });
}

const failed = results.filter((r) => r.err || r.actual !== r.expected);
const keyFailed = keyChecks.filter((k) => k.actual !== k.expected);

console.log(`结果向量: ${results.length - failed.length} 通过 / ${failed.length} 失败  (共 ${results.length})`);
console.log(`keyID 向量: ${keyChecks.length - keyFailed.length} 通过 / ${keyFailed.length} 失败  (共 ${keyChecks.length})`);
if (skipped.length) console.log(`跳过 ${skipped.length} 条: ${skipped.map((s) => s.id).join(', ')}`);

if (failed.length || keyFailed.length) {
  const show = process.argv.includes('-v') ? 1000 : 12;
  console.log('\n失败明细:');
  for (const f of failed.slice(0, show)) console.log(`  ${f.id}\n    期望 ${f.expected}\n    实际 ${f.err || f.actual}`);
  for (const k of keyFailed.slice(0, show)) console.log(`  keyID ${k.id}\n    期望 ${k.expected}\n    实际 ${k.actual}`);
  const more = failed.length + keyFailed.length - show;
  if (!process.argv.includes('-v') && more > 0) console.log(`  ... 其余 ${more} 条用 -v 查看`);
  process.exit(1);
}
console.log('\n全部通过 ✅');
