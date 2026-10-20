# 本机整理结构失败与格式修正

日期：2026-10-14，21:57—22:46（Asia/Shanghai）；后续离线验收时间以命令记录为准。

范围：本机 http://127.0.0.1:3100/，目标批次 `2026-10-13 14时 · 01` 的首条记录。使用获准保存副本及独立浏览器存储，保护原 Windows Chrome、题库和模型配置。

结论：复现并定位完整模型响应的结构错误；加强提示后的同一条真实请求通过 JSON、结构与归属校验。仅验证单条，不是27题整批成功证明。

## 根因与处理

21:57 两次服务日志都是 HTTP 200/completed，但服务只观察传输。客户端旧适配统一抛出 MODEL_OUTPUT_INVALID，具体解析失败被隐藏。

22:31 受控请求正常 stop：模型把 sources、warnings、confidence 放到根对象，questions 内只保留 key/problem；将这三项移回后仍有14处非法图框 role。没有截断、空正文或思考耗尽。探针只保留响应在内存，脱敏记录字段路径；没有模型原文落盘。

[适配](../../packages/agent/src/pi/batch-print-layout.ts)增加明确层级与 role 枚举提示，[运行入口](../../apps/mobile/src/runtime.ts)开启一次有界格式修正及浏览器控制台 print.layout 脱敏诊断。两次共用原截止时间；外来归属、截断、超限、取消和传输失败不重放。持久结构与来源校验保持严格，取舍见[决策](../../.agents/notes/implemented/agent/2026-10-14-print-layout-format-retry.md)。

## 真实请求账本

本次获准监控后共发送两次真实请求，均针对首条记录、同样的4张图；没有整批循环。SDK重试为零。时间是服务记录的响应结束时间。

| 时间 | 传输/结束 | 传输字节 | 正文字节 | 完成tokens | 思考字符 | 结构/归属 | 耗时 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 22:31:03 | 200/stop | 323167 | 5118 | 1561 | 0 | 失败 | 8.485秒 |
| 22:46:04 | 200/stop | 203424 | 3247 | 977 | 0 | 通过 | 4.956秒 |

第二次在新构建网页上触发，新响应无需额外格式重试。探针每轮只允许一个真实分发，其余分发会阻断；内存回放回调不是模型请求。

## 验证结果

- 首轮隔离恢复遗漏分离保存的图片，脚本退出1，尚无模型分发；补齐首条的 record/image/material 文档后复现成功，原库未改。
- 新重试测试首轮4项失败，原因是使用了已安装 Pi 0.85.1 不存在的 setSystemPrompt；核对安装类型后改为 state.systemPrompt，保留失败记录。
- `pnpm exec vitest run packages/agent/src/pi/batch-print-layout.test.ts packages/agent/src/pi/batch-print-layout-normalization.test.ts packages/agent/src/pi/batch-print-layout-retry.test.ts`：40项通过，退出0。新增10项覆盖单次修正、二次终止、归属/截断/超限/工具结束不重试、取消、共享截止与脱敏。
- `pnpm build:web`、`pnpm --filter @solveflow/mobile typecheck`：退出0。现有本机服务直接读取新产物，不另启生产入口；Web主包更新为 index-8b84465d15e8bb0cc002222d95180c14.js。
- `pnpm exec playwright test tests/mobile-e2e/paper-preparation.spec.ts --config playwright.config.ts --output .runtime/print-trace-2026-10-14/e2e`：24项通过，覆盖桌面与模拟窄屏，使用合成模型，不是原 Windows 配置或整批真实验收。
- `pnpm lint`、`pnpm docs:check`、`git diff --check`：退出0。文档首轮缺决策模板标题并超过长度门槛，补齐标题与去重后通过；一次直接调用 ESLint 因仓库没有对应配置入口退出2，随后使用项目正式 lint 命令通过，未新增工具配置。
- 修复版首页 HTTP 200、实际引用新主包；诊断进程均已 SIGTERM 结束，3189/3190不再监听，内存响应释放。用户测试服务仍为 PID 261970、3100端口；题库与配置未改。
- 探针在 `.runtime/print-trace-2026-10-14/`，代码没有真实题图、题干、密钥或响应正文。

## 未验证项

27题完整真实整理、原 Windows 用户配置中的实际浏览器交互、真实裁片质量和识别准确率未验。第二次真实请求首次就通过，因此自动格式修正的成功与上限由离线回归验证，不冒充真实二次修正验收。没有远端部署、提交或推送；本机新网页需刷新后加载。
