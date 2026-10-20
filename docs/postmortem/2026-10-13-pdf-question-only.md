# 纯题目PDF与独立端口验收

日期：2026-10-13。

范围：`feat/pdf-question-only`分支，基于保留的PDF功能stash恢复；原stash不删除、不覆盖main，也不提交或推送。真实用户题图与浏览器数据库不参与故障注入。

## 修改

导出弹窗增加“纯题目”，沿用项目的分段按钮和明暗主题。带作答模式继续输出题目与该份选项；纯题目只输出题干、所有选项与必要图示，DOM省去答案、解析、对错统计和副本信息，界面隐藏对错/多份设置。两种模式复用同一题图整理缓存，切换保留带作答的份数与对错配置。

纯题目直接输出单份`批次名称_总N_纯题目.pdf`，下载及打印均使用当前模式，不依赖对错规划。带作答的多份PDF/ZIP和原始阅读记录继续保留。`web-server`支持进程参数`SOLVEFLOW_WEB_PORT`和`SOLVEFLOW_WEB_DIR`，仍只绑定回环地址，默认3100和既有dist；新分支使用3102及独立构建目录，旧3100服务与产物保留。

## 验证

- `pnpm build:shared`、`pnpm --filter @solveflow/mobile typecheck`、`pnpm exec tsc --noEmit`退出0。恢复stash后的锁定依赖由pnpm复用本地安装，未升级依赖。
- `pnpm exec vitest run --maxWorkers=2 packages/client/src/batch-print-variants.test.ts tests/unit/web-server-options.test.ts`首次12通过、1失败，退出1；失败为默认目录末尾斜线与规范化路径不一致。统一resolve后，仅端口配置2项复测通过，退出0；文件名/作答规划11项原本已通过。
- `pnpm docs:test`20项通过，退出0；`pnpm lint`、`git diff --check`退出0。
- `pnpm --filter @solveflow/mobile build:web --output-dir ../../.runtime/pdf-question-only-2026-10-13/web`退出0。该构建没有替换`apps/mobile/dist`。

- 浏览器命令：`SOLVEFLOW_TEST_WEB_URL=http://127.0.0.1:46451 pnpm exec playwright test --config playwright.functional.config.ts tests/mobile-e2e/batch-pdf-export.spec.ts tests/mobile-e2e/batch-pdf-variants.spec.ts --output=.runtime/pdf-question-only-2026-10-13/browser`，桌面/移动30项全部通过，退出0；未放宽原有断言。
- 人工查看纯题目弹窗和实际下载PDF第一页，确认主题、题目/选项/图示及没有作答与对错统计。
- 用`SOLVEFLOW_WEB_PORT=3102 SOLVEFLOW_WEB_DIR=.runtime/pdf-question-only-2026-10-13/web pnpm start`后台启动；监督PID124367，凭据通过既有加载器读取，未输出配置内容。首页与隔离构建字节一致、10个唯一入口资源HTTP200；3100首页哈希未变化。服务证据见忽略目录`server.json`，隔离测试服务104033已停止，用户3102服务保留。

## 运行边界

浏览器用合成图片及假模型验证打印克隆正文、实际PDF文件、图片与所有选项保留、模式切换及原数据不变；真实模型质量、原生构建/安装未验。不同端口是不同浏览器来源，历史及缓存独立，需要旧题时通过备份导入，不自动迁移。证据进入忽略目录`.runtime/pdf-question-only-2026-10-13/`。
