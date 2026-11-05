# HEIC 上传与 iPhone 兼容核对

日期：2026-11-03。范围：`feat/public-photo-web` 工作区；只读对照本机 main，不合并、不提交、不部署远程。

## 结论

main 和当前分支的完整版网页均明确拒绝 HEIC；公网简易版没有跨浏览器解码回退，中心平台只接收现有 JPEG/PNG/WebP。修复当前分支的三个网页入口，在浏览器本地将 HEIC 转为 JPEG，保留原有规范化链路。原生 iOS 已用系统 Compatible 表示，不改为 WASM。

这不等于 iPhone 全面兼容：现有2000万像素限制仍会拒绝部分机型默认2400万像素或4800万原图。源尺寸复核：4032×3024通过，5712×4284和8064×6048被既有裁切契约拒绝。自动缩图尚未完成。

## 改动

- 选择器、空 MIME 容器识别、独立 Worker 解码、主图选择和方向处理；JPEG、PNG、WebP不加载编解码器。
- 单解码堆、数量/时间上限、取消与释放；OffscreenCanvas编码和像素转移回退。来源和许可随构建资产分发，CSP只增加 WASM 编译许可。
- 中心平台支持转换预览、取消、补图和重拍，固定原题位；迟到转换不提交其他题目。
- 修复中心静态页面/资源直接构造Response导致安全头丢失的问题；通过框架响应保留CSP及nosniff，真实HTTP回读并验证WebKit解码。Worker脚本要求重新验证缓存，避免旧处理逻辑固定一年。

当前语义和依赖原因分别归[图片输入](../subsystems/image-input.md)与[决策](../../.agents/notes/implemented/rendering/2026-11-03-heic-import.md)。

## 已执行

全部使用自制色块/文字 HEIC，不使用真实题图，不调用模型。

| 命令或验证 | 结果 |
| --- | --- |
| `git show main:apps/mobile/src/platform.web.ts`及对应native/crop源码 | 确认主分支格式拒绝与尺寸限制；原生使用Compatible |
| `pnpm exec vitest run --project unit packages/image-input/src/browser.test.ts apps/mobile/src/platform-image.test.ts apps/mobile/src/platform-batch-import.test.ts --maxWorkers=2` | 21项通过，退出0 |
| `pnpm exec vitest run --project offline packages/image-input/src/browser.offline.test.ts --maxWorkers=1` | Chrome4项通过，退出0；含真实HEIC、方向、多图主图、选择器及无OffscreenCanvas回退 |
| 同上，加`PLAYWRIGHT_BROWSERS_PATH=.runtime/playwright SOLVEFLOW_TEST_ENGINE=webkit` | WebKit26.6四项通过，退出0 |
| `pnpm exec vitest run --project offline apps/photo-web/src/server/service.test.ts tests/unit/mobile-web-server.test.ts --maxWorkers=2` | 本轮与初版HEIC浏览器测试同次执行，两项服务回归通过 |
| `node scripts/test-managed-exams.mjs --image=postgres:17-alpine` | 隔离PostgreSQL17及Chrome：51项通过，退出0，111.81秒（静态CSP生效后再次全量通过） |
| 中心上传用例切换WebKit、隔离库并单独筛选 | 一项通过、其余50项未执行；覆盖初次上传、双补图、重拍、取消及题位不变 |
| `pnpm build:web` | 退出0，Expo导出包含独立codec/Worker/许可资产 |
| 共享图像包、exam-web、photo-web构建及mobile类型检查 | 退出0 |

证据位于忽略的`.runtime/heic-review/`，其中`iphone-dimensions.json`保存尺寸核对。首次本机监听被沙箱阻止；隔离运行后复现成功。默认测试脚本要求的PostgreSQL17.11镜像本机不存在，改用其已支持参数选择现有17镜像，没有改默认值。初版旋转夹具错误地传入Pillow Exif对象，改为字节并经独立解码器核对，保留方向断言。

WebKit中心上传首次出现文件选择器等待超时，后续隔离复测通过；保留这一不稳定证据，不能据复测断言所有iOS选择器均无问题。

## iPhone 仍需验证

- 未运行当前改动的iPhone真机或原生iOS包；Linux WebKit与Chrome手机视口不能替代实际权限、相册/iCloud下载、相机成像、键盘及刘海/底部手势区验证。
- 2400万/4800万图、ProRAW/DNG、峰值内存和长批次性能尚未完成适配验收；本次只证明小型合成图的功能行为。
- 原生iOS进入后台会主动停止本机答题；网页不保证锁屏连接持续。中心任务已接收后可由服务端继续，前台重连同步。
- 完整版网页相机依赖受信HTTPS。Safari脚本存储可能回收，因此本地历史不是云端备份；中心已保存数据由服务器持有。

本机3190预览已重启到本次构建，健康检查通过、既有记录数量不变、真实模型保持关闭。文档检查、20项文档管理回归及源码边界检查通过；文档管理回归首次受沙箱限制失败，隔离权限复测退出0。

未修改DMX模型配置，未把这些改动合入main或更新Mac/公网服务。
