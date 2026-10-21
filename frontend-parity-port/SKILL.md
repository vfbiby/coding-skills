---
name: frontend-parity-port
description: 前端框架重写（如 React→Solid）的自动化行为对拍与验收。触发：前端重写/框架迁移、行为等价验收、DOM 对照、帧重放、golden master、语义测试移植。源自 claudecodeui React 18 → SolidJS 全站翻译实战（2026-10，15 张票、12+ 对照场景、交互脚本 17+ 条全部双框架跑绿）。
---

# 前端重写的自动化对拍（React → SolidJS 实战方法论）

核心思路：**前端重写不对拍代码、不对拍内部状态，只对拍「用户可观察物」**。重写的目的往往是删除对抗旧框架的机器（批处理定时器、WeakMap 投影缓存、memo bail 暗号、context 拆分），内部状态本来就不该等价。golden master 不是源码，而是三层可观察物：

1. **纯逻辑单元**：框架无关的纯函数（分页/reconciliation/分组/解析器/状态机）——语义测试**逐字移植**，新框架里跑绿即为门。
2. **渲染内容**：同一输入在两侧渲染出的可见文本树/结构——内容等价，**不比像素**（像素豁免是效率倍增器：样式后续人工调，把视觉回归从基线维护地狱降为重大异常人工可见）。
3. **全应用行为**：录制好的输入序列重放进两个真实 build，比对 DOM + 副作用 + 交互结果。

三条配套纪律：
- **旧版冻结为 golden build**（产物 sha256 清单），被测侧契约 = 一个 build 目录/URL，框架无关。
- **重写即删码**：旧框架专属机器在新代码中不得复刻，用「身份稳定探针测试」证明其原防御的问题也不出现。
- **变异自检**：harness 必须能抓住故意注入的差异（丢帧/改文本/重复 terminal 帧），否则 harness 无效。

## 分层验收线（从便宜到贵，每层独立有价值）

| 层 | 手法 | 时机 | 实战成本 |
|---|---|---|---|
| 语义测试 | 纯逻辑测试逐字搬进新框架（脱离组件树，纯 node/jsdom） | 翻译开始前即可锁定 | 最低 |
| 组件级内容树 | 同一输入双框架各渲染一遍（各自测试环境），归一化后文本树 deepEqual | 移植该组件时 | 低 |
| 场景对照 | replay mock server 按时间轴推帧 → 两个真实 build → 多观察面比对 | 该功能端到端完成后 | 高 |
| 交互脚本 | 用户级操作两侧同跑，断言可观察结果 | 同上 | 中 |

非流式域（纯 CRUD/表单/面板）没有帧流也能建场景：**REST 快照对照**——场景骨架照旧（帧当节拍器），被对照的是 REST stub 数据的渲染，每个检查点一组打开/切换手势。stub 数据尽量用真实子命令输出（git 场景直接对 fixture 仓库跑真 git 命令），比手造 JSON 更接近真实且省得猜形状。

## 流程

### 1. 前置决策（与用户逐项锁定）
对照级别（建议结构内容级、像素豁免）｜golden 冻结范围｜场景来源（真实采样优先）｜删码清单（旧框架专属机器列表，验收时逐条核对不存在）。

### 2. golden 冻结与重冻结门
- build 产物 sha256 清单（标准 `shasum -c` 双空格格式，尾无空行）入库只读。
- **重冻结门**：任何对旧版源码的合法修改（行为保持型重构/类型收敛）都会推进 golden——必须「重建 → 全场景复跑 EQUIVALENT → 重冻结清单」三步走并在清单头注明原因。**不跑这步清单会静默过期**（实战：类型收敛删恒假分支，bundle 变了 56/69 失配才发现）。
- 陈旧 node_modules 会让重建产物大面积漂移——重建前 clean reinstall（实战 56 个文件失配，reinstall 后零 mismatch）。

### 3. 场景录制
- **先普查再采样**：对真实数据源按「形态」逐类计数（哪些渲染路径有真实样本），合成仅限缺失形态、行型必须真实、场景元数据注明来源。
- 帧契约统一（如 `{seq, kind, at}`），归一化占位符一处实现两侧共用。
- 每场景带 `description`（覆盖路径 + **捕获根选择器**）与建议 speed。**重连/生命周期场景 speed 1**（加速会静默退化——completed run 永不重放是真实语义）。
- 覆盖对偶面（有审批通过就要有拒绝）与边角（未闭合围栏、数学定界、跨 delta 拆分）。
- `stream_delta` 必须是增量语义——发成累积快照 golden 会「等价地错」。

### 4. harness（观察面组合，各抓各的）
replay mock server：时间轴推帧 + 加速/暂停/单步/丢包控制端点 + REST stub；**mock 与真实后端的 wire 差异写成清单**（实战 5+ 条：双 subscribe 去重、completed run 不重放等）。

