// [ESM] 顶层 await —— spectre.js 已改为原生 ES module，require() 拿不到具名导出
/*
 * 对抗性验证：拿「官方 CLI 二进制实际输出」（test/generated_vectors.json）逐条比对本实现。
 *
 * 为什么不用 test/spectre_tests.xml 当唯一裁判：
 *   那份 XML 的 v0 组自相矛盾 —— 它的 <case id="v0"> 期望 "Feji5@ReduWosh"，
 *   而那是站点名 "masterpasswordapp.com" 的输出，XML 继承的 default 里却是 "spectre.app"。
 *   实测官方二进制：spectre.app/v0     -> NejoKecuMocx6@
 *                 masterpasswordapp.com/v0 -> Feji5@ReduWosh
 *   即 XML 的 v0 期望值被旧站点名污染过。二进制是最终裁判。
 *
 * 用法: node test/verify_vectors.js [-v]
 */
import fs from 'node:fs';
import path from 'node:path';
const S = await import('../src/spectre.js');

const FILE = path.join(import.meta.dirname, 'generated_vectors.json');
const vectors = JSON.parse(fs.readFileSync(FILE, 'utf8'));

const rows = [];
for (const v of vectors) {
  let actual = null, err = null;
  try {
    actual = S.generate({
      userName: 'Robert Lee Mitchell',
      userSecret: 'banana colored duckling',
      siteName: v.siteName,
      counter: v.counter,
      type: v.type,
      purpose: v.purpose === 'a' ? 'authentication' : v.purpose === 'i' ? 'identification' : 'recovery',
      keyContext: v.context,
      algorithm: v.algorithm,
    }).password;
  } catch (e) { err = e.message; }
  rows.push({ ...v, actual, err, ok: !err && actual === v.result });
}

const bad = rows.filter((r) => !r.ok);
const byAlg = {};
for (const r of rows) {
  byAlg[r.algorithm] ??= { n: 0, bad: 0 };
  byAlg[r.algorithm].n++;
  if (!r.ok) byAlg[r.algorithm].bad++;
}

console.log(`官方二进制向量: ${rows.length - bad.length} 通过 / ${bad.length} 失败  (共 ${rows.length})`);
for (const a of Object.keys(byAlg).sort()) {
  const s = byAlg[a];
  console.log(`  v${a}: ${s.n - s.bad}/${s.n}${s.bad ? '  ❌' : '  ✅'}`);
}

if (bad.length) {
  const show = process.argv.includes('-v') ? 999 : 15;
  console.log('\n失败明细:');
  for (const b of bad.slice(0, show)) {
    console.log(`  v${b.algorithm} ${b.type} c=${b.counter} p=${b.purpose} ctx=${b.context} site=${b.siteName}`);
    console.log(`    期望 ${b.result}`);
    console.log(`    实际 ${b.err || b.actual}`);
  }
  if (bad.length > show) console.log(`  ... 其余 ${bad.length - show} 条用 -v 查看`);
  process.exit(1);
}
console.log('\n全部与官方二进制一致 ✅');
