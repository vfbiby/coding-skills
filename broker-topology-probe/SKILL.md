---
name: broker-topology-probe
description: 实测 MT4 券商集群拓扑：找中央服务器在哪、跟单服务器或接入点选哪个最快。全程只读登录，不下单，实盘号也能测。触发：测券商服务器、找中央撮合、跟单服务器择位、选接入点、跟单延迟高怀疑接错接入点。
---

# 券商集群拓扑探针（报价到达法）

问题：一个 MT4 服务器名（如 `EBCFinancialGroupKY-Live04`）背后有一串接入点，中央服务器在哪？跟单服务器放哪、连哪个接入点最快？

原理：MT4 是「多接入点 + 单中央」。中央把每一笔报价推给所有接入点，再由接入点转给客户端。从**同一个观测点**同时连上全部接入点，同一笔报价最先到的接入点就挨着中央。各点晚到的时间扣掉「观测点到该点的单程」（RTT/2），剩下的就是该点回中央的单程后腿。报价源源不断，几分钟就能攒几千个样本，而且零交易。

## 纪律

- **只读**：探针只登录、订阅报价，代码里没有任何下单路径。实盘号测之前也要先征得所有者授权。
- **密码**：在观测点上从库里直接读出来，经环境变量喂给探针，不写进命令行参数、文件或日志。用完 `unset`。
- **不打扰生产会话**：同一账号会多开最多 N 条连接（N = 接入点数）。先只跑一次 `cluster`，确认生产网关那边没有该账号的断线，再跑 `ticks`。跑完再查一次网关日志。
- **计时只用本地单调钟**：探针打的是 `Instant`。服务器时间戳只到秒级，还带券商钟差，只用来匹配报价。
- **收尾**：远端的二进制和 csv 删掉。

## 工具（都在本目录）

```bash
./build.sh                                   # 产物在 ~/.cache/brokerprobe/{release,x86_64-unknown-linux-gnu/release}/brokerprobe
MT4_LOGIN=.. MT4_PASSWORD=.. brokerprobe cluster <host:port>
                                             # 登录一次，打印服务器名、公司，以及集群全部接入点（地址 + 描述）
MT4_LOGIN=.. MT4_PASSWORD=.. brokerprobe ticks <秒> <品种,品种> <host:port>...
                                             # 同时连所有点并订阅，stdout 每行：连接序号,本地微秒,品种,bid,ask,服务器毫秒
python3 -I tcpping.py <host:port>...         # 每点 10 次 TCP 握手，打 min/p50
python3 -I analyze.py ticks.csv 标签=tcp_min_ms ...
                                             # 标签顺序 = ticks 的 host 顺序；自动取抢先最多的点作基准
```

探针依赖 `~/codes/mtapi/mt4_rust`（路径依赖）。远端是 x86_64 Linux，用 zigbuild 产物，scp 到 `/tmp` 即可跑。

观测点：
- uk（伦敦，`ssh -i ~/.ssh/id_ed25519_uk -o IdentitiesOnly=yes ubuntu@57.129.160.113`，root 不可登）。库里读密码：`sudo -n -u postgres psql -d mtcopy -Atc "select mt_password from trading_accounts where login=<login>"`。
- 本机 ccusb（美国俄勒冈）。

## 流程

1. **拿接入点列表**：任选一个能连的点跑 `cluster`。列表里同城常有「域名」和「裸 IP（描述带 P）」两个入口，`getent ahostsv4` 解析后同 IP 的只留一个。
   完成标准：每个物理接入点都有一个可连的 `host:port`。
2. **握手矩阵 + 托管归属**：两个观测点各自对所有点跑 `tcpping.py`。逐 IP 查 `curl -s ipinfo.io/<ip>/json` 的城市和 AS。Beeks、Equinix 这类金融托管是中央的强候选，阿里云等公有云多半只是接入。
   完成标准：每个点都有两个观测点的 tcp min，以及城市和 AS。
3. **报价到达对比**：在伦敦观测点跑 `ticks 180 <账号常用品种,一个主流外汇>`，然后跑 `analyze.py`，RTT 填该观测点的 tcp min。品种名要带券商后缀（如 `XAUUSD.s`），去库里的 `copy_intents.signal_symbol` 查。
   完成标准：匹配到 1000 笔以上「所有连接都收到」的报价。stderr 里没有 `login_failed`；有就去掉那个点重跑。
4. **换观测点交叉验证**：在另一个观测点重跑第 3 步。两次的抢先点和后腿排序一致，才说明结论来自集群本身，而不是观测点的位置。
5. **结论**：中央 = 两次都抢先、后腿约 0 的接入点所在的城市。跟单服务器放那座城市，连那个接入点。再拿生产里「发单 → 回执」的中位数和 p90 做前后对比收口（库里 `copy_intents.timeline` 的 `send_requested` / `receipt_arrived`）。

## 判读

- `first` 列：抢先次数。中央旁边的点占绝大多数，远端点应接近 0。
- `backleg vs ref`：相对基准点多出来的单程。同城两个点相差几毫秒，跨洲 60～150ms。
- `lag p10` 为负是基准连接自身的抖动，看 p50。
- 想把远端点换算成城市级距离，可对照城市间物理 RTT 表；但路由常绕路，只当参考。定位以「谁抢先」为准。

## 坑

- mtapi 的 `QuoteClient::cluster_details()` 对 EBC 的 srv 解析出 0 条。探针直接扫 `latest_srv()` 原始字节（地址后偏移 68 字节是描述）。
- 用 bash 的 `/dev/tcp` + `timeout` 计时会多出约 110ms 进程开销，握手一律用 `tcpping.py`。
- 中国大陆接入点从海外连会丢包、偶发 1 秒以上的重传握手，所以看 min，不看均值。
- MT4 登录要 3～10 秒（走 `loginid-mt4.mtapi.io` 解码握手哈希，生产网关同样如此，不含密码）。`ticks` 的录制时长从启动就开始算，要留出余量。
- 报价匹配键是 (品种, bid, ask, 服务器秒)。同一秒内价格来回会撞键，脚本丢弃各连接到达跨度超过 2 秒的键。
- 目前只支持 MT4。MT5 需要用 `~/codes/mtapi/mt5_rust` 另写一个同样形状的 `ticks`。

## 判读示例（EBC Live04，2026-11-06）

伦敦观测点、180 秒、2761 笔匹配报价。dc42 伦敦（Beeks，tcp 1.7ms）抢先 1463 次，dc51 伦敦（阿里）晚 3ms，dc78 法兰克福晚 15ms。北京、上海、深圳晚 150～195ms，香港晚 240～250ms，这几个点抢先 0 次。换美国观测点重跑，排序相同，中国点仍晚 150ms 以上。结论：中央在伦敦，应连 `dc42.isdata.cloud:10442`。当时用户接的是上海 `47.100.203.21:10468`，每单要绕伦敦↔上海一圈，发单到回执约 450ms。