| 观察面 | 角色 | 实战结论 |
|---|---|---|
| 可见文本树 | **主门禁** | 直接断言「用户读到的内容」，~7KB/快照 |
| 结构骨架 | 锚点白名单 | 新组件库 `data-*` 指纹必然不同，按框架分别维护，只留语义锚点 |
| aria snapshot | 失败诊断输出 | 可读性最好但断言面弱 |
| tick 采样 | 打字机等价 | 流式中按时间轴采样，断言链单调 + Jaccard |
| network 面 | 协议副作用 | **DOM 对重复 terminal 帧幂等时只有这层抓得住** |

### 5. 变异自检（必做）
注入 ≥3 种差异（丢帧/改文本/重复 terminal 帧），harness 必须**全部抓住且各自 exit 1**，并记录各自被哪个观察面抓住——这张表就是观察面组合的正当性依据。每次调整比对器后**必须回归变异自检**，丢了检出力的调整就是造假。

### 6. 翻译相位验收门（固定命令清单，全 exit 0 才收）
新框架构建 → 该相位语义测试全绿 → 场景对照 EQUIVALENT → 交互脚本 PASS → 双侧变异 3/3 → 旧版测试/类型/lint 无回归 → golden 清单零 mismatch。
**取真实 exit code**：管道后 `$?` 是 tail 的；用重定向。

### 7. 删码核对
旧框架专属机器逐条核对「新代码中不存在」，且用探针测试证明原问题不出现（如「settled 段 DOM 节点身份十 tick 不变」「10Hz 状态帧只重渲染受影响行」）。

## 实测教训（每条都在实战中真实咬过）

**协议与对照的关系**
- **golden「等价地错」**：协议语义错误让 golden 和被测一起错、对照门全绿——前端对照门不设防协议语义，**必须配服务端契约门**（帧形状 fixtures 以服务端为仲裁）。
- 新增归一化规则只允许两类：双侧对称的噪声压制（注明来源）+ 白名单调整（注明指纹依据）；每处调整附变异回归证据。

**框架迁移的通用坑（React→Solid 实测）**
- **props 派生 const 被冻结**：React 里 `const x = props.a ? 1 : 2` 写在组件体每渲染重算，Solid 组件体只跑一次——props 派生值必须是 accessor（三处同坑同修：isRunning/isStreaming/result content）。
- **effect 依赖链互触发**：effect 读 store + 防抖自动保存写 store → effect 重跑把状态改回初始值，表象是「首击丢失」（settings 打开改回初始 tab）——`untrack` 修 + 语义测试钉住。
- **context 静默变默认值**：手工 createComponent 时 children 非 getter 会把组件实例化在 Provider 外——表象是 context 全变默认值，极难查。
- **vite-plugin-solid 必须 exclude 旧框架目录**（而非 include 新目录）：旧框架文件被新框架编译直接炸，新框架包的 "solid" condition 是未编译 JSX。
- **受控表单属性**：React 的 `checked`/`value` 属性+属性双写习惯在新框架要显式 bool 属性（需 JSX 类型 augmentation）。
- **keep-mounted 残留**：关闭的对话框内容仍在 DOM（`hidden`/`data-state`），断言不能用「不存在」；closed 菜单的 Escape 层要门控（zag keep-mounted × 14 个菜单会霸占 Escape）。
- **无重挂载是双刃剑**：React 的 context-identity remount bug（token 轮换整树重挂）在新框架天然不存在，但「组件只初始化一次」意味着 slot 挂错 owner 会被 auth-gate 换屏 dispose——挂 detached root。
- 新组件库（zag/Ark）与手写实现的 DOM 指纹差异清单：`data-part`/`data-scope`/`aria-controls`（对称剔除）、`data-highlighted` vs `data-selected`、卸载 vs hidden（驱动手势两侧分开写）。

**harness 工程**
- **捕获根（--root）是每场景的校准值**：用「两侧逐字同构的最内容器」，写进场景 description；chat/侧栏/settings/git 各有自己的根，**票文里引用校准命令全文**（实战验收员两次跑错都是没先读文档）。
- **`--scenario` 传绝对路径**：harness 常把该参数解析到自身目录，相对路径会 doubling。
- **场景与 sessionId 绑定**：mock 按 sessionId 注册场景，复用别的场景 id 会被劫持（非 chat 场景必须独立 id）。
- **golden 自身有瞬态**：React memo 滞后回填（~600ms 内不渲染相对年龄→settleMs 校准解决）、message-fetch 计数竞态（双服务器拓扑下同 build 自对照 6 vs 4——**非确定性观察面需要 retry-once 语义或收敛规则，否则门偶发假红**，实战记为待办票）。
- **悬停伪影**：批准点击留下的 hover 会让 `group-hover:opacity-0` 标签单侧消失（布局差数百像素）——点击后 `mouse.move(0,0)` 双侧同码。
- **重挂载检测双标记**：window 标记须挂载后盖章（addInitScript 重载会重设同值静默失效）+ 壳节点身份标记（抓「document 不变但 root 重建」）。
- **时钟噪声归一化逐条注明来源**：toLocaleTimeString、秒/分计数器（墙钟起算的计数两侧串行捕获必差几秒）、随机 id。
- **同机多会话隔离**：harness 固定端口会跨 worktree 相撞（side A 采到对方 build）——提供 `--port-base`；多会话并发写同一 checkout 会互踩，用票/评论协调合并窗口。
- **fixture 重放失败默认是新实现 bug**，只有主审可裁定 fixture 有误且必须留痕；发现真实帧形状与类型不符时**停下上报，不许改场景迁就类型**。

