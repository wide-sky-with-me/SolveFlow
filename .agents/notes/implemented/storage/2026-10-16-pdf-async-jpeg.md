# PDF 逐页异步 JPEG 编码

日期：2026-10-16。状态：implemented。范围：Web PDF 下载/后台生成。

## 背景

[下载器](../../../../apps/mobile/src/local/download-batch-pdfs.web.ts)原来每页绘制后同步 `toDataURL('image/jpeg', .94)`，再由 PDF 库解码 base64。真实批次降速回放中单次同步编码超过百毫秒，增加主线程连续占用。仅在页末让出执行权仍挡不住这一段。

## 决定

改为 `toBlob` 与 `Blob.arrayBuffer`，以 `Uint8Array` 传给既有 jsPDF；保留 .94、两倍绘制像素、A4 坐标、FAST 参数及分页/克隆门禁。编码与读取分别受原 `bounded` 约束：资源最多 30 秒，且不超过单份剩余 60 秒。每次成功等待后先检查取消，再检查单份期限，之后才读字节或进入 PDF。回调只交付值/错误，不推进版面或读取字节；迟到回调由已结束的等待忽略，画布与 frame 仍走原 finally。

空结果、空文件或非 JPEG 明确失败，不降级清晰度或混入 PNG；底层异常详情继续脱敏。不改浏览器打印、图片整理和模型调用。规范参考 [toBlob](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob) 和 [addImage](https://github.com/parallax/jspdf/blob/master/docs/module-addImage.html)。

容量仍保留旧估算：长度为 n 的 JPEG，旧 data URI 前缀长 23、base64 有填充，计数等于 `3 * ceil(n / 3) + 18`。直接换成 n 会悄悄移动预先拦截边界。图像累计、最终 PDF/ZIP、入库上限均不变，估算提示仍不是实际门禁。

锁定 jsPDF 4.2.1 的 typed-array 自动别名仅哈希前半字节，实库解析/缓存复现可让尾部不同的页面复用同一图片对象。每份新 PDF 内显式使用唯一非空 `page-N` 别名，避免依赖该哈希；不改第三方包。

## 放弃的方案

考虑过保留同步 data URI 并仅在编码前后让出执行权，但编码本身仍阻塞；OffscreenCanvas/Worker 会扩大传输、生命周期与兼容验证范围，本次先采用现有浏览器 API。另可计算全字节身份，但这里每页只插入一次，无须为去重增加散列成本。

## 后果与限制

同份重复页面位图不再自动去重，可能增加文件大小，仍按原实际容量门禁处理。异步接口不保证所有浏览器都在主线程外编码；底层编码/读取没有直接中断 API，软期限只结束等待并阻断迟到产物。jsPDF 字节转串/序列化和 DOM 绘制仍有同步工作，本次不宣称消除长任务、降低峰值内存或完成生产验收。

## 验证

[资源回归](../../../../apps/mobile/src/local/batch-pdf-resources.test.ts)覆盖 JPEG 参数/非零字节、原容量边界、无结果/格式错误、同步异常与读取拒绝、两阶段取消/超时、微任务交错与迟到结果。[范围回归](../../../../apps/mobile/src/local/batch-pdf-render-scope.test.ts)锁定逐页别名与既有克隆门禁；[实库回归](../../../../apps/mobile/src/local/batch-pdf-jpeg-alias.test.ts)以合成 JPEG 头核对独立图像对象，仅证明解析/缓存，不冒充像素解码。[浏览器回归](../../../../tests/mobile-e2e/background-exports.spec.ts)改观察 toBlob 并要求确实编码，防止保存重试的零变化断言失明。定向单元 46 项、根与 mobile 类型检查、Web 构建退出 0；真实回放与成品证据见[验收](../../../../docs/postmortem/2026-10-16-pdf-async-jpeg.md)。
