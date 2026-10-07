# iOS 采样路径

已在 MT5 iPhone 实测 Appium/WDA 截图、UI 树和底部标签点击；设备或版本变化后仍以本机帮助与成功输出为准。

- 真机首先只读确认连接、配对和目标 App 版本。设备标识留在本机记录。
- devicectl device info apps 默认只枚举开发应用；查询 App Store 母本需包含 --include-default-apps。本机实测 filter 未缩小表格输出，自动采集用 --json-output 落盘后按 bundle identifier 筛选。
- App Store iPhone App 不能默认安装到 Simulator。母本优先在安装目标 App 的真机采样；自有 App 可在模拟器预验收，最终视觉对比仍应在同型号同配置真机完成。
- Appium/XCUITest 是 UI 树与操作的候选路径。先验证 Xcode、签名、Developer Mode、设备解锁和 WebDriverAgent 安装运行条件；未跑通前不宣称已有自动化。
- devicectl 的设备查询、安装和启动能力不等于截图、UI 树或点击能力。逐项探测，避免用模拟器截图命令采真机。
- 只有截图/录屏时可以采静态视觉与已展示操作；控件树、精确字体和未展示交互保持未覆盖，并明确下一步所需材料或设备操作。
- 自有 App 的验收场景可以稳定复现状态，但还须验证真实触摸路径；场景直达不证明导航和手势正确。
- 记录 safe area、屏幕像素/逻辑尺寸、键盘和系统栏归属。iPhone 与 iPad 分别建布局合同。

## 当前状态采集脚本

已有 Appium 会话时运行 `scripts/capture_ios.py --session-file <创建会话的 JSON 响应> --output <新的本机证据目录>`。默认服务为 127.0.0.1:4725，可用 --server 改。输出 screenshot、原始 XML、矩形 JSON 和采集元数据；脚本只读取当前状态，不切页。原始证据可能包含账户信息，提交前脱敏。UI 树和截图按顺序采集，动态内容不是同一瞬间。

## WebDriverAgent 签名探测

Appium capability 的有效名称以已安装驱动源码为准。本轮 12.15.0 中使用 allowProvisioningDeviceRegistration 才会向 xcodebuild 传递 -allowProvisioningUpdates；allowProvisioningUpdates 本身不是有效 capability。自动签名还需要 xcodeConfigFile 设置 CODE_SIGN_STYLE = Automatic、可用 DEVELOPMENT_TEAM 与 CODE_SIGN_IDENTITY。账户或描述文件问题只在构建日志证实后归因；错误码 65 本身不说明具体原因。

## 大列表与前台校验（真机实测）

- 会话 autoLaunch=false 时先显式激活母本。mobile: activateApp 的参数是 bundleId，不能用 appId。采集脚本支持 --bundle-id 校验 UI 树归属。截图与 UI 树仍为顺序采集，需检查是否有通知遮挡或用户切页。
- 大历史列表的默认 source 可能超过 90 秒。当前实测通过的降级参数为 snapshotMaxDepth=12、snapshotMaxChildren=60、pageSourceExcludedAttributes=visible,accessible。这些值是本轮恢复参数，不是通用默认；降级后记录缺失属性、截断范围，关键子层另采。
- source 阻塞时 WDA 无会话 /screenshot 路径本轮仍可独立取图；故截图通道与树通道应分别记录成功/失败。后台通知遮挡的截图作为污染证据，重采干净画面。

## 会话与画面恢复（实测经验）

- WDA 会话创建成功后用一次只读查询或导航确认可操作。`XCTDaemonErrorDomain 41`（UI testing 未授权）在解锁后仍持续时，本轮以 `useNewWDA=true` 重建恢复；这是恢复候选，不作默认配置。
- `waitForIdleTimeout=0` 时立即截图可能出现文字空白或残影。等待动画结束重采，并与 UI 树互证，再判为实现缺陷。
- 采持续按住的滚动留白时，本轮并行发送带 pause 的触摸 actions 与 WDA `/screenshot` 成功；松手后另采回弹结果。普通截图可能等动作结束，需先验证截图确实处于按住状态。
- MAUI 的 SVG 图标本轮经 `MauiImage` 构建为 PNG，运行时引用 `.png`；编译成功而图标空白时检查资源名。原生搜索 Cancel 会在输入事件后重现，需验输入后的稳定画面，不能只验焦点或初始样式。
