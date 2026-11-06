import collections, csv, statistics, sys

if len(sys.argv) < 3:
    sys.exit("usage: analyze.py ticks.csv label=tcp_min_ms ...   (labels in the same order as the ticks hosts)")
labels, rtt = [], []
for arg in sys.argv[2:]:
    label, ms = arg.rsplit("=", 1)
    labels.append(label)
    rtt.append(float(ms))
n = len(labels)

arrivals = collections.defaultdict(dict)
for conn, us, symbol, bid, ask, server_ms in csv.reader(open(sys.argv[1])):
    arrivals[(symbol, bid, ask, server_ms)].setdefault(int(conn), int(us))
matched = [a for a in arrivals.values() if len(a) == n and max(a.values()) - min(a.values()) < 2_000_000]
if not matched:
    sys.exit("no tick reached every connection; check login_failed lines and symbol names")

firsts = collections.Counter(min(a, key=a.get) for a in matched)
ref = firsts.most_common(1)[0][0]
print(f"ticks seen on all {n} connections: {len(matched)} of {len(arrivals)}; reference = {labels[ref]}")
print(f"{'access point':28s} {'lag p50':>8s} {'lag p10':>8s} {'rtt/2':>7s} {'backleg vs ref':>15s} {'first':>6s}")
for c in range(n):
    lags = sorted((a[c] - a[ref]) / 1000 for a in matched)
    p50 = statistics.median(lags)
    backleg = p50 - rtt[c] / 2 + rtt[ref] / 2
    print(f"{labels[c]:28s} {p50:8.1f} {lags[len(lags) // 10]:8.1f} {rtt[c] / 2:7.1f} {backleg:15.1f} {firsts[c]:6d}")
