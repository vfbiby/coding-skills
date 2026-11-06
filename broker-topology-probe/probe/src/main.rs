use mt4::api::QuoteClient;
use std::env;
use std::time::{Duration, Instant};

const API_KEY: &str = "d555a78d-57a9-4781-bc41-efb7b7027eed";
const LOGIN_ID_PATH: &str = "http://loginid-mt4.mtapi.io";
const SRV_DESC_OFFSET: usize = 68;

fn split(hp: &str) -> (String, u16) {
    let (h, p) = hp.rsplit_once(':').expect("host:port");
    (h.to_string(), p.parse().expect("port"))
}

async fn login(hp: &str) -> Result<(QuoteClient, Duration), String> {
    let login: i32 = env::var("MT4_LOGIN").expect("MT4_LOGIN").parse().expect("MT4_LOGIN");
    let password = env::var("MT4_PASSWORD").expect("MT4_PASSWORD");
    let (host, port) = split(hp);
    let mut client = QuoteClient::new(login, &password, &host, port, API_KEY, LOGIN_ID_PATH, 30000);
    client.connect_timeout_ms = 8000;
    let started = Instant::now();
    client
        .connect_and_login(&password, &host, port)
        .await
        .map_err(|e| e.to_string())?;
    Ok((client, started.elapsed()))
}

fn cstr(raw: &[u8], at: usize) -> String {
    raw.get(at..)
        .unwrap_or_default()
        .iter()
        .take_while(|b| **b != 0)
        .map(|b| *b as char)
        .collect()
}

fn is_access_address(s: &str) -> bool {
    s.rsplit_once(':')
        .is_some_and(|(host, port)| !host.is_empty() && !port.is_empty() && port.bytes().all(|b| b.is_ascii_digit()))
}

fn access_points(raw: &[u8]) -> Vec<(String, String)> {
    let mut points = Vec::new();
    let mut at = 0;
    while at < raw.len() {
        let s = cstr(raw, at);
        if s.len() >= 4 && is_access_address(&s) && s.bytes().all(|b| b.is_ascii_graphic()) {
            points.push((s.clone(), cstr(raw, at + SRV_DESC_OFFSET)));
            at += SRV_DESC_OFFSET;
        } else {
            at += 1;
        }
    }
    points
}

async fn cluster(hp: &str) {
    let (mut client, took) = login(hp).await.expect("login");
    eprintln!("login_ms={:.1}", took.as_secs_f64() * 1000.0);
    if let Some(info) = client.get_server_info() {
        eprintln!("server={} company={}", info.name, info.comment);
    }
    for (address, desc) in access_points(&client.latest_srv().unwrap_or_default()) {
        println!("{address} {desc}");
    }
    client.disconnect().await;
}

async fn record(idx: usize, hp: String, symbols: Vec<String>, end: Instant, start: Instant) {
    let (mut client, took) = match login(&hp).await {
        Ok(v) => v,
        Err(e) => {
            eprintln!("conn={idx} host={hp} login_failed={e}");
            return;
        }
    };
    eprintln!("conn={idx} host={hp} login_ms={:.1}", took.as_secs_f64() * 1000.0);
    for s in &symbols {
        if let Err(e) = client.subscribe(s).await {
            eprintln!("conn={idx} subscribe {s} failed: {e}");
        }
    }
    let (mut rx, _stop, _handle) = client.start_quote_handler().await.expect("quote handler");
    loop {
        let left = end.saturating_duration_since(Instant::now());
        if left.is_zero() {
            break;
        }
        match tokio::time::timeout(left, rx.recv()).await {
            Ok(Some(q)) => println!(
                "{idx},{},{},{},{},{}",
                start.elapsed().as_micros(),
                q.symbol,
                q.bid,
                q.ask,
                q.time.timestamp_millis()
            ),
            _ => break,
        }
    }
    client.disconnect().await;
}

async fn ticks(secs: u64, symbols: &str, hosts: &[String]) {
    let symbols: Vec<String> = symbols.split(',').map(str::to_string).collect();
    let start = Instant::now();
    let end = start + Duration::from_secs(secs);
    let tasks: Vec<_> = hosts
        .iter()
        .cloned()
        .enumerate()
        .map(|(idx, hp)| tokio::spawn(record(idx, hp, symbols.clone(), end, start)))
        .collect();
    for task in tasks {
        let _ = task.await;
    }
}

#[tokio::main]
async fn main() {
    let args: Vec<String> = env::args().collect();
    match args.get(1).map(String::as_str) {
        Some("cluster") => cluster(&args[2]).await,
        Some("ticks") => ticks(args[2].parse().expect("secs"), &args[3], &args[4..]).await,
        _ => eprintln!("usage: brokerprobe cluster <host:port> | brokerprobe ticks <secs> <sym,...> <host:port>..."),
    }
}
