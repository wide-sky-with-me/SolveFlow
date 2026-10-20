# Web 批次 PDF 导出验收

日期：2026-10-12。

范围：`feat/batch-pdf-export` 分支的本地 Web 导出；隔离 IndexedDB、合成图片、桌面及移动浏览器视口。环境为 Node 24.21.0、pnpm 11.7.0、Chrome 154.0.8037.97；Node 与仓库指定补丁版本不同，命令有 engine 警告。

## 变更

批次菜单增加“导出本批 PDF”。按批次位置读取原图及全部补图，保留已保存回答、校验状态、步骤与知识点，通过独立 A4 文档打印为一个 PDF。图片副本支持自动旋转、底色整理、手动裁切和恢复原图，不写回题图或答案，不发起模型调用。裁切保留完整图像作为默认值，避免自动识图裁掉细小符号和末尾选项。

快照有版本、题数和容量限制；读取中可取消。缺图、损坏、未知记录归属、成员变化及进行中任务明确失败；再次检查成员和任务状态，避免导出期间新任务被当作已经结束。长公式按实际正文容器宽度单独缩小，保留整本正文尺寸。取舍见[决策](../../.agents/notes/implemented/storage/2026-10-12-batch-pdf-export.md)。

## 验证

证据及构建保存于忽略目录 `.runtime/batch-pdf-2026-10-12/`；真实题图和 AI 正文不进入 Git。

- `pnpm build:shared`，退出 0。
- `pnpm exec vitest run --project unit packages/client/src/batch-print.test.ts packages/client/src/local-history.test.ts --maxWorkers=2`，两文件 34 项通过，退出 0；最后针对修改的导出回归复测 5 项通过。覆盖顺序、批次隔离、源字节、取消、损坏、索引遗漏、成员变化和任务并发开始。
- `pnpm exec tsc --noEmit`、`pnpm --filter @solveflow/mobile typecheck`，退出 0。补齐知识点时首次移动类型检查退出 2：澄清候选没有讲解字段；按候选 kind 缩窄后复测，不使用断言或放宽类型。
- `pnpm --filter @solveflow/mobile build:web --output-dir ../../.runtime/batch-pdf-2026-10-12/web-complete`，退出 0。未新增依赖。
- 桌面/移动两视口运行 PDF 导出与既有批次管理，共 12 场景；验证补图、顺序、保存详情、原记录保护、损坏图片、图像复原/调整、非法裁切保留预览、长公式及短窄屏按钮。PDF 专项最终复测 6 项，批次管理 6 项通过；重复复测不累计为额外场景。
- `pnpm lint` 与 `git diff --check`，退出 0；源码边界及文档检查通过。未修改管理脚本，不额外运行管理脚本回归。
- 首次长公式回归失败：A4 正文容器宽 673px、内容宽 684px。缩放按公式所在的实际 Markdown/公式容器计算后通过，未隐藏或裁掉公式。一次验收因构建覆盖正在服务的目录遇到 404，12 项中 11 通过、1 超时；固定完成构建的产物后复测通过，失败截图和原日志保留。

最终浏览器命令：`SOLVEFLOW_TEST_WEB_URL=http://127.0.0.1:43392 pnpm exec playwright test --config playwright.functional.config.ts tests/mobile-e2e/batch-pdf-export.spec.ts --output=.runtime/batch-pdf-2026-10-12/browser-complete`，6 项通过，退出 0，包含旧版只有名称的知识点及已保存讲解的注意事项。批次管理的通过记录见 `feature-browser/` 与 `feature-browser-final/`。

## 已交付 PDF

此前按用户要求先交付当天三个批次：数学 1 共 27 题/29 页/31 张图片，数学 2 共 27 题/28 页/28 张图片，化学共 27 题/30 页/32 张图片；共 81 条记录及 10 张补图。实际 PDF 使用同一打印组件，逐批核对题号 1–27、图片数量、A4、可选中文字及页面外文字；均未发现文字超出页面。人工查看主图汇总及代表页，调整旋转、裁切和底色；源图中已存在的遮挡不补造内容。结果保存在 `pdf-validation.json`，与浏览器打印对话框验证分开记录。

## 未验范围

本轮未调用真实模型、未重新核验 AI 答案正确性；未构建/安装 Android 或 iOS。原生端不显示 PDF 入口。浏览器保存及取消文件由系统打印对话框控制，自动化模拟打开/关闭，不宣称已经替用户完成保存。原本的 3100 服务及真实用户数据库未更新；测试服务交付前关闭。改动未提交或推送。
