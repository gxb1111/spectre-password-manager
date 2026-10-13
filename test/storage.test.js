/**
 * storage.test.js —— 状态层单测（node test/storage.test.js）
 *
 * 只测纯逻辑：归一化、收藏增删、分类改名/删除、最近站点的去重与容量。
 */

import assert from 'node:assert';
const S = await import('../src/storage.js');

let passed = 0, failed = 0;
const failures = [];

function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) {
    failed++; failures.push({ name, message: e.message });
    console.log('  FAIL ' + name + '\n         ' + e.message);
  }
}

async function testAsync(name, fn) {
  try { await fn(); passed++; console.log('  ok   ' + name); }
  catch (e) {
    failed++; failures.push({ name, message: e.message });
    console.log('  FAIL ' + name + '\n         ' + e.message);
  }
}

console.log('\n== normalizeSite ==');
test('URL 走 host（host 天生小写）、去 www、去端口', () => {
  assert.strictEqual(S.normalizeSite('https://www.GitHub.com:443/login?x=1'), 'github.com');
  assert.strictEqual(S.normalizeSite('github.com'), 'github.com');
  assert.strictEqual(S.normalizeSite('https://GitHub.com/'), 'github.com');
});
test('手输的站点名保留大小写', () => {
  // Spectre 的站点名区分大小写：CTF / ctf 是两套密码，绝不能在这里折叠
  assert.strictEqual(S.normalizeSite('CTF'), 'CTF');
  assert.strictEqual(S.normalizeSite('AI安全'), 'AI安全');
  assert.strictEqual(S.normalizeSite('U+'), 'U+');
  assert.strictEqual(S.normalizeSite('  GitHub.com/  '), 'GitHub.com');
  assert.strictEqual(S.normalizeSite('CTF.'), 'CTF');
});
test('裸域名 / 带路径 / 带用户信息都能吃', () => {
  assert.strictEqual(S.normalizeSite('mail.google.com/inbox'), 'mail.google.com');
  assert.strictEqual(S.normalizeSite('https://user:pw@example.com/x'), 'example.com');
});
test('空值安全', () => {
  assert.strictEqual(S.normalizeSite(''), '');
  assert.strictEqual(S.normalizeSite(null), '');
  assert.strictEqual(S.normalizeSite(undefined), '');
  assert.strictEqual(S.normalizeSite('   '), '');
});
test('siteLookupKey 折叠大小写，只管判重', () => {
  assert.strictEqual(S.siteLookupKey('CTF'), 'ctf');
  assert.strictEqual(S.siteLookupKey('https://WWW.GitHub.com/x'), 'github.com');
  assert.strictEqual(S.siteLookupKey('AI安全'), 'ai安全');
});

console.log('\n== baseDomain ==');
test('两段域名原样', () => assert.strictEqual(S.baseDomain('github.com'), 'github.com'));
test('子域折叠到 eTLD+1', () => {
  assert.strictEqual(S.baseDomain('mail.google.com'), 'google.com');
  assert.strictEqual(S.baseDomain('a.b.c.example.com'), 'example.com');
});
test('多段后缀不误伤', () => {
  assert.strictEqual(S.baseDomain('www.bbc.co.uk'), 'bbc.co.uk');
  assert.strictEqual(S.baseDomain('mail.sina.com.cn'), 'sina.com.cn');
});
test('IP 与单标签原样', () => {
  assert.strictEqual(S.baseDomain('127.0.0.1'), '127.0.0.1');
  assert.strictEqual(S.baseDomain('localhost'), 'localhost');
});

