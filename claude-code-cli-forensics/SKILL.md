---
name: claude-code-cli-forensics
description: 静态分析 Claude Code CLI（Bun 单文件二进制）的内部实现，挖 TUI 卡片、字形、工具定义、渲染路径、主题色与文案，并产出可复跑、可跨版本 diff、带证据等级的结论。触发：要证明「官方 CLI 到底怎么渲染/怎么定义某个工具」、要把官方卡片对齐到别的客户端、要对比两个 CLI 版本的 UI 变化。不用于分析普通开源仓库。
---

# Claude Code CLI 取证

**目标**：把「官方是怎么做的」从二进制里挖出来，变成别人能复核的证据，而不是猜测。

**三条红线**：

1. **不执行**目标二进制。全部结论来自静态读取。
2. **不把逆向产物提交进公开仓库**。短 UI 标签、码位、函数名、计数可以；函数体、大段源码不行。
3. **区分证据等级**。`【实测】`（直接读到）/ `【推断】`（从命名或上下文推）/ `【未定位】`（找不到）。推断绝不许写成实测。

---

## 0. 先定位二进制

CLI 的安装位置因安装方式而异。从 `which` 出发，解析到真实文件：

```bash
which claude
readlink -f "$(which claude)"
file "$(readlink -f "$(which claude)")"
```

常见位置：

```
~/.bun/install/global/node_modules/@anthropic-ai/claude-code-<platform>/claude
~/.npm-global/lib/node_modules/@anthropic-ai/claude-code/cli.js   # 非单文件分发时
```

判断是否为本技能适用的 **Bun 单文件**：`file` 输出 `Mach-O 64-bit executable arm64`（或对应平台），且下一节能找到 `__bun`。

先记三样东西，后面所有结论都用它们锚定：

```bash
VERSION=$(strings -a "$CLI" | grep -m1 '^// Version: ')
sha256sum "$CLI"        # macOS: shasum -a 256
stat -f%z "$CLI"        # 字节数
```

> 版本号 **不要硬编码**。从二进制的 `// Version:` 行自动取。

---

## 1. 拆骨架

### 1.1 找 `__bun` 节

**通用做法**（不要硬编码偏移）：

```bash
otool -l "$CLI" | grep -A6 'sectname __bun$'
```

输出里取 `offset` 与 `size`。例：

```
sectname __bun
 segname __BUN
    size 0x000000000a7d14b3
  offset 91209728
```

### 1.2 切出可读 JS 区段

`__bun` 节里混着 **可读 JS** 和 **bytecode**。可读区不是整个节。

**起点**：节内第一个 `// @bun @bytecode\n` 标记。
**终点**：最后一个模块 JS 之后的第一个 `\x00` 字节（其后是同一模块的 bytecode）。

不要假设起点是某个整数偏移——它前面通常还有几个完整模块，硬编码会让所有模块编号整体偏移。

```python
import re
CLI = "/path/to/claude"
d = open(CLI, "rb").read()
SEC_OFF, SEC_SIZE = 91209728, 0xa7d14b3        # 从 otool 取
seg = d[SEC_OFF:SEC_OFF + SEC_SIZE]

MARK = b"// @bun @bytecode\n"
first = seg.index(MARK)
tail  = seg[first:first + 64 * 1024 * 1024]
s     = tail.decode("latin-1")

# 裁掉最后的 bytecode
last = s.rfind("// @bun @bytecode\n")
m = re.search(r"// Version: [^\n]+\n", s[last:])
nul = s.index("\x00", last + m.end())
s = s[:nul]
```

### 1.3 切模块

结构是：

```
[footer][Version 行][模块内容][下一个 footer][Version 行][模块内容]...
```

```python
parts = s.split("// @bun @bytecode\n")
mods = []
for p in parts:
    m = re.search(r"// Version: [^\n]+\n", p)
    if m:
        mods.append(p[m.end():])
# 每个 footer 之后对应一个模块；第一个 footer 之前的内容是半截，丢弃
```

**校验**：模块数应等于 `s.count("// @bun @bytecode\n")`。不等就说明起止或切法有问题，不要继续。

---

