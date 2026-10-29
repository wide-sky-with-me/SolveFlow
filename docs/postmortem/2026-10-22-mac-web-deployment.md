# Mac 独立 Web 实例部署

日期：2026-10-22。范围：用户授权检查远程 Mac 现有服务，在新端口部署当前工作树并提高并发。保留原有未提交内容，不提交/推送，不执行真实模型调用。

## 交付

原机有旧 SolveFlow 3130 与另一服务 8000，均继续运行，容器身份及启动时间未变化。新实例使用独立 Compose 项目 `solveflow-web-preview`、发布目录、模型状态副本与 launchd 网关 `local.solveflow.web-preview-tailnet`，端口 3131；不重启 Colima。沿用 Mac 原有模型与预设，副本后续独立保存。

新实例答题/校验默认各16，浏览器已保存偏好仍优先。源应用入口摘要与本地最新3100版本一致：`54f5cc8577603208b95200b323c68865062be39d19afb79bea8356475861222f`。发布清单记录包含未提交工作树，不以 Git HEAD 代替当前代码。

Docker 仅绑定宿主回环；HTTPS 网关仅绑定固定 Tailnet 地址，保持 Host/Origin/fetch-site 校验。TLS 私钥留在 Mac，新自签证书通过指定公钥校验；浏览器首次需确认或信任该公钥。新 Origin 的历史独立，不自动迁移旧数据。操作和取舍见[部署指南](../cookbook/docker-web.md)及[决策](../../.agents/notes/implemented/architecture/2026-10-22-private-web-instance.md)。

## 验证

本机 Node24.19.0、pnpm11.7.0；Mac arm64，Docker29.5.2。证据在权限700的忽略目录 `.runtime/mac-web-deploy-2026-10-22/`，不保存到公共报告。

| 命令或检查 | 实际结果 |
| --- | --- |
| `pnpm build:web` | 共享包及 Web 导出完成，退出0 |
| `node scripts/package-web-container.mjs RELEASE_DIR` | 修复后独立发布成功，退出0；远端核对归档、server/gateway/index 摘要一致 |
| `pnpm test:web-container` | 17项通过，退出0；覆盖实例并发范围、模型编辑后默认保留、Tailnet 显式准入与负向转发 |
| `pnpm exec vitest run --project unit tests/unit/web-model-settings.test.ts tests/unit/web-env.test.ts tests/unit/web-model-presets.test.ts` | 实际只匹配环境测试，4项通过，退出0；设置/预设以单独离线回归为准 |
| `pnpm exec vitest run --project offline tests/unit/web-model-settings.test.ts` | 9项通过，退出0；模型配置、预设、原子保存及凭据边界 |
| `pnpm docs:test` | 提权后的离线回归20项通过，退出0 |
| `pnpm lint` | 退出0；源码边界、329份当前文档、99份决策、165个源码锚点和108份冻结文档通过 |
| 远程 Compose 构建与启动 | arm64 镜像健康，运行 UID501；应用644、私有模型600，state700 |
| `node .runtime/mac-web-deploy-2026-10-22/remote-smoke.mjs` | 修正测试后退出0；完整校验新 TLS、入口摘要、浏览器安全上下文和界面16/16，负向来源403，保留 API404，无页面异常 |
| `pnpm exec playwright test --config .runtime/mac-web-deploy-2026-10-22/playwright.config.ts tests/mobile-e2e/batch-pdf-variants.spec.ts -g 'ten copies use\|a remark names'` | 桌面/移动视口4项通过，1.3分钟，退出0；真实单份 PDF、10份 ZIP、备注及同名去重，独立 IndexedDB，拦截模型请求 |
| 仅重启新容器与新网关 | 退出0；HTTPS200、同一入口摘要、并发16/16保持 |
| 最终只读核对 | 新旧三个容器健康；旧应用回环页面200且摘要不变；原配置与新副本指纹相同；新服务模型派发诊断0条 |

## 失败与修复

首次打包的 Git 子进程在沙箱内 EPERM，保留不完整目录；同一构建产物在授权执行环境重新生成发布包。首次 `docs:test` 沙箱退出1，授权执行后20项通过；未修改检查门槛。

首次新容器因宿主私有文件权限导致 UID501 读取 `server.mjs` 时 EACCES，健康检查失败。停止该新容器，在 Dockerfile 规范化白名单应用文件读取权限，重新生成不可覆盖发布目录与镜像后健康；挂载的凭据仍600。旧容器全程未重启。

首次负向 Host 冒烟让 Node 将伪造 HTTP Host 用于 TLS 名称检查，测试先被 TLS 拒绝；改为始终校验实际目标证书，再单独验证 HTTP Host403。末次日志统计的临时 Python 命令因换行转义失败，改用独立脚本，统计成功。

使用磁盘旧证书校验旧 LAN 入口时出现 issuer 校验失败，未修改旧网关或证书；旧应用内容和健康通过既有回环入口确认。新入口 TLS 验证独立通过。

## 限制与资源

未验真实模型吞吐、供应商限流、原生 iOS、整机重启或休眠。16/16为独立队列名额，不承诺上游吞吐。浏览器检查使用合成题目和隔离上下文，没有修改服务器模型配置。

有意保留新部署容器和 launchd 服务供用户访问；本次浏览器均关闭，无新增本地测试服务。旧配置、旧发布包、本地3100入口保留；失败发布目录用于复现，不处于活动状态。

工作区指纹对比：1184份基线文件中1175份未变，9份明确修改、2份新增均属本轮范围，无意外路径变化。
