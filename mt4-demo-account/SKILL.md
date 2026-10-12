---
name: mt4-demo-account
description: 用 mtapi 的 GetDemo 接口申请临时 MT4 demo 账号，用于不占用生产账号的真机实验。
---

# 申请临时 MT4 demo 账号

真机实验需要一个**不在本地观察栈账号表里**的账号时，用这个接口现开一个（每次请求开一个新账号）。

```bash
curl -s -X GET "https://mt4.mtapi.io/GetDemo?host=<券商服务器IP>&port=<端口>&leverage=100&balance=1000000&name=Some%20Name&accountType=demo&country=Canada&city=Vancouver&state=Vancouver&zip=123456&address=Some%20Address&phone=%2B12541234567&email=some%40email.com&terminalCompany=<券商名>" -H "accept: text/plain"
# → {"user":112553963,"password":"lt7tauu","investor":"ndmy1qv"}
```

- `host`/`port`：**券商服务器**（不是 mtapi 的），**账号开在哪家由它决定**。已知可用：`101.35.28.150:21117` → dprime。
- `terminalCompany`：**不决定开在哪家**——实测传 `roboforex` 时账号仍开在 `host`/`port` 指定的 dprime 服务器上，看上去只是开户资料字段。
- 返回的 `user`/`password` 就是登录凭据；`investor` 是只读密码。
- 其余参数（`name`/`city`/`zip`…）像开户资料，接口接受任意值。

## 存与用

- 存到 `~/codes/mtcopy-demo-accounts/<券商>-<login>.json`，写成网关能直接吃的 `SessionConfig` 数组（`platform`/`login`/`password`/`host`/`port`/`connect_timeout_ms`/`catalog_filter`）。该目录**不属于任何仓库**。
- 用独立实例跑，别接进正在运行的观察栈：

```bash
~/codes/mtcopy/target/release/mtcopy-gateway --socket /tmp/<目录>/x.sock \
  --accounts ~/codes/mtcopy-demo-accounts/<文件>.json
```

## 纪律

- 凭据**不进仓库、不贴进 issue**；用完可以放着，也可以随时删。
- 要观察它的连接行为时，把输出接上时间戳再落文件：`... 2>&1 | while IFS= read -r l; do printf '%s\t%s\n' "$(date +%H:%M:%S)" "$l"; done > x.log`。