## 2. 压缩后什么还在

Bun 产物经过 minify，但以下信息**保留**：

| 还在 | 没了 |
|---|---|
| 字符串字面量、UI 文案 | 原始文件路径（几乎全无） |
| JSX 的 props 名（`aria-label`、`verbose`、`toolUseID`） | 变量名（大量 1–2 字符） |
| 对象方法名（`renderToolUseMessage`、`userFacingName`） | 注释、sourcemap |
| 类私有字段（`#e`）、解构出的状态形状 | 原始缩进与格式 |
| Unicode 转义（`\u23BF`）、主题 token 字符串 | 类型信息 |

**结论**：结构能恢复，可读性差；靠「模式」而不是靠「读懂整段代码」。

---

## 3. 六类目标的识别配方

### 3.1 字形 / 符号

字形以 **`\uXXXX` 转义**存在，不是 UTF-8 原字符。

```python
# 搜 ⎿ 要搜这 6 个字符：\ u 2 3 B F
s.count("\\u23BF")
```

坑：
- **大小写敏感**：`\u23BF` ≠ `u23bf`。
- 4 位转义只覆盖 BMP；遇到 `\u{1F600}` 形式要单独处理。
- `\xA0`（不换行空格）、`\xD7`（×）这类 **2 位转义**也常见，别当成普通字符搜。

抓常量赋值：

```python
re.findall(r'([A-Za-z_$][\w$]*)="(\\u[0-9A-Fa-f]{4})"', s)
```

### 3.2 Ink 组件

判据是 **memo 槽位模式**，不是字形：

```js
function X(props) { let S = w(12); ... }   // w(N) = 编译后的 memo/useMemo 槽位
```

```python
MEMO = re.compile(r'function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{\s*let\s+[A-Za-z_$][\w$]*\s*=\s*w\(\d+\)')
```

- 交互式 Ink 组件的 import 别名会被压成 `e`/`r`，形如 `e(Box,{...})`、`r(Text,{...})`。
- `elements.Box` / `elements.Text` 往往只出现在**非交互**（SVG/分享）渲染器里。
- 函数总数与 memo 组件数要一起报，单看一个数会误判。

### 3.3 工具定义

官方用工厂函数包配置。典型形态：

```js
var Mi = Qt({ name: Mmt, searchHint: "...", maxResultSizeChars: 1e5,
  async prompt(){...}, get inputSchema(){...}, userFacingName(){...},
  renderToolUseMessage(e,{verbose:n}){...}, create(e){...} })
```

步骤：

1. 全区分扫 `Qt({`。
2. 取 `name:` 的值：
   - 字面量直接用；
   - 标识符要做**跨模块常量解析**。
3. 跨模块常量表：`(var|let|const) NAME = "..."`，只在**值唯一**时采用；有歧义就保留候选并标 `unresolved`。
4. 记录存在性：`renderToolUseMessage` / `renderToolResultMessage` / `renderToolUseProgressMessage` / `renderToolUseErrorMessage` / `userFacingName` / `maxResultSizeChars` / `isMcp`。

```python
from collections import defaultdict
cmap = defaultdict(set)
for m in mods:
    for k, v in re.findall(r'(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*"([^"]{1,50})"', m):
        cmap[k].add(v)
```

**不要用工具名当探针**（`"Bash"` / `"Edit"` 会命中工具定义、prompt 文本、示例代码）。工具定义要从 `Qt({` 进。

### 3.4 渲染注册表

工具卡的结果渲染常常不在工具定义里，而在一个注册表（示例中叫 `Ef`）：

```js
Ef.set(X, { renderToolResultMessage: ..., renderToolUseProgressMessage: ... })
```

找法：搜 `renderToolResultMessage`，看它出现在对象字面量还是 `export{X as renderToolResultMessage}`；后者说明渲染在**独立模块**，由注册表动态引用。这时要区分：
- 「定义对象自身有这个方法」
- 「注册表为这个工具提供方法」

两者都算「有渲染路径」，但要分别记录。

### 3.5 主题色 / tone

官方用**主题 token**，不是原始色名：

