---
name: csharp-to-rust-port
description: 把 C#/.NET 项目自动化移植成 Rust 并逐字节对拍验证。触发：C# 转 Rust、.NET 项目移植/翻译、golden master、parity 对拍、行为基准对照。
---

# C# → Rust 自动化移植

核心思路：**旧版冻结，只作 golden master（行为基准）；新版权责干净，架构改进只落新版；一切以对拍 fixtures 为验收。** 全流程由主 agent 编排、子 agent 执行，每步以可 exit 0 的验收门收口。

## 流程

### 1. 前置决策

与用户逐项锁定，写成决策表：

| 决策点 | 选项 |
|---|---|
| 范围 | 整体替换 / 只移植子系统 |
| 新旧关系 | 最终替换 / 并行对拍后定 / 纯实验 |
| 数据库 | 沿用原库（兼容 schema）/ 独立新库（自由设计） |
| 行为基准 | 旧版是否冻结不动（推荐冻结） |
| 工具链 | 是否允许 Docker；构建/部署模式（交叉编译目标） |

**完成标准**：用户逐项确认，决策表进入计划文档。

### 2. 契约盘点

派 Explore agent 全量盘点旧代码，产出四份清单，每条带 file:line：

1. **路由契约表**：方法 + 路径 + 鉴权 + 限流 + 成功/错误响应形状
2. **序列化约定**：命名策略（camelCase/PascalCase 混用逐个确认）、null、日期格式（.NET 默认 7 位小数 + Z）、decimal、枚举字符串化
3. **错误路径全集**：每个状态码的逐字文案（**含源码 typo，原样保留**）、裸字符串 vs 对象、各异常处理器形状
4. **隐式行为**：反序列化默认值、绑定失败走哪条异常路径、缓存 TTL、排序稳定性、鉴权 claim 实际形态

**完成标准**：四份清单落盘，用户可见。

### 3. golden master 录制（先于任何 Rust 代码）

起旧版（mock 依赖从日志/stdout 提取，如 OTP 验证码），脚本按场景录制 `(method, path, status, headers, body)` → `fixtures/*.json`。

- **归一化**（录制与重放共用一套，写成文档）：token/时间戳/单号/验证码 → 占位符；延迟只比 null/有值；decimal 容差比较
- **分级**：确定性端点 = 归一化后字节级全等；活数据端点（外部数据/延迟）= 仅结构对等，语义由 fake 驱动的单元测试覆盖
- fixtures 只读；**重放失败默认是 Rust 的 bug**，只有主 agent 可裁定 fixture 有误

**完成标准**：二次录制 diff 为零（可复现），fixtures 入库。

### 4. 架构候选（deep module 评审）

对旧版做 shallow/重复盘点，产出候选项与用户确认（如：外部依赖包 trait adapter——两个真实 adapter + 一个 fake 使 pipeline 可确定性测试；service 层 domain 进 domain 出；N 份重复逻辑合一；派生态单一来源；并发去重与上限统一）。

**完成标准**：用户选定候选项；改进只落新版，语义保真。

### 5. 分相位实施

相位划分：骨架（**wire-fidelity 辅助最先写并单测锁死**：日期、decimal、错误体形状）→ 核心业务 → 认证 → 外围端点 → parity 总审 → 部署。严格串行，每相位产出接口交接说明给下一相位。

每个相位是一个子 agent 的 mission brief，七要素：

1. 目标 + 非目标（后续相位端点保持桩）
2. 权威源码引用（file:line；**要求 agent 重读原文，以源码为准**，发现与 brief 矛盾即上报）
3. 路由契约（逐字文案）
4. 验收门：`cargo build && cargo test && cargo clippy --no-deps --all-targets -- -D warnings` 全部 exit 0 + 本相位 fixture 重放绿
5. 迭代规则：跑门→读失败→修→重跑，单 brief 上限 ~12 轮；**禁止弱化断言求过**（断言与源码矛盾时改测试并在报告注明）
6. 停止上报条件：门绿；同一失败卡 2 轮；发现矛盾；需改动边界外文件（旧仓库与依赖仓库只读——硬边界）
7. 报告：通过项 / 偏差及依据 / 下一相位交接说明

**完成标准**：全部相位验收门绿，主 agent 逐相位亲自复核（重跑命令）。

### 6. parity 总审

全量 fixture 重放 + 文案零遗漏审计（脚本提取旧代码全部用户可见文案 → 逐条在新代码中定位）。已知不可对齐项（如异常消息文本依赖旧版内部实现）记录为「仅信封形状对齐」。

**完成标准**：审计零遗漏 + 全部已知偏差成文。

### 7. 部署（可选相位）

按用户环境定：交叉编译（cargo-zigbuild）→ systemd/rsync/软链切换，回滚 = 切回旧版软链。真机冒烟 + 资源占用核对。

## 实测教训（.NET 特有，环境里查不到）

- **文档化行为经常是错的**：JWT claim 实际是全 URI 形式（`http://schemas.xmlsoap.org/.../nameidentifier`）而非 `nameid` 短名；ProblemDetails 有多种别名形状（全局处理器 vs `Results.Problem`：content-type、字段顺序、no-cache 头都不同）；限流分区键因中间件顺序实际按 IP 而非用户。一切以 golden master 实测为准。
- **STJ 反序列化缺字段 → 静默填类型默认值**（如缺 `freeSearchCount` 得 0），不是报错——Rust 侧用 `#[serde(default)]` 复刻。
- **绑定失败（非法枚举/坏 query 参数）走 500** 而非 400（异常冒泡到全局处理器）。
- **`0m` 序列化为 `0.0`**；字符串枚举输入大小写不敏感。
- serde_json 需开 `preserve_order` 才能保证字段顺序与 C# 一致（ProblemDetails 类响应的字节级对拍依赖它）。
- 旧版的"怪但真实"行为（typo 文案、无并发上限、10 分钟踢下线滞后）**原样保留，不做"修复"**——对拍要求语义等价，改进走架构层。