console.log('\n== 收藏 ==');
test('新增后可查到，字段被补齐', () => {
  let st = S.emptyState();
  st = S.addFavorite(st, { site: 'https://github.com/login', userName: '苏星豪', type: 'maximum' });
  assert.strictEqual(st.favorites.length, 1);
  assert.strictEqual(st.favorites[0].site, 'github.com');
  assert.strictEqual(st.favorites[0].category, '未分类');
  assert.strictEqual(st.favorites[0].algorithm, 3);
  assert.strictEqual(st.favorites[0].counter, 1);
  assert.ok(S.findFavorite(st, 'github.com'));
});
test('同站点重复收藏是覆盖不是追加', () => {
  let st = S.emptyState();
  st = S.addFavorite(st, { site: 'github.com', userName: 'a' });
  st = S.addFavorite(st, { site: 'https://www.github.com/', userName: 'b', type: 'pin' });
  assert.strictEqual(st.favorites.length, 1);
  assert.strictEqual(st.favorites[0].userName, 'b');
  assert.strictEqual(st.favorites[0].type, 'pin');
});
test('空站点名要报错', () => {
  assert.throws(() => S.addFavorite(S.emptyState(), { site: '   ' }), /站点名/);
});
test('删除只影响目标', () => {
  let st = S.emptyState();
  st = S.addFavorite(st, { site: 'a.com' });
  st = S.addFavorite(st, { site: 'b.com' });
  st = S.removeFavorite(st, 'https://a.com/x');
  assert.strictEqual(st.favorites.length, 1);
  assert.strictEqual(st.favorites[0].site, 'b.com');
  assert.strictEqual(S.removeFavorite(st, 'nope.com').favorites.length, 1);
});
test('不修改传入的 state（纯函数）', () => {
  const st = S.emptyState();
  const before = JSON.stringify(st);
  S.addFavorite(st, { site: 'x.com' });
  assert.strictEqual(JSON.stringify(st), before);
});

console.log('\n== 分类 ==');
test('新增分类去重', () => {
  let st = S.emptyState();
  st = S.addCategory(st, '工作');
  st = S.addCategory(st, '工作');
  st = S.addCategory(st, '  工作  ');
  assert.deepStrictEqual(st.categories, ['工作']);
});
test('空分类名报错', () => assert.throws(() => S.addCategory(S.emptyState(), '  '), /不能为空/));
test('改名会同步改掉收藏上的引用', () => {
  let st = S.emptyState();
  st = S.addFavorite(st, { site: 'a.com', category: '工作' });
  st = S.renameCategory(st, '工作', '公司');
  assert.deepStrictEqual(st.categories, ['公司']);
  assert.strictEqual(st.favorites[0].category, '公司');
});
test('改名撞已有分类不会产生重复项', () => {
  let st = S.emptyState();
  st = S.addCategory(st, '工作');
  st = S.addCategory(st, '公司');
  st = S.renameCategory(st, '工作', '公司');
  assert.deepStrictEqual(st.categories, ['公司']);
});
test('删分类把收藏退回未分类，不删收藏', () => {
  let st = S.emptyState();
  st = S.addFavorite(st, { site: 'a.com', category: '工作' });
  st = S.addFavorite(st, { site: 'b.com', category: '私事' });
  st = S.removeCategory(st, '工作');
  assert.deepStrictEqual(st.categories, ['私事']);
  assert.strictEqual(st.favorites.length, 2);
  assert.strictEqual(st.favorites[0].category, '未分类');
  assert.strictEqual(st.favorites[1].category, '私事');
});
test('groupByCategory 覆盖全部收藏且顺序稳定', () => {
  let st = S.emptyState();
  st = S.addFavorite(st, { site: 'a.com', category: '工作' });
  st = S.addFavorite(st, { site: 'b.com' });
  const groups = S.groupByCategory(st);
  const names = groups.map(g => g.category);
  assert.deepStrictEqual(names, ['工作', '未分类']);
  assert.strictEqual(groups[0].items[0].site, 'a.com');
});

