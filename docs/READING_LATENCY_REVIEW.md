# 读图延迟与 DeepSeek 型号核查（2026-09-18）

## 第一阶段：型号核查与对照

用户确认 DeepSeek 网页端也开启了深度思考。因此不能把网页较快简单解释成网页关闭了思考，也不能声称两端使用相同服务路径、提示词或工具流程。

当天读取 [DMX 公开目录](https://www.dmxapi.cn/api/dmxapi/rmb/pricing/public)：`deepseek-flash-guan` 条目明确说明，自 2026-09-10 起指向 DeepSeek V4.1 Flash；另列 `deepseek-v4.1-flash`，标注文本、图像输入。[DeepSeek 更新日志](https://api-docs.deepseek.com/updates/)和[视觉文档](https://api-docs.deepseek.com/guides/vision/)确认当前 Flash 的新版视觉能力，官方调用名是 `deepseek-flash`。第三方供应商的引用名应按其目录填写，不能把官方引用名直接套用给 DMX。

当前配置已经指向该新版，换成另一个引用名不能称为模型升级。核查阶段没有修改手机或 `.env` 的模型、供应商、输出上限、思考模式，没有自动 fallback。单次另入口较快还不足以保证长期稳定性。未找到已核实可用、比当前 V4.1 Flash 更新的 DeepSeek 视觉型号。用户随后明确授权关闭思考并要求可设置，实施见文末。

## 同图真实对照

使用先前自编 SAT 散点图图片，解析真值为 C、预测值 2.4；没有重新发送手机私人题图。通过相同 `solveOnDevice` / Pi 核心运行，简洁答案、手动校验模式、`max_tokens=4096`，原图文件、提示词和 Schema 相同。测试凭据从本机环境读取，不进入应用或报告。

| 入口与参数 | 用时 | 模型请求数 | 结果 |
| --- | ---: | ---: | --- |
| `deepseek-flash-guan`，当前参数 | 49.880 秒 | 3 | completed，C，完整四选项 |
| `deepseek-v4.1-flash`，当前参数 | 22.621 秒 | 4 | completed，C，完整四选项 |
| `deepseek-flash-guan`，显式 `thinking.type=disabled` | 4.996 秒 | 3 | completed，C，完整四选项 |

各方案仅一次，依次执行，存在缓存、负载、随机输出和调用轮数差异；不能据此给出稳定加速倍率、整体准确率或新入口优于旧入口的结论。测试中的关闭思考仅由独立探针注入，不是生产实现，也没有修改 Pi 循环。

脱敏报告在忽略目录 `.runtime/model-latency-review/report.json`，相关公开目录条目在同目录 `provider-catalog.json`；运行命令为 `node .runtime/model-latency-review/probe.mjs --live`。探针仅保留时间、状态、返回模型名、请求大小、思考/正文字符数与结构正确性，不落盘思考正文、HTTP 请求、密钥或图片 base64。三条报告均 passed，脚本退出码 0。测试在 Node 中使用本地核心，并非 Android 网络性能验收。

## 慢发生在哪里

当前入口三次响应头耗时分别约 1.18、1.21、0.92 秒；第二轮完整响应却用了 46.22 秒。该轮 1.27 秒已有思考增量，6.30 秒已有工具调用增量，到 46.22 秒才接收完整响应。结束后约 5 毫秒就开始下一次模型请求。不能把整段 46 秒归为本地计算工具执行，也不能仅凭首个工具增量确定中间停顿发生在供应商哪一层。

该测试实际返回思考内容；本地 `mobileModel()` 的 `reasoning:false` 与 Agent 的 `thinkingLevel:'off'` 不代表线上已经关闭思考。当前本地请求没有 `thinking` / `reasoning_effort` 字段；[官方文档](https://api-docs.deepseek.com/guides/thinking_mode/)说明接口默认启用思考。显式禁用的对照中思考字符计数为 0，但单题答对不能证明关闭后对复杂题无准确率影响。

应用已有 HTTP 流式接收（`stream:true`），不是等非流式接口一次性返回。它需要先按需读取 Skill，可能再调用数值工具，最后获取并校验结构化 JSON 才展示完整题目与答案。因此模型总耗时与用户“看到答案”的等待都受多轮串行请求影响。用户网页端是否提前流式展示、采用什么工具和服务路由没有直接测量，不猜测其内部实现。

历史手机散点图 90.3 秒、自编题 77.151 秒的详情见 [SAT 验收记录](SAT_CHOICE_ACCEPTANCE.md)。这些记录也没有后台独立校验、格式修复或 HTTP 重试；不能靠关闭本已默认关闭的校验来解决慢。

## 后续优化边界

优先减少不必要的模型往返、对流式内容分段耗时做元数据观测，再评估结构化答案提前展示；仍保留必要的 Skill 按需读取、完整题干/选项、安全与结构校验。若增加思考开关，必须通过设备设置、供应商协议能力配置和 Pi 现有兼容接口实现，不能按型号写死或单方面改变所有复杂题的推理策略。

第一阶段仅诊断和型号核查，执行上述三次真实核心解题和探针语法、报告/文档一致性检查。以下为用户随后授权的功能变更。

## 第二阶段：0.1.27 可保存的关闭思考选项

用户明确表示思考不太必要，可以关闭，并要求在设置中可选。

- `packages/contracts/src/local.ts`：设备模型配置增加可选 `thinkingControl`，缺省为服务默认，既有设置可直接读取；配置版本仍为 1。这是可选字段扩展，不迁移题目答案或清除历史。
- `apps/mobile/src/components/settings.tsx`：解题和独立校验配置均可选择服务默认、关闭 `thinking.type`、关闭 `enable_thinking`、关闭 `reasoning_effort`。选中状态可见，随模型配置持久保存。DeepSeek 当前使用第一种关闭格式；界面说明以供应商文档为准。
- `packages/agent/src/pi/mobile.ts`：通过已固定 Pi 0.85.1 的兼容字段产生 `thinking:{type:'disabled'}` / `enable_thinking:false` / `reasoning_effort:'none'`。配置不解析型号或主机名，没有写死供应商、模型或密钥，不修改 Agent 循环。连接测试、每个工具往返和手动校验共用该设置。服务拒绝参数时正常报错，不自动换模型或取消用户选择。
- 服务默认不会发出上述字段；没有默认为任意供应商猜测关闭格式。手机需明确保存所选协议。用户已有的简洁答案、按需步骤、手动校验不变。

验证：

- 先增加协议回归，4 项因配置不识别 `thinkingControl` 失败；实现后相关 41 项通过，全量 72 文件 **651 项通过**。
- `pnpm typecheck`、`pnpm lint`、`pnpm build`通过；补充 UI 测试后修正相对导入扩展名，根 TypeScript 与移动端类型检查再次通过。
- 最初浏览器测试发现当前 RN Web 不把 `accessibilityState.selected` 转为 DOM 状态；为可选按钮同时提供 `aria-pressed`，保留原生状态，重新导出 Web 后桌面/手机 2 项通过。测试覆盖保存、刷新、关闭参数、恢复服务默认、型号不变和窄屏无横向溢出，未删除状态断言。
- `node scripts/exam-skills-live.mjs --live --thinking-control=disabled-thinking --case=sat-scatter --case=sat-transition --case=ap-calculus`：三道自编题通过实际本地配置路径调用模型，SAT 散点图 9.234 秒（5 请求）、SAT 英语 4.605 秒（3 请求）、AP 微积分 18.645 秒（3 请求）。验证正确选项/数学结论、AP 必要论证和移动深浅主题展示。报告 `.runtime/exam-skills-2026-09-18T04-15-41-719Z/report.json`。均未触发独立校验；不是手机网络计时，不构成复杂题整体准确率保证。

`pnpm mobile:apk` 生成 Android 0.1.27 / versionCode 28，43,791,121 字节，SHA256 `27d841cbc5a3f0298d621d25366bc60375ef9c30452fc774f3ca09c6cfe064b1`。与 0.1.26 签名一致，5 项私密配置扫描、Hermes/SQLite/本地图文资源检查通过。iOS 仅通用代码构建，未进行 IPA 打包。

已覆盖安装到用户的 iQOO Neo9，adb 返回 Success，系统读回 0.1.27/code28。手机原配置实际为 `deepseek-flash-guan`、最大输出 8192，本次保持原值；在“我的 → 设置”选择“关闭 · thinking.type”并保存，重新进入后选中状态仍为 true。随后手机真实文本连接测试通过。没有重新发送手机私人题图；上述三道题耗时来自 Node 真实核心测试（4096 输出上限），不能当作手机 8192 配置的完整解题测速。设备设置读取过滤密码及输入框，不保存配置页截图或原始 XML，WebView 临时调试未开启。
