# PDF 编码取消与跨任务交接验收

日期：2026-10-17（Asia/Shanghai）。

范围：现有 `http://127.0.0.1:3100/` Web 服务，PID 520840；Chrome 154.0.8037.97。通过公开前台下载入口验证真实 JPEG `toBlob` 回调与该 Blob 的 `arrayBuffer` 读取，业务模型请求全部拦截。桌面与窄屏合成夹具回归，加一套既有27题真实照片的缓存回放；不构成新的识别样本或真机成绩。

工具：Node 24.21.0、pnpm 11.7.0、TypeScript 5.9.3、Node Playwright 1.63.0；真实缓存回放使用 Python 3.12.3、Python Playwright 1.58.0、PyMuPDF 1.28.2。

结论：两个阶段都在原生结果通知尚未被 JS 探针观察到时公开取消 A；A 终态、文件与可观察清理符合预期。随后启动不同的二份任务 B，在 B 真实结果已产生但尚未交付产品时释放 A，没有观察到 A 写文件、下载、改变 B 忙态或已跟踪资源；B 均完整导出。未发现需修改产品的可复现缺陷，本次只补测试与证据，生产流畅性目标继续保留。

## 变更与处理

[探针](../../tests/mobile-e2e/pdf-codec-probe.ts)被[回归](../../tests/mobile-e2e/background-exports.spec.ts)及私有 Python 回放共同复用：原生 API 真实执行，只控制真实 Blob/ArrayBuffer 向产品交付的时刻。原 API 返回后排入微任务，点击公开“取消导出”，避开同步 API 重入。探针不替产品中止控制器、清零画布或移除 frame；20秒看门狗过期明确失败，恢复时清除持有引用并还原原型。

观测主 realm 打印 frame 的所属/连接状态、编码画布尺寸、导出数据库、文件与记录写入尝试、下载和产物 URL。释放 A 前保存基线，释放后比较400 ms，连同完成后的产物比对约束迟到结果。第二阶段保留第一阶段已有的两个任务记录及一个 ZIP 文件键，补足非空跨任务保留见证。

不改产品源码、构建、限额、超时和重试。既有异步编码语义及限制见[原决策](../../.agents/notes/implemented/storage/2026-10-16-pdf-async-jpeg.md)与[原验收](2026-10-16-pdf-async-jpeg.md)，图像处理取消另见[前次验收](2026-10-17-pdf-image-cancellation.md)。

## 验证结果

工作目录为仓库根。既有服务保留；主 bundle 与磁盘同字节，SHA-256 为 `5c88465e97728e76444a8939e5690773e6c3b3f1ba2946c087381cf028b0393b`，与前次验收一致。原 QA profile 仅复制；新上下文只取3100来源，移除副本内旧导出数据库，安装冻结整理缓存的校验副本。仅修正此前已核实的可选 `sourceNumber: null` 传输差异，冻结文件不变。

| 检查 | 实际结果 |
| --- | --- |
| 原生回放 `python .runtime/pdf-production-2026-10-16/inspect-codec-cancel-r40.py --name codec-cancel-r40-v3` | 退出0；两个阶段通过，110次真实 JPEG 调用；无看门狗过期、业务模型/外网请求或 page error |
| 浏览器回归：下方实际命令 | 退出0；desktop/mobile 共4例通过，18.0秒；每例真实导出二份各二页的 ZIP，取消任务无文件/下载 |
| 独立复核 `python .runtime/pdf-production-2026-10-16/verify-codec-cancel-r40.py` | 退出0；重读实际 ZIP/PDF，核对原生通知/交付事件顺序、任务与资源见证、108页 A4 成品 |

```bash
SOLVEFLOW_TEST_WEB_URL=http://127.0.0.1:3100 SOLVEFLOW_TEST_CHROME=/usr/bin/google-chrome pnpm exec playwright test tests/mobile-e2e/background-exports.spec.ts -g 'native (blob|bytes) cancellation isolates' --reporter=line --output=.runtime/pdf-production-2026-10-16/r40-codec-e2e-v1
```

