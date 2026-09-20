# 0.1.12 解题等待动效（2026-09-16）

## 实现

- `apps/mobile/src/components/solve-progress.tsx`：蓝白卡片内的题纸扫描、逐行亮起、轻微呼吸和三点变化；不新增图片或依赖。原生使用Animated原生驱动，仅变换/透明度动画。
- 三段指示跟随真实状态：queued/understanding为识题、solving为解答、verifying/revising为核对；标题区分修正与独立校验，不估算百分比或剩余时间，不提前显示校验通过。
- `question-thread.tsx`复用该组件，首次解题、重做和追问均在对应题目内展示。取消入口保留，连接提示存在时提供刷新；终态立即卸载等待组件。
- `use-reduced-motion.ts`从已有底栏提取共用系统偏好逻辑；系统减少动态效果时保留静态插画与阶段文字，后台停止循环，卸载清理动画和订阅。未改变Agent、工具、模型或存储。
- 版本0.1.12/versionCode13。新增`tests/mobile-e2e/solve-progress.spec.ts`验证真实本地流程搭配模拟供应商的解答→核对→修正→再次核对→完成，以及追问取消与原结果保留。

## 验证

- `pnpm --filter @solveflow/mobile typecheck`、`pnpm exec tsc --noEmit`、`pnpm lint`通过；Web导出通过。
- 浏览器相关回归首轮24项中，原有导航/重做/更正/取消20项通过，新4项发现RN Web不映射`accessibilityValue.text`。改用已安装RN/Web共同支持的`aria-valuetext`后，4项全部通过（18.7秒），未删除阶段断言。日志`/tmp/solveflow-v112-e2e.log`、`/tmp/solveflow-v112-progress-final.log`。
- 桌面和390px手机窗口均检查了动画变化帧与截图，无横向溢出；普通/减少动态效果均经过解答→核对→修正→核对→完成、同题追问取消及旧答案保留。
- 本轮仅UI与共用减少动态效果hook变更，未重复运行与本次无关的数据库及完整Agent单元套件。所有模型请求均为测试fixture，无真实供应商调用。

- 最终`JAVA_HOME=/home/yhr/.sdkman/candidates/java/current pnpm mobile:apk`通过（1分44秒），0.1.12/versionCode13，43,243,644字节，同签名及私密配置扫描通过。SHA-256 `654558fc66ac1de3a10754fa58bf1ad9b253dbfb2d0bc3953825d69fa6b5c5ac`，产物`.runtime/artifacts/solveflow-arm64-local-0.1.12.apk`。
- 已覆盖安装到iQOO Neo9；原云盘文件更新为`solveflow-0.1.12-arm64.apk`并读回名称/大小，未改变共享权限。
- 动画完整流程在桌面/手机浏览器模拟模型下验证；真机不提交真实模型请求，本轮不宣称完成真机付费解题验收。iOS原生构建继续暂停。
- 真机版本读回13/0.1.12，原题保留、重新解答入口及个人页/帮助打开返回通过，记录`.runtime/device-progress/result.json`。
