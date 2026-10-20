# 多选补图、裁剪与批量保存验收

日期：2026-10-13。

范围：沿用`feat/pdf-question-only`分支；保护已有未提交PDF工作，不提交或推送。Web用隔离IndexedDB、合成图片及假模型，真实用户题图未参与故障注入。

## 修改

补图与更正相册入口复用多选；多张进入预览，可逐张裁剪、旋转、移除后一次确认，单张仍直接裁剪。已保存材料增加编辑入口，新像素以新ID保存在原选择位置，旧材料和旧run证据不变。整批追加通过一次事务保存，失败保留全部草稿可重试，不产生部分补图或模型请求。临时图片在移除、取消、提交、卸载后释放。

## 验证

- `pnpm build:shared`、`pnpm --filter @solveflow/mobile typecheck`退出0；根`pnpm exec tsc --noEmit`首次退出2，测试读取函数误名为document遮蔽浏览器全局，改为readDocument后退出0。
- `pnpm exec vitest run --maxWorkers=2 packages/client/src/local-image-edit.test.ts packages/client/src/local-engine.test.ts`，2文件51项通过，退出0；验证事务失败、非法像素/容量无写入、旧快照及当前顺序。
- `pnpm --filter @solveflow/mobile build:web --output-dir ../../.runtime/materials-multi-2026-10-13/web`退出0。Expo报告退出时清理提示，导出文件成功，未构建/安装原生包。
- 浏览器命令：`SOLVEFLOW_TEST_WEB_URL=http://127.0.0.1:45573 pnpm exec playwright test --config playwright.functional.config.ts tests/mobile-e2e/materials-multi.spec.ts tests/mobile-e2e/exam-materials.spec.ts tests/mobile-e2e/correction-images.spec.ts --output=.runtime/materials-multi-2026-10-13/browser`，首次20项中18通过、2失败，退出1。
- 失败为编辑后立即读取旧元数据，原“查看材料3”按钮存在不代表异步写入完成；改为等待数据库归档计数及裁剪窗口关闭。相同服务器对`materials-multi.spec.ts -g 'selects several'`复测，结果`edit-recheck/`，桌面/移动2项通过、退出0；不放宽计数、顺序、旧字节和原run断言，重复复测不累计新场景。
- 已验证实际多选输入、600×300图裁剪为588×300、旋转为300×600、移除、保存后编辑、刷新、取消释放URL、超量选择与事务中止后的完整重试；普通/批次更正及原补图作文流程同轮通过。

- 根类型检查及`git diff --check`退出0。`pnpm lint`源码边界通过，但首次文档长度检查退出1，设备运行页2254超过2200单位；精简补图段落保留完整操作与边界后复查，不提高上限。
- 人工查看移动端深色预览，确认缩略图、尺寸、裁剪/旋转/移除及固定保存区域采用既有主题。

- 补上PDF衔接：结构化题目导出按activeImageIds使用当前补图，原始阅读记录仍保留历史图。最终`web-current`构建与两套类型检查均退出0。

- 最终PDF衔接复测：`SOLVEFLOW_TEST_WEB_URL=http://127.0.0.1:45057 pnpm exec playwright test --config playwright.functional.config.ts tests/mobile-e2e/materials-multi.spec.ts -g 'selects several' --output=.runtime/materials-multi-2026-10-13/current-images-recheck`，桌面/移动2项通过、退出0；当前4张图不重复包含归档第5张，并核对最新补图JPEG引用。
- 文档精简后`pnpm docs:check`退出0，未改变长度门槛。最终构建合并到3102已有隔离目录并原子替换index，10个唯一入口资源HTTP200，主dist文件保持原样。3100在更新核对时已无监听进程，没有由本次启动或停止；首次网络预检查因其不可访问未执行复制，后续直接核对3102成功。两套隔离测试服务已清理，3102保留。

## 边界

模型调用由假响应验证，补图与保存本身不调用模型；未验真实模型、原生选择器及真机文件回收。数据结构和容量沿用当前协议，已提交的保存事务不假称被取消。证据在忽略目录`.runtime/materials-multi-2026-10-13/`；更新3102时保留3100服务和用户浏览器数据。
