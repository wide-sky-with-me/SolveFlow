# 图文使用说明验收

日期：2026-10-21，Asia/Shanghai。范围：已有未提交改动上的应用内说明；不提交、推送或调用付费模型。

## 变更

原说明是一段长文本，未覆盖近期PDF功能。[说明组件](../../apps/mobile/src/components/usage-guide.tsx)改为分节步骤，保留“明白了”，增加固定返回栏；补充导出、错题标记、自动续页、后台任务、记录入口及备份边界。Web专属部分按平台拆分，原生不显示这些入口。

新增三张[配图](../../apps/mobile/assets/help/README.md)，从当前Web界面与合成练习截取，合计133472字节；没有真实题图、个人记录或凭据。主题与布局沿用现有组件，无新增依赖。

## 验证

Node24.19.0、pnpm11.7.0；隔离静态服务`http://127.0.0.1:45779`，PID3367183。桌面1440×1000、移动视口390×844，另检查320×700及深浅色。证据位于`.runtime/usage-guide-2026-10-21/`。

| 实际命令或范围 | 结果 |
| --- | --- |
| `pnpm --filter @solveflow/mobile typecheck` | 退出0 |
| `CI=1 EXPO_NO_TELEMETRY=1 EXPO_NO_DOTENV=1 pnpm --filter @solveflow/mobile build:web --output-dir ../../.runtime/usage-guide-2026-10-21/web` | 退出0 |
| `pnpm exec tsc --noEmit` | 退出0 |
| `CI=1 SOLVEFLOW_TEST_WEB_URL=http://127.0.0.1:45779 pnpm exec playwright test tests/mobile-e2e/usage-guide.spec.ts tests/mobile-e2e/desktop-layout.spec.ts --grep 'illustrated usage guide\|wide profile separates' --reporter=line --output=.runtime/usage-guide-2026-10-21/browser-fitted-results` | 4项通过，退出0 |
| `pnpm lint`、`git diff --check` | 最终均退出0 |

新用例先在旧构建复现缺少图文说明，退出1，保留before.log。首轮新构建2项通过、2项失败：键盘重开后立即按Escape，早于RN弹窗动画完成；改为等待实际dialog角色激活后复测。保留browser.log与browser-final.log，不修改产品动画或放宽关闭断言。

逐图核对发现RN Web保留本地图片原始高度，造成空白；新增实际显示比例断言在旧布局复现，退出1，保留before-image-fit.log。改用比例容器约束图片两维，修复后重新构建并复测。

覆盖章节、三图加载及实际比例、无横向溢出、固定返回、底部关闭、键盘打开/Escape关闭及原菜单入口。截图采集、说明浏览的模型请求均为0；不读取用户浏览器数据。未执行原生包、真机或真实模型验证。

文档检查曾因rendering.md超长失败；精简本轮导航后通过，未调整门槛，失败和最终日志均保留。

## 本地交付

已同步到现有`http://127.0.0.1:3100`：备份旧入口，增加10项哈希资源后原子切换；首页、12项入口资源和全部新增资源返回200。未重启服务或操作用户历史；现有标签页刷新后生效。哈希与资源清单见publication.json。

45779测试服务已停止，确认原PID不存在、端口关闭；3100仍返回200，见cleanup.json。
