---
name: broker-topology-probe
description: 实测 MT4/MT5 券商集群拓扑——找中央撮合服务器在哪、各接入点的后腿多长、跟单服务器放哪最快。触发：测券商服务器、找中央撮合、跟单服务器择位、挂单延迟分解、单账本验证。
---

# 券商集群拓扑探针（中央撮合定位 + 择位）

问题：券商给一串接入服务器 IP，订单最终汇总到哪台中央撮合？跟单服务器放谁旁边最快？
原理：MT4/MT5 是「多接入 + 单中央」架构，接入只转发不撮合。**挂单 RTT − TCP RTT ≈ 该接入到中央的后腿×2**，残差最小的接入就是中央的邻居；跨接入交叉管理挂单可坐实单账本。

## 纪律（先读）

- **只挂单、不市价单**：远偏移挂单（偏移要远超品种日波幅，如 BTCUSD 300、XAUUSD $500）+ 即挂即删，永不成交、零市场风险。跑完 `positions` 复核无残留。
- 账号凭据只存 `~/codes/mtcopy-demo-accounts/`（仓库外），不进仓库、不贴 issue。
- 全程本地单调钟计时；服务器时间戳（open_time 等）是秒级 + 券商钟差，**不用于计时**。
- 挂单实验先 demo 后 live；live 账号零余额可能被券商 `Trade is disabled`（账号级开关，入金恢复），登录/行情仍可用。

## 工具

`mtprobe/`（探针源码，双协议；`build.sh [mtapi目录] [输出目录]` 编译，MTAPI DLL 在 `~/codes/mtapi/*.dll`）：

```bash
mtprobe <mt4|mt5> <host> <port> <login> <password> ping <n>        # TCP 握手 RTT×n（5s 超时）
mtprobe <mt4|mt5> <host> <port> <login> <password> login           # 登录 RTT + balance/equity
mtprobe <mt4|mt5> <host> <port> <login> <password> symbols [过滤]   # MT5：列品种（美分户常带 .r/.m 后缀）
mtprobe <mt4|mt5> <host> <port> <login> <password> smoke <sym>     # 一单挂删走通全流程
mtprobe <mt4|mt5> <host> <port> <login> <password> pending <sym> <lots> <offset> <n> [gapMs]
                                                                   # 挂删×n，末尾打 min/p50/p95/max
env MTPROBE_BUILD=<build>                                          # 覆写客户端 build 号（排协议兼容）
```

云上观测点：uk 服务器 `ssh root@57.129.160.113` 留有静态二进制 `/root/mtprobe`（伦敦视角，接近多数券商中央）。重传：`scp target/linux-x64/mtprobe root@57.129.160.113:/root/mtprobe`。

## 流程（按序，前两步不要交易权限）

1. **TCP 矩阵**：两个观测点（本机 + uk）对所有 IP `ping 3`。可达性是硬约束（CN 网络常不通海外 Azure 段；唯一全网 refused 的节点是券商 ACL，放弃）。私网 IP（10.x）直接跳过。
2. **判协议 + 判集群归属**：拿目标账号对每台可达节点 `login`。
   - 协议不对：MT4 握手对 MT5 服务器会回 `Invalid account`，MT5 握手对 MT4 口则断线——两个协议都试。
   - **正确集群上错账号 → 正经回 `INVALID_ACCOUNT`；错误集群上任何账号 → 静默断线**。所以「全部节点都静默断线」≠ 节点坏了，先怀疑列表是别的集群的。正向对照：拿一个已知能连的同券商账号跑一遍。
   - 4/4 节点 balance/equity 一致 = 单一账号后端（第一条证据）。
3. **挂单分解**：对每个可达节点 `pending <sym> <lots> <offset> 10~15 800`，同一观测点跑完所有节点再换观测点。**残差 = order p50 − TCP p50**：残差最小的接入 ≈ 中央所在；其余接入的残差带有「回中央」的地理特征（用城市间物理 RTT 对表：伦敦↔SG ~170ms、HK↔SG ~35ms、东京↔SG ~70ms），可圈到城市级。
4. **单账本铁证**：从接入 A 挂一对远挂单（mtcli `limit`/`stop`，或探针改挂不删），从接入 B `positions` 看到同票号并 `delete`，回 A 复核已清。
5. **择位结论**：跟单服务器放「残差最小的接入」旁边，用该位置的端到端 order p50/p95 收口。注意接入离中央远时，客户端本地再近也白搭（每单都背接入↔中央回程，实测香港接入到伦敦中央 377ms）。

## 判读示例（Lirunex 实测 2026-10-01）

uk 视角：185.96.244.198（Beeks 伦敦）TCP 2ms / 挂单 p50 5.4ms（后腿 ~3ms）＝中央在此；119.42（香港接入）TCP 186ms / 挂单 377ms；92.223 TCP 236ms / 挂单 409ms——远程接入每单多背 170–190ms。跨洲挂单交叉管理坐实单账本。

## 坑

- zsh 里 `set -- $var` 不分词，逐台循环要把参数写全（`for host in a b c` + case 转端口）。
- dotnet 的 obj 目录被 publish/build 混用会报 CS0579 重复特性——删干净 `obj/ bin/` 和自定义 obj 路径再编。
- mtcli 每次调用重新登录 ~5s，只能做交叉管理这类不计时的操作；计时一律 mtprobe。
- MT5 美分户品种名带后缀（XAUUSD.r），先 `symbols` 过滤再挂；`limitPoints` 是最小挂单距离（点）。
- demo 集群结论不可外推到 live（托管商可能都不同，AXPM demo=Beeks SG + Azure SG、live=纯公有云）；券商可能对零余额 live 账号关交易。
