# 任务书模板（填空即用）

> 结构七件套缺一不可。任务书放 `~/codes/agy-tasks/<票号>/brief.md`（agy 会按前缀清理自己的临时目录，别放 /tmp）。

```markdown
# 任务：<仓> #<票号> —— <标题>

先读 `AGENTS.md` 与 `CLAUDE.md`（<仓> 仓的），按它们执行。<要点提示：不写注释/最简实现/测试红绿+变异/fmt 零 diff>。

## 工作区

你在隔离工作树 `~/codes/<仓>-wt-<票号>`（分支 `fix/<票号>-<slug>`，基于 main `<commit>`）干活，
**只在这个目录内写文件**。所有命令同步执行并等输出，不要挂后台。
测试命令用 <仓的测试脚本/惯例>，收尾全量。

## 票面（vfbiby/<仓> #<票号>，照抄）

<Problem / Solution / 测试面逐条照抄——不许转述缩写。测试面就是 pre-agreed seam，
明确写「就用这个，若断言不到就停下在交付说明里问，不自己挑缝」。>

## 执行方式

- 按 `implement` 技能执行，实现用 `tdd`，完成后 `code-review` 自审：
  - `implement` 原文：Implement the work described by the user in the spec or tickets.
    Use /tdd where possible, at pre-agreed seams. Run typechecking regularly, single test
    files regularly, and the full test suite once at the end. Once done, use /code-review
    to review the work. Commit your work to the current branch.
  - `tdd` 与 `code-review`：先读 `~/.agents/skills/<名字>/SKILL.md`，按其执行。
- TDD：先写测试看它红，再最小实现变绿。
- 提交前 `cargo fmt --check` 零 diff（基线现状注明：干净/有旧债不许扫）。
- **变异自证（硬性）**：亲手破坏实现确认断言变红再还原；写明变异点与变红测试名。

## 工具与禁令（OpenCode 路线必填）

OpenCode 没有 `--allowedTools`，这一段就是硬边界，必须写死；只写一句“遵守边界”不算。
走 dlaudep 路线时，把「允许的工具」换成命令行白名单，同样要原样贴进任务书。

### 允许的工具

Read / Write / Edit / Glob / Grep / Bash / TodoWrite（按票增删；不要给用不到的工具）。

### 允许的命令（只列前缀，按票补充）

- 构建/测试：`cargo test`、`cargo fmt`、`bun run test`、`bun run typecheck`、`bun run build`
- 只读：`git status`、`git diff`、`git log`、`git show`、`ls`、`cat`、`head`、`tail`、`wc`、`rg`、`find`
- 提交：`git add`、`git commit`、`git checkout -- <path>`（只用于还原自己的变异）
- 环境：`redis-cli ping`（只探活，不停服务）
- <按票补充>

### 禁止的命令（出现即违规）

- `git push`、`git merge`、`git rebase`、`git reset --hard`、`git tag`、`git branch -D`
- `gh`（任何子命令：关票 / 评论 / 改 label）
- `rm -rf`（项目目录外或未确认的路径）
- 用 `GATEWAY_ALLOW_NO_REDIS=1` 之类的开关掩盖测试失败
- <按票补充>

### 禁止的动作

- 不 push、不合并、不关票、不评论 GitHub 票、不改主线 / 其他工作树
- 不调用真实模型；不跑被禁的测试；不停共享 Redis / 本地栈进程
- 不修改或删除既有测试来规避失败；不新增 `#[ignore]` / `.skip` / `.only`
- 不降低 schema 必填约束、不放宽断言
- <按票补充>

## 边界（硬性）

- **不 push、不合并、不关票、不评论 GitHub 票。**
- 不碰 `<仓>` 主 checkout，不碰 `deploy/mtapi.rev`（钉子是验收方的活），不碰另一仓。
- 不停/不碰任何正在跑的本地栈进程；禁止连接任何真实 MT4/MT5 账号。
- 交付 = 提交到你自己的分支（可多个提交，收尾工作树必须干净）。

## 交付说明要求

1. 改了什么（文件 + 语义一句话；C# 相关票要引原文位置）。
2. 复现命令（具体命令行）。
3. 变异自证：变异点 + 变红测试名。
4. 测试结果摘要（含全量）+ fmt 确认。
5. 异常/疑似 bug 发现如实写明并标观测/推断，不许硬塞。
```

## 按票追加的常用条款

- **大票（>300 行移植/多段）**：分 N 个提交，每段独立绿；「先读透 C#/原文、列判据清单再动笔，清单进交付说明」。
- **修补轮**：沿用同一工作树同一分支；逐条对应审查意见；**不改生产行为的纯标注修补要明说**；收尾重复全部检查命令。
- **真机实验票**：指定账号；禁止用生产栈在用的账号；观察窗活动留给验收方。
- **取证票**：仓库零改动，唯一交付物是报告文件（路径写死）；否定结论必须写证据边界（覆盖了什么/没覆盖什么）；观测与推断分开标。
