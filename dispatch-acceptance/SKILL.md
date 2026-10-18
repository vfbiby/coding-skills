---
name: dispatch-acceptance
description: 派活与验收流程——所有者说「派/派票/继续派」时按此派出实施票（首选 glmfclaude/driver-glm.py；额度不足时可走 OpenCode + DeepSeek V4.1 Flash/driver-opencode.py；本会话已是 GLM 则直接 subagent；agy 暂时不可用不派），交付后走完整验收（双轴独立审查、亲跑变异、全量+fmt、合并推送顶钉子、关票）。覆盖工作树隔离、任务书七件套、钉子三处核对。
---

# 派活与验收

角色：**我派票不写码**。实现缺陷发回实施者修补（可多轮）；验收方只亲做验证类操作（跑测试、打变异、读源核对）与合并/推送/钉子等流程动作。

实施者路线（2026-10 起调整）：**agy 暂时不可用，一律不派**。首选 **glmfclaude**（GLM 驱动的 Claude Code，用 `driver-glm.py` 派发，见「派出」一步）；若本会话本身就是 glmfclaude（已经是 GLM 模型），**直接走 Claude subagent**（general-purpose，任务书直接复用），不必再套一层 GLM。**GLM/其他通道额度不足时**，走可选的 **OpenCode + DeepSeek V4.1 Flash**（`driver-opencode.py`，见下；OpenCode 没有工具白名单，命令级边界必须写进任务书）。agy 的历史深坑与经验留档在 `~/.claude_glmf/skills/agy-dispatch/SKILL.md`（--print 死亡史、settings、账号额度），恢复前仅供参考。

## 一、派活

1. **读票**：`gh issue view <N> --repo vfbiby/<仓>`。needs-triage 票先确认所有者已裁；无票的按 to-spec 规格开票（打 `ready-for-agent`）再派。
2. **建工作树**：`git -C ~/codes/<仓> worktree add ~/codes/<仓>-wt-<票号> -b fix/<票号>-<slug> main`，输出目录 `mkdir -p ~/codes/agy-tasks/<票号>`。多 agent 并行时工作树是唯一隔离手段。
3. **写任务书**：按 `brief-template.md`（本目录）七件套填写。三条铁律：票面**照抄不转述**；测试面（pre-agreed seam）钉死、找不到缝就停下问；硬边界第一条就是「不关票」——agy 已两次提前关票（#64/#66），每次验收都要查票状态。
4. **派出**（后台，跑完自动通知，**不挂 sleep 轮询**）。首选 glmfclaude 路线：

```bash
python3 ~/.agents/skills/dispatch-acceptance/driver-glm.py \
  ~/codes/<仓>-wt-<票号> ~/codes/agy-tasks/<票号>/brief.md \
  ~/codes/agy-tasks/<票号>/<票号>-out.ndjson "<允许的工具,逗号分隔>"
```

- driver-glm 经 `zsh -ic` 调 shell 函数 `glmfclaude`（token 留在 ~/.zshrc 不落文件）；**不用** `--dangerously-skip-permissions`，靠 `--allowedTools` 显式白名单——**这份白名单要原样写进任务书**，让实施者知道自己的边界。
- 结果 `type: "result"` 事件即收尾；进度随时可看 ndjson 事件流。
- 本会话已是 GLM（glmfclaude）时跳过本步，直接 Agent 工具派 subagent，任务书原文作 prompt（加「所有命令同步执行」）。
- （agy 恢复后才适用）agy 结果 `status: ERROR` 先查 `error` 字段：`RESOURCE_EXHAUSTED (429)` = 配额尽——**交付可能仍然完整**（提交已落地，死的是收尾调用），查工作树与测试再定性；配额反复撞墙就告知所有者换账号。

### 可选路线：OpenCode + DeepSeek V4.1 Flash（GLM 额度不足时）

```bash
python3 ~/.agents/skills/dispatch-acceptance/driver-opencode.py \
  <工作树> <任务书> <输出.ndjson> [模型] [超时秒]
```

- 默认模型 `deepseek/deepseek-flash`（= **DeepSeek V4.1 Flash 1017**，快、便宜）；难活可传
  `deepseek/deepseek-flash#high` 或 `deepseek/deepseek-v4-pro`。也可用
  `OPENCODE_DISPATCH_MODEL` 覆盖。
