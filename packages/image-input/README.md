# 本地图片输入适配

只为浏览器提供 HEIC/HEIF→JPEG；不包含模型、网络转换、服务身份或存储。当前限制和原生端区别归[图片输入](../../docs/subsystems/image-input.md)。

`pnpm --filter @solveflow/image-input build` 编译可被 Metro 和浏览器打包器共同读取的 ESM。三个网页构建调用[资产准备脚本](../../scripts/prepare-image-codec.mjs)；不要只复制 JS 入口而遗漏独立 Worker、codec 和许可资产。

新增运行依赖 libheif-js 1.23.5，许可 LGPL-3.0；复用维护中的 libheif 解码实现，避免手写 HEVC 解码。依赖展开约9MB，网页按需 codec 约2MB（压缩前），不进入普通图片首屏 JS。独立资产保留许可和源码获取说明，源包及构建方式见[上游](https://github.com/catdad-experiments/libheif-js)。
