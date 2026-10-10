# 网页版功能完备性检查

日期：2026-10-07。范围：当前工作区 Web 导出、Chromium 桌面与 390×844 窄屏、隔离 IndexedDB、合成图片与假模型；未调用真实供应商、未部署或改产品代码。

结论：主要使用流程已有实现，26 个场景在两个视口共 52 项检查通过，未发现本轮网页版独有的阻断问题。功能覆盖不等于所有浏览器和真实模型均可用，也不证明答案准确率。

## 已检查的流程

| 范围 | 当前实现及本轮证据 |
| --- | --- |
| 图片输入 | 相册上传、伪图片拒绝、裁剪保存、旋转；裁剪预览与保存 JPEG 字节一致 |
| 单题与追问 | 图片→生产 Pi 适配→答案→同题追问→刷新读取→删除；假供应商返回合成答案 |
| 批量 | 相册入队、连续拍摄、保持相机预览、批次替换、切题、题号、搜索、重命名与删除；相机使用 Chromium 模拟设备 |
| 考试与材料 | 同题补图保存不调用模型；作文追问保留全文、FRQ 小问和数值填写值分开显示 |
| 核验 | 多小问覆盖完整才 PASS，缺项显示无法确认；刷新保留核验结果，不重放请求 |
| 内容展示 | 公式、金额与中文单位，作文/点评/修改稿分开，化学记号和坐标图 |
| 本地记录 | 导出下载的完整头尾与题目内容、恢复、重复导入跳过、截断拒绝、坏记录旁正常导入 |
| 设置与导航 | HTTP 400/429 反馈脱敏且不重试；活动解题、追问草稿、取消相机、返回/前进及减少动态效果 |

Web 与 Android 复用共享解题核心。当前导出基于[本轮可靠性修复](2026-10-07-exam-reliability-repair.md)的成功构建；该报告的主机真实模型成绩不代替浏览器真实接通，本轮也没有核对线上网站部署版本。

## 实际验证

使用上一轮成功生成的 `apps/mobile/dist`，没有重复构建。Node 24.19.0、pnpm 11.7.0；自有静态服务 `http://127.0.0.1:55821`，PID 983841。每个场景使用独立浏览器上下文，没有操作用户浏览器或手机数据。

设置 `SOLVEFLOW_TEST_WEB_URL` 为上述地址，实际命令：

- `pnpm exec playwright test tests/mobile-e2e/workspace.spec.ts tests/mobile-e2e/exam-materials.spec.ts tests/mobile-e2e/verification-coverage.spec.ts tests/mobile-e2e/history-import.spec.ts tests/mobile-e2e/model-failures.spec.ts tests/mobile-e2e/navigation.spec.ts --reporter=line`：36 项通过，1.8 分钟，退出 0。
- `pnpm exec playwright test tests/mobile-e2e/batch-solving.spec.ts tests/mobile-e2e/history-export.spec.ts tests/mobile-e2e/math-rendering.spec.ts tests/mobile-e2e/subject-presentation.spec.ts --reporter=line --output=.runtime/web-completeness-2026-10-07/extended-results`：16 项通过，58.4 秒，退出 0。

浏览器模型端点全部为 fixture，不是 CORS 或供应商兼容验收。新日志、Web HTML/JS 哈希与服务信息在忽略目录 `.runtime/web-completeness-2026-10-07/`。本轮服务已关闭。`pnpm docs:check` 退出 0；无产品源码修改。

## 平台限制与未验证项

- [密钥](../../apps/mobile/src/local/secrets.web.ts)只存内存，刷新后重填；记录用 IndexedDB 保存，依赖浏览器本地存储，没有自动跨设备同步。
- [后台适配](../../apps/mobile/src/local/background.web.ts)没有原生后台服务。页面关闭或被浏览器挂起可能中断；重启不自动重放付费任务。
- [本地锁](../../apps/mobile/src/local/lock.web.ts)要求支持 Web Locks 的浏览器和 HTTPS/localhost；相机也依赖安全上下文及授权。
- [图片分享](../../apps/mobile/src/share-image.web.ts)要求浏览器支持文件分享，不支持时显示提示；桌面与各移动浏览器能力不同。
- 真实供应商需允许当前网页来源的 CORS。本轮没有验证真实跨域解题、Safari/Firefox、实体相机、系统分享、浏览器存储极限或性能全集；部署路径及缓存是否更新也未检查。

生物概念、TARA 推理、核验误放行和长请求超时属于共享核心的剩余问题，见[修复报告](2026-10-07-exam-reliability-repair.md)；浏览器检查通过不能消除这些问题。