```js
color:"error" | "warning" | "success" | "suggestion"
     | "subtle" | "inactive" | "text" | "planMode" | "bashBorder"
```

结果行另有 `tone: "dim" | "red" | "gold"`。

```python
re.findall(r'color:"([A-Za-z]+)"', module_text)
```

不要把 token 当成具体颜色；也不要从别的项目照搬 Tailwind 色名。

### 3.6 文案探针

用**短 UI 标签**定位功能模块：

```
"Do you want to proceed"      → 审批卡
"Found " / "across "          → 搜索结果卡
" PreToolUse "                → hook 卡
"Recalling" / "Recalled"      → 记忆卡时态
"tell Claude what to do next" → 审批回执
```

要点：
- 卡片层可能把一句话拆成多个 JSX 子节点（`" "` + `"across "`），**带空格的精确串会漏**。同时跑变体。
- 命中后要报「次数 + 模块号」，不要只报「有」。
- 命中的模块可能是 prompt 文本而不是 UI；用模块大小、函数数、memo 数辨别。

---

## 4. 跨版本 diff

```bash
# 每个版本各跑一次抽取，产物带版本号命名
node extract.mjs --cli /path/v1 --out /tmp/baseline-v1
node extract.mjs --cli /path/v2 --out /tmp/baseline-v2
diff -u /tmp/baseline-v1/card-baseline.json /tmp/baseline-v2/card-baseline.json
```

**先比锚点再比编号**：sha256、模块数、字形表条数、工具定义数。编号会因打包顺序变化而漂移，**不要**拿旧编号直接对比新编号。

建议的稳定 diff 键：
- 字形：码位（不是变量名）
- 工具：解析出的 `name`（不是模块号）
- 文案：字符串本身
- 组件：`functionCount` / `memoComponentCount` 的分布

---

## 5. 验证清单

每次抽取都必须能回答：

- [ ] 版本号与 sha256 是否写进了产物？
- [ ] 模块数 == footer 标记数？
- [ ] 起点是第一个 footer、终点是最后一个模块的 JS 末尾？
- [ ] 连跑两次，剔除时间戳后产物**逐字节一致**？
- [ ] CLI 路径不存在时**非 0 退出**？
- [ ] 每个结论都有 `【实测】/【推断】/【未定位】`？
- [ ] 有没有把「别的项目里有」当成「官方有」？

---

## 6. 坑表

| 坑 | 症状 | 正确做法 |
|---|---|---|
| 硬编码区段起点 | 模块编号整体偏移 7 个 | 用第一个 footer 标记动态定位 |
| 字形按 UTF-8 搜 | 0 命中，误判「没有卡片层」 | 搜 `\uXXXX` 转义，大小写敏感 |
| 用工具名当探针 | 命中一堆 prompt 文本 | 从 `Qt({` 进，用 UI 文案定位 |
| 把 `renderToolResultMessage` 只算在定义对象 | 漏掉注册表提供的渲染 | 定义对象 + 注册表分别统计 |
| 把 memo 组件数当卡片数 | 以为「一卡一组件」 | memo 多是共享原语；卡片按工具定义分组 |
| 把别的项目配置当官方清单 | 对不存在的工具做卡 | 官方 0 命中就是没有，明确作废 |
| latin-1 之外的解码 | 中文字符串乱码 | 按字节偏移切，decode 用 `latin-1` |
| 把 `\xA0` 当空格 | 文案匹配失败 | 同时试 `\u00A0` / `\xA0` |

---

## 7. 边界（必须写进交付）

1. 只覆盖**可读 JS 区段**；纯 bytecode 部分不可见。
2. 抽取依赖「Bun 单文件 + 保留可读 JS」。官方改成纯 bytecode 或换打包方式时，配方失效，脚本应**非 0 退出**而不是静默产出空结果。
3. 模块编号、压缩函数名都是**本期快照**，靠版本号 + sha256 锚定。
4. 组件/工具识别是**启发式**（正则 + 文案探针），可能漏判或误判；未定位项要如实列出。
5. 不能从二进制推出运行时行为；运行时结论要靠 PTY 抓帧或协议抓包单独证明。

---

## 8. 本仓库的现成实现

