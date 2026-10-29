# 大型导出成品保存失败与下载恢复

日期：2026-10-24。范围：Web快速原文PDF/七份ZIP、导出IndexedDB及前台/记录页恢复；Node24.19.0、pnpm11.7.0、本机Chrome隔离上下文。

结论：用户截图明确是“导出完成，等待保存”，不是生成阶段失败。已用补图七份合成导出复现缓存满、配额与克隆写入失败，修复后可先下载原成品，再重试持久化；未访问或修改用户出错浏览器，尚不能确定原事件的底层原因。未部署到远程Mac，也没有调用真实模型。

## 问题与处理

截图显示十八题七份等待保存，上一份九题七份ZIP为143.7 MiB。独立导出库存于访问者当前浏览器，部署机器不负责这些文件。[此前补图调查](2026-10-24-supplement-pdf-reproduction.md)只验证新库中的正常生成下载，未覆盖旧大文件占用。

源码原有累计512 MiB上限以及所有事务十秒期限；超过缓存上限、浏览器配额和写入异常都被折叠成通用提示。文件生成后必须先入库才能下载，没有独立取回内存成品的入口。补图和副本增大成品，但不能仅凭大小把原事件归因为某一限制。浏览器自身配额及来源边界参见[MDN存储说明](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)。

[存储适配](../../apps/mobile/src/local/export-task-store.web.ts)现用固定分类显示缓存满、配额、超时、克隆异常、不可用及损坏容量信息；游标回调中的写入同步抛错主动中止事务。文件写入单独使用120秒界限，元数据仍十秒；不提高缓存上限或删除旧文件。

[共享队列](../../packages/client/src/local-export-tasks.ts)、[管理器](../../apps/mobile/src/local/web-export-tasks.ts)、[原弹窗](../../apps/mobile/src/components/batch-pdf-export.web.tsx)和[记录页](../../apps/mobile/src/components/export-records.web.tsx)增加“下载已生成文件”。读取独立字节，不重绘或重放模型；保持等待保存及取消优先，不伪称持久化成功。长期取舍见[决策](../../.agents/notes/implemented/storage/2026-10-24-generated-export-recovery.md)，当前语义归[导出任务](../subsystems/export-tasks.md)。

## 验证结果

忽略目录`.runtime/pdf-save-recovery-2026-10-24/`保存改前快照、日志、PDF/ZIP及浅深色截图。测试服务使用独立动态回环端口，未借用用户3100或Mac3131。测试拦截模型请求，服务端也拒绝付费派发。

- `pnpm exec vitest run packages/client/src/local-export-tasks.test.ts --project unit -t 'generated export recovery'`：修复前四项失败，退出1，日志保留。
- `pnpm exec vitest run packages/client/src/local-export-tasks.test.ts apps/mobile/src/local/web-export-admission.test.ts --project unit`：165项通过，退出0；包含成品字节所有权、锁等待期间取消、仅元数据失败无下载、固定分类与任意错误脱敏。
- `pnpm build:web`、根`pnpm exec tsc --noEmit`及`pnpm --filter @solveflow/mobile typecheck`：退出0。
- `pnpm exec playwright test tests/mobile-e2e/background-exports.spec.ts --grep 'supplemented seven-copy|foreground quick export recovers' --project=desktop --project=mobile`：8项通过，退出0。三类故障各有桌面/窄屏补图七份ZIP，先下载、再补存、再下载，两次字节相等，绘制数不增、模型0、历史不变；前台另验直接下载后明确取消。容量测试使用合成容量账本触发真实512 MiB守卫，不代表浏览器实际分配了512 MiB。
- 对上述14个ZIP解压检查，每份均含7个可打开PDF，共98个PDF文件；两次取回的同一成品不计为独立测试样本。
- `pnpm exec playwright test tests/mobile-e2e/background-exports.spec.ts --grep 'file persistence can outlast|a failed file save only|inline file recovery' --project=desktop --project=mobile`：12项通过，退出0。文件提交完成通知注入11秒延迟，超过旧十秒期限仍成功；另验补存不重绘、成功通知在提交后、补存/读取期间取消以及放弃待保存任务。是延迟通知的合成测试，不是大型文件实际耗时测量。
- 文档检查初次因两份当前文档超长退出1；精简发布摘要，并把任务/成品保存章节完整迁至独立子系统页，保持原文入口和信息，不提高门槛。
- 最终`pnpm lint`退出0，含源码边界及`pnpm docs:check`：356份当前文档、107份决策、181个源码锚点、108份冻结文档。`git diff --check`退出0。本次隔离测试服务已停止，用户本机及远程服务未改动。

## 未验证项与剩余风险

没有取得用户原浏览器的IndexedDB、容量估计、磁盘空间或异常名，原故障原因仍待该浏览器新分类提示确认。未执行Windows第三方浏览器、Safari/Firefox、低内存设备、真实系统配额耗尽或数百MiB的长时间写入。本次合成数据不能代表所有实题导出的性能。

下载只向浏览器发起，不证明系统最终落盘；未入库成品刷新/关闭后仍会丢失。旧成功成品和题目历史保留，不承诺跨浏览器同步或从已刷新页面找回内存成品。远程部署保持原版本。