- driver 用 `opencode run --standalone --auto --format json --agent build`：
  `--standalone` 起私有 server，不碰当前会话的共享服务；`--auto` 自动批准工具。
- **OpenCode 没有 `--allowedTools`。** driver 只能做两件事：
  1. 启动前检查任务书里确实有硬边界（`不 push` / `不合并` / `不关票` / `禁止`），缺了直接拒派；
  2. 把完整 JSONL 与 `.meta.json`（session / exit / tool_calls / error_events /
     step_finish_reasons / last_text）落盘，供验收复核。
- 命令级边界必须由任务书写死：**允许用哪些工具、允许跑哪些命令、禁止跑哪些命令、
  禁止做哪些动作**。按 `brief-template.md` 的「工具与禁令（OpenCode 路线必填）」段填写，
  不能只写一句“遵守边界”。
- 退出码不可全信：OpenCode 可能在瞬时 transport 错误后仍完成任务但退出 1。
  先看 `.meta.json` 的 `last_text` / `error_events` / `step_finish_reasons`，再以工作树
  `git log/diff` 与测试实跑为准。
- 进度看输出 ndjson 的 `tool_use` / `error` 事件；driver 的 stdout 已投影成 `TXT` / `USE` / `ERR` 行。
- 建议同时把 `--title`（`OPENCODE_DISPATCH_TITLE`）设成票号/活名，便于在 OpenCode 会话里找。

## 二、验收

按序执行，任何一步不过就停下处置，**不带病合并**。

1. **读 result 与 git 本体**。`status: SUCCESS` ≠ 成功（挂后台空转也是 SUCCESS）；**回复文本不可信**——已实证编造 commit 哈希（#65）、编造测试期望值（#64）。一切以工作树 `git log/diff` 与测试实跑为准；回复里引用的票号/哈希/期望值逐个 `git cat-file` 抽查。
2. **查票状态**：`gh issue view <N> --json state`——agy 会提前关票，被关就补发验收记录。
3. **读 diff 本体**：`git diff main...<branch>`，生产码与测试分开看，先分清改动面再深读。
4. **双轴独立审查**：两个 Explore 子代理并行。Spec 轴 = 对照权威原文（C# 源逐段/票面逐条）+ 超纲排查；Standards 轴 = CLAUDE.md 条款 + 同文件先例 + 测试质量（断言外部行为、无空转）+ fmt。C# 移植票的决胜点在 Spec 轴的逐段对照，任务书里点名要求。
5. **亲跑变异**：亲手破坏实现（窄变异，只动受测维度）→ 确认目标断言红 → `git checkout` 还原 → `git status`/`grep` 核对零残留。变异打不中执行路径等于没测。实施者的变异报告不能代替亲跑。
6. **全量 + fmt**：`cargo test --workspace` 零失败 + `cargo fmt --check` 零 diff。偶发 flake 的处置：隔离复跑单套件 → 干净基线连续两次全量绿才放行；复现不了的红记为瞬时负载敏感并留档。
7. **合并与钉子**：`git merge --no-ff`（merge message 带票号与验收摘要）→ **mtapi 才推 origin**，mtcopy 按惯例不推 → mtapi 有变更就顶 `deploy/mtapi.rev` 并三处核对：`cat deploy/mtapi.rev` / mtapi `rev-parse --short HEAD` / `rev-parse --short origin/main` → mtcopy main 复跑全量。
8. **关票与清场**：关票评论写验收记录（亲跑项、双轴结论、修补轮、留档偏离）；删工作树与分支。

## 三、修补轮

验收发现的问题发回**原实施者**（同工作树同分支，driver 重跑 followup 任务书），不走验收方代改。任务书逐条对应审查意见；纯标注/纯文档修补要明说「不改生产行为」；收尾重复全部检查命令。多轮修补后重点查是否引入新偏离（#64 第二轮就清出过成体系漏译）。

## 四、纪律

- **等待靠通知不靠定时器**：后台任务完成自动唤醒；sleep 轮询是已改正的坏习惯。
- **验收记录是唯一完整账本**：亲跑了什么、变异点、双轴结论、留档偏离、边界违规，全部写进关票评论——票是唯一持久面，会话会消失。
- 边界违规（提前关票等）如实向所有者报告并记录，不沉默消化。
