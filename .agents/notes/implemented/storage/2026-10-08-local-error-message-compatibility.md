# 本地历史错误文案的读取兼容

日期：2026-10-08。状态：implemented。范围：本地 v1/v2 题目和 NDJSON 备份读取；Android、Web、iOS 共享契约。

## 背景

安全错误严格匹配固定目录。更新 MODEL_UNAVAILABLE 文案后，旧记录保留旧文案，因而被误判损坏。只读副本中 28 条记录有 13 条符合此模式，替换已知固定文案后均通过原契约；见[验收](../../../../docs/postmortem/2026-10-08-storage-maintenance-and-native-sync.md)。

## 决定

[读取契约](../../../../packages/contracts/src/local.ts)仅识别旧版本已发布的完整错误形状：指定错误码、固定旧文案、retryable=false 和合法 traceId，随后在内存中转换成当前安全错误。仓库读取与旧值比较通过显式读 schema，备份导入在完整校验前复用同一转换。

[仓库](../../../../packages/client/src/local-repository.ts)读取不覆盖原记录或题图；常规保存和[备份导入](../../../../packages/client/src/local-history-import.ts)继续写当前契约。服务事件、模型结果和写入 schema 仍严格匹配当前目录。

## 放弃的方案

不全局放宽安全文案，否则任意上游异常可能进入学生界面。不启动时批量重写历史，以免读取触发写入故障或覆盖尚未备份的数据。单纯隐藏维护提示不能恢复题目。

## 后果与限制

仅兼容此次已知旧文案；任意文案、额外字段、错误的重试标记与真正损坏的记录仍被拒绝并保留。后续改公共错误文案时，应同时审查本地历史兼容。共享代码进入原生构建不等于已在用户手机安装或完成 iPhone 签名验收。

## 验证

[v1/v2 仓库回归](../../../../packages/client/src/local-history.test.ts)覆盖读取、摘要、导出、原始字节保留及伪造错误拒绝；[导入回归](../../../../packages/client/src/local-history-import.test.ts)覆盖旧备份及无效数据零写入。浏览器验证维护入口、宽窄屏、健康题目切换、原始数据保留且没有模型请求。实际构建与测试结果归所属验收。
