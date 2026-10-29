# 浏览器批次导出复核

日期：2026-10-21，Asia/Shanghai。范围：既有未提交改动上的Web PDF导出、用户新增的全对假定与分散错题。未提交、推送或调用付费模型，未修改原Chrome站点数据库。

## 复现与修复

只复制SolveFlow站点的IndexedDB，在隔离浏览器和服务中检查253条记录、9个批次，每批27张题图。数据库、真实图片、回答及成品只存于忽略的私有运行目录，不入仓库。

物理、数学批次的“原始记录”均复现单份60秒超时，约63.9秒、62.6秒返回失败。旧实现每页重复解析整本内容；新增[按记录绘制](../../apps/mobile/src/local/reading-pdf-scope.web.ts)，保留页壳，仅接入当前记录。首次克隆确定页界，后续检查一致性，未知结构或越界内容回退完整路径；不放宽期限/容量/画质。原因见[决定](../../.agents/notes/implemented/storage/2026-10-21-reading-pdf-render-scope.md)。

真实PDF像素检查另发现一张全白续页和一张只剩提示框边缘的短页：删除确无图文和装饰的完整尾页，短提示框整体分页；所有页完成后才回填总页数。保存取消测试等待同时覆盖“取消导出”和“正在取消…”，避免按钮改名后提前读取存储；保留原终态与文件断言。

用户指定作答版默认全对：历史校验/回答失败不预占错题数，缺答案保持空白，不制造verified或补答；原始记录继续显示历史。错题在题号区间随机分层，兼顾保存内容的复杂度估计及多份重复；本次窗口固定种子，预览/打印/下载一致。明确不等同于标定难度；约束见[规划决定](../../.agents/notes/implemented/storage/2026-10-21-export-error-distribution.md)。使用说明同步规则并重拍合成设置图。

## 逐批验证

Node24.19.0、pnpm11.7.0、Chrome154；隔离服务`http://127.0.0.1:45919`，PID1207421。日志位于`.runtime/export-review-2026-10-21/`，无环境模型桥接，拦截外部及POST请求。

9批分别检查整理试卷、已保存作答、纯题目、原始记录，共36项。稳定版本最终28项成功并实际下载；8项整理试卷缺缓存或图示待核对，明确阻断，不调用模型补造。9批保存作答、纯题和原始记录均通过；缺答案批次不再禁止作答版。

- `user-audit-distribution.log`保留首次全量结果；测试期间原地重建资源，第8批纯题失败、原始记录导航超时。停止重建后`user-audit-batch8.log`复测4项：3成功、1预期待整理阻断；不能将首轮失败计为通过，也不据此推断产品内容错误。
- 私有`audit-final.json`合并复测，历史记录/图源摘要前后相同，模型请求0、POST0、页面异常0。原始记录9份约9.1～12.8秒完成，未扩大60秒期限。
- `user-extra-distribution.log`补验真实物理批次：未标记、错5题标记、两份ZIP（错5/错3）均成功，分别29页、29页、两份各29页。错题覆盖前中后三段。
- `pixel-validation-final.json`检查28份PDF共782页，JPEG解码数与物理页数一致，没有全白页或低于150px的孤立短页。9份原始记录ZIP共59,527,690字节，9个可解压PDF。

## 回归与静态检查

- `baseline.log`：旧桌面导出回归63通过、1取消收尾等待失败，退出1；`reading-before.log`作用域回归旧实现每页连接5条正文，要求最多1条，退出1。中间调试失败保留，不累计通过。
- `blank-before.log`：合成长记录尾页实际编码为空白，退出1；`blank-final.log`修复后作用域/非空页及迟到编码取消2项通过，退出0。
- `unit-final-counts.log`：`pnpm exec vitest run --project unit`定向12文件358测试通过，退出0；覆盖投影/规划、空作答、27题错5题分布、所有0～27错题数、种子稳定性、页脚、提示框、资源/期限/取消和准入。
- `build-release.log`：`CI=1 EXPO_NO_TELEMETRY=1 EXPO_NO_DOTENV=1 pnpm --filter @solveflow/mobile build:web --output-dir ../../.runtime/export-review-2026-10-21/web`，退出0。
- `typecheck-root-e2e.log`：`pnpm exec tsc --noEmit`，退出0；`typecheck-mobile.log`：`pnpm --filter @solveflow/mobile typecheck`，退出0。
- `lint-final.log`：`pnpm lint`源码边界及文档检查通过，退出0。过程中笔记章节名及文档长度检查失败已修正，未提高门槛。

- `mobile-targeted.log`：新错题规则、缺答案、阅读PDF及取消5项通过；使用说明仍匹配旧文案，1失败，退出1。同步新假定断言后`guide-final.log`桌面/窄屏2项通过，退出0，保留9张图片、比例、主题、键盘及零模型断言。

- `desktop-final.log`：`SOLVEFLOW_TEST_WEB_URL=http://127.0.0.1:45919 pnpm exec playwright test`定向五文件、桌面132项，131通过，1项仍要求缺答案默认切纯题，退出1。按新全对作答默认更新后显式选纯题，保留断连/恢复/缓存/打印/下载/历史不变断言；`preparation-recheck.log`该项1通过，退出0，未重复其它131项。
- `unit-seed-final.log`：组合覆盖测试固定随机种子后，核心规划15项通过，退出0。

## 本机交付

`publication.json`：核对原入口哈希后，追加8个带哈希的新资源，再原子替换本机3100入口；12个入口资源及8个新增资源均HTTP200，保留旧资源，不重启服务。新入口SHA256为`70ea3b5202edef75efde46e7f689d9d52e94fe964bc57753853f3fd69ed31191`。

`live-smoke.log`：更新后的3100地址，隔离浏览器用合成27题设错5题，验证分布及预览/打印/实际下载一致，1通过，退出0。`cleanup.json`：核对PID归属后关闭本次1207421/45919服务；3100仍HTTP200且入口哈希一致，用户原Chrome数据未写入。最终文档检查日志为`docs-final.log`。

## 限制

本次使用真实数据的隔离副本，不代表原Windows Chrome自动化、真实模型正确率、APK、iOS或任意大文档性能保证。8个未整理试卷尚未做新的付费提取；可使用已保存内容及原始记录。旧失败记录保留历史状态，重新导出使用新规则。
