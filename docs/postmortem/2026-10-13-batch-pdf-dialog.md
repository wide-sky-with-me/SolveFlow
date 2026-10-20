# PDF 导出弹窗与历史入口验收

日期：2026-10-13。

范围：Web的导出交互与历史批次菜单，沿用 `feat/batch-pdf-export` 分支；隔离 IndexedDB、合成图片、假模型，桌面/移动浏览器视口。

## 修改

导出和批量设置从整页改为共享的居中弹窗，限制宽高、内部滚动，标题及操作栏固定。表单统一字体、留白、控件高度和明暗主题；图片整理及长文预览默认折叠。选择题目同步该题原图/补图/裁片，只有多图时显示图片来源选择。

历史题目的批量记录菜单在重命名、删除旁增加“导出 PDF”，直接打开同一弹窗，关闭仍停留历史位置；详情入口保留。原生端继续不显示入口，进行中的批次禁用导出。源图片、答案和文件生成逻辑未改。

## 验证

- `pnpm --filter @solveflow/mobile typecheck`、`pnpm exec tsc --noEmit`、`pnpm lint`、`git diff --check`均退出0。首次类型检查拒绝向严格可选属性显式传undefined；明确可空参数后通过，未放宽编译器规则。
- `pnpm --filter @solveflow/mobile build:web --output-dir ../../.runtime/batch-pdf-dialog-2026-10-13/web-delivery`退出0。最终构建包含border-box和系统无衬线字体修正。Node补丁版本的engine警告沿用当前环境；未新增依赖。
- 浏览器完整定向回归24项中23通过、1失败。失败为桌面弹窗实宽762px超出760px限制；给弹窗根应用border-box后定向复测，不放宽断言。
- 完整回归命令：`SOLVEFLOW_TEST_WEB_URL=http://127.0.0.1:46137 pnpm exec playwright test --config playwright.functional.config.ts tests/mobile-e2e/batch-pdf-export.spec.ts tests/mobile-e2e/batch-pdf-variants.spec.ts tests/mobile-e2e/batch-management.spec.ts --output=.runtime/batch-pdf-dialog-2026-10-13/browser`，首次退出1。通过范围包含单份PDF、10份ZIP、取消、红警告修正、图片识别及既有批次管理；证据与失败截图保留。
- 弹窗复测命令：`SOLVEFLOW_TEST_WEB_URL=http://127.0.0.1:45471 pnpm exec playwright test --config playwright.functional.config.ts tests/mobile-e2e/batch-pdf-variants.spec.ts -g 'history batch actions' --output=.runtime/batch-pdf-dialog-2026-10-13/popup-recheck`，桌面/移动两项通过，退出0。断言验证两入口、关闭位置、默认折叠、控件深色、320px窄屏/740×390短屏及操作栏可见。
- 同一用例补充默认折叠预览时从历史入口真实下载PDF，复测两项通过，退出0，结果为 `history-download-recheck/`；PDF头、原数据及关闭位置均核对。重复复测不累计新场景。
- 最终构建使用 `SOLVEFLOW_TEST_WEB_URL=http://127.0.0.1:46639 pnpm exec playwright test --config playwright.functional.config.ts tests/mobile-e2e/batch-pdf-variants.spec.ts -g 'history batch actions' --output=.runtime/batch-pdf-dialog-2026-10-13/delivery-recheck`，桌面/移动两项通过，退出0。人工检查最终桌面深色截图，确认字体、控件、折叠区及固定操作栏。

## 交付边界

证据保存在忽略目录 `.runtime/batch-pdf-dialog-2026-10-13/`，人工查看代表界面；真实用户数据未参与故障注入。未调用真实模型、未构建/安装原生包，未更新原3100服务，改动未提交。测试服务交付前停止。当前操作说明维护于[批次PDF](../subsystems/batch-pdf.md)，不使用旧测试成绩替代本次验收。
