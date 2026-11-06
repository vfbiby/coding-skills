import socket, statistics, sys, time

for target in sys.argv[1:]:
    host, port = target.rsplit(":", 1)
    samples = []
    for _ in range(10):
        s = socket.socket()
        s.settimeout(3)
        started = time.perf_counter()
        try:
            s.connect((host, int(port)))
            samples.append((time.perf_counter() - started) * 1000)
        except OSError:
            pass
        s.close()
        time.sleep(0.2)
    if samples:
        print(f"{target:32s} n={len(samples):2d} min={min(samples):7.1f} p50={statistics.median(samples):7.1f}")
    else:
        print(f"{target:32s} unreachable")
