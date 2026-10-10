# AGENTS.md — 保留的服务路径

阅读 [服务运行语义](../../docs/subsystems/legacy-server.md)。默认设备应用不依赖本服务。

- Hono 路由与 worker 使用项目契约，不直接导入 Pi；模型、角色凭据和端点仅来自经验证的服务端配置，不硬编码或自动 fallback。
- 每次 session/run/upload/SSE/取消/删除核验 owner；客户端或模型提供的 owner 字段不构成授权。Origin/CSRF、原生身份和私有存储授权不能省略，不可见资源不泄漏归属。
- 上传重新解码验证格式、尺寸和体积并移除 EXIF；拒绝任意远程 URL，私有对象通过授权预览访问。
- 创建 run 返回 202；幂等键、同题活动限制、结果/终态/final-done 事件原子保存。SSE seq 单调，重放与过期快照恢复不重做付费请求。
- 取消持久化并传播，迟到结果不能覆盖终态；租约丢失标 WORKER_LOST，不自动重放外部调用。
- 自动路径强制独立验证，Verifier 含原图且无工具；有效 PASS 才 verified，FAIL 最多修正一次，UNKNOWN/超时不伪装通过。
- body、模型/工具输出、SSE 均用共享 schema；日志和错误脱敏，不输出原图、正文、凭据或 thinking。
- 测试 owner 越权、幂等冲突、取消竞态、租约失效与事件事务；使用隔离数据库/桶，不重置真实数据。
