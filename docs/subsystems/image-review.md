# 核验疑点的局部复读

设备路径在自动核验FAIL后的既有一次纠错中，可为视觉疑点生成局部放大图。适用于通用模式和ACT、SAT、AP、ESAT、TMUA、TARA；不改变各考试的作答格式、完整性要求和有效PASS门槛。保留服务路径尚未接入本地裁片回调。

## 区域与原图

[核验契约](../../packages/contracts/src/agent.ts)允许issue附带可选`imageRegion`，用原图序号及归一化矩形定位。0为主图，后续对应本轮有序补图，不包含派生辅助图；不是题号、历史图片或外部URL。[区域契约](../../packages/contracts/src/image-review.ts)验证整数、范围、非零大小和边界，旧核验记录没有该字段仍可读。

[准备逻辑](../../packages/agent/src/pi/image-review.ts)只选TRANSCRIPTION、DIAGRAM或INSUFFICIENT_EVIDENCE中的可用区域，跳过重复及不存在的图片，最多两个区域。适当扩边保留标点、行列标签与图形上下文。没有可靠坐标时继续沿用原图纠错，不从问题文字猜坐标。

Web使用[本地画布](../../apps/mobile/src/local/image-review-views.web.ts)，原生使用[已有图像处理SDK](../../apps/mobile/src/local/image-review-views.native.ts)，按原始像素坐标裁切并适度放大，保留颜色，不补写或生成字符。最长边不超过2048；最多两张派生图，原图和全部补图的顺序、字节及保存快照不变。

## 纠错、复验与边界

[设备适配](../../packages/agent/src/pi/mobile.ts)将裁片及来源区域交给同一次纠错，最终复验复用本轮内存中的相同裁片。原图始终作为完整依据；局部图不能替代上下文，也不能把补图坐标写入仅属于主图的illustrations。裁片优先于普通ACT辅助视图，不叠加突破两张上限；所有图片仍受现有8MiB请求图片预算约束。

准备最多10秒，占用本次纠错时间窗口；取消向下传播，迟到裁片不能派发请求。辅助图生成失败时记录脱敏诊断，并回到完整原图路径，不丢弃已有有效答案。原生SDK操作完成后协作检查取消并释放图像引用和自建缓存文件，尚不能以浏览器验证代替真机释放验收。

没有新增OCR服务、模型阶段、自动重试轮数或工具权限。UNKNOWN不触发新增纠错；主动校验本身不生成裁片或原地改写历史，客户端另行创建的备用重答尚不复用上次核验定位。未确认的问题继续FAIL/UNKNOWN，关键条件仍无法辨认时须说明需要补拍的图片或区域。

[ACT转录](act-transcription.md)仍保留全部可见题面。转录错误会在既有一次修正中重新输出完整转录，本功能没有引入按字段增量补丁，不能承诺总耗时一定减少。裁片不恢复失焦、反光或原图缺失的信息；真实识别改善需另行授权实测。

取舍见[决策](../../.agents/notes/implemented/agent/2026-10-26-local-image-review.md)，实际平台验证范围见[验收](../postmortem/2026-10-26-local-image-review.md)。
