using System.Diagnostics;
using System.Net.Sockets;
using TradingAPI.MT4Server;

const string Usage = """
usage: mtprobe <mt4|mt5> <host> <port> <login> <password> <command> [args]
  ping <n>                          tcp connect rtt x n
  login                             login only, print rtt + balance
  smoke <symbol>                    login, account + symbol info, one pending place+delete
  pending <symbol> <lots> <offset> <n> [gapMs]   place+delete far pending x n, rtt per op
""";

if (args.Length < 6)
{
    Console.Error.WriteLine(Usage);
    return 2;
}
var platform = args[0];
var host = args[1];
var port = int.Parse(args[2]);
var login = long.Parse(args[3]);
var password = args[4];
var cmd = args[5];

if (cmd == "ping")
{
    for (int i = 0; i < int.Parse(args[6]); i++)
    {
        using var s = new Socket(AddressFamily.InterNetwork, SocketType.Stream, ProtocolType.Tcp);
        var sw = Stopwatch.StartNew();
        try
        {
            using var cts = new CancellationTokenSource(5000);
            s.ConnectAsync(host, port, cts.Token).GetAwaiter().GetResult();
            Console.WriteLine($"connect rtt={sw.Elapsed.TotalMilliseconds:F1}ms");
        }
        catch (Exception e)
        {
            Console.WriteLine($"connect FAILED {(e is OperationCanceledException ? "timeout>5s" : e.Message.Split('\n')[0])}");
        }
        Thread.Sleep(300);
    }
    return 0;
}

if (platform == "mt4")
    return RunMt4((int)login, password, host, port, cmd, args);
if (platform == "mt5")
    return RunMt5((ulong)login, password, host, port, cmd, args);
Console.Error.WriteLine(Usage);
return 2;

static string Now() => (DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() / 1000.0).ToString("F3");

static string Stats(string label, List<double> xs)
{
    var sorted = xs.OrderBy(x => x).ToList();
    double P(double p) => sorted[Math.Min(sorted.Count - 1, (int)Math.Ceiling(p * sorted.Count) - 1)];
    return $"{label} n={xs.Count} min={sorted[0]:F1} p50={P(0.5):F1} p95={P(0.95):F1} max={sorted[^1]:F1} ms";
}

static int RunMt4(int login, string password, string host, int port, string cmd, string[] args)
{
    var c = new QuoteClient(login, password, host, port);
    var connectSw = Stopwatch.StartNew();
    c.Connect();
    Console.WriteLine($"login rtt={connectSw.Elapsed.TotalMilliseconds:F0}ms equity={c.AccountEquity} balance={c.AccountBalance}");
    try
    {
        switch (cmd)
        {
            case "login":
                break;
            case "smoke":
            {
                var sym = args[6];
                c.Subscribe(sym);
                var q = c.GetQuote(sym, 10000);
                var info = c.GetSymbolInfo(sym);
                Console.WriteLine($"quote {sym} bid={q.Bid} ask={q.Ask} digits={info.Digits} stopsLevel={info.StopsLevel}");
                var oc = new OrderClient(c);
                var price = Math.Round(q.Ask + 300, info.Digits);
                var sw = Stopwatch.StartNew();
                var o = oc.OrderSend(sym, Op.BuyStop, 0.01, price, 0, 0, 0, "mtprobe", 0);
                Console.WriteLine($"place rtt={sw.Elapsed.TotalMilliseconds:F1}ms ticket={o.Ticket} type={o.Type} price={o.OpenPrice}");
                sw.Restart();
                oc.OrderDelete(o.Ticket, o.Type, sym, o.Lots, o.OpenPrice);
                Console.WriteLine($"delete rtt={sw.Elapsed.TotalMilliseconds:F1}ms ticket={o.Ticket}");
                break;
            }
            case "pending":
            {
                var sym = args[6];
                var lots = double.Parse(args[7]);
                var offset = double.Parse(args[8]);
                var n = int.Parse(args[9]);
                var gap = args.Length > 10 ? int.Parse(args[10]) : 1000;
                c.Subscribe(sym);
                var q = c.GetQuote(sym, 10000);
                var info = c.GetSymbolInfo(sym);
                var digits = info.Digits;
                Console.WriteLine($"quote bid={q.Bid} ask={q.Ask} digits={digits} stopsLevel={info.StopsLevel}");
                var oc = new OrderClient(c);
                var places = new List<double>();
                var deletes = new List<double>();
                for (int i = 0; i < n; i++)
                {
                    q = c.GetQuote(sym, 10000);
                    var price = Math.Round(q.Ask + offset, digits);
                    var sw = Stopwatch.StartNew();
                    var o = oc.OrderSend(sym, Op.BuyStop, lots, price, 0, 0, 0, "mtprobe", 0);
                    var placeMs = sw.Elapsed.TotalMilliseconds;
                    sw.Restart();
                    oc.OrderDelete(o.Ticket, o.Type, sym, o.Lots, o.OpenPrice);
                    var deleteMs = sw.Elapsed.TotalMilliseconds;
                    places.Add(placeMs);
                    deletes.Add(deleteMs);
                    Console.WriteLine($"[{i + 1}/{n}] place rtt={placeMs:F1}ms ticket={o.Ticket} delete rtt={deleteMs:F1}ms");
                    if (gap > 0) Thread.Sleep(gap);
                }
                Console.WriteLine(Stats("place", places));
                Console.WriteLine(Stats("delete", deletes));
                break;
            }
            default:
                Console.Error.WriteLine(Usage);
                return 2;
        }
    }
    finally
    {
        c.Disconnect();
    }
    return 0;
}