**工程节奏**
- 大票按模块切 commit，每个 commit 点保持全部门绿；做不完的模块**如实列出**（不许半成品硬凑），裁剪项逐条挂票。
- 每票验收评论附「亲跑数据表」——验收人不信任转述，全门亲跑。
- 一次真实移植的 bug 捕获统计：REST 快照对照在 settings 一票抓出 4 个真实移植缺口（含 2 个框架特性坑），全靠「两侧同输入渲染比对」，无一靠人眼。

## 与后端对拍（golden master）的关系
前端对拍的可信度依赖后端契约门：帧形状 fixtures 独立测试（服务端为仲裁）。两套 harness 命名与目录严格分开、票文写全路径（实战被混淆过两次）。协议冻结纪律：wire 改动必须先改单一 contract 模块（discriminated union 单一来源，两侧消费，serde 生成留到后端重写相位），再动任何实现。

## 收官补充（F15 实测，2026-10-16）

- **`content-visibility:auto` 冻结测量**：渲染窗外一行的 getBoundingClientRect 返回 contain-intrinsic-size 估算值（而非真实高度，实测偏大 1/3），scrollHeight/懒挂载窗口计算全被污染——测量前临时强制该行真布局。这类 CSS containment 对几何观察面的系统性影响，比任何框架差异都难查。
- **webfonts 头契约**：新框架的 index.html 容易漏掉旧版的字体 `<link>`；文本 face 未就绪时 IntersectionObserver 首测会误判——补齐头部契约 + 首测前 `document.fonts` 门。
- **布局方向 bug 的表型是「对照面积不够」**：shell 容器 flex 方向写错（column vs row），sidebar 变成横带，pane 只有 335px 宽——/findings 表现为大面积结构差异时，先查壳层布局，别急着调比对器。
- **变异门会被 golden 竞态间歇掩蔽**：注入「重复 terminal 帧」抬高的副作用计数可能正好落进 golden 自身的计数波动带 → 全观察面漏检（实测 3/3↔2/3 翻转）。处置：变异门遇 2/3 先复跑再归因；根治靠 F16 类加固（非确定性计数观察面加 retry-once/收敛规则）。**变异门不是永远可靠的信号**——这句要写进每个验收 SOP。
- **懒挂载窗口的 IO 收敛手势**：回底后高度仍在结算，IntersectionObserver 可能停有过时挂载态——scroll 手势加对称 jiggle 强制重算 + post-gesture 检查点 settleMs 提高（1200ms 实测值）。

## 收官补充（F15 实测，2026-10-16）

- **`content-visibility:auto` 冻结测量**：渲染窗外一行的 getBoundingClientRect 返回 contain-intrinsic-size 估算值（而非真实高度，实测偏大 1/3），scrollHeight/懒挂载窗口计算全被污染——测量前临时强制该行真布局。这类 CSS containment 对几何观察面的系统性影响，比任何框架差异都难查。
- **webfonts 头契约**：新框架的 index.html 容易漏掉旧版的字体 `<link>`；文本 face 未就绪时 IntersectionObserver 首测会误判——补齐头部契约 + 首测前 `document.fonts` 门。
- **布局方向 bug 的表型是「对照面积不够」**：shell 容器 flex 方向写错（column vs row），sidebar 变成横带，pane 只有 335px 宽——findings 表现为大面积结构差异时，先查壳层布局，别急着调比对器。
- **变异门会被 golden 竞态间歇掩蔽**：注入「重复 terminal 帧」抬高的副作用计数可能正好落进 golden 自身的计数波动带 → 全观察面漏检（实测 3/3↔2/3 翻转）。处置：变异门遇 2/3 先复跑再归因；根治靠加固票（非确定性计数观察面加 retry-once/收敛规则）。**变异门不是永远可靠的信号**——这句要写进每个验收 SOP。
- **懒挂载窗口的 IO 收敛手势**：回底后高度仍在结算，IntersectionObserver 可能停有过时挂载态——scroll 手势加对称 jiggle 强制重算 + post-gesture 检查点 settleMs 提高（1200ms 实测值）。

