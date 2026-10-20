# PDF 图示编辑草稿同步补验

日期：2026-10-17。范围：本机 Web `http://127.0.0.1:3100/`，隔离浏览器与合成题目。本轮修复图示编辑状态，不作为整体生产、手机原生或实体打印验收。

## 结论与原因

原构建先补五个回归，全部失败；独立静态复核指出已有四角的引用克隆边界后，再补第六例，也复现失败：

- 已保存四角为 `undefined`、底图不变时，恢复或自动整理成功，未应用的 `12.5` 坐标仍留在界面；重复恢复也没有新的同步依赖。
- 自动整理或四角加工失败时，按钮预先清数值草稿，输入的 `-` 被换回 `0`；图像尚未提交，编辑却已丢失。
- 已应用四角 P 后编辑未应用 Q，普通数值预览的 schema 校验重建同值数组 P′；依赖数组引用的 effect 把 Q 覆盖回 P。

修复限定在[编辑器](../../apps/mobile/src/components/print-perspective-editor.web.tsx)、[面板](../../apps/mobile/src/components/batch-pdf-panel.web.tsx)与[状态控制](../../apps/mobile/src/components/use-batch-pdf-export.web.ts)：四角按八个坐标值同步，不依赖数组身份；成功恢复、自动整理、显式四角应用另有内存重置信号，同值提交也同步。信号在图像提交保护内更新，先于可能失败的保存；移除处理前的草稿清理。普通数值预览和清晰化开关不主动丢弃未应用四角；保存重试不发重置信号。

未用 `key` 强制重挂载，避免额外重置展开与底图加载状态；未扩持久格式、模型请求、依赖或像素算法。当前运行语义只维护在[题图处理](../subsystems/print-images.md)。

## 浏览器与成品证据

[回归文件](../../tests/mobile-e2e/paper-preparation.spec.ts)新增六个场景，在桌面和窄屏分别执行，共十二项新检查；完整文件 **104 项通过**，无跳过、重试通过或意外失败。新增覆盖重复同值恢复、非法中间输入、加工失败后成功重试、已有 P 上的新 Q、同值显式应用的格式归一化，以及保存失败后继续编辑四角和数值再补存。均核对原始记录未变、模型夹具调用不额外增加、无意外接口或浏览器异常。

保存失败场景确认新图已提交、导出受阻；输入新的 `3.5` 四角与 `-` 角度后重试，仅补存储，绘图计数不增加且新草稿保留。实际预览和下载使用已提交的恢复裁片，而非这些未应用输入；刷新恢复已保存的零坐标和零角度。

两种视口各实际下载两页 A4 合成 PDF，均 143487 字节；每页实际绘制一张 1346×1988 JPEG，两页不同，跨视口逐页 JPEG 的尺寸、字节数与 SHA-256 完全一致。已查看下载后第二页栅格：题干、红色裁片、选项、疑点、作答与页脚可见。此处不声称真实照片质量或整体 PDF 文件哈希相同。

本机返回的新主包为 `index-35aab080fe8a42653a30d9801598d837.js`，SHA-256 `5c88465e97728e76444a8939e5690773e6c3b3f1ba2946c087381cf028b0393b`，HTTP 与磁盘逐字节一致；html2canvas 及[浅灰修复后的纸面算法](2026-10-17-pdf-paper-contrast.md)不变。旧产物备份在证据目录的 `web-dist-before-r37/`。没有另开服务、提交、推送或更新 Mac；本轮无新增付费调用。

## 执行记录

证据根为 `.runtime/pdf-production-2026-10-16/`：

- 原构建：Playwright `--project desktop --grep 'image geometry drafts'` 先得五项预期失败；补第六例后用 `--grep 'image geometry drafts preserve'` 再得一项预期失败，退出码均 1。保留 `r37-drafts-red*`、`r37-equivalent-red*` 日志、JSON 与截图，不放宽断言。
- `pnpm typecheck`、`pnpm exec tsc --noEmit`、`pnpm build:web` 均退出 0，日志为 `r37-typecheck.log`、`r37-test-tsc.log`、`r37-build-web.log`。
- `PLAYWRIGHT_JSON_OUTPUT_FILE=.runtime/pdf-production-2026-10-16/r37-paper-e2e-report.json pnpm exec playwright test tests/mobile-e2e/paper-preparation.spec.ts --output .runtime/pdf-production-2026-10-16/r37-paper-browser --reporter line,json` 退出 0；日志 `r37-paper-browser.log`，104 项用时 6.4 分钟。
- `verify-drafts-r37.py --help` 与传入两份 `geometry-draft-restored.pdf` 的实际核验退出 0；`r37-final-verification.json` 记录源码、线上资源和逐页图片哈希。私有核验初版把共享页资源表误当成实际绘制清单，退出 1；检查内容流 `/I0 Do`、`/I1 Do` 后按实际绘制图片核验，保留 `r37-verification-resource-catalog-red.log`，没有更改产品来迎合探针。

本轮静态检查收尾结果见同目录 `r37-lint-final.log`、`r37-docs-final.log` 与 `r37-diff-final.log`。首次 lint 的源码边界检查通过，但状态页 2205 超出 2200 单位上限；保留 `r37-docs-length-red.log`，仅压缩导航标签，全部报告 URL、事实和门槛不变。Node 实际 24.21.0 与声明 24.19.0 的差异及颜色环境警告仍有记录。未重复执行未改动像素算法的单元测试，也未把旧成绩计成本轮执行。

## 未验与后续

本轮没有新增本地图像提交前取消、提交后保存阶段取消、补存再次失败或取消的定点实验。独立静态复核对“取消时跳过图像提交却继续分支外持久化”提出窄时序推演，尚未动态复现，不按已证产品缺陷处理。

已核对既有人工校样参数实际位于证据根的 `numeric-real-replay/result.json`，十处校样图片哈希与记录一致；更正旧私有交接的目录误记，尚未用最新纸面算法重新建立该校样成品基线。蓝色图元与倾角检测竞争、照片残边、持续负载、原生资源静默及实体打印仍待验收；保留现有生产目标。
