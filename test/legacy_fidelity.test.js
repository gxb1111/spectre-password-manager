/**
 * legacy_fidelity.test.js —— 迁移保真度回归测试
 *
 * 回答一个具体问题：把旧版桌面 WebUI 的收藏搬进这个插件之后，
 * **同一个姓名 + 同一个主密钥，插件推出的密码和旧版一致吗？**
 *
 * 裁判是官方 CLI 二进制本身（`/home/gxb/spectre-webui/spectre`）：
 * test/fixtures/legacy_oracle.json 里那些密码就是它跑出来的，不是我们编的。
 * 生成脚本：D:\desktop\1\dsh\legacy_fidelity_oracle.sh
 *
 * 这个测试盯的是两件很容易悄悄坏掉的事：
 *   1. 站点名的大小写不能在迁移/归一过程中被折叠
 *      （`AI安全` / `CTF` / `U+` 一旦变成小写，密码就全错）
 *   2. 旧版的 `template` → 插件的 `type`、算法默认 v3、counter 默认 1 都要对
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const S = await import('../src/spectre.js');
const Store = await import('../src/storage.js');

const HERE = import.meta.dirname;
const LEGACY = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'spectre_data.legacy.json'), 'utf8'));
const ORACLE = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'legacy_oracle.json'), 'utf8'));

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; failures.push({ name, message: e.message }); console.log('  FAIL ' + name + '\n         ' + e.message); }
}

console.log('\n== 迁移：旧版 spectre_data.json → 插件 state ==');

const { state, stats } = Store.importMetadata(Store.emptyState(), LEGACY);

test('16 条收藏全部搬进来（含那条 site="1" 的测试垃圾）', () => {
  assert.strictEqual(stats.source, 'legacy-webui');
  assert.strictEqual(stats.total, 16);
  assert.strictEqual(stats.added, 16);
  assert.strictEqual(state.favorites.length, 16);
});

test('站点名逐字符原样保留（大小写没被折叠）', () => {
  const sites = state.favorites.map(f => f.site);
  for (const s of ['AI安全', 'CTF', 'U+', '普通话', '西北民族大学']) {
    assert.ok(sites.includes(s), '丢了站点 ' + s + '；实际：' + sites.join(' / '));
  }
  assert.ok(!sites.includes('ai安全'), '站点名被错误地小写化了');
  assert.ok(!sites.includes('ctf'), '站点名被错误地小写化了');
});

test('template 映射成 type，user 映射成 userName', () => {
  const bySite = Object.fromEntries(state.favorites.map(f => [f.site, f]));
  assert.strictEqual(bySite['补天漏洞'].type, 'maximum');
  assert.strictEqual(bySite['微软'].type, 'pin');
  assert.strictEqual(bySite['远程'].type, 'basic');
  assert.strictEqual(bySite['攻防世界'].type, 'medium');
  assert.strictEqual(bySite['普通话'].type, 'long');
  assert.strictEqual(bySite['补天漏洞'].userName, '苏星豪');
});

test('旧版无 -a ⇒ 算法 v3；counter 恒为 1', () => {
  for (const f of state.favorites) {
    assert.strictEqual(f.algorithm, 3, f.site + ' 的算法不是 v3');
    assert.strictEqual(f.counter, 1, f.site + ' 的 counter 不是 1');
  }
});

test('分类结构与最近记录被带过来', () => {
  assert.ok(state.categories.includes('默认'));
  assert.ok(state.categories.includes('1'));
  const recent = state.recent.map(r => r.site);
  assert.ok(recent.includes('skyeye'));
  assert.ok(recent.includes('补天'));
});

test('姓名「苏星豪」被顺手写进 settings（省得再打一遍）', () => {
  assert.strictEqual(state.settings.userName, '苏星豪');
});

console.log('\n== 保真度：插件 vs 官方 CLI 二进制（逐条）==');

for (const c of ORACLE.cases) {
  test(c.site + ' / ' + c.type + ' → ' + c.password, () => {
    const fav = state.favorites.find(f => f.site === c.site);
    assert.ok(fav, '迁移后没有这个站点：' + c.site);
    const got = S.generate({
      userName: ORACLE.userName,
      userSecret: ORACLE.userSecret,
      siteName: fav.site,          // ← 用的是迁移后的站点名，不是 oracle 里的
      counter: fav.counter,
      type: fav.type,
      algorithm: fav.algorithm,
    }).password;
    assert.strictEqual(got, c.password,
      '插件算出 ' + got + '，官方二进制是 ' + c.password);
  });
}

console.log('\n== 反面对照：如果站点名被小写会怎样（证明这道防线不是摆设）==');
test('小写化 AI安全 会推出完全不同的密码', () => {
  const good = S.generate({
    userName: ORACLE.userName, userSecret: ORACLE.userSecret,
    siteName: 'AI安全', type: 'long', algorithm: 3,
  }).password;
  const bad = S.generate({
    userName: ORACLE.userName, userSecret: ORACLE.userSecret,
    siteName: 'ai安全', type: 'long', algorithm: 3,
  }).password;
  assert.strictEqual(good, 'RigfReku7?Bomt');
  assert.notStrictEqual(good, bad, '大小写居然没影响？那说明整条链路对不上');
});

console.log('\n' + '='.repeat(52));
console.log('通过 ' + passed + ' / 失败 ' + failed);
if (failed) {
  failures.forEach(f => console.log('  - ' + f.name + ': ' + f.message));
  process.exit(1);
}
console.log('全部通过 ✅');
