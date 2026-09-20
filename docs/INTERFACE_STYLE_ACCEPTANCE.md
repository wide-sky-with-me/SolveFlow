# 拍照解题界面精简

2026-09-15，按用户要求参考小猿搜题、夸克拍照搜题，精简学生端视觉和信息层级。

## 参考与实施范围

参考[小猿搜题官方产品介绍](https://www.yuansouti.com/)和[夸克官方拍题说明及界面图](https://www.quark.cn/articles23721)。公开资料强调拍题入口、答案和分步解析；本次采用白底、蓝色主操作、单列阅读和简短文案。官方资料包含历史产品图，作为方向参考，不声称与当前安装版逐像素一致。保留 SolveFlow 自有名称、图标和实现，未引入第三方品牌素材或依赖。

- `apps/web/app/globals.css`：统一中性背景、正文对比度、蓝色按钮、圆角和间距；去除旧的绿色装饰及无用样式。桌面收窄阅读宽度；移动端保留安全区、至少44px操作区域、16px输入框和局部公式/图形滚动。
- `apps/web/components/workspace.tsx`：移除欢迎标语、右侧指南、侧栏鼓励文字和页尾装饰。首页聚焦拍照/相册、选填说明和开始解题。进入解答后整张原图折叠，通过“原始题图”展开；删除入口保留。上传限制、多题数量、异常及演示状态仍可见；身份与保留时间说明归入使用说明。
- `conversation-card.tsx`、`question-conversation.tsx`、`answer-content.tsx`、`knowledge-panel.tsx`：去掉重复编号、单题外层标题和解释界面本身的文字；简化答案/步骤/知识点标题、边框和追问区域。每题完整题干和原题局部图、教学步骤、校验状态、知识点及题内持续追问继续显示。
- `apps/web/app/layout.tsx`：同步页面标题和浏览器主题色。
- `tests/e2e/` 与六个真实验收脚本：同步新的补充说明/答案文案，补充原图默认折叠、键盘展开和继续查看题干的验证。

这是展示层调整，不改变模型、提示词、Skill、API、数据库和校验协议。

## 验证

- `pnpm exec vitest run apps/web/lib`：11项通过，覆盖公式、图像裁切和分题展示的前端逻辑。
- `pnpm --filter @solveflow/web typecheck`、`pnpm exec tsc --noEmit`、`pnpm lint`：通过。
- `pnpm build`：通过全仓生产构建及产物边界检查；最后微调答案标题后，`pnpm --filter @solveflow/web build` 再次通过。
- `pnpm test:e2e`：最终34/34通过（32.1秒），桌面和手机各17项，含320px、原图键盘展开/收起、裁切、题干/局部图、知识点、同题追问、更正/失败/刷新、图文安全展示。使用生产构建和明确的 demo 模式，包含真实本地上传/SSE/持久化流程及标明的 UI 合约样例，不调用付费模型。
- 六个同步文案的真实探针脚本执行 `node --check` 均通过，仅检查语法。

构建首次因沙箱不允许 Turbopack 本地通信端口失败；端口权限恢复后旧缓存仍保留失败记录。移走本次失败的生成目录后正常构建通过，未修改构建器或放宽源码检查。首轮浏览器回归32/34通过，两处失败均为旧答案标题定位；已同步可见文案，保留公式、私有图、XSS和外部请求等检查。

## 验收边界

仅对呈现与交互验收，不将演示答案当作新一轮真实模型正确率验证。模型和课程 Skill 未变，本次没有追加付费解题调用。手机验收使用 Chrome 的移动设备模拟，真实 iOS/Android 相机和软键盘仍需设备实测。

## 本地体验

已恢复真实服务 `http://127.0.0.1:3100`，API健康检查返回 `mode=live`、`solvingAvailable=true`。最终首页在1440px、390px、320px浏览器检查中无横向溢出和页面异常；移动/桌面截图见忽略目录 `.runtime/screenshots/style-{mobile,desktop,narrow}-home.png`，运行记录见 `.runtime/app-session.json`，检查摘要见 `.runtime/interface-style-verification.json`。
