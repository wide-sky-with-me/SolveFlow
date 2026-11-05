# 网页图片输入

完整版网页通过[图片包](../../packages/image-input/src/browser.ts)在本地识别JPEG、PNG、WebP、HEIC/HEIF，兼容空MIME和苹果方向信息。转换不上传题图，不包含模型或远程转换服务；原生沿用系统图片选择与解码，本轮只修改网页入口。

HEIC由可终止Worker使用锁定的libheif-js解码主图，再转JPEG；只允许一个活动解码、最多16个活动及等待项，前台等待最多30秒，取消释放Worker。原图最多32MiB和6400万像素。高像素图先生成最长边4096的等比预览，再交给原有裁切/2048模型图链路，不放宽原裁切契约。常量归[格式模块](../../packages/image-input/src/formats.ts)。

Web相机请求后置镜头及理想3840×2160分辨率；实际能力不足时兼容较低分辨率，不把低清视频放大冒充高清。画布按实际视频尺寸生成最长边2048图片，用后立即清空；系统相机对焦和成像仍需真机确认。连续导入四张及拍摄六次有隔离浏览器回归，三张待保存缓冲不等于批次容量。

[构建脚本](../../scripts/prepare-image-codec.mjs)生成独立codec、Worker及LGPL许可/源码获取说明，需随网页完整分发；只替换入口JS会漏掉解码资源。CSP仅补充WASM编译许可。依赖原因及分支边界归[决策](../../.agents/notes/implemented/rendering/2026-11-05-main-camera-input.md)，本次证据归[验收](../postmortem/2026-11-05-main-camera-input.md)。
