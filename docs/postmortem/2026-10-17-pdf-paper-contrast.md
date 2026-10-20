# PDF 浅灰填充保真与显式更新验收

日期：2026-10-17。

范围：本机 `http://127.0.0.1:3100/`；Chrome 154、Playwright 1.63、Vitest 5。Node 24.21.0 与声明的 24.19.0 存在版本警告。使用隔离合成题和既有真实批次副本，不改用户浏览器、原题或答案。未提交、推送或更新 Mac。

结论：修复大面积浅灰填充被局部纸面估计抹白的缺陷。图像定向单元 54 项、桌面和窄屏浏览器 92 项通过；真实批次显式更新 29 张图并生成 27 页 A4。整体生产流畅验收仍未完成。

## 变更与归因

先比较修正前构建的存量像素和同原裁片、同几何的显式清晰化：29 图均未变化，重载可复用，下载 27 页。固定缓存键没有处理器版本，故这里只证明该样本与当时处理结果相同，不追认历史生成版本。

另由静态审查提出独立浅灰反例：640×480、纸面 240、中心大灰区 220。灰区覆盖局部采样格后被当作白纸，原归一输出 255，与纸面同白。旧算法新增六项单元断言均失败；旧构建浏览器也实际测得灰区亮度差为 0，要求至少 8。它不是照片黑边、蓝边或碎字的根因证明。

修正只调整背景格参考下限。首个无色差权重的半差候选虽然修好浅灰，却令原渐变断言失败：最小通道 245，要求大于 245。保留原断言和失败证据，最终用连续相对色差权重区分明暗变化与色调过渡。取舍及限制见[决策](../../.agents/notes/implemented/storage/2026-10-17-print-paper-contrast.md)，当前行为见[题图处理](../subsystems/print-images.md)。

## 验证结果

- 单元：五个图像文件共 54 项通过。新增中性浅灰、同色偏灰填充以及已开始回写临时像素后的取消；原渐变、深灰、淡虚线、饱和色、alpha、几何和提交门禁保留。
- 浏览器：整份整理规格在桌面及窄屏共 92 项通过。新增夹具两端均测得原裁片纸面/灰区 240/220，加工后 255/244，亮度差 11；不是任意照片的对比保证。预览引用同一成品 URI，各下载两页合成 PDF，刷新恢复时 `drawImage` 为 0。显式清晰化本身允许重算。
- 真实副本：与修正前回放的初始快照一致；更新 29 图，来源、完整布局、调整参数和原题哈希保持不变。独立解码确认全部图像尺寸和通道数不变。刷新后本地重绘为 0，无模型请求及页面错误。成品 27 页 A4、6,566,322 字节，SHA-256 为 `91b46585420e1474ce3fb90af1f41dd58f88e654f752c0284e17f6806f4eb32e`。
- 构建：`pnpm typecheck`、`pnpm build:web` 退出 0；补测试后 `pnpm exec tsc --noEmit` 退出 0。HTTP 主包与磁盘逐字节一致，主包 SHA-256 为 `b1e61e0cdc4789d5a7d2ecd71287e9140423a08efab98c25bfc05cbf00cfe5e9`；html2canvas 仍为原包，未接入历史性能实验。

实际命令，均从仓库根运行；前两组退出 0：

```sh
pnpm exec vitest run apps/mobile/src/local/print-image-paper.test.ts apps/mobile/src/local/print-image-sharpen.test.ts apps/mobile/src/local/print-image-perspective.test.ts apps/mobile/src/local/print-image-deskew.test.ts apps/mobile/src/local/straighten-paper-batch.test.ts --maxWorkers=1
PLAYWRIGHT_JSON_OUTPUT_FILE=.runtime/pdf-production-2026-10-16/r36-paper-e2e-report.json pnpm exec playwright test tests/mobile-e2e/paper-preparation.spec.ts --output .runtime/pdf-production-2026-10-16/r36-paper-browser-green --reporter line,json
python3 .runtime/pdf-production-2026-10-16/inspect-image-refresh-r36.py --name image-r36-new-contrast --refresh --export
python3 .runtime/pdf-production-2026-10-16/verify-paper-r36.py
```

两个 Python 命令退出 0，均先检查 `--help`。私有证据根为 `.runtime/pdf-production-2026-10-16/`：`r36-paper-red.log`、`r36-paper-candidate-a.log` 与 `r36-pale-browser-red.log` 保留失败；`r36-image-final-unit.log`、`r36-paper-browser-green.log`、`r36-paper-e2e-report.json`、`r36-final-verification.json` 保存复测。两次真实回放分别在 `image-r36-refresh/` 和 `image-r36-new-contrast/`，原构建另存 `web-dist-before-r36/`。

## 未验证项与剩余风险

本次真实样本是同一批 27 题的旧几何副本，没有应用此前人工校样参数；不是新批次、重新识别或任意 20 份容量成绩。实际查看新成品第 19、23 页，黑蓝残边、倾斜裁片和边缘碎字仍存在；清晰化不负责改变这些几何。此前接受的四角参数应另建视觉验收基线，不能把这份性能夹具视为最新人工校样。

浅灰修正可能保留阴影。通道饱和、弱彩色与参考偏置没有普遍保真保证；未测合法蓝色宽图元竞争角度证据。回写阶段取消单测不等于实图取消时延或画布释放实测。本轮未增加业务模型调用，未复测持续重负载、实体打印及所有模式容量；原图和人工决定继续优先于自动净边。
