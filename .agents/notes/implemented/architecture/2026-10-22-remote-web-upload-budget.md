# 远程 Web 上传期限与失败归属

日期：2026-10-22。状态：implemented。范围：Web代理、HTTPS网关、设备错误分类和诊断。

## 背景

用户在Windows Chrome通过Tailnet访问Mac3131，批量答题大量失败后终止。只读复制该Origin的IndexedDB元数据并在全网络拦截的独立Chrome读取：34份诊断中15份有HTTP408（解题12、校验3）；实际已派发模型的服务器响应均200。既有模型正文10秒和Node入口15秒不足以承受远程并发传图，未派发的408又被设备归为模型拒绝，代理不记录这类失败。原浏览器不修改，诊断副本提取后删除。

## 决定

[统一限制](../../../../scripts/web-request-limits.mjs)保留配置10秒；模型正文允许120秒总期限和30秒无数据期限。[代理](../../../../scripts/web-model-proxy.mjs)按两种时钟清理计时器、监听和名额，不改变字节上限或已派发模型的阶段预算。[Web入口](../../../../scripts/web-server.mjs)和[HTTPS网关](../../../../scripts/web-lan-gateway.mjs)使用统一130秒Node接收期限，防止外层提前返回无标记408；容器复用Web入口。

本地正文超时才铸造`X-SolveFlow-Request-Failure: upload-timeout`。[设备传输](../../../../packages/agent/src/pi/mobile-model.ts)仅在408与该标记同时存在时返回[安全目录](../../../../packages/contracts/src/agent.ts)的`MODEL_UPLOAD_TIMEOUT`；不进入传输自动重试或备用模型恢复集合，用户手动重试。未标记上游408保留原分类，不凭HTTP码猜测是否已计费。

本地上传失败也记录固定元数据：是否派发、HTTP码、接收字节；不记录题图、正文、密钥或供应商输出。[诊断契约](../../../../packages/contracts/src/local.ts)增加`upload_timeout`原因，旧诊断继续可读，旧失败不自动改写或重放。

## 放弃的方案

仅降低16并发仍不能保证远程单次上传在10秒完成；仅放宽代理仍被外层Node15秒打断。完全取消上传截止会让半截请求长期占位；配置正文不随模型图片一起放宽。将本地408映射为既有MODEL_TIMEOUT会进入自动备用恢复集合，故单独分类，保留用户对重试和费用的控制。

## 后果与限制

局部替代[原正文截止决定](2026-10-21-web-request-body-deadline.md)的模型和外层接收期限，配置截止继续有效。慢上传占用名额更久，但总量、并发、总时间和停滞均有界。客户端总阶段时间仍包含排队与上传。该修复不证明模型答案质量或供应商吞吐；真实题目不用于自动付费复测。

## 验证

[代理回归](../../../../tests/unit/web-model-proxy.test.ts)覆盖16路20秒进展、30秒停滞释放和120秒总期限；[设备回归](../../../../packages/agent/src/pi/mobile-backup.test.ts)证明明确上传超时不重放或切换备用。[当次验收](../../../../docs/postmortem/2026-10-22-remote-upload-timeout.md)记录浏览器、隔离假上游与部署结果。
