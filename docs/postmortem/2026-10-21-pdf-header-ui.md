# PDF 导出提示与操作区整理

日期：2026-10-21，Asia/Shanghai。基线：main `4f7f8d7`及既有未提交改动。本轮仅调整Web导出窗，不提交、推送或付费调用。

## 改动

- [面板](../../apps/mobile/src/components/batch-pdf-panel.web.tsx)将成功反馈并入批次题量行，[保存文案](../../apps/mobile/src/components/use-batch-pdf-export.web.ts)缩为“整理结果已保存”；错误仍保留独立提示和聚焦。
- [样式](../../apps/mobile/src/components/batch-pdf-dialog.web.css)移除右侧280px限制，整理状态与操作独立成行；按钮整项换行，文字保持单行。已完成的整理入口使用次要样式，操作及禁用条件保持。
- 当前行为维护于[批次PDF](../subsystems/batch-pdf.md)。布局调整无需新增架构决策。

## 验证

Node24.19.0、pnpm11.7.0，合成图片、fake模型、新浏览器存储。隔离入口为`http://127.0.0.1:46293`，PID1385758；桌面1440×1000、窄屏390×844，人工查看浅色/深色截图。日志和产物位于`.runtime/pdf-header-ui-2026-10-21/`。

| 实际命令或范围 | 结果 |
| --- | --- |
| `CI=1 EXPO_NO_TELEMETRY=1 EXPO_NO_DOTENV=1 pnpm --filter @solveflow/mobile build:web --output-dir ../../.runtime/pdf-header-ui-2026-10-21/web` | 退出0 |
| `CI=1 SOLVEFLOW_TEST_WEB_URL=http://127.0.0.1:46293 pnpm exec playwright test tests/mobile-e2e/paper-preparation.spec.ts --grep 'incomplete choices remain\|legacy prepared crops\|manual decisions and crop\|prepared storage failure reveals\|preparation action and live\|busy progress and cancellation\|slow preparation survives\|cached preparation read' --reporter=line --output=.runtime/pdf-header-ui-2026-10-21/browser-results` | 22项中20通过、2失败，退出1 |
| 同入口仅筛选`legacy prepared crops`，输出至`browser-final-results` | 修正夹具后2项通过，退出0；与前20项组成22个不同场景，不累计重复执行 |
| `pnpm exec tsc --noEmit`、`pnpm --filter @solveflow/mobile typecheck` | 均退出0 |
| `pnpm lint`、`git diff --check` | 最终均退出0；初版文档超长已精简，未调整门槛 |

三按钮夹具首轮缺少不完整选项所需的uncertainties，首次复测又因逐记录返回数组从0开始而误标两题；分别保留在browser.log、browser-retest.log。改用稳定题干定位并补齐字段后通过，保留原状态、调用次数、历史不变、像素和按钮边界断言。

覆盖待整理/进行中/已保存/待核对、三个按钮不折字或溢出、键盘操作、保存重试、缓存恢复及短屏取消。未执行真机、APK/iOS构建或真实模型测试。

## 本地交付

已更新用户现有`http://127.0.0.1:3100`：新增两个哈希资源后原子切换入口，旧资源和入口备份保留；未重启服务或操作用户历史。首页及19项脚本/样式返回200，文件路径与入口哈希见publication.json；现有标签页由用户刷新生效。

随机端口测试服务已停止，确认PID不存在、端口关闭，见cleanup.json；3100服务保留运行。
