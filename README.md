# Spectre 密码管理器 · 浏览器扩展

把一台 Windows 桌面上的「密码启动.bat」——背后是一个跑在 WSL 里的 Spectre / Master Password 密码管理器——重做成了一个 Manifest V3 浏览器扩展。

主密钥只在内存里，**从不落盘、从不上网**；密码由「主密钥 + 站点名」实时推导，想换密码就换站点名或计数器，不用记、不用同步。

---

## 这是什么

原来的东西是一个本地网页：一个 Python 脚本（`server.py`）用 `pexpect` 去驱动 Spectre 官方 CLI 二进制，每生成一次密码就 `rm -rf ~/.spectre.d` 清一次状态，生成的密码吐回网页让你复制。

这个扩展把中间的 Python 和命令行全扔了——**算法用纯 JavaScript 重写**，直接跑在浏览器里：

- 不需要装 Python、不需要 WSL、不需要本地服务进程；
- 不需要联网（扩展本身零网络请求）；
- 没有「生成完还得去复制粘贴」这一步，可以直接填进当前页面。

算法实现与官方二进制逐条对过账，见下面的「正确性验证」。

## 算法

这就是 [Spectre](https://spectre.app)（早期叫 Master Password）的确定性口令推导，spec 与参考实现见 [spectre.app/spectre-algorithm.pdf](https://spectre.app/spectre-algorithm.pdf)。

```
userKeySalt = "com.lyndir.masterpassword" ‖ uint32BE(len(userName)) ‖ userName
userKey     = scrypt(userSecret, userKeySalt, N=32768, r=8, p=2, dkLen=64)     ← 64 字节原样使用
keyID       = SHA-256(userKey)                                                ← 只是指纹，不参与派生

siteSalt    = scope(purpose) ‖ uint32BE(len(siteName)) ‖ siteName ‖ uint32BE(counter)
              ‖ uint32BE(len(keyContext)) ‖ keyContext
siteKey     = HMAC-SHA256(userKey, siteSalt)
password    = 按模板渲染(siteKey)                                              ← siteKey[0] 选模板，siteKey[i+1] 选字符
```

`scope` 按用途分三种：

| 用途 | scope |
|---|---|
| 认证（普通站点密码） | `com.lyndir.masterpassword` |
| 识别（登录名） | `com.lyndir.masterpassword.login` |
| 恢复（安全问题答案） | `com.lyndir.masterpassword.answer` |

### 四个版本的差别（不是可有可无的兼容代码）

官方四种算法版本都实现了。v0–v3 的差别藏在两个地方——**长度按字符数还是字节数**，以及 **v0 的索引换算**：

| 版本 | 用户名长度按 | 站点名/上下文长度按 | 单字节索引 |
|---|---|---|---|
| v0 | 码点数 | 码点数 | `(b << 8) \| (b >= 0x80 ? 0xFF : 0x00)` |
| v1 | 码点数 | 码点数 | 直取单字节 |
| v2 | 码点数 | UTF-8 字节数 | 直取单字节 |
| v3 | UTF-8 字节数 | UTF-8 字节数 | 直取单字节 |

v0 那个怪式子不是瞎猜的：官方 C 里 `spectre_uint16()` 把 `(uint16_t)b` 按大端写成 `[0, b]` 两个字节，再按小端 `uint16_t` 读回来，等于 `b << 8`；而读的是**有符号**单字节，所以负数的高字节补 `0xFF`。这一条是从官方 `-v -v` 的 trace 里对上号的（`0xE9 → 0xE9FF = 59903`，`59903 % 21 = 11` → 模板 `CvcvCvcvCvccno`）。

### 字符集与模板

```
V = AEIOU                              C = BCDFGHJKLMNPQRSTVWXYZ
v = aeiou                              c = bcdfghjklmnpqrstvwxyz
A = AEIOU + 大写辅音                    a = A + a
n = 0123456789                         o = @&%?,=[]_:-+*$#!'^~;()/.
x = a + 数字 + !@#$%^&*()
```

`long` 有 **21** 个模板（不是 20），`maximum` 2 个，`medium` 2 个，`basic` 3 个，`phrase` 3 个，`short`/`pin`/`name` 各 1 个。模板顺序和条数必须与官方逐字一致，因为取的是 `idx % count`——少一条、错一位，选中的模板就全变了。

## 正确性验证

算法不是「看着像」，是拿官方二进制对账过的。

**官方 CLI 二进制生成的基准向量**（`test/generated_vectors.json`，68 条）：

```
官方二进制向量: 68 通过 / 0 失败  (共 68)
  v0: 17/17  ✅   v1: 17/17  ✅   v2: 17/17  ✅   v3: 17/17  ✅
```

覆盖 4 个版本 × 8 种密码类型（maximum / long / medium / short / basic / pin / name / phrase）、counter ∈ {1, 2, 256, 65536, 4294967295}、三种用途、三个站点名（含 `masterpasswordapp.com` 这种长站点）。

**官方测试套件**（`test/spectre_tests.xml`，源自官方 CLI 仓库）：

```
结果向量: 215 通过 / 0 失败  (共 215)
keyID 向量: 240 通过 / 0 失败  (共 240)
跳过 24 条: *_type_personal*（见「已知限制」）
```

跑法：

```bash
node test/verify_vectors.js      # 68 条官方二进制向量
node test/vectors.test.js        # 官方 XML 测试套件（215 结果 + 240 keyID）
node test/storage.test.js        # 状态层单测（28 项）
node test/browser_e2e.js         # 真 Chrome 端到端
node test/audit_xml_vs_cli.js    # 用官方 CLI 复判 XML 每一条（需 WSL 里有官方二进制）
```

浏览器端到端那条会用 `--load-extension` 起一个真的 headless Chrome，验证插件被加载、popup 页面渲染、在扩展上下文里跑完 68 条向量、并且真的走一遍 worker 的 `derive → generate`。

同一套断言可以直接换浏览器跑（脚本内不依赖 Chrome 专有行为）：

```powershell
# 在 Edge 上跑（端口可配，好和 Chrome 并行）
$env:SPECTRE_CHROME = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$env:SPECTRE_PORT = "9344"
node test/browser_e2e.js
```

`SPECTRE_CHROME` 指到哪个浏览器二进制就跑哪个；`SPECTRE_PORT` 用来避开默认的 9333。

### 踩过的两个坑（留档，免得别人再撞）

**（1）`algorithm` 必须从 case 里解析出来。** 官方 XML 把算法版本写在 case 上（`<algorithm>0</algorithm>`），靠 `parent=` 逐级继承。如果解析时只看 `resultType` 不看 `algorithm`，所有用例都会按默认的 v3 计算——v0/v1/v2 的用例会大面积失败，看上去就像「XML 里有几十条坏向量」，其实只是测试脚本自己漏了一个字段。本仓库一度得出过这个错误结论，后来用 `test/audit_xml_vs_cli.js` 拿官方 CLI 逐条复判才纠正过来：**239 条里 215 条与官方 CLI 逐字一致，剩下 24 条全是 `type_personal`**（下一节）。

**（2）多字节用户名的 keyID 是随版本变的。** `keyID = SHA-256(userKey)`，而 userKey 的盐里用户名的**长度**编码随版本变（v0–v2 用码点数，v3 用字节数）。所以用户名 `⛄` 在 v3 下 keyID 是 `1717AA1F…`、在 v0 下是 `4D5851D0…`——两个值都对，不是数据矛盾。

## 为什么没有 `personal` 类型

`resultType=Personal` 和其他八种**根本不是一类东西**：

- 其他八种是**确定性推导**：同一个（主密钥，站点名）永远得到同一个密码，实现里不需要任何状态。
- `Personal` 是**加密/解密用户自己存的密码**：官方 CLI 用它把用户随手编的密码用派生密钥加密后存进 `~/.spectre.d`，需要时再解出来（`save with -P pw`）。它要一份**持久化的加密状态**才有了意义。

官方 CLI 对这个类型的原话是 `Missing encrypted state. Couldn't generate result.`——没有那份状态文件，它什么也算不出来。

本扩展**故意不持有这种状态**：只做确定性推导，不落任何与密码有关的盘。所以这 24 条用例在本项目里没有可实现的语义，测试里只统计、不计入通过率。


## 安装

1. 下载或 clone 本仓库；
2. Chrome 打开 `chrome://extensions/`，右上角打开「开发者模式」；
3. 点「加载已解压的扩展程序」，选择仓库根目录（有 `manifest.json` 的那层）；
4. 工具栏出现图标即可。点图标 → 输入全名与主密钥 → 生成密码。

### Edge 也一样能装

Edge 是 Chromium 内核，这份 Manifest V3 扩展原样可用，本仓库的端到端测试在 Edge 上跑过同一套断言（`Edge 155.0.4283.45`，12/12 通过）。操作只有一处不同：

1. Edge 地址栏打开 `edge://extensions/`（不是 `chrome://`）；
2. 左下角打开「开发人员模式」；
3. 点「加载解压缩的扩展」，选仓库根目录。

Edge 用的是同一套 `chrome.*` 扩展 API，`chrome.storage` / `chrome.scripting` / Web Worker 行为一致，无需改代码。扩展 ID 由 `manifest.key` 决定，所以**在 Edge 里装出来的 ID 和在 Chrome 里完全一样**，配置与数据能互通。

装完建议先在「扩展设置」页核对一遍。用全名 `Robert Lee Mitchell`、主密钥 `banana colored duckling`、站点 `spectre.app`，那么：

| 算法版本 | 类型 | 期望结果 |
|---|---|---|
| v3（默认） | long | `ReqoCenuXonu1?` |
| v3（默认） | maximum | `FB22U#U*LPFWlWxaxK2.` |
| v3（默认） | pin | `3648` |
| v0 | long | `NejoKecuMocx6@` |

对得上，说明算法实现没问题。

> 别拿 `PozoLalv0_Yelo` 当基准。那是官方 README 里的示例占位值，本机官方 CLI 二进制的 4 个版本 × 8 种类型全都复现不出它——它不是任何真实输入组合的输出，所以核对时以官方二进制复算出来的上表为准。


## 从旧版 WebUI 迁移收藏

设置页有「导入 / 迁移」区，两种格式都认：

| 格式 | 长相 |
|---|---|
| 旧版桌面 WebUI 的 `spectre_data.json` | `{ "favorites":[{ "site","template","category","user" }] }` |
| 本插件的「导出 JSON」 | `{ "favorites":[{ "site","userName","type","counter","algorithm","category" }] }` |

选文件或直接把 JSON 粘进文本框，点「导入」。映射规则：

- `template → type`、`user → userName`、`category` 原样
- 旧版 `server.py` 调 spectre 二进制时**没带 `-a`**，所以那批数据一律按 **v3**、counter 按 **1** 收
- 旧版 `categories` 是对象（`{ "默认": [...] }`），也认
- 未设过姓名时，顺手从导入条目里按众数补一个，省得再打一遍
- 同站点重复导入是**覆盖**不是副本；判重不分大小写，但**存下来的站点名保留原样**

### 站点名区分大小写，这条不能马虎

Spectre 的站点名是**区分大小写**的输入：`CTF` 和 `ctf` 推出来是两套完全不同的密码。
旧版 WebUI 就是把用户手输的原样喂给二进制的，所以迁移时**一个字都不能改**。

`src/storage.js` 因此分成了两个函数：

- `normalizeSite()` —— 决定密码的那个站点名，**保留大小写**（URL 里的 host 天生小写，那是 URL 规范的事）
- `siteLookupKey()` —— 只在「这是不是同一个站点」这类判重里用，折叠大小写

`test/legacy_fidelity.test.js` 专门盯这条：拿官方 CLI 二进制对 15 个真实站点跑出密码当 oracle，
再让插件推一遍逐步比对。其中 `AI安全` / `CTF` / `U+` 三个一旦被小写化就会立刻红。

## 使用

- **生成**：填站点名，选密码模板（long / maximum / pin …），点生成，点密码即复制。
- **填写**：解锁后点「填入当前页」，扩展会把密码写进当前标签页的密码输入框。走的是 `activeTab`，只在用户点击那一刻生效。
- **收藏 / 分类 / 最近**：与原版网页一致的功能。**收藏里只存站点名、模板、用户名、分类**——没有密码。
- **右键菜单 / 快捷键**：`Alt+Shift+S` 可直接唤起填写。

## 隐私

- 主密钥只存在于内存（popup 的 `input` → worker 的局部变量），**不写 `chrome.storage`、不写 localStorage、不写文件**。
- 扩展**没有任何网络请求**，`manifest.json` 里没有 `host_permissions` 常驻项。
- 派生结果里只有 `keyID`（`SHA-256(userKey)` 的十六进制）会出现在界面上，那是**单向指纹**，反推不出主密钥。
- 「填入当前页」用 `activeTab` + `chrome.scripting`，只在用户点击/快捷键触发时注入，不常驻、不监听页面输入。
- 内容安全策略：`script-src 'self'; object-src 'none'; base-uri 'none'`。

## 与原版「密码启动.bat」的差别

| | 原版 | 本扩展 |
|---|---|---|
| 运行环境 | WSL + Python + Flask + 官方 CLI 二进制 | 浏览器扩展，无外部依赖 |
| 每次生成 | `rm -rf ~/.spectre.d` 清状态（用的还是真实 `$HOME`） | 无状态纯函数，不存在中间状态 |
| 数据落盘 | `spectre_data.json`（收藏/分类/最近） | `chrome.storage.local`，**只存站点名/模板/用户名/分类** |
| 密码来源 | `pexpect` 正则从 CLI 输出里捞 | 直接算出来 |
| 网络 | 本地 HTTP 服务 | 零请求 |

那个 `rm -rf ~/.spectre.d` 是原版的一个真问题：它清的是 CLI 的缓存目录，但既然用了真实 `$HOME`，一旦有残留就会污染派生结果——同一个输入可能给你两个不同的密码。这个扩展里**根本不存在中间状态**，所有派生都是无状态的纯函数，所以那个坑自然没了。

## 目录结构

```
manifest.json           MV3 清单（含固定 extension key）
src/
  spectre.js            算法核心：零依赖的 SHA-256 / HMAC-SHA256 / PBKDF2 / scrypt + v0–v3
  worker.js             Web Worker：跑 scrypt，避免卡住 popup 的 UI
  popup.html/.css/.js   主界面（解锁、生成、收藏、最近）
  options.html/.css/.js 设置页（默认模板、用户名、算法版本、导入/导出、清空）
  background.js         service worker（右键菜单、快捷键、注入填写）
  storage.js            状态层（纯函数 + chrome.storage 后端 + 内存后端 + 旧版迁移）
test/
  verify_vectors.js     68 条官方二进制向量
  vectors.test.js       官方 XML 套件（215 结果 + 240 keyID）
  storage.test.js       状态层单测
  legacy_fidelity.test.js 迁移保真度：官方 CLI 当 oracle，逐步比对 15 个真实站点
  browser_e2e.js        真 Chrome / Edge 端到端（含设置页真实导入）
  audit_xml_vs_cli.js   用官方 CLI 逐条复判 XML（生成坏数据清单）
  generated_vectors.json 官方二进制的基准向量
  spectre_tests.xml     官方测试套件
  fixtures/
    spectre_data.legacy.json  旧版 WebUI 的真数据（含那条 site="1" 的测试垃圾）
    legacy_oracle.json        上面那份数据的官方 CLI 输出（裁判）
tools/
  make_icons.js         零依赖 PNG 图标生成器
  lint.js               语法与清单静态检查
  set_extension_key.js  生成并写入 manifest 的扩展公钥（固定扩展 ID）
```

## 已知限制

- **密码类型 `personal` 不实现**（理由见上「为什么没有 `personal`」）。本扩展支持 `maximum / long / medium / short / basic / pin / name / phrase` 八种。
- **不做跨设备同步、不导入 `.mpsites` 文件**。收藏/分类只存在本地 `chrome.storage`。
- 图标是脚本画的，不是设计稿。
- 端到端实测覆盖 Chrome 155 与 Edge 155（均是 Chromium 155）；MV3 + 模块 Worker 需要 Chrome 102+。

## 许可

MIT，见 [LICENSE](LICENSE)。算法属于 [Spectre](https://spectre.app) 项目（GPLv3+），本项目是独立的 JavaScript 实现，未包含其代码。
