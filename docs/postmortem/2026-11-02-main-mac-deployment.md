# 主分支同步与 Mac 网页发布

日期：2026-11-02。

范围：提交并推送公网精简版独立分支，检查主分支，将已推送的 `main` 发布到 Mac 既有 3131 实例。没有合并公网版到主分支，也没有更新公网服务器或本机 3100 资源。

结论：`feat/public-photo-web` 已推送至 `8db63e2`，`main` 发布源码为 `92f5c07d737a649615345f562d2bf8131b899061`。Mac 已切换到 `20261102-main-095734`，两个既有 HTTPS 入口正常，模型配置和默认并发 32/32 保留。

## 变更与处理

检查时两个分支均无未提交改动；远端 `main` 为 `199f19d`，本地仅领先一笔 ACT 验收及测试夹具提交，已正常推送，无强制推送或历史改写。公网版保留独立分支，Mac 继续运行完整客户端。

本轮 732 份运行源文件指纹为 `f67534addc833aa60183284e92fb5ab4480d84f805a2327f2009d36fa46afea0`，与[上次 Mac 发布](2026-10-30-mac-web-update.md)一致。因此本轮是主分支版本归属确认及重新发布，不包含新的产品行为修改。后续验收文档提交不改变这一运行指纹。

按[发布指南](../cookbook/docker-web.md)使用隔离 Expo 输出，不覆盖本机产物。新归档经 SSH 上传及摘要核对，在 Mac 构建镜像；备份私有状态和网关配置，等待请求空闲后切换。旧发布、镜像和 96 份旧静态资源保留，激活失败可回滚；本次未触发回滚。

归档 3,865,658 字节，SHA-256 为 `0a4d13bea6896caa00fa8c8d418cc9f9b983bf09c622de74ff8f3085ba08d05e`；首页摘要为 `7b448a173186700b8542d01e4bb79561f5b7f36a2cc179fab4f8ae24ed432ed9`。发布清单记录 `branch: main`、上述源码提交和干净工作树。

## 验证结果

私有日志、源码清单、脱敏快照和发布收据位于忽略目录 `.runtime/mac-main-2026-11-02/`。

- `pnpm build:shared`、资源准备、隔离 `expo export --platform web` 与发布打包退出 0。
- `pnpm test:web-container`：17 项通过、退出 0；`pnpm lint` 退出 0。
- Mac 激活脚本退出 0，目标容器 healthy；Tailscale `100.88.228.28:3131` 与 Wi-Fi `192.168.100.84:3131` 均通过 TLS 证书、HTTP 200、首页摘要及并发配置检查。本机也使用公开证书严格验证 Tailscale 入口，没有忽略证书错误。
- 部署前后私有 JSON 摘要及 0600 权限一致，活动模型配置一致；其他两个容器身份、启动时间及端口不变。
- 隔离 Chrome 页面检查退出 0：安全上下文、设置、任务入口及使用说明正常；页面异常、HTTP 失败、意外写入及外部请求均为 0。浏览器忽略既有自签证书错误，严格 TLS 检查另列于前项。
- `pnpm exec playwright test --config .runtime/mac-main-2026-11-02/playwright.remote.config.ts tests/mobile-e2e/batch-pdf-variants.spec.ts --grep 'keeps real English text|long source retains|downloads answers and pure questions' --project=desktop --output=.runtime/mac-main-2026-11-02/remote-pdf-browser`：3 项通过、退出 0，共 29.3 秒。实际下载 10 份 ZIP、90 段长文 PDF 及带作答/纯题 PDF，正文、书签、黄色标记和原记录不变均通过；模型请求被拦截。

## 未验证项与剩余风险

本轮没有真实模型请求、付费压测、Safari/Firefox、原生设备或整机重启验证。浏览器历史按原 Origin 保留，没有迁移或清空用户数据；刷新前应完成当前任务和待存照片。识别、依赖审计及原生发行的既有缺口仍见[发布状态](../project-status.md)，不能以本次部署代替对应验收。
