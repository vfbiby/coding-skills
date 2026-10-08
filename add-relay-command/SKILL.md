---
name: add-relay-command
description: 把一个 API 中转站（relay/gateway）接入某个 CLI（Claude Code、Codex CLI 等），做成 ~/.zshrc 里的独立启动命令。触发：用户给了中转站说明文档/密钥，想「跟 robclaude/geminiclaude/robcodex 一样做一个命令」时。
---

# 中转站接入为独立命令

用户的固定组织方式（用户明确拒绝安装包和 GUI 管理器）：**不改任何现有配置**，每个中转站×CLI 组合一个 zsh 函数 + 一个隔离配置目录。现有先例：`glmfclaude`/`glmfxclaude`（GLM）、`robclaude`（Claude 系）、`geminiclaude`（Gemini 系）、`robcodex`（GPT 系）。

## 流程

### 1. 收集要素

从说明文档和用户处拿到：CLI 类型（claude/codex/…）、Base URL、密钥、可用模型列表（没有就先第 2 步拉）、默认模型。**先例命令名可复用**——同名函数已存在时是改配置，不是新建。

### 2. 验密钥、拉模型列表（写任何文件之前）

```bash
curl -sS -o /tmp/<名>_models.json -w "HTTP %{http_code}\n" --max-time 20 "<BASE_URL>/v1/models" \
  -H "Authorization: Bearer <KEY>" -H "x-api-key: <KEY>"
python3 -c "import json; [print(m['id']) for m in json.load(open('/tmp/<名>_models.json'))['data']]"
```

- 非 200 或分组不对（如要 claude-* 却只有 gpt-*）→ 停，告诉用户换密钥，不写任何文件
- 模型列表决定默认模型和档位映射，**逐档 PONG 实测**（见第 5 步），别只测默认档

### 3. 建隔离配置目录

**Claude Code**：`~/.claude_<名>/`，子项符号链接回 `~/.claude` 共享（agent-memory agents backups cache file-history history.jsonl hooks jobs paste-cache plans plugins projects session-env sessions shell-snapshots skills tasks telemetry），自有文件两个：
- `settings.json`：`availableModels`（用户点名要哪些模型就只放哪些）+ `theme`。注意：Claude Code 会自己改写这个文件（`model`、`modelSettings` 等键是用户在 /model 里按出来的），整理时一并理顺
- `.claude.json`：`{"hasCompletedOnboarding": true}`

**Codex CLI**：`~/.codex_<名>/`，只两个文件，用户的 `~/.codex` 不动：
- `config.toml`：`model_provider`/`model`/`review_model` + `[model_providers.<id>]`（`base_url` **带** `/v1`、`wire_api = "responses"`、`requires_openai_auth = true`）
- `auth.json`：`{"OPENAI_API_KEY": "<KEY>"}`

### 4. 写 ~/.zshrc 函数

追加到文件末尾，带一行 `# <中转站> — use via `<命令>` command` 注释头。命名跟先例风格（中转站缩写+CLI 名）。

**Claude Code 版**——`-u` 清泄漏变量是硬要求，一个都不能少（GLM 会话的 `ANTHROPIC_MODEL=glm-*` 泄漏进来会报「selected model 不存在」，这是用户上次 robclaude 失败的真因）：

```zsh
<命令>() {
  env \
    -u ANTHROPIC_API_KEY \
    -u ANTHROPIC_MODEL \
    -u ANTHROPIC_DEFAULT_OPUS_MODEL \
    -u ANTHROPIC_DEFAULT_SONNET_MODEL \
    -u ANTHROPIC_DEFAULT_HAIKU_MODEL \
    -u CLAUDE_CODE_SUBAGENT_MODEL \
    -u ANTHROPIC_SMALL_FAST_MODEL \
    CLAUDE_CONFIG_DIR="$HOME/.claude_<名>" \
    no_proxy="localhost,127.0.0.1" \
    NO_PROXY="localhost,127.0.0.1" \
    ANTHROPIC_BASE_URL="<根地址，不带 /v1>" \
    ANTHROPIC_AUTH_TOKEN="<KEY>" \
    ANTHROPIC_MODEL="<默认模型>" \
    ANTHROPIC_DEFAULT_OPUS_MODEL="<opus 档>" \
    ANTHROPIC_DEFAULT_SONNET_MODEL="<sonnet 档>" \
    ANTHROPIC_DEFAULT_HAIKU_MODEL="<haiku 档>" \
    CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY="1" \
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC="1" \
    claude "$@"
}
```

要点：用 `ANTHROPIC_AUTH_TOKEN` 不用 `ANTHROPIC_API_KEY`；BASE_URL 是根地址（claude 加 `/v1` 会全模型报错，codex 反而要带）；分组缺某档（如 Claude 分组无 haiku）就映射到邻近档。

**Codex 版**精简得多：

```zsh
<命令>() {
  env \
    -u OPENAI_API_KEY \
    CODEX_HOME="$HOME/.codex_<名>" \
    codex "$@"
}
```

### 5. PONG 实测

用与函数**完全相同**的环境直接跑（绕过没生效的函数）：

```bash
# claude
env -u … CLAUDE_CONFIG_DIR=… ANTHROPIC_BASE_URL=… claude -p "Reply with exactly: PONG" --model "<档位>"
# codex
env -u OPENAI_API_KEY CODEX_HOME=… codex exec --skip-git-repo-check "Reply with exactly: PONG"
```

每个对外档位都测。测新配置时留着当前会话的泄漏变量跑，正好验证 `-u` 防线有效。

### 6. 收尾

- 结果记入备忘 `mt9-robclaude-robinsonai.md`（或新建），MEMORY.md 索引行同步
- 提醒用户：**开新终端**（或 `source ~/.zshrc`）再用新命令

## 排障速查

| 症状 | 根因 |
|---|---|
| 「selected model 不存在」但模型确实在列表里 | 终端泄漏了其它中转站的 `ANTHROPIC_MODEL`/`ANTHROPIC_DEFAULT_*_MODEL`，检查函数 `-u` 是否齐全；或恢复旧对话沿用旧模型，`/model` 切一下 |
| 503 "No available accounts" | 中转站上游没号，服务端问题，本地无解，等恢复或找客服 |
| 全模型报 "issue with the selected model"（claude） | BASE_URL 误带了 `/v1` |
| 改了函数不生效 | shell 里还是旧定义，开新终端或 `source ~/.zshrc` |
| banner 显示的模型跟预期不符 | 同上，或用户在 /model 里选过、被记进 settings.json 的 `model` 键 |
