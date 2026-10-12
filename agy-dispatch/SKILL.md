---
name: agy-dispatch
description: 派活给 agy（Antigravity CLI，Gemini 驱动）时的调用形态、任务书要点与结果去哪看。
---

# 派活给 agy

`agy` 没有按次授权参数（不像 glmfclaude/dlaudef 能按次给 `--tools`），无人值守只会**直接拒绝**所有工具调用。所以派活带 `--dangerously-skip-permissions`：本次全放行，它可以跑任何命令、写任何文件——因此任务书必须反过来划边界（见下）。

**先在隔离工作树里干，别动主 checkout**（多个 agent 同时在改同一个仓库）。mtapi 侧同理：`~/codes/mtapi-wt-<票号>`、分支 `fix/issue-<票号>-<slug>`。纯只读的活（审查、取证）可以不用工作树；**凡是会写文件的都用**。

```bash
git -C ~/codes/mtcopy worktree add ~/codes/mtcopy-wt-<票号> -b fix/<票号>-<slug> main
cd ~/codes/mtcopy-wt-<票号>
```

## 调用形态：一律用 stream-json（2026-09-19 实测定型）

**`--print` 形态已废弃，禁用**：它挂后台任务后通知回路是断的，见「坑」第一节。替代形态是 `--input-format stream-json`——进程活着，后台任务完成通知能送回 agent，跑完出结构化 `result` 事件（2026-09-19 实验+真机各一次验证：挂后台→system_message 通知→继续干完）。

```bash
{ python3 -c '
import json, sys, time
brief = open(sys.argv[1]).read()
print(json.dumps({"event":"user","message":{"content": brief}}), flush=True)
time.sleep(7200)
' <任务书> | agy --dangerously-skip-permissions --add-dir ~/codes/mtcopy-wt-<票号> \
    --input-format stream-json --output-format stream-json \
    > <输出目录>/<票号>-out.ndjson 2> <输出目录>/<票号>-err.log & }
```

要点：

- **消息格式**：NDJSON 一行 `{"event":"user","message":{"content":"<任务书全文>"}}`——`message` 必须是对象、正文字段是 `content`（传字符串或用 `promptText` 都会报错）。
- **stdin 必须保持打开**（上面用 `time.sleep` 撑着）：提前关掉等于断掉回路。读到 `{"event":"result",...}` 就可以收尾杀进程；result 落地后进程不会自己退。
- **成败与产出看 `result` 事件**：`status`/`response`/`duration_seconds`/`num_turns`/`usage`，语义同旧 `-p` 的 JSON。过程有 `step_update` 事件流（`tool_name`、`text_delta`），汇报可疑直接对照。
- 旧 `-p` 的 `--print-timeout` 对流式形态同样适用（默认无限）。
- **现成驱动脚本**：本技能目录下的 `driver.py`（原底是 mtapi #60 真票实测通过的那份）——subprocess 起 agy、写一行消息、逐行转发 stdout、看到 `result` 就关 stdin 并 terminate，两种结局（`RESULT-SEEN`/`STREAM-ENDED-WITHOUT-RESULT`）都打印标记。派活抄走改 `--add-dir`/`cwd`，比手搓管道省事。
- 备选形态：`script -q <typescript> agy --dangerously-skip-permissions --add-dir <目录> -i '<任务书>'`（伪 TTY 交互模式）同样修通通知回路，但 TUI **不会自动退出**，要靠外部轮询完成信号再杀——只在不方便用管道时用。

- `--add-dir` **必给**：不给会说「没有活动工作区」，连 `AGENTS.md` 都不注入。
- `--print-timeout` 按活的大小给：小问答十几秒，取证/实施类实测约半小时，给 30–40 分钟。

## 任务书

