# PDF 清理异常不截断失败结算

日期：2026-10-19。状态：implemented。范围：Web PDF 下载的资源失败结算；源码实现不等于服务部署，不属于性能方案采用。

## 背景

[下载器](../../../../apps/mobile/src/local/download-batch-pdfs.web.ts)原先在 bounded 的失败分支先锁定终态并注销定时器/取消监听，再调用 cleanup，最后 reject。[绘制租约](../../../../apps/mobile/src/local/pdf-render-lifecycle.web.ts)允许清理回调抛错；此时 reject 被跳过，原 Promise 永久待定，后续取消或超时也失效。队列即使已登记取消，仍可能等不到 runner 退栈释放生成槽。本决策局部补充[绝对截止交接](2026-10-18-pdf-resource-handoff.md)的异常结算，其期限与调度取舍保留；非自然故障或主线程性能根因声明。

## 决定

保留先锁定终态、清除定时器和监听的次序。清理异常由失败分支消费，随后仍拒绝受限 Promise；取消、资源/单份期限或原错误仍为主要原因。仅在清理抛错时新建同分类错误，已分类的 ExportTaskFailure 保持公开分类，任意第三方错误不提升信任。cause 用 AggregateError 同时保留原错误与清理错误，包括抛出 undefined。

绘制失效先设置 renderActive=false，再分别尝试租约和打印帧释放。首个清理错误不跳过后者，多个异常全部保留；没有新增等待、自动重试、首屏调度或延长期限。正常成功、画质、页别名、资源截止及迟到结果隔离不变。

## 放弃的方案

仅用 finally reject 会让清理异常继续逃出事件监听或 Promise 回调，造成未处理异常；仅 catch 后忽略会丢失诊断。让清理异常替代超时会隐藏已知原因，统一提升为公开错误又可能泄露第三方详情。只保证受限 Promise 结算但继续串行无保护释放，仍会漏掉打印帧。

## 后果与限制

新错误实例只出现在清理异常分支，原错误实例及异常值保留于 cause，不要求错误对象可写。平台清理本身失败不等于已经物理释放，也不声称终止任意同步 JavaScript 或修复交互长尾；根取消仍按已有 owner 规则优先。

## 验证

[资源回归](../../../../apps/mobile/src/local/batch-pdf-resources.test.ts)先复现绘制、编码和读取超时的清理抛错；覆盖重新生成、迟到画布清零、双方清理均抛错、undefined、取消优先及不提升任意错误分类。最终命令、首次失败/替身纠正和受控原生回放见[本次验收](../../../../docs/postmortem/2026-10-19-pdf-cleanup-settlement.md)。