- 抽取脚本：`course/web-client/scripts/extract-cards.mjs`
- 母本文档：`course/web-client/docs/card-baseline.md`
- 机读产物：`course/web-client/docs/card-baseline.json`
- 工具卡片清单：`course/web-client/docs/card-inventory.md`

用法：

```bash
cd course/web-client
node scripts/extract-cards.mjs                       # 默认路径
node scripts/extract-cards.mjs --cli /path/to/claude # 指定二进制
node scripts/extract-cards.mjs --out /tmp/out        # 指定产物目录
node scripts/extract-cards.mjs --dump-raw /tmp/raw   # 原始模块（默认关闭，拒绝写入仓库）
```

---

## 9. 官方 vs 实现：找组件 → 抓帧 → 并排

这一节回答两个问题：**组件在二进制哪里**、**它渲染成什么样**。

### 9.1 找组件（二进制侧）

按这个顺序，不要一上来全文搜工具名：

1. **工具定义**：全区分扫 `Qt({`，取 `name:`。name 常量常常跨模块，先建全局 `var X="..."` 表。
2. **渲染路径**：看工具定义对象自身的 `renderToolUseMessage` / `renderToolResultMessage`；
   结果渲染通常还在一个注册表（示例中叫 `Ef`）里，或由独立模块 `export{X as renderToolResultMessage}` 提供。
3. **卡片层**：同时含 `Recalling` / `Recalled` / `toggleTranscript`、且 memo 组件数最多的模块
   （2.1.303 是 **#1570**；编号随版本变，靠内容定位）。
4. **按 UI 文案定位**：`Found ` / `Ran ` / `Recalling` / `Do you want to proceed` /
   `User approved Claude's plan` / `Did 1 search` / `Received ` / `Updated cell `。
5. **字形**：结果行 `\u23BF`（⎿）；任务 `\u25FB`（◻）/ `\u25FC`（◼）/ `\u2714`（✔）。
6. **显示名**：官方不一定用工具名。Edit/MultiEdit/NotebookEdit → `Update`，
   Grep/Glob → `Search`，WebSearch → `Web Search`，WebFetch → `Fetch`，
   Agent → 输入里的 `subagent_type`。

### 9.2 核对渲染（可视化侧）

官方侧没有可用的断言，只能抓帧；**不要**把"我们的测试全绿"说成"与官方一致"。

1. 用 tmux 跑一次真实 CLI（固定 110 列，避免换行差异）：
   ```bash
   tmux new-session -d -s cmp -x 110 -y 46
   tmux send-keys -t cmp "cd /tmp/demo && claude --allowedTools 'Read' 'Grep' 'Bash' ..." Enter
   # 首次信任目录：Down + Enter
   ```
2. 发一个明确要求"用 X 工具一次、别做别的"的提示；工具没默认加载时，官方会先 `ToolSearch`。
3. **`ctrl+o` 切换详细 transcript**：官方默认把连续工具折叠成一行语义摘要；
   展开后才看到单卡。两种状态都要抓。
4. 抓 ANSI：`tmux capture-pane -t cmp -e -p > official.ansi`
   （SGR + OSC 8；转 HTML/图片时保留颜色）。
5. 从**同一会话日志**抽载荷：`~/.claude/projects/<cwd-slug>/*.jsonl`，
   按 `tool_use_id` 配对 `tool_use` / `tool_result`，输出
   `{name,input,result,is_error,status}`。
6. 用同一批载荷渲染我们：
   ```bash
   node scripts/card-gallery.mjs --tools /tmp/tools.json --out /tmp/web.html --expanded
   ```
   `--expanded` = 逐张展开（对照官方 ctrl+o）；不加 = 折叠组（对照官方默认）。
7. 两边截图并排：`magick montage web.png official.png -tile 2x1 -geometry +14+14 ...`。

### 9.3 判定标准（官方 2.1.303 实测）

- 头部是 `Name(arg)`，**中间没有空格**，等宽字体。
- 结果行是**摘要**，不是原始 payload：
  `Read N lines`、`Found N files`、`Wrote N lines to X`、
  `Added N line, removed M line`、`Ran N shell command`、`Did 1 search`、
  `Updated cell cell-N`、`User approved Claude's plan`。