console.log('\n== 最近站点 ==');
test('新站点排最前，重复站点被提到最前而不是重复出现', () => {
  let st = S.emptyState();
  st = S.pushRecent(st, { site: 'a.com', at: 1 });
  st = S.pushRecent(st, { site: 'b.com', at: 2 });
  st = S.pushRecent(st, { site: 'https://a.com/', at: 3 });
  assert.deepStrictEqual(st.recent.map(r => r.site), ['a.com', 'b.com']);
  assert.strictEqual(st.recent[0].at, 3);
});
test('超过容量截断', () => {
  let st = S.emptyState();
  for (let i = 0; i < S.RECENT_LIMIT + 10; i++) st = S.pushRecent(st, { site: 's' + i + '.com', at: i });
  assert.strictEqual(st.recent.length, S.RECENT_LIMIT);
  assert.strictEqual(st.recent[0].site, 's' + (S.RECENT_LIMIT + 9) + '.com');
});
test('空站点不入最近', () => {
  const st = S.pushRecent(S.emptyState(), { site: '   ' });
  assert.strictEqual(st.recent.length, 0);
});
test('clearRecent 清空', () => {
  let st = S.pushRecent(S.emptyState(), { site: 'a.com' });
  assert.strictEqual(S.clearRecent(st).recent.length, 0);
});

console.log('\n== migrate ==');
test('垃圾输入回退到空状态', () => {
  assert.deepStrictEqual(S.migrate(null).favorites, []);
  assert.deepStrictEqual(S.migrate('nonsense').favorites, []);
  assert.deepStrictEqual(S.migrate(42).favorites, []);
});
test('缺字段的收藏被补齐、重复被合并', () => {
  const st = S.migrate({
    favorites: [
      { site: 'https://www.a.com/x' },
      { site: 'a.com', userName: 'u', type: 'pin' },
      { nonsense: true },
      null,
    ],
  });
  assert.strictEqual(st.favorites.length, 1);
  assert.strictEqual(st.favorites[0].site, 'a.com');
  assert.strictEqual(st.favorites[0].type, 'pin');
});
test('收藏里出现的新分类被补进 categories', () => {
  const st = S.migrate({ favorites: [{ site: 'a.com', category: '工作' }] });
  assert.ok(st.categories.indexOf('工作') !== -1);
});
test('recent 去重并按时间倒序', () => {
  const st = S.migrate({ recent: [{ site: 'a.com', at: 5 }, { site: 'b.com', at: 9 }, { site: 'a.com', at: 1 }] });
  assert.deepStrictEqual(st.recent.map(r => r.site), ['b.com', 'a.com']);
});
test('settings 与默认值合并', () => {
  const st = S.migrate({ settings: { defaultType: 'maximum' } });
  assert.strictEqual(st.settings.defaultType, 'maximum');
  assert.strictEqual(st.settings.algorithm, 3);
  assert.strictEqual(st.settings.autoFill, true);
});

console.log('\n== 导入 / 迁移 ==');
test('旧版 webui 格式：template/user/categories 对象都认', () => {
  const legacy = {
    favorites: [
      { site: 'AI安全', template: 'long', category: '默认', user: '苏星豪' },
      { site: '补天漏洞', template: 'maximum', category: '默认', user: '苏星豪' },
      { site: '微软', template: 'pin', category: '默认', user: '苏星豪' },
    ],
    categories: { '默认': [] },
    recent: [{ site: 'skyeye', template: 'maximum' }],
  };
  const r = S.importMetadata(S.emptyState(), legacy);
  assert.strictEqual(r.stats.source, 'legacy-webui');
  assert.strictEqual(r.stats.total, 3);
  assert.strictEqual(r.stats.added, 3);
  assert.strictEqual(r.stats.updated, 0);
  assert.strictEqual(r.state.favorites.length, 3);
  // 大小写原样保留
  assert.strictEqual(r.state.favorites[0].site, 'AI安全');
  // template → type，user → userName
  assert.strictEqual(r.state.favorites[0].type, 'long');
  assert.strictEqual(r.state.favorites[1].type, 'maximum');
  assert.strictEqual(r.state.favorites[2].type, 'pin');
  assert.strictEqual(r.state.favorites[0].userName, '苏星豪');
  // 旧版没带 -a ⇒ v3；counter 恒为 1
  assert.strictEqual(r.state.favorites[0].algorithm, 3);
  assert.strictEqual(r.state.favorites[0].counter, 1);
  assert.ok(r.state.categories.indexOf('默认') !== -1);
  // 没设过姓名时顺手补上
  assert.strictEqual(r.state.settings.userName, '苏星豪');
  assert.strictEqual(r.state.recent[0].site, 'skyeye');
});

