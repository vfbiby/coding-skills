---
name: dispatch-glm
version: 1.0.0
description: GLM 派活器：用 glmclaude / glmfclaude 把活派给子 agent。这是「用哪个 GLM 模型」的配置卡；派活机制（任务书 / 白名单 / 发送命令 / 复核）见 orchestrating-agents。触发于「用 glm 派活」「用 glmfclaude 跑」「派 agent 去实现」且想用 GLM 时。
---

# dispatch-glm：GLM 派活器

两个 shell 函数都走智谱官方 GLM Coding Plan 端点驱动 claude：

- `glmclaude`（glm-5.3，subagent 位 glm-5.2 / 5.1）——主模型更强，适合含判断的设计类活。
- `glmfclaude`（glm-5.3-flash）——全 flash，便宜快，适合写死的实现类活。

拿不准就上 `glmfclaude`。命令其余参数两个通用。

⚠️ 本机还有走**别的服务商**的 GLM 命令（`hsglmcc` 火山引擎、`rtocglmcc` 中转站、`glaude` 依赖默认配置），本卡只覆盖智谱官方这两个。

## 探活

```bash
zsh -c "source ~/.zshrc >/dev/null 2>&1; glmfclaude -p 'reply with exactly: OK'"
```

探你这次真要用的那个（探 `glmfclaude` 通过 ≠ `glmclaude` 可用）。

探活判据、发送命令、白名单、任务书、收活复核——全部机制见 `orchestrating-agents`，这里不重复。

## 价格与成本

价格**待核对**（本卡暂无账单依据），成本统计脚本也待适配 GLM 单价——现在的脚本只按 DeepSeek 单价折算，对 GLM 只能当 token 量级看。
