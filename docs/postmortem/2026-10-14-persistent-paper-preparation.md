# 持久试卷整理验收

日期：2026-10-14。

范围：`feat/batch-pdf-unified` 未提交工作区，Node 24.21.0、pnpm 11.7.0、Linux Chromium；六份参考 PDF 与隔离浏览器合成图题。当前行为归[批次 PDF](../subsystems/batch-pdf.md)，取舍归[持久整理决策](../../.agents/notes/implemented/storage/2026-10-14-persistent-paper-preparation.md)。

结论：当前源码的定向回归、完整离线测试、桌面/移动视口导出回归与真实参考裁片回放通过。新发布已在原 Mac HTTPS 地址验收纯题及作答 PDF、刷新复用与原题数据不变；模型设置、预设、证书及既有入口文件指纹未变。真实自动识别质量与原生设备不在本次完成声明中。

## 变更与处理

默认改为显式首次整理的试卷版，普通导出只读已保存结果。文字题不附原图，有图题保留必要裁片；清晰化保护彩色像素并有界锐化，不生成新细节。自动结果及人工调整按原题与源图片指纹独立保存，保留原图和题库。人工保存故障重试仅写存储，关闭前确认未保存状态。

首次浏览器夹具将未完整选项与所选标签同时放入保存作答，违反现有契约，导致题库维护提示及弹窗读取失败。修正夹具：保存作答合法，抽取输出单独模拟题干缺项；保留缺项与警告断言。实际缓存写入同步异常补事务终止，页面不产生未捕获异常。

## 验证结果

`pnpm build:web`、`pnpm --filter @solveflow/agent build`、`pnpm --filter @solveflow/mobile typecheck`、`pnpm exec tsc --noEmit`、`pnpm lint` 与 `git diff --check` 退出 0。Node 比项目固定版本更新的提示保留，未替换工具链或锁文件。

`pnpm test` 退出 0：141 文件、1320 项通过；容器和 LAN 入口另 13 项通过。初次错误的 `@solveflow/agent typecheck` 无该脚本，改用实际存在的 build 验证；旧成绩不计入当前结果。

`SOLVEFLOW_TEST_WEB_URL=http://127.0.0.1:3147 pnpm exec playwright test tests/mobile-e2e/background-exports.spec.ts tests/mobile-e2e/batch-pdf-variants.spec.ts tests/mobile-e2e/paper-preparation.spec.ts --output=.runtime/paper-preparation-2026-10-14/e2e-isolated` 退出 0，42 项通过。后续新增缓存边界场景后，仅重跑 `paper-preparation.spec.ts`，10 项通过；独立场景合计 46 项，不重复累计复测。覆盖首次显式提取、文字题无图、必要裁片、保留识别疑点、刷新像素复用、人工旋转与文字确认保存、故障仅重试存储、年龄不逐出、模式/份数不重绘、源图仅使对应记录失效，以及既有队列、通知、PDF/ZIP、严格门槛和取消竞争。移动视口不等于真手机。

## 测试环境误触发

初次测试服务直接启动 `scripts/web-server.mjs`，继承既有本地模型配置；未配置场景的严格模式测试没有拦截该路由。日志观察到 4 次真实上游请求：2 次完成、2 次连接中断取消，素材只有合成题图和合成文本。费用未核算，不能将这些误调用当成授权的真实模型验收。已停止服务与测试组并保留失败证据。

重跑服务明确使用空模型环境，传入始终抛错的上游 transport；`/__solveflow/web-env` 和模型入口实测 404，配置场景只在 Playwright 路由返回夹具。该环境完成上述 42 项回归，未更改既有配置文件。此次教训：隔离端口和浏览器不足以隔离模型权限，测试服务器也必须显式使用空环境及阻断 transport。

## 真实参考回放与未验范围

离线回放使用审核过的历史裁片与保存转录，通过当前清晰化、持久格式和应用导出验证复用，不冒充自动识别效果。六批各 27 题，生成六份各 27 页的纯题 PDF，分别保留 7、17、4、7、4、23 个裁片；原题照片为 0，模型调用为 0，页面异常为 0，原始归档哈希未变。代表数学文字、生物曲线、物理电路页已目视核对。产物及回执在忽略目录 `.runtime/paper-preparation-2026-10-14/`。

初次辅助束因 Zod 依赖的 JIT 触发现有 CSP 失败；仅在辅助束禁用 JIT，未放宽应用 CSP 或更改依赖文件。首轮 Mac 辅助验收的 IndexedDB 回调变量遮蔽使 Promise 未结束，停止该进程、修正变量名并补拒绝分支后重验，应用代码未因此改动。原参考裁图存在超出当前旋转范围的人工校正，回放使用已审核正向裁片，不截断角度，不宣称两条处理链相同。自动识别质量、Safari/Firefox、原生手机及跨设备缓存同步尚未验。

## Mac 发布与实际来源

发布为 `20261014-paper-preparation-1430`，原地址 `https://192.168.100.84:3130/` 不变；应用容器 `87990888d279` 健康，`personaweave-personaweave-1` 仍为 `396f62b26017`。升级前备份保留于 Mac 的 `shared/backups/20261014-before-paper-preparation`，前版发布目录与 Docker 镜像保留。设置、预设、TLS 密钥/证书及 LAN LaunchAgent 的升级前 SHA256 清单复查全部通过。仅切换 SolveFlow 应用，未迁移浏览器题库。

发布包摘要、Web index 与服务器摘要在忽略目录的 release manifest，上传包 SHA256 为 `ea5e2b28ec9c080e1340f73bf62f7e04439e3e2b3bfd96d6a4ae00f3cab7de2a`；Mac 上 index 和服务器与该 manifest 一致，回环及原 HTTPS 首页 200。

`timeout --signal=TERM --kill-after=10s 240s python .runtime/paper-preparation-2026-10-14/replay-real.py https://192.168.100.84:3130/ 1` 退出 0。在独立 Chromium 上下文的真实 HTTPS 来源回放一批 27 题、7 裁片，下载纯题及作答两份各 27 页 PDF；刷新后全部裁片的字符串像素哈希一致。模型/连接测试路由预先封锁，调用和页面异常皆为 0，导出前后浏览器原题 JSON 与原始归档均未变。辅助上下文不等于用户已打开的浏览器配置文件；未操作后者。

收尾静态检查及文档检查通过；只清理本轮创建的隔离测试服务，不停止 Mac 发布或其他项目服务。
