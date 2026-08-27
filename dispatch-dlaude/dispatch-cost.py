#!/usr/bin/env python3
"""统计 dlaude 派活的耗时与 token 消耗，并可与 DeepSeek 账单对账。

────────────────────────────────────────────────────────────────────────
用法
────────────────────────────────────────────────────────────────────────
  dispatch-cost.py                      # 不给目录 → 列出本机所有候选 scratchpad 供你挑
  dispatch-cost.py <日志目录>            # 统计该目录下的 *.log
  dispatch-cost.py <日志目录> --bill <账单目录或 amount-*.csv>   # 顺便和账单对账

────────────────────────────────────────────────────────────────────────
日志在哪（其他 agent 最常卡在这一步，所以写死在这里）
────────────────────────────────────────────────────────────────────────
派活配方里那条命令用 `tee "$S/task.log"` 落盘，`$S` 是**当前会话的 scratchpad 目录**，
形如：

    /private/tmp/claude-<uid>/<项目路径转义>/<会话 UUID>/scratchpad/

  - `<uid>` 是 macOS 上的用户 id（如 `claude-501`）；
  - `<项目路径转义>` 是仓库绝对路径把 `/` 换成 `-`，如
    `-Users-zhangsike-codes-mt-investor-plateform`；
  - `<会话 UUID>` **每个会话都不同**——所以「上一个会话的日志」不在你自己的 scratchpad 里，
    要按修改时间去别的 UUID 目录里找。

找法（本脚本不给目录时就是干这个）：

    ls -dt /private/tmp/claude-*/*/*/scratchpad 2>/dev/null | head

⚠️ 这些目录是**临时的**，系统清理临时文件时会一起没掉；跨天的趋势别指望它（见 O-87）。

────────────────────────────────────────────────────────────────────────
两个必须知道的偏差（不写清楚就会得出比账单小一截的数）
────────────────────────────────────────────────────────────────────────
1. **被杀 / 还在跑的轮次统计不到，但账单照收。** 用量的权威值只在日志最后那条 `result`
   事件里；进程被 kill 就没有这条。流式的 `assistant` 事件里也带 usage，但那是中途快照
   （实测输入多算 8 倍、输出恒为 0），**不能拿来补**。本脚本对这类轮次只标注，不猜数。
   实测代价：一轮被杀的实现（30 分钟）在表里显示为空，而它在账单上是十几元。
2. **账单是按 API key 汇总的，不是按会话。** 同一个 key 上如果还有别人（另一个 AI 会话、
   另一个项目）在跑，账单会比你这一个 scratchpad 的合计大。对账对不上时先想这条。

────────────────────────────────────────────────────────────────────────
单价
────────────────────────────────────────────────────────────────────────
来自 DeepSeek 官网价目表（USD），与用户导出的账单 CSV 的 `price` 列（CNY）逐项核对一致，
汇率 6.82。**高峰时段（官网原文）：UTC 01:00–04:00 与 06:00–10:00，周一至周五**——换成北京时间是
工作日 09:00–12:00 与 14:00–18:00，其余（含整个周末）全部错峰、单价减半。
⚠️ 日志里的 `total_cost_usd` 是 claude-code 按 Anthropic 价目算的，与 DeepSeek 无关，本脚本不读它。
"""
import csv, glob, json, os, sys, time
from collections import defaultdict

# CNY / 1M token。官网 USD × 6.82，与账单 CSV 的 price 列逐项吻合。
# vision（deepseek-v4-flash-vision-exp）与 flash 同价；图片按尺寸折成 input token 一起计费。
PRICE = {
    "flash": {"off": {"in": 1.5, "cached": 0.05, "out": 4.5},
              "peak": {"in": 3.0, "cached": 0.10, "out": 9.0}},
    "pro":   {"off": {"in": 4.5, "cached": 0.15, "out": 13.5},
              "peak": {"in": 9.0, "cached": 0.30, "out": 27.0}},
}
# 高峰时段（官网原文）：UTC 01:00–04:00 与 06:00–10:00，**周一至周五**；其余全部错峰。
# 换算成北京时间就是工作日 09:00–12:00 与 14:00–18:00，周末全天错峰。
# ⚠️ 判定必须在 UTC 上做——按本地时钟写死区间，跨时区或改了系统时区就会静默算错档。
PEAK_UTC_HOURS = set(range(1, 4)) | set(range(6, 10))


