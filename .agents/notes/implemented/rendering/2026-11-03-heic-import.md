# 网页 HEIC 在本地有界转换

日期：2026-11-03。状态：implemented。范围：完整版、公网拍题、中心考试的网页图片输入。

## 背景

主分支与当前分支的完整版选择器及 MIME 校验明确拒绝 HEIC；其他网页缺少跨浏览器解码。只改 accept 不能让 Windows Chrome 解码，也不能让中心平台的 sharp 自动支持 HEVC。既有模型输入、裁切和文件限制应继续生效。

## 决定

新增[浏览器图像包](../../../../packages/image-input/src/browser.ts)，不放入主题包或模型契约。容器探测后由可终止 Worker 使用 libheif-js 1.23.5 解码主图并转 JPEG，再交给原有入口。所有网页使用[相同构建资产](../../../../scripts/prepare-image-codec.mjs)。原生沿用系统 Compatible 和 ImageManipulator。

解码只允许一个活动堆、活动与等待合计最多16项，30秒前台等待超时或取消会终止 Worker。元数据尺寸先校验，再分配 RGBA；OffscreenCanvas在 Worker 内编码，缺失时转移像素，避免无条件复制大数组。中心页面保持上传题位快照并在卸载时取消转换。

## 放弃的方案

只放宽 MIME/扩展名仍会在解码时失败；服务端 sharp 的现成发行版不能据格式名单推定有 HEVC 解码，且不覆盖设备直连路径。评估过 heic-to/csp，其内部长驻 Worker 未暴露终止句柄，不满足本项目取消与资源释放要求。直接调用成熟 libheif 包，保留自己控制 Worker 生命周期的薄适配层。

## 后果与限制

增加 LGPL-3.0 依赖，解压约9MB，独立按需浏览器 codec 约2MB；随产物保留许可及源码获取说明，可单独替换。CSP允许 WASM 编译，不增加 JS unsafe-eval。没有外部转换服务或付费请求。

现有2000万像素限制仍在，2400万/4800万 iPhone 原图未全面支持。后台暂停也会延迟前台计时器，不能宣称网页在锁屏后持续处理。主分支尚未合入本改动，部署环境未更新。

## 验证

[验收记录](../../../../docs/postmortem/2026-11-03-heic-iphone.md)区分单元、Chrome、Linux WebKit、隔离数据库和未验真机范围。长期行为归[图片输入](../../../../docs/subsystems/image-input.md)。

## 局部替代

源图2000万像素限制由[高分辨率预览决定](2026-11-03-high-resolution-input.md)替代；本笔记的 Worker、许可与格式检测选择继续有效。原验收结果保持原貌。
