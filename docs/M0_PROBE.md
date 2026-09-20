# M0 命令行探针

此命令验证一张项目自制的 `2x + 3 = 7` PNG，不是上传服务或 Web 应用。图像由自制字形编码为 PNG，无外部素材、EXIF 或学生数据；真值 `x = 2` 仅由父侧评分器和明确标注的离线服务持有，不注入真实模型提示。

## 离线运行

```sh
pnpm probe:offline
```

命令先构建，随后启动仅监听 127.0.0.1 随机端口的确定性模拟服务，运行**同一个编译后的 worker、Pi 会话工厂、原生 OpenAI 兼容 stream、受限 read 和业务编排**。它不读取 `.env`，不打开真实费用账本；输出 `mode: offline`、`simulatedProvider: true`，不能作为真实识图证据。

正常结果为 `passed: true`，2 次 Solver 请求、1 次 Verifier 请求、1 次成功 read、1 次实际受限AST计算；`protocol.calculations: 1` 表示模拟供应商核实了计算器输出。3 个请求均带原图，Verifier 无工具。所有临时服务、worker 与私有运行目录由父侧在结束时清理。

## 真实运行

1. 按 [LOCAL_SETUP.md](LOCAL_SETUP.md) 和 [MODEL_SELECTION.md](MODEL_SELECTION.md)核实供应商、模型引用、容量/报价和当前令牌硬额度。
2. **仅首次、真实调用前**初始化固定账本：

   ```sh
   pnpm probe:ledger:init
   ```

   账本固定为忽略目录 `.runtime/m0-spend/ledger.jsonl`。初始化为独占创建，永久 `.initialized` 标记阻止丢失账本后重新创建。重复初始化会失败；不得删除账本、标记或锁来重置预算。不要对已有费用历史初始化新账本。

3. 确认当前专用令牌额度、关闭无限配额后设置 `SOLVEFLOW_LLM_HARD_QUOTA_CONFIRMED=true`；真实调用获准后将 `SOLVEFLOW_LIVE_CALLS=true`。再运行：

   ```sh
   pnpm config:check
   pnpm probe:live
   ```

缺少任意门控或账本时非零退出，不发送模型请求。每次模型调用由父侧 `fsync` 预占后授权，子线程不能选择价格、账本或 endpoint。Solver/Verifier各自使用环境配置的型号、供应商和独立内存session；Solver具有受限read与calculate，发现general/math Skill；Verifier无工具。没有注册搜索、MCP或Python，也不宣称完整产品工具可用。calculate输入/输出为version1，只接受固定数值语法，默认弧度、可选角度；近似值有明确标记，不提供符号证明或单位换算。

业务顺序为 Solver → Verifier；首次 FAIL 最多修正一次再验证，UNKNOWN 不修正。验证超时/无效输出可保留 unverified 候选；取消、总超时、型号不可用和费用/权限拒绝停止运行。所有阶段共用一个 120 秒预算，Verifier 单次最多 20 秒；Pi 继续负责模型与工具循环。

## 输出与边界

- CLI 仅输出状态、是否通过、真值匹配布尔值、工具次数、预算计数及预占账本摘要；不打印密钥、原始模型错误、题图、候选全文或 thinking。`actualCost: unknown` 不等于 0 元。
- 评分器对这个单一自制样本采用严格的 `x = 2` 文本匹配（允许空格/美元公式标记/末尾句号）；正确但采用其他表达形式的结果可能未通过。此评分不代表通用数学等价检查或准确率评测。
- worker 为终止非合作 JS 的边界，不是 OS 沙箱。宿主管理员目录、Node native/Buffer 内存、供应商取消后迟到费用等部署前提仍存在。
- 此命令不持久化业务结果/终态/SSE，不提供 owner 认证、并发队列、上传解码或私有存储。M1应用已有独立入口，见[M1_ACCEPTANCE.md](M1_ACCEPTANCE.md)。

## 已执行的真实结果

2026-09-10首次 `pnpm probe:live` exit0：3次请求，1次成功read，答案真值匹配，独立Verifier PASS。详见 [LIVE_PROBE_2026-09-10.md](LIVE_PROBE_2026-09-10.md)。本机账本已初始化并累计预占19.368元；无需重复初始化，也不要为展示状态再次付费运行。

该实测早于calculate/math接入；新增工具组合已通过离线CLI/SDK回归，尚未追加付费验证，不把旧的真实结果当作新工具验收。
