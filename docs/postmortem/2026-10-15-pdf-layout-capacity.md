# PDF 疑点排版与真实容量实测

日期：2026-10-15。

范围：`feat/batch-pdf-unified` 未提交工作区；原有 `http://127.0.0.1:3100/`；Chrome 154.0.8037.97、Python Playwright 1.58.0；隔离浏览器中的真实27题批次。前轮证据见[资源门禁与裁图](2026-10-15-pdf-resource-guards.md)。

结论：纯题与作答各27页A4，零业务模型调用；20份实测在最后一份触发128MiB门禁，无半包下载、无挂载frame。不代表20份成功或生产验收完成；等待超限反馈仍太久。

## 变更与失败证据

[打印文档](../../apps/mobile/src/dom/batch-copy-document.tsx)将识别与整理疑点合并成一个框、分段保留来源与全部文字，不按语义猜测去重。[浏览器回归](../../tests/mobile-e2e/paper-preparation.spec.ts)先在旧构建复现桌面/窄屏均为两个框；要求一个框、两个段落、两个公式及两类前缀，旧版退出1，新版退出0。继续发现拼接后未闭合代码围栏会吞掉另一来源的公式，桌面/窄屏均应有1个公式却实得0、退出1；补分别解析及段间距，失败截图保留在`red-fence-r7/`。

[打印样式](../../apps/mobile/src/dom/batch-print.css)将多题干图高度上限55mm改为65mm，单图105mm和选项35mm未变。通过现有人工调整入口校正第19题相对运动图和第23题两张单摆图，仅影响隔离缓存；逐项校验全部题干、疑点、图键和所有选项图不变，并刷新验证保存。第19题保留100m、3m/s、2m/s及方向；第23题保留h、m、2m、悬线和虚线。

初次第19题测试输入16°超出既有±15°契约，产品保留旧图；脚本误收旧预览。失败产物留在`round7-crops/`，未放宽契约；补可见错误断言后改用15°，查看`round7-crops-v2/`并确认、重载。更新预览也会保存调整参数，并非零写入。

## 验证与计时

证据均在`.runtime/pdf-production-2026-10-15/`，原图与完整结果不入Git。Node24.21.0与仓库要求24.19.0有版本警告。

- `pnpm exec tsc --noEmit`、`pnpm --filter @solveflow/mobile typecheck`通过；`pnpm --filter @solveflow/mobile build:web`通过，最终CSS为`batch-print-75d1ea1a93634d9c4fa4d17cbd57c21f.css`；初版实测CSS为`batch-print-ef0f96436b8e461aa30742d87b65c9d1.css`。
- `pnpm exec playwright test tests/mobile-e2e/paper-preparation.spec.ts --grep 'print notes render formulas|manual text confirmation|manual diagram confirmation|prepared incomplete choices|unfinished recognition fence' --workers=1`：最终桌面/窄屏12例通过；未闭合围栏由红转绿，其他例重复复测不累计。
- `python .runtime/pdf-production-2026-10-15/manual-crops-round7.py --apply`：题库哈希不变，所有选项图字节不变、无丢图、原疑点保留，刷新后复用；退出0。
- `python .runtime/pdf-production-2026-10-15/measure-export-round7.py --artifact accept-questions-r7.pdf`及`--mode answers --artifact accept-answers-r7.pdf`：均退出0。分别6564130/6917651字节；SHA-256分别`64d1ebcd81672a9c29e36febb94e4e6b1e9535736096c85363fe9aee0fec6797`、`5606567d97fc3e3ca9bd8801388a44d37ec5cf75227145748c104f357715e72d`。

以下为分开解析前的合并初版计时。被动观察同一生成frame从适配完成至释放，含逐页绘制和序列化；点击至成品另含排队、准备和存储，不含事先克隆/哈希/预览。纯题17.23/18.00秒，作答23.27/24.17秒，各一次；完整脚本54.28/61.38秒，不混为纯生成时间。纯题长任务56次、最长454ms；作答63次、最长822ms，尚不足以声明流畅。首份纯题计数器只观察父文档，零画布计数无效；补子文档观察后作答捕获27次克隆，不改绘制逻辑。

`--mode answers --copies 20 --artifact capacity-20-r7.zip --expect-capacity-failure`退出0，仅表示预期门禁通过：19份各27页完成，第20份第13次绘制触发“PDF 导出超过 128 MiB，请减少份数或分批导出。”；没有ZIP下载，打印frame均移除，原题与缓存哈希不变。绘制/点击至报错411.44/414.30秒，完整脚本454.38秒；长任务1037次、最长693ms。实际执行526次页绘制，不是540页成品；没有以体积乘法替代实测。零业务模型调用。

纯题第5/19/23题正文字号约10.07/9.12/10.47pt，图内字不受此下限保证。第5/19题至页脚间隔约9.69/9.42CSS像素，仍紧；第23题约79.12像素。独立复核实看16个变化页与前轮对照，另11页PNG字节一致复用旧证据。未见新增排版裁切、覆盖或疑点分类丢失，小字、淡虚线和杂边仍在。记录为`visual-review-r7/review.md`，非原图逐字或答案验收。

最终分开解析复测使用`accept-questions-r7b.pdf`、`accept-answers-r7b.pdf`，同一脚本两次均退出0，各27页、大小与初版相同。SHA-256分别`aaf17e191a08015d3890aab3a78ab11981ae127debfc24461a1c7d695dd9bd15`、`1bb01c6e57e846b4c34b80dd108a69fe79e43c614926f20a477a169b602434c7`。绘制/点击至成品分别18.73/19.53秒、24.85/25.79秒，各一次；最长长任务507/721ms，未作平均或推导生产吞吐。

最终两份与初版按2倍栅格逐页对比，全部54页像素一致，退出0，记录`golden-r7b.json`，故复用上述视觉检查。PDF文件ID不同，不宣称PDF字节相同；20份容量未在最后的解析隔离构建重跑。

原记录哈希仍为`baaa5796f47c31b39c7e5733ae7b57bec9f66b8d9eaa7a839343e239647190cf`；人工调整后整理缓存哈希`3963af09cbd0a7a4c7ad0ab9c41045b1b79e347d9e9c4d135496366587de6cc4`。导出前后两者相同。业务付费累计仍67次。

## 剩余范围

小坐标字、邻题残片、重复照片文字和页脚留白仍需优化；第9/11/18/20/24/27题有来源缺项提示，第25题为完整性未确认，二者不同。缺失内容未补造。全部作答页逐字核对、原浏览器缓存同步、跨平台和真机仍未完成。本轮未提交、推送或部署。
