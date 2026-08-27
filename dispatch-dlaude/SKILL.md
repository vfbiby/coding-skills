---
name: dispatch-dlaude
version: 2.0.0
description: 用 dlaudef / dlaudep / dlaudefv 把活派给子 agent 并复核结果。触发于「派活」「派 agent 去实现」「派个 agent 审查」「用 dlaude 跑」，以及要让实现与审查并行时。
---

# 用 dlaude* 派活

三个 shell 函数都用 DeepSeek 端点驱动 claude，便宜，适合派实现与审查：

- `dlaudep`（deepseek-v4-pro）——思考更强，适合含判断的设计类活。
- `dlaudef`（deepseek-v4-flash）——照着命令直接执行，适合写死的实现类活。
- `dlaudefv`（deepseek-v4-flash-vision）——能看图，适合界面等视觉验收。

拿不准就上 `dlaudep`。命令其余参数三个通用；价格见同目录 `PRICING.md`。

⚠️ 这些名字 2026-08-22 改过（`dlaude`→`dlaudef`、`dlaudepro`→`dlaudep`、`dlaudev`→`dlaudefv`），旧名字会 `command not found`。`dlaudefv` 是实验版，探活尤其不能省（更容易整体不可用）。

## 派活之前：留基线，并想一遍该不该派

- **派活前先留可回退基线**：已成型的正常提交掉（一次一个）；未跟踪新目录 git 帮不上忙，`cp -r <目录> <scratchpad>/baseline-<名字>/`。没基线，「改回去」变「重新写一遍」→ 又会再派一轮。
- **撤回/还原/机械替换自己做，不派。** 判据是**要不要做判断**，不是体量。有基线就 `git checkout` / `cp` 回来。只有撤回同时伴随新撰写且分量够大才考虑派。
- **转发报错给执行侧前先自核。** 凡报「不存在/找不到」，先自己精确匹配核一次——存在性是双方能独立核实的事实。
- 想知花费：`python3 ~/.claude/skills/dispatch-dlaude/dispatch-cost.py <scratchpad 目录>`（加 `--flash` 按 Flash 单价折算）。⚠️ 折算单价未经账单核对，只能当量级看。

## 步骤

### 1　探活

```bash
zsh -c "source ~/.zshrc >/dev/null 2>&1; dlaudef -p 'reply with exactly: OK'"
```

**探你这次真要用的那个。** 三个同端点但通道坏不保证同时坏。通道整体坏（TLS 等）时 `RESULT` 仍报 `success`——判据是响应正文，不是 `subtype`。探不通就自己写。

### 2　写任务书

写到 scratchpad 的 `task.md`，不进仓库。内容见下「任务书」。

### 3　发出去

```bash
S=<scratchpad 目录>
zsh -c "source ~/.zshrc >/dev/null 2>&1; dlaudef -p \"\$(cat $S/task.md)\" \
  -n '<活名：如 loginwindow-实现豁免>' \
  --output-format stream-json --verbose --permission-mode acceptEdits \
  --allowedTools '<按活收紧，见下>'" 2>&1 \
  | tee "$S/task.log" \
  | grep --line-buffered '^{' | jq -rc --unbuffered 'if .type=="assistant" then (.message.content[]? | if .type=="text" then "TXT "+(.text|.[0:220]) elif .type=="tool_use" then "USE "+.name+" "+((.input.file_path // .input.pattern // .input.command // "")|tostring|.[0:110]) else empty end) elif .type=="result" then "RESULT "+(.subtype//"")+" turns="+((.num_turns//0)|tostring) else empty end'
```

配 `run_in_background: true`。关键点：`--output-format stream-json --verbose`（`claude -p` 默认缓冲、跑完才吐；加它还能在杀进程后从日志捞回已完成的调查）；`tee` 分流（stdout 全重定向会让 harness 任务输出为空）；`jq` 投影（一条 NDJSON 几千 token，压成一行、正文截 220、工具调用截 110）；`--permission-mode acceptEdits`（`--dangerously-skip-permissions` 会被 auto 分类器拦）；`-n '<活名>'`（落成会话 JSONL 首行 `custom-title`，否则 `/resume` 里是一串 UUID）。

**用 `acceptEdits`，不用 `plan`**：headless 下 `ExitPlanMode` 没有出口，审查 agent 以为自己交付了，整份报告消失。

### 4　等通知

后台任务跑完自动叫你，去看那个 output 文件（已投影成可读行）。Agent 工具派的子 agent 则不同——output 是完整 JSONL 转录，读它会撑爆上下文，只能等通知。**不要挂 Monitor**（每条事件一次全量 API 调用）。

### 5　自己复核

**跑一遍它说跑通的东西。** 报告说测试全绿你自己跑；注入实验红在第 N 条你自己换注入验一遍。判据：你亲手跑出的输出与报告一致，且关键断言在你自己的注入下红在预期那条上。只读报告不算复核。

**被杀的 agent 会把注入留在工作树里**（「改坏→跑→改回来」停在「改坏」那步，看起来像一处实现）。没有报告 = 先当作有半截注入没回滚：`git diff` 逐处过，找「删掉一个调用」「true 改 false」这种孤立改动，对着注入靶子核。这就是「报告要写在测试跑绿之后、收尾之前」的原因。

