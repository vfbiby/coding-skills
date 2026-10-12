---
name: mtcopy-dispatch
description: mtcopy/mtapi 项目专属的派活与验收层——派本项目活、验收本项目的票（尤其 C# 移植票）、顶 mtapi 钉子、查审计表与 ADR、用抓包/demo 账号等项目资产时，叠加本技能与通用 dispatch-acceptance 一起用。
---

# mtcopy 项目派活与验收

流程骨架走通用技能 **dispatch-acceptance**（派活五步/验收八步/修补轮/纪律），本技能只补**项目层**：仓库事实、验收特殊项、资产索引。两层叠加使用。

## 一、仓库事实（派活前必核对）

| 项 | mtcopy | mtapi |
|---|---|---|
| GitHub | vfbiby/mtcopy | vfbiby/mtapi |
| 推送惯例 | **不推**（本地 main 即权威） | **推 origin**（钉子所指提交必须在 origin） |
| 测试 | `deploy/scripts/cargo-test.sh [args]` | 按 mtapi 仓 AGENTS.md 惯例 |
| 额外门 | `deploy/scripts/acceptance.sh`（四道门，约 10 分钟） | `cargo fmt --check`（#61 后基线干净） |
| 特殊 | `deploy/mtapi.rev` 钉子（path 依赖版本） | 改动落 main 后由验收方顶钉子 |

**钉子三处核对**（mtapi 变更后必做）：`cat ~/codes/mtcopy/deploy/mtapi.rev` ≡ mtapi `rev-parse --short HEAD` ≡ `rev-parse --short origin/main`。工作树留脏会挡发布。

**C# 权威源**：mtapi `sources/mt5api/`、`sources/MT4ServerAPI/`——移植票的 Spec 轴审查一律逐段对照这里，审计表/票面转述不作数。第一原则：与 C# 不一致就是 port gap；「当前没人调」只定影响面。豁免通道：对齐会破坏移植架构时做行为等价的替代实现并留档（先例：#64 margin 读时重算）。

## 二、验收的项目特殊项

- **C# 移植票**：Spec 轴必须逐段对照 `sources/` 原文（含 C# 的怪癖也照搬才算等价）；交付方引用的判据位置要亲验（#64 票面判据名就引错过）。
- **「完整移植」表述警觉**：#64 曾以.partial 范围冒充完整（挂单路径漏译被双轴抓出）——审计表/票面的「已完整」要对着漏译清单核。
- **项目的既有缝**：mtcopy `alert/engine.rs` 规则测试、`session.rs` StubDriver 对账缝、mtapi `crypto_tests`/注入 transport 缝、margin 模块纯函数缝——票面没给缝就引这些先例。
- **实盘形态**：主力账户 hedging 双向持仓——凡「简化公式 vs 完整实现」的取舍按 hedging 场景判够不够。
- **观察栈**：本机在跑网关/platform/nginx，**停/重启/碰进程都在硬边界外**；杀网关只用 `pkill -x mtcopy-gateway`（`-f` 会误杀自家哨兵）。运行手册见 memory `mtcopy-local-native-stack-ops`。

## 三、项目资产索引

**技能**（`~/.claude_glmf/skills/`）：
- `wire-diff`——报文级差分取证。**凡想把行为差异归因到「服务端/券商侧」，先跑差分**；「参考实现不踩坑我们踩」类问题必用。实战注记含解密型 MITM 方法。
- `mt4-demo-account`——GetDemo 申请 virgin MT4 账号做真机实验。
- `mtcopy-dispatch`（本技能）/ `dispatch-acceptance`（通用流程）/ `agy-dispatch`（agy CLI 深坑）。

**工件目录**：
- `~/codes/agy-tasks/`——每票一目录（任务书 + ndjson 输出）。重点存量：`57/`（踢断案探针与日志）、`57-packetdiff/`（抓包报告 + proxy.py；其自定义 SHA1 的第 4 轮常数曾抄错为 3238371032 导致 #59 立案的假 gap，2026-09-20 已修为标准值 3395469782 并是唯一权威版本）、`38-recheck/`（#38 审计表复核）。**取证工具的算法常数先对标准表核再用**——工具抄错会伪造 gap（#59 教训）。
- `~/codes/mtcopy-demo-accounts/`——demo 凭据（chmod 600，不入仓不入票）。
- `~/codes/mtcopy-wt-<票号>/`、`~/codes/mtapi-wt-<票号>/`——隔离工作树（验收完即删）。

**真账号与观察栈材料**（均 gitignored，永不入库）：
- `deploy/etc/accounts.local.json`——真账号归档母本（信号/跟单/走查对的角色钉在同名 `_说明.md`）。**它是母本，别手编**：观察栈的 `~/.local/share/mtcopy-local/etc/accounts.json` 由它派生（逐条加 `catalog_filter/copy_magics/connect_timeout_ms`）；归档结构会被并发会话改，解析前先看形状。派生与起停细节见 memory `mtcopy-local-native-stack-ops`。
- `deploy/etc/certs.local/`——`*.mtcopy.cc` Origin 证书+私钥。
- `tools/broker-lab/`——真机实验工具箱（`close-burst.sh` 主动补料、`accept-market/accept-pending.sh`、`gw.py` 等，`lab.env` 配置）。**跑前先 `build.sh`**：`target/release` 与 `target/broker-lab` 会被并发会话整目录清掉，用前先 ls 确认。补料/实验选账号看归档角色说明，**禁用观察栈在用的账号**。

**项目文档**（权威落点，引用前先确认仍在）：
- mtcopy：`CONTEXT.md` + `docs/adr/`（0002 错误面对齐、0013 告警语义、0028 多端登录不互踢等）。
- mtapi：`docs/superpowers/specs/mt5-porting-pitfalls.md`（a12/a17 偏离史）、`docs/mt5-event-and-order-surface-audit.md`（事件/下单面对账表，**带处置状态列**，引用前看状态）、`docs/mt5-coverage-audit.md`（逐文件表，挡不住文件内偏差——下钻用对账表）。
- 已知偏差账本：a12（margin 完整计算，#64/#66 已移植持仓+挂单两腿）、a17（CLI 范围取舍）、CFDIndex/ExchangeBounds margin 记 0 容差、舍入语义 half-away vs 银行家——细节在审计表「已知边缘备注」小节与码内注释。

## 四、 issue 面约定

- 实施票标 `ready-for-agent`，待裁决标 `needs-triage`；裁决定案后改标签并把裁决写进评论（先例：#64）。
- 关票评论是**唯一持久账本**：亲跑项、变异点、双轴结论、修补轮、留档偏离、边界违规全部写入。
- 引用类内容（票号/commit/期望值）一律对交付物本体抽查——agy 回复文本两次实证失真。
