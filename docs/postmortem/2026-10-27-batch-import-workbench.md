# 新增题图工作台验收

日期：2026-10-27。范围：本地Web，已有批次新增相册题图；不含远程Mac部署、原生或真实模型验收。

## 问题与实现

旧构建中，单选一张新增图仍只进入“确认图片顺序”，确认页无法指定位置。隔离浏览器复现该问题，要求工作台标题的回归在旧构建失败，退出1。

现在已有批次的直接相册入口和继续拍摄内的相册入口，都进入新增题图工作台。展示新图、已有题图缩略卡和最终顺序；逐张指定不同位置、整组放到一处、恢复全部追加均可。单选也显示，默认追加到末尾。新建空批次保留顺序预览；连续快拍不逐张弹确认。

确认按钮固定底部，使用现有主题和按钮。深色模式的原题顺序卡修正为主题底色。取消不保存、不发请求；逐图成功后才递增保存数量，停止后只保留未导入输入。插入沿用[此前位置事务](2026-10-26-batch-insertion-order.md)，本次没有改持久化格式和导出路径。

## 验证

Node24.19.0 / pnpm11.7.0。Chrome桌面1440×1000及手机视口390×844，独立45186服务禁用环境模型，全部请求拦截为假模型；测试数据为色块JPEG。

| 命令与检查 | 实际结果 |
| --- | --- |
| `pnpm exec vitest run apps/mobile/src/batch-import-placement.test.ts apps/mobile/src/batch-photo-order.test.ts apps/mobile/src/batch-photo-preparation.test.ts apps/mobile/src/batch-capture-buffer.test.ts packages/client/src/local-batch-insertion.test.ts packages/client/src/local-batch.test.ts --maxWorkers=2` | 6文件49项通过，退出0 |
| `pnpm typecheck`、最终移动端`typecheck` | 退出0 |
| `pnpm --filter @solveflow/mobile build:web --output-dir ../../.runtime/batch-import-workbench-2026-10-27/web` | 退出0 |
| `SOLVEFLOW_TEST_WEB_URL=http://127.0.0.1:45186 pnpm exec playwright test --config playwright.functional.config.ts tests/mobile-e2e/batch-import.spec.ts` | 首轮28通过、4项按钮位置检查抢在滑入动画结束前断言，退出1；改为等待同一位置条件后，这4项单独复测全部通过，退出0。共32个不同场景完成，两轮不重复累计 |
| `pnpm lint` | 首轮决策状态字段格式不符而退出1；改用规定的`implemented`后退出0，包含边界和文档检查 |

工作台新增场景覆盖两入口的单张默认末尾、点击中部插入、取消后数据和请求数不变；多张独立插到头部/中部/末尾、整组放置和全部追加恢复、停止后继续且不重复。核对保存题图颜色、连续位置及旧题session未变。按钮检查要求动画结束后仍在视口内，未放宽范围；截图人工核对浅色手机及深色桌面。

既有场景继续验证自然排序、时间/手动排序、容量边界、部分存储失败重试、离开后的迟到保存不入队，以及默认追加不增加逐图全局摘要读取。

私有日志、截图和源码前快照在`.runtime/batch-import-workbench-2026-10-27/`，不纳入Git。测试服务验收后关闭；本机用户服务3100保留。新构建先复制哈希资源，最后原子替换入口，保留旧资源以支持已经打开的页面。

## 限制

未重新做真实模型调用、Android/iOS打包或远程Mac部署；浏览器移动视口不代表真机。跨标签同时新增/删除仍按原仓库冲突检查失败，保留输入由用户重新选择位置，不自动重放。

行为说明见[批次顺序](../subsystems/batch-order.md)，取舍见[决策](../../.agents/notes/implemented/storage/2026-10-27-batch-import-workbench.md)。
