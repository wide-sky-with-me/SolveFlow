# Mac网页更新与快速导出复核

日期：2026-10-29。

范围：用户授权更新远程Mac既有3131实例，发布源码为 `a1575515c73d332d4684dd5c1b031fae9ffee141`；本机3100继续运行。浏览器检查使用隔离存储，PDF测试仅用合成记录，没有真实模型调用。

结论：从 `20261025-capture-pdf-speed-195334` 切换到 `20261029-security-batch-114448`。Tailnet及Wi-Fi两个既有HTTPS入口正常，默认答题/校验并发仍为32/32；模型状态保持，旧3130及另一服务未重启。

## 变更与处理

发布包含[识别图片复核](2026-10-26-local-image-review.md)、[独立补图工作台](2026-10-27-batch-material-workbench.md)、[批次控制与导出预检](2026-10-28-batch-controls-preflight.md)及[依赖修复](2026-10-29-dependency-hardening.md)。全量功能的本机证据由对应报告维护，本轮不将旧成绩累计为远程通过。

沿用[部署指南](../cookbook/docker-web.md)：新建发布目录并核对归档、首页、服务和网关摘要，备份Compose环境、模型状态和两个launchd配置，先构建镜像再切换现有实例。保留旧目录、镜像及7个旧静态资源，供已打开页面加载延迟资源；应用升级仍需刷新。两处网关只更新程序路径，沿用原地址、端口、证书和label；未重启Colima，没有修改模型配置或迁移浏览器历史。激活脚本有原实例回滚路径，本次未触发。

## 验证结果

私有证据位于 `.runtime/mac-web-update-2026-10-29/`，含发布包、清单、部署前后脱敏快照、部署日志、收据、隔离浏览器截图和实际PDF/ZIP。首页SHA-256为 `121fc2e87c35c4237713572c5aa8581e82384428088856b652aee7ba8a71127f`，与已验证的本机产物相同。

- `node scripts/package-web-container.mjs` 退出0；包不含凭据、数据库或用户题图，上传归档SHA-256一致。源码工作区干净，清单差异摘要为空。
- SSH后台部署脚本退出0，目标容器healthy；Mac上Node对两个HTTPS入口均完成证书、HTTP200、首页摘要及32/32配置核对。当前机器也以公钥证书严格验证Tailnet入口，退出0。
- 部署前后模型JSON摘要与600权限一致，活动设置摘要相同；解题 `deepseek-flash-guan`、校验/备用 `gpt-6.1-sol`。其他两个容器的身份、启动时间和发布端口完全一致。
- `node .runtime/mac-web-update-2026-10-29/browser-smoke.mjs` 退出0：远程实际页面处于安全上下文，设置、批量任务入口与补图说明正常；页面异常0、HTTP失败0、意外写入或外部调用0。浏览器测试忽略既有自签证书错误，独立TLS校验见前项。
- `pnpm exec playwright test --config .runtime/mac-web-update-2026-10-29/playwright.remote.config.ts tests/mobile-e2e/batch-pdf-variants.spec.ts --grep 'keeps real English text|long source retains|downloads answers and pure questions' --project=desktop --output=.runtime/mac-web-update-2026-10-29/remote-pdf-browser`：3项通过，退出0。实际远程脚本生成10份ZIP、90段长文PDF及带作答/纯题PDF，核对正文、书签、黄色答案标记、错题数量和原记录不变；模型接口被拦截，未使用用户浏览器数据。
- `pnpm docs:check`、`git diff --check` 均退出0。本轮未改应用源码，没有重跑已通过的本机构建与完整功能回归；独立浏览器均已关闭。

## 未验证项与剩余风险

没有真实付费解题、负载压测、Mac整机重启、Safari或原生设备验收。依赖修复仍有一项已加本地补丁的低危审计通告，原始CI审计未放宽，详见依赖报告。不同Origin仍各自保存历史；用户页面刷新前应等待当前任务及待存照片完成，刷新不会自动重放请求。
