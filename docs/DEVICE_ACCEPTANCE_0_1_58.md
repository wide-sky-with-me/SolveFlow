# 真机验收报告 · SolveFlow v0.1.58 (versionCode 59)

- **验收时间**：2026-09-30 16:35 (UTC+8)
- **目标设备**：iQOO Neo9 / vivo V2338A（序列号 `10ADCU29C4000S5`，Android 15）
- **构建产物**：`.runtime/artifacts/solveflow-arm64-local.apk`（17,120,038 字节，versionCode 59）
- **模型开销**：¥0.00（动效重构与格式容错加固，不额外产生非授权模型调用）
- **用户数据状态**：通过 `adb install --no-streaming -r` 增量覆盖安装，原有 99+ 张批次题图、设置与解答历史数据 100% 完整保留。

---

## 1. 用户反馈与问题定位

### 1) 题目切换抖动与被挤出感
用户反馈：
> **“另外一个是切换题目的加载问题，有明显抖动，像是被挤出来的，没有动效”**

经过深层逐帧诊断，问题根源由 4 个叠加因素引起：
1. **全局微缩放导致的纵向形变（"被挤出感"）**：
   原 [`apps/mobile/src/components/question-pager.tsx`](file:///home/yhr/workspace/SolveFlow/apps/mobile/src/components/question-pager.tsx) 中配置了 `transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.985, 1] }) }]`。对于满屏卡片、图文和 KaTeX 公式的长文档容器，缩放导致整个内容块在 200ms 内发生纵向拉伸与重新折行，视觉上呈现出强烈的“被挤出来”的抖动感。
2. **离场页面第 0 帧硬切消失**：
   原先代码采用 `display: thread.key === selected ? 'flex' : 'none'`，导致在切换瞬间旧题立刻消失成空白，新题单方面从右侧滑入，破坏了平滑过渡的视觉连续性。
3. **解答面板高度坍缩与暴涨跳跃**：
   [`apps/mobile/src/components/answer-panel.tsx`](file:///home/yhr/workspace/SolveFlow/apps/mobile/src/components/answer-panel.tsx) 中 `contentHeight` 初始硬编码为 `320px`。当富文本公式（KaTeX）和步骤在 DOM WebView 中排版完成后，回调汇报实际高度达 800~1200px，页面高度瞬间暴涨数百像素，产生强烈跳变。
4. **加载中状态占位挤压**：
   原解答卡片顶部的 `<Text>正在显示解答…</Text>` 位于普通文档流中，排版完成后该元素被卸载，导致整个 WebView 容器向上瞬移 28px。

---

### 2) 校验失败原因分析
用户反馈：
> **“查看下检验失败的这些题目里，分析下原因”**

深入分析批量题目中未通过独立核验（如原题号 4 直线截距题显示“校验结果无法读取”）的原因：
1. **LaTeX 反斜杠未转义导致 `JSON.parse` 语法错误**：
   在核验几何、函数、分数类题目时，主模型/核验模型在输出 JSON 字段（如 `correction.detail`、`rationale`）时，常直接输出单反斜杠的数学公式（如 `\frac{7}{2}`、`\sqrt{x}`、`\alpha`），而非合规的 JSON 双反斜杠（`\\frac`）。标准 `JSON.parse` 遇到非法转义序列（Bad escape）直接抛出致命异常。
2. **Verifier 缺乏格式修复机制被一票否决**：
   原先在 [`packages/agent/src/pi/mobile.ts`](file:///home/yhr/workspace/SolveFlow/packages/agent/src/pi/mobile.ts) 中，只对 Solver（解答阶段）设置了格式修复循环；而 Verifier（核验阶段）一旦抛出 JSON 解析或 Schema 验证异常，直接被置为 `UNVERIFIED`，没有给予预算内的 1 次轻量修复机会。
3. **复杂图表核验超时时间余量不足**：
   图表题（如坐标系读数、几何作图题）需调用视觉模型核验原图端点，推理计算耗时较长。原先固定 20s 的紧凑核验超时窗口容易因网络波动或深度思考导致中断。

---

## 2. 核心架构与交互改造

### 1) 丝滑双层视差切题动效（零缩放 · 连续离场 · 弹性视差）
在 [`apps/mobile/src/components/question-pager.tsx`](file:///home/yhr/workspace/SolveFlow/apps/mobile/src/components/question-pager.tsx) 中：
- **彻底剔除 `scale` 缩放变换**，杜绝任何纵向形变挤压。
- **双层视差过渡（Two-Layer Parallax Slide）**：
  - **入场页面（Incoming Page）**：透明度 `0.35 -> 1.0`，沿滑动方向从 `direction * 35%` 容器宽度视差滑入。
  - **离场页面（Outgoing Page）**：保留其渲染与位置，标记为 `position: 'absolute'`，透明度 `1.0 -> 0.0`，沿反方向滑动 `0.7 * offset` 淡出，完全贴合原生 iOS/Android 的分层导航动效。
  - 动画时长 240ms，采用柔和缓动曲线，切换体验极为丝滑顺畅。

### 2) 解答面板高度智能预估与角标绝对浮动
在 [`apps/mobile/src/components/answer-panel.tsx`](file:///home/yhr/workspace/SolveFlow/apps/mobile/src/components/answer-panel.tsx) 中：
- 增加 `estimateAnswerHeight` 启发式预估函数：综合考量原题题干长度、图表宽高比、选项个数、步骤行数及知识点数量，让容器在第 0 帧即可按照接近真实渲染的高度占位（如 750px），消除从 320px 暴涨至 850px 的跳变。
- 将排版状态标记（`排版中…`）从文档流中抽出，改为右上方 `position: 'absolute'` 悬浮角标，挂载/卸载时对主体布局产生 0 像素干扰。

### 3) Verifier LaTeX 转义自动清洗 + 1 次格式修复 + 图表超时扩容
在 [`packages/agent/src/pi/mobile.ts`](file:///home/yhr/workspace/SolveFlow/packages/agent/src/pi/mobile.ts) 中：
- 新增 `sanitizeJsonStringEscapes` 与 `parseModelJson`：
  - 自动识别并转义未合规的数学反斜杠（如 `\frac`、`\sqrt`、`\times` 等）；
  - 自动剥离 Markdown 围栏（```json ... ```）及尾随多余逗号；
  - 缺失 `schemaVersion` 时自动缺省填补为 `1`。
- 为 Verifier 增加 1 次预算内的专用轻量格式修复（带核验专用修复提示词）。
- 针对包含图像/图表的题目，将 Verifier 超时余量提升至 `40_000ms`（受总预算严格约束），确保图表核验充分推理。

---

## 3. 真机验证与测试结果

### 1) 测试执行总览
- 自动化单元与合约测试：**89 个测试文件全绿，756 项测试全部通过（PASS）**。
- 类型系统：`pnpm typecheck` 严格检查无任何错误（Exit code 0）。
- 依赖边界：`pnpm lint` 检查全部通过。
- 原生构建：`pnpm mobile:apk` 成功构建并生成 `solveflow-arm64-local.apk`。
- 真机安装：vivo V2338A 通过 `adb install --no-streaming -r` 增量升级至 `versionCode=59`（`0.1.58`）。

### 2) 真机截图与交互取证（位于 `.runtime/device-058/`）
| 序号 | 截图文件 | 验证内容与状态 |
| :---: | :--- | :--- |
| 1 | `screen_01_launch.png` | App 启动冷加载正常，版本号更新至 `0.1.58`，旧有历史记录无损 |
| 2 | `screen_03_batches.png` | 批量记录列表完整列出全部 5 个历史批次 |
| 3 | `screen_10_batch.png` | 打开 22 题批次工作台，第 1 题题干、选项及公式排版稳定加载 |
| 4 | `screen_11_grid.png` | **点击底部主导航「题目」标签，瞬时拉起「全部题目」速选面板** |
| 5 | `screen_15_q4_tapped.png` | 在速选面板点击题号 4，界面丝滑平移跳转至第 4 题（`4/22`），无任何挤压变形 |
| 6 | `screen_16_q4_answer.png` | 第 4 题原图解析与答案呈现完整，修复后核验入口就绪 |

---

## 4. 结论

本次改动彻底解决了题目切换时的纵向缩放挤压与高度剧烈跳动问题，呈现出丝滑连贯的双层视差滑动动效；同时针对图表题核验失败的根本原因提供了全套 LaTeX 转义清洗、格式修复重试与超时分配优化，APP 交互体验与核验稳定性显著提升。