def discover():
    """列出本机所有候选 scratchpad，按修改时间倒序。"""
    dirs = glob.glob("/private/tmp/claude-*/*/*/scratchpad")
    dirs = [d for d in dirs if glob.glob(os.path.join(d, "*.log"))]
    if not dirs:
        sys.exit("本机没有找到任何带 *.log 的 scratchpad 目录。\n"
                 "手动找：ls -dt /private/tmp/claude-*/*/*/scratchpad")
    print("带派活日志的 scratchpad（按修改时间倒序，越靠上越新）：\n")
    for d in sorted(dirs, key=os.path.getmtime, reverse=True):
        logs = glob.glob(os.path.join(d, "*.log"))
        t = time.strftime("%m-%d %H:%M", time.localtime(os.path.getmtime(d)))
        print(f"  {t}  {len(logs)} 个日志  {d}")
    print("\n挑一个再跑一次：dispatch-cost.py <上面某一行的目录>")


def read_result(path):
    """取最后一条 result 事件；没有就是还在跑或被杀（见文件头偏差 1）。"""
    res = None
    for line in open(path, encoding="utf-8", errors="replace"):
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            d = json.loads(line)
        except ValueError:
            continue
        if d.get("type") == "result":
            res = d
    return res


def tier_of(epoch):
    """按 UTC 判高峰：周一至周五的 01–04 与 06–10 点。其余（含周末）全是错峰。"""
    u = time.gmtime(epoch)
    if u.tm_wday >= 5:                      # 周六 / 周日
        return "off"
    return "peak" if u.tm_hour in PEAK_UTC_HOURS else "off"


def family(model_name):
    """`deepseek-v4-flash[1m]` / `...-vision-exp` → flash；认不出按 pro（贵档，宁可高估）。"""
    return "flash" if "flash" in model_name else "pro"


def load_bill(path):
    """读账单目录或 amount-*.csv，返回 {(小时, 模型族): 元}。逐行各用各的单价——
    同一小时可能横跨错峰边界而出现两档，用一个字典存单价会被后一档覆盖（实测把
    全天总额算成了两倍）。"""
    files = ([path] if path.endswith(".csv")
             else sorted(glob.glob(os.path.join(path, "amount-*.csv"))))
    if not files:
        sys.exit(f"{path} 下没有 amount-*.csv")
    if len(files) > 1:
        print(f"⚠️ 读到 {len(files)} 份 amount-*.csv。DeepSeek 的导出**按天和按区间是两份重叠的文件**"
              "（区间那份把整段汇总成一行），一起读会重复计算。只给其中一份。\n")
    out = defaultdict(float)
    for f in files:
        for r in csv.DictReader(open(f, encoding="utf-8-sig")):
            if r["type"] == "request_count" or not r["price"]:
                continue
            out[(r["start_time_iso"][:13], family(r["model"]))] += float(r["price"]) * int(r["amount"])
    return out