两个真实 ZIP 各13,192,919字节，每个内含两份27页 PDF，各份27张实际绘制 JPEG 均彼此不同。每阶段第一份的27张 JPEG 与冻结正确校样逐页全字节相同，共54页；第二份每页整图与第一份不同，上部90%解码像素逐像素相同，共54次比较。底部页脚具体字义未另设真值，不将这部分差异直接当成页脚正确证明。

原题和整理内容的在线指纹在两个阶段前后均保持：原题 `baaa5796f47c31b39c7e5733ae7b57bec9f66b8d9eaa7a839343e239647190cf`，整理 `638f9f989d6eaa84d0b00a4758c37c48290290613053d341b99c5cef41e4473e`。独立复核重验 PDF 内容，但这些存储指纹仍是运行时见证，不冒充重新打开数据库的独立证明。两个下载 URL 均观察到产品按原定30秒调用原生撤销；已跟踪打印 frame 断开，编码画布宽高归零。

首轮 `v1` 退出1：份数切到二份后，探针仍查找“下载 PDF”，实际按钮为“下载 PDF 压缩包”，等待期间看门狗过期；该轮不计通过。`v2` 退出1：错误预期忙态下载按钮仍存在且禁用，实际忙态仅保留取消。按源码与截图修正为下载控件不存在、取消可用，未改产品或放宽产品超时。`v3` 及随后首次四例回归通过；失败目录、截图、脚本快照及日志均保留。

忽略目录 `.runtime/pdf-production-2026-10-16/codec-cancel-r40-v3/` 保存执行脚本/探针快照、`result.json`、`verification.json`、截图、两个 ZIP 和四份 PDF；同级保留失败回放与 E2E 输出。ZIP SHA-256 分别为 `f9e706cbf79fb19108fe3b3c536f02f3c3eb23dbc9b9694b739ccc4263f2fad6`、`cb14fb1942a236e34b43089e478a90a2cb78c5cace886f2800e43fb2323f99ad`。测试探针 SHA-256 为 `78d8a3ec276987e6528bc911fe01d5574916e5cf90ac392d1de44a632afcf08c`；独立只读审查未见确证缺陷，报告指纹为 `7b33eff55a730ab8a1b4d20a42fa232b4507a4a008d9bfa173554071836503b4`。

静态收尾：`pnpm exec tsc --noEmit`、`pnpm lint`（含源码边界与 `pnpm docs:check`）、`git diff --check` 均退出0；旧测试除新增 import 外字节前缀完整，渲染器及冻结 PDF/缓存指纹校验退出0。首次 lint 因状态页2204单位超过2200上限退出1，压缩导航别名并保留全部 URL 后复测通过，未抬高限额。失败输出保留为 `.runtime/pdf-production-2026-10-16/r40-final-checks-v1.log`，通过输出为同级 `r40-final-checks.log`，完整性见 `r40-integrity.json`。Node 24.21.0 高于仓库固定的24.19.0，CLI 警告保留，未切换工具链。

## 未验证项与剩余风险

取消时“通知未被 JS 观察到”不证明原生线程仍在工作；B 的 held 点已经收到其原生结果，不证明两个原生编码线程并行。400 ms 快照及尺寸归零不证明线程中止、GC、native backing memory 回收或任意更晚静默。探针保留强引用用于观察，仅覆盖已记录的主 realm 打印 frame，不完整计数其他 realm 内的 html2canvas 克隆 frame。

画布只比尺寸，frame 只比所属/标题/连接状态，未比较即时像素或正文摘要；最终 PDF 图像比对另补成品保真。未完整快照管理器全部内存 progress/UI 属性；E2E 不等待 URL 撤销，真实回放另验。合成 DOM click 不等同操作系统输入；仅首个编码/读取点注入，未穷举后续页、第二份中途或所有内核。

持续取消负载、底层在途工作和长期内存、弱设备响应、剩余实图校样、Mac/手机原生与实体打印仍待验。没有新增付费识别、全量套件、Web 重建或原生构建成绩，不据此宣布生产目标完成。