test('插件导出格式识别为 spectre-plugin，settings 被合并', () => {
  const r = S.importMetadata(S.emptyState(), {
    exportedAt: '2026-01-01T00:00:00Z',
    favorites: [{ site: 'gitee', userName: 'u', type: 'medium', counter: 2, algorithm: 2, category: '码' }],
    categories: ['码'],
    settings: { defaultType: 'pin', algorithm: 1, userName: '张三' },
  });
  assert.strictEqual(r.stats.source, 'spectre-plugin');
  assert.strictEqual(r.state.favorites[0].counter, 2);
  assert.strictEqual(r.state.favorites[0].algorithm, 2);
  assert.strictEqual(r.state.settings.defaultType, 'pin');
  assert.strictEqual(r.state.settings.algorithm, 1);
  assert.strictEqual(r.state.settings.userName, '张三');
});

test('重复导入不产生副本，同站点以导入的为准', () => {
  const legacy = { favorites: [{ site: 'CTF', template: 'long', user: 'a' }] };
  const once = S.importMetadata(S.emptyState(), legacy).state;
  const twice = S.importMetadata(once, { favorites: [{ site: 'CTF', template: 'maximum', user: 'b' }] });
  assert.strictEqual(twice.state.favorites.length, 1);
  assert.strictEqual(twice.stats.updated, 1);
  assert.strictEqual(twice.state.favorites[0].type, 'maximum');
  assert.strictEqual(twice.state.favorites[0].userName, 'b');
});

test('大小写不同的站点视为同一个（判重不分大小写）', () => {
  const a = S.importMetadata(S.emptyState(), { favorites: [{ site: 'ctf', template: 'long' }] }).state;
  const b = S.importMetadata(a, { favorites: [{ site: 'CTF', template: 'pin' }] }).state;
  assert.strictEqual(b.favorites.length, 1);
  assert.strictEqual(b.favorites[0].site, 'CTF');   // 后导入的写法胜出
  assert.strictEqual(b.favorites[0].type, 'pin');
});

test('未知模板回退 long，坏记录跳过，非法 JSON 抛错', () => {
  const r = S.importMetadata(S.emptyState(), {
    favorites: [{ site: 'x.com', template: 'personal' }, { nonsense: 1 }, null, { site: '' }],
  });
  assert.strictEqual(r.stats.total, 1);
  assert.strictEqual(r.state.favorites[0].type, 'long');
  assert.throws(() => S.importMetadata(S.emptyState(), '{ 不是 json'), SyntaxError);
  assert.throws(() => S.importMetadata(S.emptyState(), '42'), /JSON/);
});

test('字符串载荷与裸数组载荷都能吃', () => {
  const viaString = S.importMetadata(S.emptyState(), '{"favorites":[{"site":"a.com"}]}');
  assert.strictEqual(viaString.stats.total, 1);
  const viaArray = S.importMetadata(S.emptyState(), [{ site: 'b.com', template: 'medium' }]);
  assert.strictEqual(viaArray.state.favorites[0].type, 'medium');
});

console.log('\n== 存储后端 ==');
(async () => {
  await testAsync('内存后端可读写、migrate 生效', async () => {
    const store = S.createStore(S.memoryBackend({ favorites: [{ site: 'a.com' }] }));
    assert.strictEqual(store.backend, 'memory');
    const st = await store.load();
    assert.strictEqual(st.favorites[0].site, 'a.com');
    await store.update(s => S.addFavorite(s, { site: 'b.com' }));
    const reloaded = await store.load();
    assert.strictEqual(reloaded.favorites.length, 2);
  });

  console.log('\n' + '='.repeat(52));
  console.log('通过 ' + passed + ' / 失败 ' + failed);
  if (failed) {
    failures.forEach(f => console.log('  - ' + f.name + ': ' + f.message));
    process.exit(1);
  }
  console.log('全部通过 ✅');
})();
