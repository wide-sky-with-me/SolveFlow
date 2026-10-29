# 错题标记、导出通知与菜单验收

日期：2026-10-21，Asia/Shanghai。基线为main `4f7f8d7`及既有未提交改动；用户要求可选错题标记、通知自动收起、移动“导出记录”。不提交、推送或调用付费模型。

## 变更与边界

[作答导出](../../apps/mobile/src/components/batch-pdf-export.web.tsx)增加默认关闭的“标记错题”，预览、打印、PDF/ZIP与后台沿用同一值；题号旁显示“× 作答错误”，作答区突出，续页重复标记。文件名/记录区分版本，原不标记格式保持。标记消费副本计划，不代表新核验；兼容与冻结边界见[决定](../../.agents/notes/implemented/storage/2026-10-21-marked-answer-exports.md)。

[通知](../../apps/mobile/src/local/web-export-tasks.ts)8秒后收起，新通知重置期限，手动关闭清理定时器；执行中保留状态入口，存储故障不自动吞掉。[菜单](../../apps/mobile/src/components/profile.tsx)将入口放在“使用说明”之后，沿统一行样式，运行中数量仍可见。当前语义见[批次PDF](../subsystems/batch-pdf.md)。

## 环境与验证

Node24.19.0、pnpm11.7.0；fake模型/合成图、隔离IndexedDB。静态服务`http://127.0.0.1:45119`，PID2137535，未加载环境模型桥接。日志及PDF在`.runtime/pdf-marking-ui-2026-10-21/`。

- before.log：旧Web两项桌面回归失败、退出1，分别因无标记选项、菜单中无导出记录；通知超时断言尚未执行。
- `pnpm build:workspace`：退出0，见build-workspace.log。
- `pnpm exec vitest run --project unit --maxWorkers=2 packages/contracts/src/export-task.test.ts packages/client/src/batch-print-variants.test.ts packages/client/src/local-export-tasks.test.ts apps/mobile/src/local/run-batch-export.test.ts apps/mobile/src/local/web-export-admission.test.ts`：初轮5文件246项通过、退出0，见unit-targeted.log；后续新增文件名回归不累计此成绩。
- `CI=1 EXPO_NO_TELEMETRY=1 EXPO_NO_DOTENV=1 pnpm --filter @solveflow/mobile build:web --output-dir ../../.runtime/pdf-marking-ui-2026-10-21/web`：退出0，见build-web.log。
- new-browser.log：通知/菜单2项通过；标记2项因测试未等预览就绪而在读题号前失败，退出1。补充题页就绪等待，原断言保持。
- marking.log：补齐就绪等待后，桌面/窄屏2项标记回归通过、退出0；含下载PDF红色像素、原版无红标、打印及后台重载。
- browser-final.log：26项中24通过，2项因旧菜单断言仍要求6个箭头而失败、退出1。更新为新增入口后的7项，保留全部对齐/尺寸断言，追加入口唯一性检查。
- browser-delivery.log：随后调整通知不再常驻运行进度时，误删弹窗仍依赖的active变量，导致4项失败；停止重复执行，退出130，另1通过、1中断、8未执行。恢复弹窗统计，保留普通通知自动收起与存储故障提示；重建后复测。
- `pnpm exec vitest run --project unit --maxWorkers=2`：最终119文件1470项通过、退出0，见unit-final.log。
- `pnpm exec tsc --noEmit`、`pnpm --filter @solveflow/mobile typecheck`：最终均退出0，见typecheck-root.log与typecheck-mobile-final.log；移动端首轮因测试替身返回值缺title退出2，补齐后通过，原日志保留。

最终构建build-delivery.log退出0。`CI=1 SOLVEFLOW_TEST_WEB_URL=http://127.0.0.1:45119 pnpm exec playwright test tests/mobile-e2e/background-exports.spec.ts tests/mobile-e2e/paper-preparation.spec.ts tests/mobile-e2e/profile-dashboard.spec.ts --grep 'optional wrong-answer marks|export notices close automatically|a failed file save only|cancellation during renderer loading|dashboard counts saved|a later long question' --reporter=line --output=.runtime/pdf-marking-ui-2026-10-21/browser-verified-results`：14项通过、退出0，见browser-verified.log，不与前轮累加。

包含实际PDF页眉红像素对应计划题号、原版无红标、打印/后台重载、标记题自动续页、通知收起后任务仍在执行且可取消、存储故障补存、七项菜单在1920/1280/390/320宽度及浅/深色下对齐。人工查看标记PDF页眉及菜单截图，历史字节与模型调用数保持。文档初检因batch-pdf.md为2215/2200单元退出1，精简开头布局说明，未修改限制。

`pnpm lint`最终退出0，见lint.log；边界与文档检查通过，`git diff --check`退出0。

已更新现有`http://127.0.0.1:3100`：新增4项哈希资源，保留旧资源及入口备份后原子切换，不重启服务或操作用户历史。首页、12项入口资源及4项新资源均返回200，路径/哈希见publication.json。测试PID与45119端口已清理，3100仍返回200，见cleanup.json。

未验证用户原始27题、APK/Android真机、Mac/iOS或真实模型；本轮不重判答案，不把副本计划当正确性证据。
