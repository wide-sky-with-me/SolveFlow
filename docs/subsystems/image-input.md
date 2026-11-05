# 图片选择与 HEIC 兼容

## 网页入口

完整版相册的单张、批量、新题和补图，以及公网拍题、中心考试的初次拍摄、重拍和补图，共用[本地图像适配](../../packages/image-input/src/browser.ts)。选择器包含 HEIC/HEIF 扩展名；判断容器不依赖 MIME 或文件名，因此空 MIME 和大写扩展名也可识别。传入 AVIF 时不误走 HEIC。

HEIC 在本机 Worker 中转成 JPEG，优先取容器标记的主图，保留容器旋转后的方向。编解码资产来自锁定的 libheif-js；图片不发送到转换网站。JPEG、PNG、WebP 超出原有输入范围时也先生成有界预览，再走各入口规范化链路。保存及模型输入的尺寸、EXIF 清理和字节上限不变。服务 API 只接收规范化后的图片，不直接增加原始 HEIC 上传格式。

解码串行执行、等待有界，前台等待超过30秒会终止 Worker；结束、错误或取消后释放解码堆和画布。支持 OffscreenCanvas 时在 Worker 内编码 JPEG，否则转移 ImageBitmap 到主线程编码。HEVC编解码器按需加载，普通图片不加载该资产。中心考试转换过程中可取消，固定原题位和提交幂等标识，迟到结果不写入其他题。

## 网页拍摄

完整版[相机预览](../../apps/mobile/src/components/camera-preview.web.tsx)通过getUserMedia请求3840×2160理想视频尺寸，由设备协商实际能力；按真实视频像素捕获，最长边2048，不放大低清图。每次拍摄结束立即释放画布，关闭释放视频轨道。

中心考试与临时拍题使用`input[type=file]`的`capture=environment`调起系统拍照；网页不能借此强制主摄、微距、焦点或4800万像素。拍摄界面已经模糊时，须区分对焦/镜头与拍后处理；不能将后续压缩归因到取景画面。规范见[W3C](https://www.w3.org/TR/html-media-capture/)，WebKit的[上传实现](https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/ios/forms/WKFileUploadPanel.mm)也有JPEG编码分支；具体iOS版本与机型需真机验收。

## iPhone 限制

原生相册已使用系统 Compatible 表示，再通过 ImageManipulator 保存 JPEG，不使用网页 WASM 解码器。原生与网页能力需分别验收。

原图最多32MiB、6400万像素；2400万/4800万 HEIC与JPEG在本地先缩成最长边4096的预览，原生用系统 ImageManipulator 做相同预处理。网页先读取有界EXIF方向，再计算解码缩放尺寸，避免宽幅图先缩得过小又放大；取消时也释放已转移的ImageBitmap。裁切坐标沿预览比例计算，完整版及公网模型图继续使用最长边2048、4MiB限制；中心上传仍遵循既有服务端尺寸/字节限制。范围和原因见[原图预览决定](../../.agents/notes/implemented/rendering/2026-11-03-high-resolution-input.md)。

这解决原图被2000万像素门槛直接拒绝的问题；高噪声、专业格式或大于32MiB的照片仍可能需要用户先缩小。HEVC回退可能分配完整RGBA，低内存iPhone仍需真机验证，不能凭合成图片通过就宣称所有设备全面兼容。

完整版网页相机需要受信 HTTPS（本机 localhost 例外）；局域网 HTTP 或未受信证书不等于可用相机环境。不同入口的后台行为归[设备运行](device-runtime.md#平台生命周期)。本地历史仍受浏览器存储策略影响。

## 构建与验证

[资产构建](../../scripts/prepare-image-codec.mjs)为三种网页打包相同版本的独立 codec、Worker、许可和源代码获取说明；CSP仅增加 WASM 编译许可，不允许任意 JS eval。原生包不引入网页 Worker 执行链。

[合成夹具](../../tests/fixtures/images/generate-heic.py)覆盖旋转、多图主图及24MP/48MP；[单元](../../packages/image-input/src/browser.test.ts)、[浏览器](../../packages/image-input/src/browser.offline.test.ts)与[中心上传集成](../../apps/exam-web/src/server/managed.integration.test.ts)分别验证边界、实际解码和题位绑定。Linux WebKit不等于 iPhone 真机，证据见[格式验收](../postmortem/2026-11-03-heic-iphone.md)和[高分辨率/后台验收](../postmortem/2026-11-03-iphone-input-background.md)。
