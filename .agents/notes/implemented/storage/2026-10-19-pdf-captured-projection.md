# 私有捕获的协作渲染投影

日期：2026-10-19。状态：implemented。范围：Web正式后台任务的快照投影；不改存储、图片编码和期限。

## 背景

[实际调用栈](../../../../docs/postmortem/2026-10-19-pdf-drawing-profile.md)将同步校验定位到渲染投影，但采样权重不是阻塞时长或可回收时间。[原决定](2026-10-16-export-snapshot-projection.md)保留的同步unknown入口仍适合通用调用者；直接在该入口加入等待会让可变调用者形成混合快照。

## 决定

[客户端](../../../../packages/client/src/batch-print-variants.ts)新增captured-only组合投影，要求普通静态数据对象、隔离、无访问器/Proxy，且到结束前独占。仍接收unknown，复用完整逐记录parser；源错误回原完整schema，保留issues、路径、顺序及正则元数据。源验证后继续原纯题输出schema、页数门禁、按需作答及其输出schema，不累计到301题提前停止，也不重扫成功快照。旧同步公开入口保持原样。

[正式提交](../../../../apps/mobile/src/local/web-export-tasks.ts)的计量、128MiB检查与原生structuredClone继续同一同步段。captured仅留在闭包，队列仅发布标量元数据，prepare只收到signal；内部别名保留不等于对外共享。新执行入口只接这条私有链；不据此扩大prepared等其它对象的独占承诺。

[Web执行器](../../../../apps/mobile/src/local/run-batch-export.web.tsx)保留通用入口，共享投影后的原渲染、根、期限及释放。队列注入既有MessageChannel检查点；执行器在检查点前后及投影finally检查取消，拒绝与取消同时出现时保留取消优先。源验证开始只发一次“正在核对导出内容”；完整投影成功且验活后转“正在准备导出页面”，避免缓存恢复仍标核对，不逐记录写进度。第二回调也处于同一取消优先区，异常不进入渲染。reading仍完整验证并投影纯题，只免页数回调与作答提取。

本次只替代原决定中正式私有任务的同步源解析；初始化预检、[捕获复核](2026-10-19-pdf-captured-validation.md)、通用同步契约和后半段渲染继续有效。[剩余输入等待提案](../../proposed/storage/2026-10-19-pdf-projection-validation.md)另行验收。

## 放弃的方案

不以类型、Readonly、品牌、对象身份或先前题数代替验证；不给通用unknown偷偷加clone，也不扩大collected视图到任意Proxy。没有更换正则、并行解析、只让微任务或重放模型。初版执行器新增调度模块导入时非主资产门禁发现jsPDF分块变化，故改由已有队列依赖注入检查点，保留严格资产门禁，而非放宽SDK比较。

## 后果与限制

单记录、封套失败及完整错误回退仍可能同步；输出提取、原生捕获、布局与绘制也有下界。新API的独占前提由正式调用图维持，不能把误用者的输入变更当作已解决；未证明全链路可抢占、INP改善或生产级流畅。没有部署。

## 验证

[组合投影契约](../../../../packages/client/src/batch-print-captured-projection.test.ts)与[执行器](../../../../apps/mobile/src/local/run-batch-export.test.ts)覆盖精确getter oracle、逐记录完整验证、页数/答案顺序及阶段回调取消优先；[正式队列回归](../../../../apps/mobile/src/local/web-export-admission.test.ts)保留真实parser/runner，在注入检查点验证调用者隔离、拒绝/迟到/超时、终态与模拟满额恢复。首次实现与构建见[R93报告](../../../../docs/postmortem/2026-10-19-pdf-captured-projection.md)，阶段交接、自然UI取消及新增回归见[R94报告](../../../../docs/postmortem/2026-10-19-pdf-validation-stage.md)；DOM/rAF文案不是具体parser持有点或像素绘制证明。
