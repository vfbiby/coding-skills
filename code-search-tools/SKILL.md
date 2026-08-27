---
name: code-search-tools
description: 在 codebase-memory-mcp 与 grep 之间选对工具，并避开它们静默给错答案的那些坑。触发于「代码里 X 在哪」「谁调用了 X」「改 X 会影响什么」「这个 bug 的根因在哪」，以及任何要给某个仓库建/重建代码索引的时刻。
---

# 检索：cbm 还是 grep

本机的代码检索只剩两条路径：**codebase-memory-mcp**（下称 cbm，图 + 全文）与 **grep**。
2026-08-22 实测对比后砍掉了 GitNexus——它的主打能力（影响半径）被 cbm 完整覆盖，
而它在检索上更弱、索引大 6.5 倍。对比报告见某仓库的
`docs/CODE-SEARCH-TOOLS-RESEARCH.md`。

## 一句话选型

| 你在问什么 | 用哪个 |
|---|---|
| **"它到底写了什么"**——CSS、SQL、配置、模板 | **grep**（见下方能力边界） |
| **"它在哪、还有谁在用"** | **cbm `search_code`** |
| **"谁调用了它、改了会炸哪"** | **cbm `trace_path`** |
| **"这个项目长什么样"** | **cbm `get_architecture`** |

---

## 能力边界：索引工具看不见样式和 SQL

**CSS 在 cbm 的图里只有文件级节点**（`File` + `Module`），没有任何选择器结构。
与 `.css` 相连的 `USAGE` 边是「这个文件被 import 了」这一层。验证方法：

```
query_graph: MATCH (n) WHERE n.file_path ENDS WITH '.css' RETURN labels(n), n.name
```

一个真实教训：一个"下拉框展开后把页面撑宽"的 bug，根因是 CSS 里
`.tzlist` 没有宽度约束。**索引工具能告诉你 `console.css:169` 有命中，
但给不出那一行写了什么，更算不出它的影响半径。** 样式、SQL、模板一律走 grep。

> **推论也要小心**：「cbm 索引得多，所以影响半径更全」是**错的**——
> 多索引的 CSS/MD 是"能被文本搜到"，不是"进了图"，不参与影响传播。

---

## cbm 用法

### 走 MCP，别走 CLI（差 25 倍）

同一查询实测（0.10.8）：MCP/stdio **0.12s** ／ `cli` + daemon 2.97s ／ `cli` 无 daemon 8.7s。
内部 `elapsed_ms` 都是 ~100ms，**差的全是外壳**。排除过磁盘争用、UI 端口、代理超时。

**会话里用 MCP 工具；`cli <tool> [json]` 只留给一次性排查。**

### 让输出清爽

`search_graph` 每个节点**必带** `fp`（函数指纹）、`sp`（结构剖面）、`bt`（函数体词元），
**没有字段裁剪参数**——一个节点 ~2.2 KB。

| 目的 | 用法 | 体量 |
|---|---|---|
| 只要"在哪些文件里" | `search_code --mode files` | **~230 B** |
| 要签名 + 行号 | `search_code --mode compact`（默认） | ~1.1 KB |
| 要源码 | `get_code_snippet` | 按需 |
| 要自选字段 | **`query_graph` 写 Cypher 显式 RETURN** | 你说了算 |

先用 `--path-filter` / `--file-pattern` / `--limit` 收窄，再谈模式。

### 影响半径

```
trace_path(function_name=…, direction="inbound", depth=3, risk_labels=true)
```

⚠️ `direction` 只认 **`inbound`（调用者）/ `outbound`（被调用）/ `both`**——
传 `callers` 会报错。另有 `mode`：`calls`（默认）/ `data_flow`（带参数表达式）/
`cross_service`（跨 Route、跨仓库）。

### 三处会骗你的地方

1. **`--mode compact` 只给行号，不给内容。** 它会准确告诉你 `console.css:83,169,174`
   ——但不显示那几行写了什么。**"没显示"不等于"没找到"。**
2. **`pattern` 默认是字面量。** `--pattern "foo|bar"` 返回 0 条且**不报错**，
   只在响应的 `warnings` 数组里附一句。要或分支就显式 `--regex true`。
   **更普适：这个工具的 `warnings` 字段要读**——它把"你的查询没按你以为的方式执行"
   放在那里，而不是放在错误里。
3. **中文只能走 `search_code`（grep 底座，正常），不能走 `search_graph --query`（BM25）。**
   查「时区」会回 `total=13355`，头条是 `launchSettings.json` 里的 `$schema`。

### 升级会删掉全部索引 ⚠️

`codebase-memory-mcp update` 在装新版前**删除本机所有仓库的索引**（会列出来确认）。
`auto_index=true` 时它们会在下次用到时自动重建，但那一次很慢。
非交互环境下还要显式加 `--standard` 或 `--ui`，否则会因为要选变体而失败。

### 完整性保证（相对 grep 的真优势）

`search_code` 回 `total_grep_matches` / `total_results`，`search_graph` 回 `total` / `has_more`。
**这正是 `grep | head -N` 结构上给不了的**——后者只能证明"前 N 条里没有"，
永远不能证明"没有"。要断言某个符号**不存在**，用它。

---

## 通用纪律

1. **不要从截断的搜索结果里得出"不存在"的结论。**
2. **工具找不到 ≠ 不存在。** 先问"这类文件在它的索引里吗"。
3. **静默的空结果比报错危险。** 上面标 ⚠️ 的每一条，失败形态都是"返回一个整齐的
   空结果"，没有任何红色。查中文查出 0 条时，**先怀疑分词，别怀疑仓库**。
4. **改配置前先确认配置目录。** 本机 `CLAUDE_CONFIG_DIR=~/.claude_official`，
   `~/.claude` **不是**生效的那个——写错文件的话，改动看着成功但完全不起作用。
   动手前 `echo $CLAUDE_CONFIG_DIR`。
