# 更正题干增删图片验收

日期：2026-10-09。范围：设备路径的图片草稿、当前选择、历史快照与共用更正窗口。

## 行为

单题和批量共用“更正题干”窗口，可拍摄、添加或删除本次图片，至少保留一张。新增图片经既有规范化与裁切处理。取消更正不保存；提交时图片、当前选择及queued任务同一事务落盘，失败不派发模型。后续解答采用当前图片，删除原主图后由剩余图片接替。

旧图片字节和旧答案的校验依据保留；新答案显示自身的主图，旧记录按原快照回读。每次仍最多8张、8MiB，历史容量单独有界。持久化理由见[决定](../../.agents/notes/implemented/storage/2026-10-09-correction-image-selection.md)，当前语义见[存储](../subsystems/storage.md)与[生命周期](../subsystems/local-run-lifecycle.md)。

## 验证

证据目录为忽略的 `.runtime/correction-images-2026-10-09/`。没有访问用户题目库、上传真实题图或调用付费模型。

- `pnpm build:workspace`：退出0，`workspace-build.log`。
- `pnpm exec vitest run --project unit --maxWorkers=2` 定向图片编辑、引擎、导入、导出、存储恢复、历史六个文件：109项通过，退出0，`unit-final.log`。新增5项覆盖主图删除及替代、满额替换、旧/新校验快照、事务失败无写入/无调用、无效草稿和备份兼容。
- 初次新增测试复制JPEG夹具时缺少字节，3失败/76通过，退出1，`unit.log`；改用已有完整合成JPEG后4项通过，新增容量场景后纳入最终109项，不放宽图片检查。
- `pnpm --filter @solveflow/mobile typecheck`、`pnpm exec tsc --noEmit`：退出0，`mobile-typecheck-final.log`、`root-typecheck-final.log`。首次根类型检查因测试函数名遮蔽DOM document失败，改名后通过。
- `pnpm --filter @solveflow/mobile build:web --output-dir ../../.runtime/correction-images-2026-10-09/web-final`：退出0，`web-build-final.log`。
- `SOLVEFLOW_TEST_WEB_URL=http://127.0.0.1:45783 pnpm exec playwright test` 定向更正图片、公式编辑、多图、单题路径、批量学习五个文件，桌面与移动视口共24项通过，退出0，`browser-final.log`。包含六项新增图片交互场景。
- 新场景真实经过隔离页面的图片增删、提交和请求序列化：所选补图作为主图，新增图作为材料；原主图没有进入新请求，新校验使用相同图片。刷新无新模型请求，恢复配置后重新更正显示保存的选择。取消草稿保持原记录和调用次数不变。
- 首轮浏览器夹具刷新丢失内存密钥且误用批量URL，3失败、10通过、1中断、10未跑，退出130，`browser.log`；修正为刷新后配置及从历史打开批次。一次桌面复测已完成实际请求验证，但最后图片断言选中RN包装层而失败，3失败，`browser-retry.log`；定位到子img后仍断言相同src，最终24项全部通过。首次失败证据保留，不累计复测场景。
- 人工检查最终桌面与窄屏更正截图，增删入口和公式编辑可见。`pnpm lint`退出0，`lint-final.log`；初次文档超过长度5单位，精简文字后检查通过，未调整门槛。

## 交付范围

Web保留旧哈希资源并原子替换入口，3100用户服务不重启。当前批次应完成后刷新加载新版。随机端口45783测试服务单独清理。Android/iOS共用源代码已修改，本轮未重新打包、安装或执行原生真机验收；假模型结果不代表真实答题准确率。

3100只读核对HTTP200，入口与最终导出一致，退出0，`delivery.json`；测试进程3980199已发送SIGTERM清理。最终`pnpm docs:check`通过，源码边界和类型检查均为退出0。
