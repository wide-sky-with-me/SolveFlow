# iPhone 大图输入与后台结果恢复

## 范围与结论

2026-11-03，`feat/public-photo-web`工作区增量，未提交或部署公网/Mac。本次处理格式修复后仍存在的24MP/48MP原图拒绝，以及公网答题随浏览器连接中断的问题；原始格式检查见[前轮报告](2026-11-03-heic-iphone.md)，不修改其当时结论。

原图先生成最长边4096预览，再沿既有裁切/2048模型图链路处理；公网服务端接收任务后继续执行，刷新和网络恢复只同步同一结果。原生iOS增加系统允许范围内的短暂后台收尾，不能保证长时间锁屏或杀进程后继续。实现、取舍分别见[图片输入](../subsystems/image-input.md)、[公网指南](../cookbook/public-photo-web.md#任务与连接恢复)、[平台生命周期](../subsystems/device-runtime.md#平台生命周期)。

## 环境与样本

Linux Node24.19.0、pnpm11.7.0、实际Chrome及Playwright WebKit26.6；隔离PostgreSQL17。原生在远程Mac独立`/tmp`工程复用锁定Expo57/RN0.86.3缓存，Xcode/iOS27 SDK与专用iPhone17模拟器。缓存路径改变后重新生成Pod路径，并单独断言全部Pod版本与缓存锁的`PODS`完全一致。

全部图片为本仓库[合成夹具](../../tests/fixtures/images/generate-heic.py)：普通、旋转、多图主图、24MP/48MP HEIC和JPEG；新增24MP EXIF旋转JPEG。模型均为fake，真实模型请求0次，没有上传真实题图。

## 验证结果

以下为实际完成的检查，退出码均为0；日志在忽略目录`.runtime/iphone-fixes/`，不提交题图正文或密钥。

| 检查 | 命令与结果 |
| --- | --- |
| 客户端与服务核心 | `pnpm exec vitest run --project unit`定向选择队列、引擎、存储、恢复、原生图片、后台准入及公网任务等9文件，99项通过；`packages/image-input/src/high-resolution.test.ts`另2项通过 |
| HTTP任务与旧接口 | `pnpm exec vitest run --project offline apps/photo-web/src/server/service.test.ts --maxWorkers=1`，2项通过，含身份/同源、断开、重复、取消 |
| 网页图片 | `pnpm exec vitest run --project offline packages/image-input/src/browser.offline.test.ts --maxWorkers=1`，Chrome5项通过18.82秒；设置`SOLVEFLOW_TEST_ENGINE=webkit`后同5项通过18.96秒，含EXIF、大图回退和最终2048输出 |
| 公网页面 | `node scripts/test-photo-web.mjs`，Chrome14项通过46.8秒；设置`SOLVEFLOW_PHOTO_TEST_ENGINE=webkit`后WebKit14项通过52.3秒。新增断网后取回结果，断言只上传/派发一次；原12项不重复计数 |
| 中心完整回归 | `node scripts/test-managed-exams.mjs --image=postgres:17-alpine`，51项通过，123.55秒，含48MP首次上传、24MP重拍及HEIC补图 |
| 中心WebKit上传 | 同一隔离入口筛选HEIC上传场景，1项通过、50项跳过，11.35秒；不重复累计为51项 |
| iOS工程生成 | `pnpm exec vitest run --project offline tests/unit/ios-scene.test.ts --maxWorkers=1`，1项通过，确认原生模块进入编译Sources |
| Mac原生编译 | 隔离工程`xcodebuild -workspace …/SolveFlow.xcworkspace -scheme SolveFlow -configuration Release -sdk iphonesimulator … build`，`BUILD SUCCEEDED`；仅模拟器目标 |
| iOS模拟器 | `node scripts/test-ios-simulator.mjs --app=…/SolveFlow.app`，2项XCTest通过、0失败，187.827秒；相册含48MP合成图，覆盖补图/裁切/重启读取及横屏。SQLite核对1题、1图、1摘要、4份材料、0次答题；人工检查导入截图，专用模拟器已删除 |
| 构建与静态检查 | `pnpm build:web`、两种精简网页包构建、`pnpm exec tsc --noEmit`及移动端/公网包typecheck通过；`pnpm docs:check`、源码边界及`git diff --check`通过。`pnpm docs:test`受限子进程先退出1，在授权本机环境复测20项通过，没有改测试 |

首次高分辨率回归复现了旧像素拒绝。实现后Chrome JPEG缩放出现4096×3073的一像素误差，按原尺寸比例修正后通过，没有放宽断言。公网刷新恢复初次4项失败：服务器结果存在，但5秒轮询超出页面恢复期望；改为可见时2秒状态同步后，原12项通过。

Mac首次打包遇到tar硬链接，生成归档改为解引用，解包仍拒绝链接及越界路径。Expo预生成清除了缓存Pods/workspace，首次xcodebuild退出66；恢复依赖后部署锁又因临时路径不同拒绝。仅调整隔离目录的Pod来源路径并验证版本不变，重建和模拟器测试最终均退出0，未改线上服务。

Mac编译日志、模拟器结果和合成图截图已取回本机`.runtime/iphone-fixes/native/`；本次远程`/tmp`源码、上传归档及生成工程已清理，原部署与依赖缓存保留。

## 未验证项与剩余风险

没有真实iPhone相机、锁屏/切网、低内存或iCloud远程原图验收；Linux WebKit与iOS模拟器不代替真机。模拟器未执行真实模型或后台20秒到期的OS端到端场景；后台阶段持有、到期清理与回前台竞态由核心回归覆盖。新原生模块须重编译安装，旧iOS包不生效。

公网持续执行以服务端接收为前提；上传未完即断线不保证执行。服务重启不会恢复运行中的付费调用，已保存结果仍可查询；磁盘失败和进程退出同时发生无法保证内存答案。24小时可恢复窗口不是云历史，过期文件后续提交时惰性清理，多实例写同一目录不受支持。主分支、公网服务器和Mac3131均未更新。本机3190已加载新构建，增量迁移后核对原记录数量未变、真实模型关闭。
