# 学生当前答案的选项内容预览

日期：2026-11-06。范围：`feat/public-photo-web`学生当前题答案。本次修改只在本地，未替换远程版本、提交或推送。

## 变更

用户反馈答案字母旁缺少具体选项，难以辨认。现在在字母旁显示对应选项，最多两行并省略溢出，保留现有浅绿/浅黄标牌和完整题目详情；多选逐项展示，公式沿用已有安全RichText。

[当前答案](../../apps/exam-web/src/browser/student-answer.tsx)按展示选项匹配同一材料/run/人工版本的识别选项，不从解释猜测内容。选择题预读当前详情，与展开共用同一请求；普通轮询或展开不重复读取。缺选项或网络失败不影响已有字母和答案，展开详情可只读重试，不发起模型调用。切题取消旧请求，版本变化立即隐藏旧预览。未新增接口、数据库字段或依赖。当前行为归[学生流程](../subsystems/managed-student-flow.md)。

## 验证

证据位于忽略目录`.runtime/answer-choice-preview-20261106/`。

- `before-ui.log`在Chrome/WebKit复现4项失败：没有选项预览，也未在答案出现时读取详情。最初默认PG镜像不存在，改用已有`postgres:17.11-alpine3.23`，没有下载镜像。
- 首次修正后2项断言把合成字符串尾空格当成保留内容；契约会trim选项，故在夹具中预先trim，未放宽展示或版本断言，见`after-ui.log`。4项新增回归随后通过，见`after-ui-2.log`。
- `node .runtime/answer-choice-preview-20261106/run.mjs --image=postgres:17.11-alpine3.23`退出0，最终筛选`console: (?:answer choice preview:|student flow:|student rerun:|student status palette:|mobile refinement:)`，18项通过，见`regression.log`。覆盖单/多选、公式、两行省略、请求复用、迟到响应、重拍、读取失败、当前题答案、手动切题、重答和核验状态。只使用隔离PG、合成图与浏览器路由，不调用模型。
- 截图覆盖Chrome/WebKit的320、390和1280宽、明暗主题。自动断言预览确实截断且无页面横向溢出；人工查看WebKit390深色和Chrome320浅色，字母与选项并排、文字省略正常。截图在`screens/`，不代表iPhone真机。
- `pnpm --filter @solveflow/exam-web build`、`pnpm exec tsc --noEmit`均退出0。文档检查首次报告状态页超过2200单位，见`lint.log`；精简重复文案后，`pnpm lint`及`git diff --check`复测均退出0，见`lint-final.log`和`diff-check.log`。

## 限制

选项预览需要一次当前题只读详情请求，慢网时可能稍后出现，字母和已有答案先显示；不为显示选项重新解题。未验iPhone真机或真实学生题图，没有对远程进行本轮更新。
