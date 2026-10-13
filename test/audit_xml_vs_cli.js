// [ESM] 用官方 CLI 二进制逐条复判 spectre_tests.xml 里的每个 case。
//
// 目的：搞清楚「我们实现 ≠ XML 期望」的条目，到底是
//   (a) 我们错了（那就必须修），还是
//   (b) XML 自己的期望值就是坏的。
//
// 做法：对每个 case，用同样的输入去问官方 CLI 二进制，得到 oracle。
//   oracle == XML 期望 → XML 这条可信
//   oracle != XML 期望 → XML 这条是坏数据，记进 test/xml_bad_vectors.json
//
// 实现上刻意不逐条 spawn：把全部用例生成一个 bash 脚本一次跑完。
// 原因是经 Windows→wsl.exe 传含 emoji / 引号的参数会被吞掉（踩过），
// 落盘的脚本是 UTF-8，不受命令行编码影响。
//
// 用法: node test/audit_xml_vs_cli.js
//       node test/audit_xml_vs_cli.js --keep    保留生成的脚本以便查看

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const BIN = process.env.SPECTRE_BIN || '/home/gxb/spectre-webui/spectre';
const DIR = import.meta.dirname;
const WIN_SH = path.join(DIR, '_audit_cases.sh');
const XML = fs.readFileSync(path.join(DIR, 'spectre_tests.xml'), 'utf8');

// ── 解析（含 parent 继承） ─────────────────────────────────────────────────
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

// bash 单引号安全包裹：' → '\''，其余原样（UTF-8 安全）
const q = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";

// ── 收集全部可用用例 ───────────────────────────────────────────────────────
const cases = [];
for (const c of raw) {
  const r = resolve(c);
  if (!r.result || r.result === '') continue;
  if (!r.userName || !r.userSecret || !r.siteName || !r.resultType) continue;
  cases.push({
    id: c.id,
    // XML 没写 algorithm 时语义等价于继承到的 default（3）
    algorithm: r.algorithm !== undefined ? Number(r.algorithm) : 3,
    userName: r.userName,
    userSecret: r.userSecret,
    siteName: r.siteName,
    keyCounter: Number(r.keyCounter || 1),
    resultType: String(r.resultType).toLowerCase(),
    keyPurpose: r.keyPurpose,
    keyContext: r.keyContext,
    expected: r.result,
  });
}

// ── 生成 bash 脚本：每个用例一个全新 HOME（CLI 的 .spectre.d 与算法版本绑定） ──
const lines = [
  '#!/usr/bin/env bash',
  '# 由 test/audit_xml_vs_cli.js 生成 —— 逐条问官方 CLI，得到权威 oracle',
  'set -u',
  `BIN=${q(BIN)}`,
  'ROOT=/tmp/spectre-oracle',
  'rm -rf "$ROOT"; mkdir -p "$ROOT"',
  'n=0',
  'while IFS= read -r line; do',
  '  case "$line" in ""|"#"*) continue;; esac',
  '  IFS="|" read -r ID ALG USER SECRET SITE COUNTER TYPE PURPOSE CTX <<< "$line"',
  '  n=$((n+1))',
  '  h="$ROOT/h$n"; mkdir -p "$h"',
  '  printf %s "$SECRET" > "$h/sec.txt"',
  '  args=( -a "$ALG" -u "$USER" -s 3 -t "$TYPE" -f none -c "$COUNTER" )',
  '  case "$PURPOSE" in',
  '    Identification*) args+=( -p i );;',
  '    Recovery*)       args+=( -p r );;',
  '  esac',
  '  [ -n "$CTX" ] && args+=( -C "$CTX" )',
  '  args+=( "$SITE" )',
  '  out=$(HOME="$h" SPECTRE_USERNAME="$USER" "$BIN" "${args[@]}" 3< "$h/sec.txt" 2>/dev/null)',
  '  printf "ORACLE\\t%s\\t%s\\n" "$ID" "$out"',
  'done <<\'__CASES__\'',
];
for (const c of cases) {
  // 用 | 作字段分隔（XML 里这些值不含 |）
  const f = [c.id, c.algorithm, c.userName, c.userSecret, c.siteName,
    c.keyCounter, c.resultType, c.keyPurpose || '', c.keyContext || ''];
  if (f.some((x) => String(x).includes('|'))) throw new Error('字段含 | 分隔符: ' + c.id);
  if (f.some((x) => /[\r\n]/.test(String(x)))) throw new Error('字段含换行: ' + c.id);
  lines.push(f.join('|'));
}
lines.push('__CASES__', 'rm -rf "$ROOT"');

fs.writeFileSync(WIN_SH, lines.join('\n') + '\n', 'utf8');

let stdout = '';
try {
  stdout = execFileSync(
    'wsl.exe',
    ['-d', 'Ubuntu-24.04', '--', 'bash', '/mnt/d/desktop/1/dsh/spectre-plugin/test/_audit_cases.sh'],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 900000, stdio: ['ignore', 'pipe', 'pipe'] });
} catch (e) {
  if (e.stdout) stdout = e.stdout;
  process.stderr.write('CLI 批次退出码非零（可能是个别用例失败）：' + e.message.split('\n')[0] + '\n');
}

// ── 比对 ───────────────────────────────────────────────────────────────────
const oracleById = new Map();
for (const ln of stdout.split(/\r?\n/)) {
  if (!ln.startsWith('ORACLE\t')) continue;
  const [, id, ...rest] = ln.split('\t');
  oracleById.set(id, rest.join('\t').trim());
}

const rows = cases.map((c) => {
  const oracle = oracleById.get(c.id) || '__MISSING__';
  return { id: c.id, algorithm: c.algorithm, expected: c.expected, oracle, agrees: oracle === c.expected };
});

const xmlBad = rows.filter((r) => !r.agrees);
console.log(`共复判 ${rows.length} 条`);
console.log(`官方 CLI 与 XML 期望一致: ${rows.length - xmlBad.length}`);
console.log(`官方 CLI 与 XML 期望不一致: ${xmlBad.length}`);
console.log();

if (xmlBad.length) {
  console.log('=== XML 坏数据明细（cli = 官方CLI实测）===');
  for (const r of xmlBad) {
    console.log(`  ${r.id.padEnd(36)} alg=${r.algorithm}  xml=${JSON.stringify(r.expected).padEnd(22)} cli=${JSON.stringify(r.oracle)}`);
  }
  fs.writeFileSync(path.join(DIR, 'xml_bad_vectors.json'),
    JSON.stringify(xmlBad.map((r) => ({ id: r.id, algorithm: r.algorithm, xml: r.expected, cli: r.oracle })), null, 2), 'utf8');
  console.log('\n已写入 test/xml_bad_vectors.json');
} else {
  console.log('XML 与官方 CLI 完全一致 —— 没有坏数据。');
}

if (!process.argv.includes('--keep')) fs.rmSync(WIN_SH, { force: true });