1. **先读规矩**：开头写「先读 `AGENTS.md` 与 `CLAUDE.md`，按它执行」。agy 只自动读 `AGENTS.md`，本仓那份只有一行指路，不点它去读 `CLAUDE.md` 它就不知道本仓规矩。
2. **划边界**：全放行下要写清不许做什么（不许 push、合并、关票；不许停或重启正在跑的本地栈），并写明**交付要提交到自己的分支上**（不写它就只在工作区留改动）。
3. **票号 + 验收条款 + 收尾方式**：照票面抄全，证据写进交付说明，并要求附**复现命令**（「这些数我怎么再跑一遍」）。
4. **真机实验写清账号**：指定用哪些账号，**禁止用正在跑的生产栈所用的账号**——两边会话会互相干扰。
5. **否定结论要写证据边界**：「没有异常」「不会互相影响」这类结论必须说明覆盖了什么、没覆盖什么，并按 `CLAUDE.md` 标成观测或推断。
6. **点名让它走 `implement`**：任务书里写「按 `implement` 技能执行；实现用 `tdd`；完成后用 `code-review` 自审」。这几个技能 agy 侧**看得到**（`~/.gemini/skills/<名字>` 软链到 `~/.agents/skills/<名字>`，`implement`/`tdd`/`code-review` 都在），但它属于「只能手动调」那一类，**任务书点名就等于替它手动调**。两句必须配上：
   - `implement` 里的「pre-agreed seams」= 票面的「**测试面**」；票面没写就停下来问，不许自己挑缝。
   - 它自己另装了 `superpowers` 的 `test-driven-development`（先写测试、看它失败、再最小实现），需要时也可以直接点名用。

   `implement` 原文（万一它的技能没读到，就把这段抄进任务书）：

   > Implement the work described by the user in the spec or tickets.
   > Use /tdd where possible, at pre-agreed seams.
   > Run typechecking regularly, single test files regularly, and the full test suite once at the end.
   > Once done, use /code-review to review the work.
   > Commit your work to the current branch.

## 用哪个技能（`~/.agents/skills/` 下，与 Claude Code 这边同一套）

**任务书里点名技能名 ≠ 替它调用了技能**：`disable-model-invocation`（agy 侧 `allow_implicit_invocation: false`）挡的是模型自己发起调用，点名只是一句话，内容不会自动到达。两条路，按长短选：

- **短技能（几百字节，如 `implement`）→ 把原文抄进任务书**，零依赖。
- **长技能（几 KB 以上的，如 `diagnosing-bugs` 8.5 KB 且带 `agents/`+`scripts/`、`code-review` 6.6 KB、`tdd` 3.5 KB）→ 只写一句**：「先读 `~/.agents/skills/<名字>/SKILL.md`，按它执行；有 `scripts/` 子目录时照它调」——这是**读文件**（它 `allowNonWorkspaceAccess: true`，工作树外也读得到），不是调技能。

按活选：实施 → `implement`（配 `tdd`、完成后 `code-review`）；诊断 → `diagnosing-bugs`；调研 → `research`；拷问/定案 → `grilling`。

## 结果去哪看

- **stdout 就是结果**：stream-json 形态下逐行输出 NDJSON 事件（`init` → `step_update`… → `result`）。判成败只看 `result` 事件的 `status`（`SUCCESS`）与 `response`（收尾汇报），`duration_seconds`、`num_turns`、`usage{...}`、`conversation_id` 同一行里。**没读到 `result` 就是还没跑完。**
- **输出与任务书要放它清理范围之外的目录**：它收尾会按前缀删自己的临时文件，曾把放在 `/tmp/agy-<票号>-*` 的任务书和输出一起删掉。
- **它自己的完整记录**在 `~/.gemini/antigravity-cli/brain/<conversation_id>/`（挂过的后台任务日志在 `.system_generated/tasks/`），汇报可疑时去那里核对它到底跑了哪些命令。验收顺序：先读 `result` → 再 `git log/diff` 看它实际改了什么 → 有疑问翻 transcript。

## 坑

- **~~挂后台命令会杀死整个会话~~（2026-09-18/19 九跑实证 → 2026-09-19 已修，见「调用形态」）**：死因是 `--print` 形态下通知回路断——`run_command` 带 `WaitMsBeforeAsync`（工具描述还**主动推荐**用它，系统提示词明说「Prefer the tool's own backgrounding over shell backgrounding」），命令超时转后台任务后 agent end turn 等通知，print 模式 CLI 只等 5 秒就 terminating。任务书纪律条款压不住（系统提示词优先）。**修法 = 换 stream-json 或伪 TTY 交互形态，让通知回路活着**；不是提示词能解决的。首票真机实测已过（2026-09-19 午，mtapi #60：stream-json 驱动派实施票，完整交付+验收过）。
- **`agy` 升级不解决问题**：1.2.7（2026-09-19 最新）二进制里就是这个行为；changelog 1.2.6/1.2.7 无相关修复。
- **`--print-timeout` 值必须带时间单位**（如 `40m`），裸数字会 usage error 直接退出（mtapi #60 实测）。
- **账号有额度上限**：撞到限额就派不动了，输出会是错误而不是结果——遇到就如实告诉所有者，他会换一个账号登录后即可继续。
- 工具被拒时**退出码仍是 0**，只在正文打印一行 `jetski: …auto-denied`；判成败要看 `status` 和正文，不能看退出码。
- `-c` 续聊与 `--mode plan` 的实际行为没验过，别当已知。
