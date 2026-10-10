# 保留的服务路径

该路径由 [Hono 应用](../../apps/api/src/app.ts)、[worker](../../apps/api/src/worker.ts)、[数据库仓库](../../packages/db/src/repository.ts)、[对象存储](../../apps/api/src/storage.ts) 和 [配置](../../packages/config/src/app.ts) 组成。默认 Android/Web 使用设备模型与本地库，不依赖此服务。

## 任务语义

认证将服务确认的 owner 绑定到 session/run/upload/SSE/删除；写操作使用 Origin/CSRF 或原生身份协议。对象私有，图片经实际格式/像素/大小验证及 EXIF 清理，预览需授权。

创建任务返回 202；同题活动限制与持久幂等键防重复付费。同键不同参数冲突。结果、终态和最终事件原子落盘；SSE 使用单调 seq，断线重放和过期快照恢复不重开模型调用。

取消持久化并传播；迟到 worker 不可覆盖终态。租约失效标 WORKER_LOST，用户明确重试才新建 run。独立校验由业务编排控制，有效 PASS 才 verified，不能由 Solver 自称通过。

创建任务的正文大小限制与长文消息契约对齐，其他端点沿用各自限制。完整草稿及源答案共用应用 worker 的有界 JSON 封包；MCP/工具调用保留较小的默认封包和原有结构限制。同题补图的保存/上传界面目前仅在默认设备路径实现，保留的服务端 HTTP 路径尚未接入材料管理。

接口和状态全集由 [公共契约](../../packages/contracts/src/http.ts) 与实现拥有，不在本文复制端点表。

## 开发与限制

模型和角色凭据从服务端环境配置；`.env.example` 只含安全占位，实际秘密不进入客户端或诊断。启动使用根 scripts 的 `server:dev` / `server:start`；集成测试需隔离 PostgreSQL/对象桶。

修改遵循 [API 规则](../../apps/api/AGENTS.md)、[DB 规则](../../packages/db/AGENTS.md) 和 [Agent 规则](../../packages/agent/AGENTS.md)。公网身份、配额、隐私、运维与数学隔离验收不能由本地 M1 成功代替；历史证据见 [M1 记录](../M1_ACCEPTANCE.md) 与 [Pi 兼容记录](../PI_COMPATIBILITY.md)。
