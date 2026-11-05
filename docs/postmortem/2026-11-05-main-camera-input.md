# main图片修复恢复与提交验收

日期：2026-11-05。范围：main独立工作树，基线b49173e。原`/tmp`工作目录已不存在，残留索引与main一致且无暂存改动；先备份元数据再重建工作树。

保留的Mac版本`20261104-camera-175615`发布清单包含743份文件哈希，与main相比22份有差异，多数仍可与当前同源文件逐项核对。恢复网页相机约束、拍照画布释放、HEIC和24/48MP预览、codec资产及缓存；构建入口、锁文件、边界检查和离线夹具按main包图适配，未合入中心考试、公网精简版或原生后台修改。新main与旧Mac构建逐字节一致未验。

实现及依赖边界归[图片输入](../subsystems/image-input.md)和[决策](../../.agents/notes/implemented/rendering/2026-11-05-main-camera-input.md)。生成夹具仅色块/文字，不含真实题图；不调用模型。

## 实际验证

以下命令在独立main工作树执行，最终退出码均为0；日志保存于本机忽略的`.runtime/branch-submit-20261105/`。

- `pnpm install --frozen-lockfile --offline --ignore-scripts`复用838份缓存包，下载0；移植的锁条目来自已验证分支，额外结构对比确认其余依赖记录未改。
- `pnpm typecheck`：全部main工作区构建、根TS及移动端类型检查通过。
- `pnpm exec vitest run --maxWorkers=2`：207文件、2329项通过，包含Chrome HEIC/24/48MP、连续四图和六次相机捕获。
- `SOLVEFLOW_TEST_ENGINE=webkit pnpm exec vitest run --project offline packages/image-input/src/browser.offline.test.ts --maxWorkers=1`：6项通过，17.83秒；不另累计为不同功能场景。
- `pnpm test:web-container`17项、`pnpm docs:test`20项通过；`pnpm lint`检查源码及文档。
- `pnpm --filter @solveflow/mobile build:web`：Expo导出成功；逐项确认dist内codec、Worker、许可、源码说明四项非空资产。

首次lock-only解析仍请求额外元数据并被网络权限阻止，已取消且未采用其解析结果。改为只移植固定图片依赖条目、冻结离线安装，再完成上述检查。没有提高超时、放宽断言或修改既有依赖版本。未重复联网依赖审计，既有审计限制保留。

本轮只提交及推送代码，不部署腾讯云或Mac，不改变其账号、配置及数据。iPhone真机相机、系统对焦、低内存与真实模型未验。
