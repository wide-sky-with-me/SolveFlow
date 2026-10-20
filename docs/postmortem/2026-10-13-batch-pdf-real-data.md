# 六组真实批次的 PDF 功能验收

## 范围与结论

日期：2026-10-13。基线为 `feat/batch-pdf-unified` 的 `b9044c2`；分页修复在该基线的隔离 checkout 上重新构建验证。环境为 Windows Chrome 原始存储的只读副本、Linux Chrome 154.0.8037.97、Node 24.21.0、pnpm 11.7.0。Node 与仓库指定的 24.19.0 不同，构建有版本警告。

六组各 27 题，共 162 题。五组有完整已保存回答，支持题目版和作答版；13时第一组的第27题缺完整回答，仅原始记录打印开放。`needs_clarification` 是终态，不是未恢复任务。无新增真实模型调用，不据保存的核验判错数推算准确率。

| 批次 | 作答 PDF 页数 | 纯题目 PDF 页数 | 结果 |
| --- | --- | --- | --- |
| 08时 · 01 | 29 | 29 | 下载通过，另有24页原生打印 |
| 09时 · 01 | 33 | 31 | 下载通过 |
| 10时 · 01 | 27 | 27 | 下载通过 |
| 13时 · 01 | 未开放 | 未开放 | 原始记录原生打印28页 |
| 13时 · 02 | 29 | 28 | 下载通过 |
| 14时 · 01 | 35 | 35 | 下载通过，修复后仍35页 |

## 处理与缺陷

仅导入选定记录、图片、材料、摘要和批次标题，不读取凭据或重放解题。所有恢复计数为0。原浏览器文件及导出输入的 SHA-256 复核一致；用户已有改动未参与隔离构建。

实图 PDF 第17页出现下一题的孤立题号。最小布局复现切点950 px，期望900 px，修复前退出1。现为长题的标题与短题干共同保护分页；修复后切点900 px，退出0。整组物理题重新下载并目视第17、18页，确认第15题的题号与题干同页。实现与回归分别见[分页器](../../apps/mobile/src/local/download-batch-pdfs.web.ts)、[回归测试](../../apps/mobile/src/local/download-batch-pdfs.test.ts)。

测试脚本曾因 CSP 的字符串求值、环境探测等待、原始记录没有下载按钮、异步预览未就绪、图片来源数量假设而失败，均保留原成绩并改正测试方法。首组三份 ZIP 在90秒时仍处理第二份；补验使用240秒总等待，生产单份60秒时限不变，135.15秒完成。曾误运行未配置的 ESLint，退出2；正确入口是 `pnpm lint`。

## 验证与证据

完整批次检查题数、选项、图片、纯题目隐藏答案和统计、模式往返、A4与实际 PDF；首组另测窄屏、横屏、深色和打印克隆。三份 ZIP 的错题数为0/1/2，各29页。完整批次单份下载观测为15.68～51.22秒，不是性能基准。

数学扇形和物理电路实图验证手动裁切、仅文字、恢复图像、绑定当前图示；取消样本没有迟到下载并释放打印 iframe。六个代表题用明确标记的保存转录回放验证持久缓存：刷新和模式切换复用，修改隔离图片字节失效；回放不是新识图。

根目录：`pnpm exec vitest run --project unit apps/mobile/src/local/download-batch-pdfs.test.ts --maxWorkers=1`，2项通过，退出0。

隔离 checkout 工作目录为 `.runtime/batch-pdf-real-2026-10-13/checkout`：

```sh
pnpm --filter @solveflow/mobile typecheck
pnpm lint
pnpm --filter @solveflow/mobile build:web --output-dir ../../web
pnpm exec playwright test tests/mobile-e2e/batch-pdf-export.spec.ts tests/mobile-e2e/batch-pdf-variants.spec.ts
```

均退出0；Playwright 使用本次专用 URL 与 `/usr/bin/google-chrome`，桌面和移动视口共30项通过。私有证据保存在忽略目录 `.runtime/batch-pdf-real-2026-10-13/`：输入摘要、原始失败结果、缓存结果、ZIP结果、分页修复结果、PDF与截图；不提交题图、模型正文或原始数据。测试服务及临时 checkout 在验收结束后清理。

## 未验范围

未调用真实排版模型，自动去文字截图、图示提取、透视校正与识别准确性尚未实测；保留全图的 PDF 仍有拍摄背景和重复题面。原生打印通过克隆页面生成 PDF，不证明系统打印对话框交互。未验 Firefox、Safari、Android/iOS原生、发行部署或重新解题准确率。当前浏览器服务未被替换，修复尚未提交或推送。
