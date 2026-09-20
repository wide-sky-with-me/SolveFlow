# 2026-09-17 最近答题失败诊断

本轮仅分析，未修改应用、重试真实模型、修改设置或删除答题记录。通过已授权手机的应用界面只读查看；release包不可通过run-as读取私有数据库，没有绕过Android权限。原图/截图仅放在忽略的`.runtime/recent-answer-review/`，本文不包含原图、密钥或用户完整题干。

## 实际观察

- 9月17日最新记录：同图三道数学题，其中第三题要求函数绘图。照片基本可辨认；一次cancelled，随后一次failed，错误码MODEL_OUTPUT_INVALID，未显示候选答案。
- 9月16日前一次两题记录：方程结果±2，定积分结果2/3，结果正确且均显示独立校验通过。
- 历史列表最新题目显示“已保存的题目/综合”，因为失败时没有有效candidate，历史摘要与学科均取默认值；这不能证明识题模型已经成功，也不是用户选错学科。

## 已证实的程序问题

1. `packages/agent/src/pi/mobile.ts:76`把所有非stop结束原因统一归为MODEL_OUTPUT_INVALID。Pi SDK会把传输/供应商异常转换为assistant的error结束状态，原有HTTP/网络分类因而在此丢失。
2. 同文件78行还以32KiB限制最终UTF-8正文；80–88行分别进行JSON语法和结构化协议检查，均返回相同错误码。实际这次是否达到输出长度/Token上限，没有证据。
3. 格式修复只覆盖JSON.parse失败；JSON合法但缺知识点、题组/图示引用不一致等结构化失败会直接结束，没有进入已有一次格式修复机会。三题加图要求的结构更复杂，但这只是候选原因，不能据此认定本次失败原因。
4. `packages/client/src/local-engine.ts:47`仅用阶段事件更新界面/seq，最终保存通用outcome，未保留HTTP状态、finish_reason、输入输出用量、失败阶段/结构字段路径等诊断元数据。现有历史无法还原本次供应商返回。
5. `apps/mobile/src/app.tsx:64`进入后台自动取消；取消记录未区分用户主动取消、锁屏/切后台及卸载清理。因此第一条cancelled不能直接归因于用户点击。

## 离线复现

命令：`node .runtime/recent-answer-review/probe.mjs`，调用当前编译后的真实本地Pi适配器，传入模拟fetch；没有真实网络或模型调用。

| 场景 | 请求次数 | 当前结果 |
| --- | --- | --- |
| 正常Solver + Verifier | 2 | completed，verified=true |
| HTTP 401 | 1 | failed / MODEL_OUTPUT_INVALID |
| HTTP 503 | 1 | failed / MODEL_OUTPUT_INVALID |
| 网络异常 | 1 | failed / MODEL_OUTPUT_INVALID |
| finish_reason=length | 1 | failed / MODEL_OUTPUT_INVALID |
| 合法JSON但缺必要字段 | 1 | failed / MODEL_OUTPUT_INVALID，无格式修复 |

结果保存在`.runtime/recent-answer-review/probe-results.jsonl`。六种模拟结果验证的是代码行为，并非本次真实供应商的返回。UI与原图分析不能替代丢失的服务端错误证据。

## 结论与处理顺序

可以确认最新请求没有产生可展示的有效结果，当前错误归类与诊断记录存在缺陷。无法从现有记录唯一判断本次是接口故障、截断还是结构输出不合规，不能直接归咎额度、模型能力或前端TeX。

优先修复错误分类并保留脱敏诊断字段（角色/阶段、HTTP状态、结束原因、用量、输出字节数、schema错误路径、取消来源；不记录密钥、图片、正文或内部thinking）。再将结构化错误纳入已有有界格式修复，补充多题+绘图合约回归。记录诊断后对同图重新验证，才能判定供应商/输出容量是否另需调整。

本轮未改变源码，因此未重复全套构建、应用E2E及数据库集成；仅执行上述离线诊断探针与文档一致性检查。