- 连续工具折叠成**语义摘要**：
  `Searched for 2 patterns, read 1 file, ran 1 shell command`。
- 错误行是 `Error: ...`；不要展示 CLI 的内部 metadata
  （Agent 的 result 明确写着 "never quote or paste"）。
- 成功时默认折叠输出；官方不显示 `Done` / `Error` 徽标。

### 9.4 断言分层

| 层 | 谁保证 | 能证明什么 |
|---|---|---|
| 二进制证据 | 抽取脚本 + 母本文档 | 官方有哪个工具、哪条渲染路径、短文案是什么 |
| 官方抓帧 | tmux + `capture-pane` | 官方**当时**长什么样（人工目视） |
| 我们的 DOM 断言 | vitest + happy-dom | 子元素、状态、文案一直在；快照防回归 |
| fixture | 真实会话日志（脱敏） | 输入/结果形状不是手编的 |

**官方侧没有断言**：抓帧只能得出"看起来一致"，不能得出"测试证明一致"。
**我们的测试也只能证明我们自己的行为**，不能替代官方抓帧。

### 9.5 核对清单

- [ ] 头部 `Name(arg)` 无空格、等宽
- [ ] 结果行是摘要，不是原始 payload
- [ ] 成功态默认折叠；错误态 `Error: ...`
- [ ] 折叠组是语义摘要
- [ ] 不显示内部 metadata / 不显示 Done 徽标
- [ ] 记录哪些工具**没能触发**，明确写"未目视比对"
- [ ] 新工具已归属：专属卡或显式 generic（`cardCoverage.test.ts`）
- [ ] 官方抓帧、载荷、并排图都留在仓库外（/tmp），不提交

### 9.6 升级后一条命令查漂移

```bash
node scripts/extract-cards.mjs --check
```

对比当前二进制与 `docs/card-baseline.json` 的工具定义（渲染路径、searchHint、
maxResultSizeChars、isMcp）和字形集合：

- 无差异 → exit 0
- 工具增删改 / 字形增删 → exit 1，逐条打印 `+ / - / ~`
- 基线缺失 → exit 1

版本号/sha256 变了但工具与字形没变时，只报告，不判失败。

### 9.7 现成资产

- 抓帧 + 抽载荷 + 并排配方：`course/web-client/gallery/README.md`
- 渲染器：`course/web-client/gallery/render.tsx`、`scripts/card-gallery.mjs`
- 全卡手工演示（fake-cli，不是官方对照）：`scripts/card-demo.sh`
- 已比对 / 未比对清单：`course/web-client/docs/card-alignment-plan.md` §10

> 演示栈和官方抓帧是两回事：
> `card-demo.sh` 用 fake-cli 把所有卡片跑一遍，用于**看我们自己的实现**；
> 官方对照必须用真 `claude` + tmux 抓帧。

### 9.8 默认态 vs 展开态（必采两态）

官方 TUI 有全局 `ctrl+o`：默认把一部分工具压成一行，展开才显示卡片。
**只采展开态会把「收起」误判成缺失，也会把「默认展开」误判成需要收起。**

1. 每个工具单独一轮：`/clear` → 只用一个工具的提示 → 等 turn 结束。
2. 先抓默认（不按 `ctrl+o`），再按 `ctrl+o` 抓展开。
3. 记录默认形态属于哪一类：
   - **一行摘要**：Read / Bash / Grep / Glob / NotebookEdit
   - **默认展开**：Edit 的 diff / Write 的内容
   - **紧凑卡（头 + 一行结果）**：WebSearch / WebFetch / Agent
4. 额度友好：用 `glmfclaude`（GLM 中转）。注意它的配置目录是 **`~/.claude_glmf`**，
   会话日志在 `~/.claude_glmf/projects/<slug>/*.jsonl`，不是 `~/.claude`。
5. **不要假设「全部收起」**：2.1.303 实测 Read/Bash/Grep 收起，Edit/Write 默认展开。
6. 结论表 + 剩余差异：`course/web-client/docs/card-collapse-baseline.md`。
