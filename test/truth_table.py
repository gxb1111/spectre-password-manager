#!/usr/bin/env python3
# 用官方 C 参考实现遍历官方 XML 里的全部向量，产出「谁对谁错」真值表。
# 目的：判断 v0 那一组到底是我们实现的问题，还是 XML 向量本身就与当前 C 库不一致。
import os
import re
import subprocess
import sys

XML = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
    os.path.dirname(os.path.abspath(__file__)), 'spectre_tests.xml')
# 官方 C 参考实现的探测程序：自己编译一份，用环境变量指过来
PROBE = os.environ.get('SPECTRE_PROBE')
if not PROBE:
    sys.exit('请先用环境变量 SPECTRE_PROBE 指向官方 C 参考实现的探测程序，例如：'
             'SPECTRE_PROBE=/path/to/spectre_probe python3 test/truth_table.py')

TYPE_MAP = {
    'long': 'long', 'maximum': 'maximum', 'medium': 'medium', 'short': 'short',
    'basic': 'basic', 'pin': 'pin', 'name': 'name', 'phrase': 'phrase',
}
PURPOSE_MAP = {'authentication': 'a', 'identification': 'i', 'recovery': 'r'}

text = open(XML, encoding='utf-8').read()
cases = re.findall(r'<case\b([^>]*)>(.*?)</case>', text, re.S)

parsed = {}
for attrs, body in cases:
    cid = re.search(r'id="([^"]+)"', attrs)
    parent = re.search(r'parent="([^"]+)"', attrs)
    rec = {'id': cid.group(1) if cid else '?', 'parent': parent.group(1) if parent else None}
    for tag in ('algorithm', 'userName', 'userSecret', 'keyID', 'siteName',
                'siteCounter', 'resultType', 'keyPurpose', 'keyContext', 'result'):
        m = re.search(r'<%s>(.*?)</%s>' % (tag, tag), body, re.S)
        if m:
            rec[tag] = m.group(1)
    parsed[rec['id']] = rec


def resolve(cid):
    seen = set()
    chain = []
    cur = cid
    while cur and cur in parsed and cur not in seen:
        seen.add(cur)
        chain.append(parsed[cur])
        cur = parsed[cur]['parent']
    out = {}
    for rec in reversed(chain):
        for k, v in rec.items():
            if k not in ('id', 'parent'):
                out[k] = v
    return out


rows = []
for cid in parsed:
    eff = resolve(cid)
    if 'result' not in eff:
        continue
    alg = eff.get('algorithm', '3')
    if alg == '-1':
        continue
    user = eff.get('userName', 'Robert Lee Mitchell')
    secret = eff.get('userSecret', 'banana colored duckling')
    site = eff.get('siteName', 'spectre.app')
    counter = eff.get('siteCounter', '1')
    rtype = TYPE_MAP.get(eff.get('resultType', 'long').lower())
    ctx = eff.get('keyContext', '')
    if not rtype:
        continue
    args = [PROBE, alg, user, secret, site, counter, rtype]
    if ctx:
        args.append(ctx)
    try:
        p = subprocess.run(['wsl', '-d', 'Ubuntu-24.04', '--', 'bash', '-lc',
                            ' '.join("'%s'" % a.replace("'", "'\\''") for a in args)],
                           capture_output=True, text=True, timeout=180)
        m = re.search(r'^RESULT = (.+)$', p.stdout, re.M)
        cresult = m.group(1).strip() if m else '(no result)'
    except Exception as e:
        cresult = 'ERR %s' % e
    rows.append((cid, alg, eff['result'], cresult))

ok = sum(1 for _, _, want, got in rows if want == got)
print('向量总数: %d   C 库与 XML 一致: %d   不一致: %d' % (len(rows), ok, len(rows) - ok))
print()
by_ver = {}
for cid, alg, want, got in rows:
    by_ver.setdefault(alg, [0, 0])
    by_ver[alg][1] += 1
    if want == got:
        by_ver[alg][0] += 1
for alg in sorted(by_ver, key=lambda x: int(x)):
    a, b = by_ver[alg]
    print('  v%s: %d/%d 一致' % (alg, a, b))
print()
print('=== 不一致明细 ===')
for cid, alg, want, got in rows:
    if want != got:
        print('  v%s %-26s XML=%-20s C库=%s' % (alg, cid, want, got))
