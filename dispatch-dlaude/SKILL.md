---
name: dispatch-dlaude
version: 3.0.0
description: DeepSeek 派活器：用 dlaudef / dlaudep / dlaudefv 把活派给子 agent。这是「用哪个模型」的配置卡；派活机制（任务书 / 白名单 / 发送命令 / 复核）见 orchestrating-agents。
---

# dispatch-dlaude：DeepSeek 派活器

三个 shell 函数都用 DeepSeek 端点驱动 claude，便宜，适合派实现与审查：

- `dlaudep`（deepseek-v4-pro）——思考更强，适合含判断的设计类活。
- `dlaudef`（deepseek-v4-flash）——照着命令直接执行，适合写死的实现类活。
- `dlaudefv`（deepseek-v4-flash-vision）——能看图，适合界面等视觉验收。

拿不准就上 `dlaudef`。命令其余参数三个通用。

⚠️ 这些名字 2026-08-22 改过（`dlaude`→`dlaudef`、`dlaudepro`→`dlaudep`、`dlaudev`→`dlaudefv`），旧名字会 `command not found`。`dlaudefv` 是实验版，探活尤其不能省（更容易整体不可用）。

## 探活

```bash
zsh -c "source ~/.zshrc >/dev/null 2>&1; dlaudef -p 'reply with exactly: OK'"
```

探你这次真要用的那个（探 `dlaudef` 通过 ≠ `dlaudep` / `dlaudefv` 可用）。

探活判据、发送命令、白名单、任务书、收活复核——全部机制见 `orchestrating-agents`，这里不重复。

## 价格与成本

价格见同目录 `PRICING.md`。想知每轮花了多少：`python3 ~/.claude/skills/dispatch-dlaude/dispatch-cost.py`（不带参数扫当前项目 `.scratchpad/`；加 `--flash` 按 Flash 单价折算）。⚠️ 它折算单价未经账单核对，只能当量级看。