**收活不要 `git add -A`。** 另一个 agent 可能正跑着或没复核——会卷进你的提交，一个提交两件事，事后 `reset --soft` 拆。**按路径 add**，或先 `git status` 看清楚。

## 白名单

`--allowedTools` 必须写在命令行上，`.claude/settings.json` 的 `permissions.allow` 对派出去的 agent 无效（workspace 未 trust）。

**用下面三个具名 bundle，整块粘贴，别每次手拼。** 手拼会想不全、给出 agent 想用的工具被拒、多绕 turn、每个 turn 重重吃上下文。

```
# ① 只读调查（审查、排查、回源核对）——绝不给 Write/Edit
Read,Glob,Grep,Bash(git diff:*),Bash(git status:*),Bash(git log:*),Bash(ls:*),Bash(cat:*),Bash(sed -n:*),Bash(head:*),Bash(tail:*),Bash(wc:*)

# ② 实现（写代码 + 自测）——在 ① 基础上加写与构建
Read,Write,Edit,Glob,Grep,Bash(git diff:*),Bash(git status:*),Bash(ls:*),Bash(cat:*),Bash(sed -n:*),Bash(head:*),Bash(tail:*),Bash(wc:*),Bash(bash:*)  + 构建工具前缀（如 `Bash(dotnet:*)`）

# ③ 审查（= ①，一个字都不加）
```

- `Bash(sed -n:*)` 只放读，`sed -i` 不匹配；② 的 `Bash(bash:*)` 给包装脚本用，但也等于给了完整 shell——所以 ①③ 绝不能加它。
- **给 `Grep` 工具，不给 `Bash(grep:*)`**——后者能让 agent grep shell snapshot，三个函数的函数体都在里面，带硬编码的 API token。
- `Bash(xxx:*)` 是**前缀匹配**：`set -a; . ./.env; dotnet test` 不以 `dotnet` 开头会被拒。把 `source .env` 封进脚本、白名单给 `Bash(bash:*)`，任务书写死「跑测试只能用 `bash <脚本路径>`」。收太紧的代价不是报错而是误导（agent 反复 `printenv` 试探，得出错误结论）。
- **审查 agent 不给构建工具**——两个 agent 同时构建抢 `obj/`/`dist/`，两边都坏。任务书写明「构建由主会话跑」，它照样能读代码写报告，实现与审查可真并行。
- **「只分读写」这条轴是错的**（`Bash(bash:*)` 一给就是完整 shell，Bash 层切不成读写；`grep` 纯读却必须禁）。真正的轴是**这活要不要写文件、要不要构建**。

## 任务书

派出去的 agent 是**冷启动**的：它不知道这个仓库、不知道之前几轮做过什么、不会自己去找该读的文件。

- **任务书第一行写清本场可用工具**（对应白名单 bundle）：如「本场有 `Read,Write,Edit,Glob,Grep,Bash(dotnet:*)`」，并提醒「看文件用 `Read`/`Grep`，别用裸 `Bash`；跑测试只能走 `bash <脚本>`」——agent 一审就知道边界，省掉被拒的 turn。
- **点名要读哪几个文件**，用全路径（相关 ADR、坑库条目 `docs/pitfalls/P-<编号>-<slug>.md`、spec、tasks——不点名它就不读）。**点名前先 grep**，拿改动领域词去文档目录搜一遍，命中全点名（凭回忆点名，漏的常是最该读的）。
- **写清这轮最容易做错什么、错了会怎样**——不是「实现 X」，是「X 做错不会报错，只会让 Y 看起来更好」。
- **报告写进文件，不在流里**。给绝对路径（scratchpad 下 `report-<活名>.md`），要求**边做边写、每节落一次盘**——流是易失的，agent 被杀时报告就没了。
- **报告写在测试跑绿之后、收尾之前**（长任务接近上限会被杀）。
- **每次调试/注入改动做完立刻改回来并重跑确认绿**（有 agent 死在「改坏」和「改回」之间，那处 `throw;` 若跟着提交会打断整个循环，且无测试覆盖）。
- **划死不许碰**：别的模块、别的任务组、既有测试、文档目录。
- **注释只许引用能回源核对的出处**（ADR 编号、spec 的 Requirement 名、坑编号 `P-n`、文件全路径）。任务书里的「第 3 组」「6.7」是一次性的，写进注释就是死链。
- **交付要求写成可检查的**——贴真实测试输出（条数）、贴注入失败输出、逐条回答指定问题。「写份报告」换来复述注释，「数出你写了几条断言」换来真数了。

## 被杀之后

`RESULT` 行缺失 = 被外部终止（不是崩溃，也不是通道坏——通道坏时 `RESULT` 仍报 success）。**先读磁盘**：

1. `git status --short` —— 落了什么
2. 半成品报告 —— 做到哪、下一个嫌疑是什么
3. `grep -rn "TEMP\|DEBUG" src` —— 调试残留

够不够自己收尾：够就自己收——重派付一次冷启动，已定位到函数级的 bug 自己修比重新交代便宜。日志分不出「被人停」和「被杀」——查 `Console.app` 的 `jetsam` 或 `sysctl vm.swapusage`；分辨不出就别下结论，当成「随时可能发生」来设计任务书。

## 通道坏了

探活不通、或 `RESULT` 报 success 但正文是错误——自己写。派活是省时间的手段，不是前提。
