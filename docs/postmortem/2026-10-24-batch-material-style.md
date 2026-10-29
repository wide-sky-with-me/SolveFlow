# 批量补图界面风格与键盘验收

日期：2026-10-24。范围：新增批量补图流程及共用补图预览，Linux Chrome、合成图片和模型；未部署远程应用。功能基线见[批量补图验收](2026-10-24-batch-materials.md)，当前行为见[子系统说明](../subsystems/batch-materials.md)。

结论：统一内容宽度、卡片、输入控件和浅深色反馈，修复键盘空格无法选择；窄屏预览改为图片信息在上、操作在下，长分配摘要限制两行。最终桌面15项、移动视口7项通过，不代表原生设备或真实模型质量。

## 变更与处理

- 入口原用720px内容宽度，后续用920px，桌面标题切换时偏移100px；[流程界面](../../apps/mobile/src/components/batch-materials.tsx)统一使用现有workspace宽度。
- 分配列表原为直角分隔行，与预览卡片圆角不一致；改用共享卡片样式，选中背景及焦点描边使用主题色。未选框边界对比度原为浅色1.21、深色1.55，改用主题次要文字色并验证至少3。
- 序号输入框原比紧邻按钮高6px，现与compact按钮等高。预览图片加共享卡片容器。
- 已安装react-native-web的PressResponder只为button标签或button角色提供空格激活，原checkbox角色的Pressable无法切换。新增[Web控件](../../apps/mobile/src/components/material-target-control.web.tsx)使用原生button并暴露checkbox语义，焦点显示在外层卡片；[原生控件](../../apps/mobile/src/components/material-target-control.tsx)沿用Pressable。
- [共用预览](../../apps/mobile/src/components/material-import.tsx)将缩略图/文件信息与操作分行，避免320px下缩略图夹在多行按钮中；分配摘要显示总数并限制两行。保存、队列和模型协议未在本轮修改。

## 验证结果

证据保存在忽略目录`.runtime/batch-material-style-2026-10-24/`：改前快照、日志及entry/draft/selection截图。隔离服务使用动态回环端口及独立浏览器上下文，不读取真实密钥；真实模型请求为0。测试结束按服务记录PID清理，未触碰用户或Mac服务。

- 修复前`SOLVEFLOW_TEST_WEB_URL=<隔离服务> pnpm exec playwright test tests/mobile-e2e/batch-materials.spec.ts --grep 'batch material style' --project=desktop`：8项失败，退出1，覆盖标题错位、圆角、对比度、焦点、空格和控件高度。首次修正后8项外观及4项功能通过，之后继续调整窄屏预览，不累计为新增场景。
- 最终`pnpm exec playwright test tests/mobile-e2e/batch-materials.spec.ts tests/mobile-e2e/materials-multi.spec.ts --grep 'batch material style|reuses assigned|grouped recipient|cancelling a reusable|failed shared-image|fifty recipients|selects several supplements once|supplemented correction downloads a complete PDF in 快速原文' --project=desktop`，同样指定隔离服务：15项通过，退出0，49.2秒。包含320/390/1440/1920px各浅深色、空格选择、焦点反馈、无横向溢出及确认/取消按钮可见；另覆盖复用补图、同图多题、事务失败重试、50接收者和快速PDF。
- 相同两文件、去掉style筛选、`--project=mobile`：7项通过，退出0，32.0秒。桌面/移动共22次测试执行，7个功能场景各执行两次；复测次数不增加场景数。
- `pnpm build:web`、`pnpm exec tsc --noEmit`、`pnpm --filter @solveflow/mobile typecheck`均退出0；最终Web包为`index-1dee89fa90f96811b88c2477ca41589c.js`。
- `pnpm lint`退出0，含源码边界及文档检查：361份当前文档、108份决策、183个源码锚点、108份冻结文档；`git diff --check`退出0。首次文档检查因发布状态2201单位超过2200门槛失败，精简摘要后复测通过，未提高上限。隔离服务PID3014726已停止，服务进程退出0。

## 未验证项与剩余风险

没有远程新界面部署、Windows/Safari/Firefox、Android/iOS新包、原生放大字体或真实付费模型测试。此次检查聚焦批量补图及共用预览，不宣称全项目所有页面完成视觉验收。
