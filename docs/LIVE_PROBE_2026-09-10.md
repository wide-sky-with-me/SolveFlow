# 2026-09-10 真实 DMXAPI 探针结果

## 结果

`pnpm probe:live` **exit 0**。固定型号 `deepseek-v4.1-flash-expires-on-0910` 完成项目自制题图 `2x + 3 = 7` 的识别与解题；父侧确定性评分器判定答案匹配 `x = 2`，独立 Verifier 返回符合 schema 的 PASS，且含 transcription 检查。

这是首次真实模型链路通过，**不是整个 M0 或可用 Web 产品完成**，也不是准确率或性能评测。未运行第二次付费探针。

## 实际执行摘要

下面是该命令返回的脱敏结果，未包含原图、原始模型输出、thinking 或凭据：

```json
{
  "schemaVersion": 1,
  "mode": "live",
  "passed": true,
  "status": "completed",
  "verified": true,
  "fixtureAnswerCorrect": true,
  "readCompleted": 1,
  "budget": {
    "modelAttempts": 2,
    "verifierAttempts": 1,
    "fileAttempts": 1,
    "businessAttempts": 0,
    "searchAttempts": 0
  },
  "reservations": 3,
  "ledger": {
    "reservedMicros": "19368000",
    "remainingMicros": "10632000",
    "attempts": 3
  },
  "actualCost": "unknown"
}
```

首次 Solver 请求触发受限 read，读取获准 general Skill 后续轮给出有效候选；Verifier 为新建独立 Pi session，无工具，并由代码独立传入同一原图。两角色均使用上述固定型号，Pi SDK/pi-ai 为锁定的0.85.1。未自动换型、未自动重试；未调用离线模拟服务。

## 授权、费用与清理

- 用户明确确认当前令牌已设置30元并关闭无限配额，随后授权继续；本机 `LIVE_CALLS` 和 `HARD_QUOTA_CONFIRMED` 均启用，`pnpm config:check` 的配置门控通过。这是用户确认，不冒充后台配置的独立审计。
- 请求前再次无凭据读取 DMXAPI [公开人民币报价](https://www.dmxapi.cn/api/dmxapi/rmb/pricing/public)，指定型号仍为此前核实的分时表达式及容量；最高输入3元/百万tokens、输出9元/百万tokens。详见 [DMX_PRICING.md](DMX_PRICING.md)。
- 本次3条费用预占已持久化，合计 **19.368元**；本地账本剩余可预占 **10.632元**。这些是保守预算，不是供应商已扣费或账户余额；未取得实际账单，不写0元、不释放历史预占。
- 已检查账本无遗留锁。命令只在worker实际退出后返回；父侧finally清理私有run目录。本次未启动Web/API或持续后台服务。

## 验证范围与下一步

本次运行了真实探针（包含分包构建）、脱敏配置检查，并做文档/账本一致性检查。既有343项离线回归在上一轮已通过；本轮没有改变模型提示、解题逻辑或费用策略，未为记录结果重复执行全量测试。配置检查命令移除了写死的 `liveExecutionValidated:false`，改为指向兼容性记录：配置检查本身不执行或判定真实验收。

仍待完成供应商实际用量/费用核对、真实失败样本和更广的安全验收；MCP网络边界、生产身份/生命周期、M1数据库/上传/API/SSE/Web等仍以 [PI_COMPATIBILITY.md](PI_COMPATIBILITY.md)和实施计划为准。价格页仍把此型号标为9月10日下架，本次成功只证明本次请求时可用，不保证后续可用性。
