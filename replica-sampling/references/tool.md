# Playwright 采集器

复用项目里的 `playwright` 或 `playwright-core`，要求 Node.js 22+。浏览器使用项目已安装的 Chromium；配置 `channel: "chrome"` 可用本机 Chrome，也可指定 `executablePath`。不自动安装浏览器。

复制 [示例配置](../scripts/example.json)，替换 URL、元素选择器和操作，再运行：

```sh
node "$HOME/.codex/skills/replica-sampling/scripts/sample.mjs" \
  --config ./sampling.json --out /tmp/replica-evidence --project .
```

`--project` 指向已安装 Playwright 的项目，也记录该目录的 Git 提交和脏状态。`--out` 必须为空，旧证据不会覆盖。此命令仅采集，不作自动通过判定。

## 配置

- `targets`：可采单页或对照多页，第一项作为参考。`name` 唯一；`url` 为入口；`ready` 为页面就绪元素。可填 `revision` 标记已确认的目标源码版本，未填不会猜测。
- `selectors`：逻辑名到 CSS 选择器。目标站结构不同时，用 `target.selectors` 覆盖同名选择器。默认必须存在；可写 `{ "selector": ".optional", "required": false }`；采伪元素加 `pseudo`。
- `viewports`：`name / width / height / dpr`，可加 `isMobile / hasTouch / userAgent`。
- `states`：`name / actions / framesMs`。支持 `click / hover / press / waitFor`；前三种按需填 `selector`，`press` 填 `key`；`waitFor` 支持 `state: "hidden"`。两站入口不同，用 `target.actions[stateName]` 替换该状态操作。
- 已登录采样：`target.storageState` 指向配置文件旁的会话 JSON；只读入，不复制到产物、不自动登录。会话文件放 Git 外。
- 可选 `timeoutMs`、`colorScheme`、`styles`（覆盖默认计算样式字段列表）。

每个目标×视口×状态都新建上下文，从入口恢复，避免前一状态污染后一个。初始等待字体和首屏图片；图片失败、未完成及不可读样式表会记录。JS 分支、缩放公式和语义仍需人工取证。

## 输出与边界

- `index.html`：双方并排图、元素首项区域预览、几何及样式差异；图片可直接打开查看。
- `samples.json`、逐帧 JSON：矩形、计算样式、实际视口/DPR、字体、图片状态、CSS 媒体条件、bundle 路径。
- `comparison.json`：相对第一目标的坐标差与样式差，保留原值，不设统一像素差闸门。
- `run.json`：完成/失败状态、浏览器版本、版本出处和被拦请求。失败不会生成完整对照页。
- PNG：逐帧视口截图及序列结束后的 `full.png` 全页图。

帧时间从首次操作前开始，含自动等待；记录实际 DOM 采集与截图起止时间，**不是精确录像时间轴**。过密采样会延迟，查看实际时间再作判断。动态内容身份仍需采样者固定。

默认拦截非 GET/HEAD/OPTIONS 请求、WebSocket 和 Service Worker，不记录请求体、Cookie或会话文件；URL不输出认证信息或查询值。GET也可能有副作用，仍须遵守站点授权；依赖 POST 读取的页面需项目专用适配。本工具不自动操作登录、录音、重置或删除。

工具回归使用本机 HTTP 夹具和真实 Chrome：

```sh
REPLICA_TEST_PROJECT=/path/to/project-with-playwright \
  node --test "$HOME/.codex/skills/replica-sampling/scripts/sample.test.mjs"
```