def main():
    argv = sys.argv[1:]
    bill_path = None
    if "--bill" in argv:
        i = argv.index("--bill")
        bill_path = argv[i + 1] if i + 1 < len(argv) else sys.exit("--bill 后面要给账单目录或 csv")
        argv = argv[:i] + argv[i + 2:]
    if not argv:
        return discover()

    root = argv[0]
    files = sorted(glob.glob(os.path.join(root, "*.log")), key=os.path.getmtime)
    if not files:
        sys.exit(f"{root} 下没有 *.log —— 扫了空气，不是「消耗为零」。\n"
                 "不带参数跑一次可以列出本机所有候选目录。")

    tot = defaultdict(float)
    rows, unmeasured = [], []
    for f in files:
        name = os.path.basename(f)[:-4]
        res = read_result(f)
        if not res:
            rows.append((name, None))
            unmeasured.append(name)
            continue
        tier = tier_of(os.path.getmtime(f))
        mu = res.get("modelUsage") or {}
        if not mu:
            u = res.get("usage", {}) or {}
            mu = {"?": {"inputTokens": u.get("input_tokens", 0),
                        "outputTokens": u.get("output_tokens", 0),
                        "cacheReadInputTokens": u.get("cache_read_input_tokens", 0)}}
        r = defaultdict(float)
        r["turns"] = res.get("num_turns", 0)
        r["min"] = (res.get("duration_ms") or 0) / 60000
        fams = set()
        for mname, mv in mu.items():
            fam = family(mname)
            fams.add(fam)
            p = PRICE[fam][tier]
            i_, c_, o_ = (mv.get("inputTokens", 0), mv.get("cacheReadInputTokens", 0),
                          mv.get("outputTokens", 0))
            r["in"] += i_; r["cached"] += c_; r["out"] += o_
            r["cny"] += (i_ * p["in"] + c_ * p["cached"] + o_ * p["out"]) / 1e6
        r["models"] = "+".join(sorted(fams))
        r["tier"] = tier
        for k in ("turns", "min", "in", "cached", "out", "cny"):
            tot[k] += r[k]
        rows.append((name, r))

    w = max(len(n) for n, _ in rows)
    print(f"{'轮次':<{w}} {'模型':<6}{'档':<5}{'turns':>6}{'分钟':>6}{'未命中输入':>12}{'缓存读':>12}{'输出':>9}{'¥':>7}")
    print("-" * (w + 65))
    for name, r in rows:
        if r is None:
            print(f"{name:<{w}} ⚠️ 没有 result 行（被杀 / 还在跑）—— 用量【无法统计】，但账单照收")
            continue
        t = "错峰" if r["tier"] == "off" else "高峰"
        print(f"{name:<{w}} {r['models']:<6}{t:<5}{int(r['turns']):>6}{r['min']:>6.0f}"
              f"{int(r['in']):>12,}{int(r['cached']):>12,}{int(r['out']):>9,}{r['cny']:>7.2f}")
    print("-" * (w + 65))
    print(f"{'可统计合计':<{w}} {'':<11}{int(tot['turns']):>6}{tot['min']:>6.0f}"
          f"{int(tot['in']):>12,}{int(tot['cached']):>12,}{int(tot['out']):>9,}{tot['cny']:>7.2f}")

    if tot["cny"]:
        p = PRICE["pro"]["off"]
        a, b, c = tot["in"] * p["in"], tot["cached"] * p["cached"], tot["out"] * p["out"]
        s = a + b + c
        print(f"\n结构（按 pro 错峰价折算）：未命中输入 {a/s*100:.0f}%、"
              f"缓存读 {b/s*100:.0f}%、输出 {c/s*100:.0f}%")
    if tot["turns"]:
        print(f"平均每 turn {tot['min']*60/tot['turns']:.0f} 秒、"
              f"每 turn 重吃 {int(tot['in']+tot['cached'])//int(tot['turns']):,} token 上下文")

    if unmeasured:
        print(f"\n⚠️ 有 {len(unmeasured)} 轮统计不到（{', '.join(unmeasured)}）："
              "被杀或还在跑，日志里没有 result 事件。\n"
              "   这些轮次的钱**照样花了**——上面的合计是【下界】，不是实际花费。")

    if bill_path:
        bill = load_bill(bill_path)
        total = sum(bill.values())
        print(f"\n=== 对账（账单是按 API key 汇总的，不是按会话）===")
        by_fam = defaultdict(float)
        for (h, fam), v in bill.items():
            by_fam[fam] += v
        for fam, v in sorted(by_fam.items()):
            print(f"  账单 {fam:<6} ¥{v:.2f}")
        print(f"  账单合计            ¥{total:.2f}")
        print(f"  本目录可统计合计    ¥{tot['cny']:.2f}")
        print(f"  差额                ¥{total - tot['cny']:.2f}")
        print("  差额的来源按可能性排序：① 上面统计不到的那些轮次；"
              "② 同一个 key 上别的会话（另一个 AI、另一个项目）；③ 账单时间范围比本目录宽。")

    print("\n单价：官网价目表 × 6.82，与账单 CSV 的 price 列核对一致。"
          "高峰＝工作日 UTC 01–04 / 06–10（北京 09–12 / 14–18），其余错峰减半。")


if __name__ == "__main__":
    main()
