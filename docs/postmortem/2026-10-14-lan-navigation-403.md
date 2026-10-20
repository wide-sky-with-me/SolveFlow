# 局域网首页链接导航 403

日期：2026-10-14。范围：Mac 局域网 HTTPS 薄网关；不修改模型配置、题库或 Docker 容器。

## 问题与证据

用户 Chrome 打开既有 https://192.168.100.84:3130 后显示 HTTP 403，不是连通性或证书确认页。curl 首页导航在 fetch-site none/same-origin 下200，cross-site/same-site下403。

真实 Chromium 从隔离模拟外站点击首页链接，CDP 捕获实际请求：GET、固定 Host、无 Origin、fetch-mode navigate、fetch-dest document、fetch-site cross-site；服务403。此前直接 page.goto 的验收未覆盖真实链接进入，不能代表另一网站链接可用。

初次浏览器复现夹具未指定 UTF-8，中文选择器没有命中；指定编码与稳定 id 后得到403。Playwright request.all_headers 未给出此导航的浏览器附加头，改用 CDP ExtraInfo 并仅保存白名单字段后确认实际跨站导航。失败日志未删除。

## 修正

[网关](../../scripts/web-lan-gateway.mjs)保留固定 Host、Origin、路径和请求模式校验。仅首页 GET、无 Origin、navigate/document 获得入口例外，并在转发给既有回环桥接前将 fetch-site 转为 none。模型路径、写入、iframe、跨站 fetch 和外来 Origin 仍被阻止，不移除整体同源检查。选择原因见[决策](../../.agents/notes/implemented/architecture/2026-10-14-container-web-loopback.md)。浏览器语义参考 [MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Fetch_metadata)。

先添加[失败回归](../../scripts/web-lan-gateway.test.mjs)，首页跨站导航断言失败，修正后十二项通过，包括原有模型与网关场景以及导航例外的六类负向边界。依赖和学生模型资源不变，无真实付费调用。

## 发布与验收

独立网关副本保存到目标用户 `.local/share/solveflow-web/gateways/20261014-navigation`；旧网关与 launchd 配置保留。仅替换本部署 launchd 的 ProgramArguments 并重启该任务，不重启模型容器、Colima 或其他项目，不替换证书。

真实链接点击、模型设置可读、页面异常、保护接口和线上摘要的复测证据保存在 `.runtime/lan-navigation-403-2026-10-14`。根 lint 和 diff 检查单独记录；既有部署范围见[部署验收](2026-10-14-docker-web-deployment.md)。