static int RunMt5(ulong login, string password, string host, int port, string cmd, string[] args)
{
    var api = new mtapi.mt5.MT5API(login, password, host, port);
    if (int.TryParse(Environment.GetEnvironmentVariable("MTPROBE_BUILD"), out var b))
        api.Build = b;
    var connectSw = Stopwatch.StartNew();
    api.Connect();
    Console.WriteLine($"login rtt={connectSw.Elapsed.TotalMilliseconds:F0}ms equity={api.AccountEquity} balance={api.Account.Balance}");
    try
    {
        switch (cmd)
        {
            case "login":
                break;
            case "symbols":
                foreach (var n in api.Symbols.Names.Where(n => n.Contains(args.Length > 6 ? args[6] : "", StringComparison.OrdinalIgnoreCase)).OrderBy(n => n))
                    Console.WriteLine(n);
                break;
            case "smoke":
            case "pending":
            {
                var sym = args[6];
                var lots = cmd == "smoke" ? 0.01 : double.Parse(args[7]);
                var offset = cmd == "smoke" ? 300 : double.Parse(args[8]);
                var n = cmd == "smoke" ? 1 : int.Parse(args[9]);
                var gap = cmd == "smoke" ? 0 : args.Length > 10 ? int.Parse(args[10]) : 1000;
                api.Subscribe(sym);
                var q = api.GetQuote(sym, 10000);
                var info = api.Symbols.GetInfo(sym);
                var digits = info.Digits;
                Console.WriteLine($"quote bid={q.Bid} ask={q.Ask} digits={digits} limitPoints={info.LimitPoints}");
                var places = new List<double>();
                var deletes = new List<double>();
                for (int i = 0; i < n; i++)
                {
                    if (i > 0) q = api.GetQuote(sym, 10000);
                    var price = Math.Round(q.Ask + offset, digits);
                    var sw = Stopwatch.StartNew();
                    var o = api.OrderSend(sym, lots, price, mtapi.mt5.OrderType.BuyStop, 0, 0, 0, "mtprobe", 0);
                    var placeMs = sw.Elapsed.TotalMilliseconds;
                    sw.Restart();
                    api.OrderClose(o.Ticket, sym, o.OpenPrice, o.Lots, o.OrderType, 0);
                    var deleteMs = sw.Elapsed.TotalMilliseconds;
                    places.Add(placeMs);
                    deletes.Add(deleteMs);
                    Console.WriteLine($"[{i + 1}/{n}] place rtt={placeMs:F1}ms ticket={o.Ticket} delete rtt={deleteMs:F1}ms");
                    if (gap > 0) Thread.Sleep(gap);
                }
                Console.WriteLine(Stats("place", places));
                Console.WriteLine(Stats("delete", deletes));
                break;
            }
            default:
                Console.Error.WriteLine(Usage);
                return 2;
        }
    }
    finally
    {
        api.Disconnect();
    }
    return 0;
}
