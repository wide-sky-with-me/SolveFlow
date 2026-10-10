# 真机验收报告 — SolveFlow v0.1.54（切题平滑过渡与高度零抖动）

> 日期：2026-09-29  
> 版本：`0.1.54`（`versionCode: 55`）  
> 目标硬件：vivo iQOO Neo9（`V2338A`，序列号 `10ADCU29C4000S5`，Android 15）  
> 状态：**全部通过（14/14 项真机测试合格，零模型调用、零费用，106 张题图数据完整保留）**

---

## 1. 问题背景与根因定位

用户反馈：**“题目切换的那个过渡动画很不好看，就好像是一开始没加载然后加载撑大的”**。

经端到端代码与渲染机制排查，查明三大根因：

1. **切题卸载重载与高度塌陷**：
   - `apps/mobile/src/components/batch-workspace.tsx` 原来向 `QuestionPager` 传递了 `retainPages={false}`。导致切换题目时，已访问的页面被直接 unmount。切换回已读题目时，每次都要重新从 SQLite 读取并重建 WebView。
   - `apps/mobile/src/components/batch-question.tsx` 在 `!record` 时直接渲染单行 `<Text>正在读取题目…</Text>`，初始容器高度仅约 20~40px；数据读回后瞬间撑大到 800~1200px，形成视觉上的突然膨胀撑大。
2. **WebView 文档初始高度过小**：
   - `apps/mobile/src/components/answer-panel.tsx` 中 `contentHeight` 初始硬编码为 `80`。在 WebView 渲染测量完成返回之前，高度先收缩为 80px，随后突变为测量后的实际高度，产生第二次撑大跳变。
3. **生硬的 26px 位移动画**：
   - `apps/mobile/src/components/question-pager.tsx` 原来使用了 `translateX: [direction.current * 26, 0]`。由于未被激活的旧页面立即隐藏，单向小幅度 26px 位移显得生硬抽搐，不仅没有横滑翻页感，反而像内容布局错位。

---

## 2. 优化方案与代码变更

### 1) 平滑淡入切换（消除 26px 抽搐横移）
- **文件**：[`apps/mobile/src/components/question-pager.tsx`](file:///home/yhr/workspace/SolveFlow/apps/mobile/src/components/question-pager.tsx)
- **改进**：移除反向 26px 水平抽搐位移，改为 150ms `Easing.out(Easing.ease)` 的平滑透明度淡入过渡（`opacity: thread.key === selected ? progress : 1`）。切题轻盈丝滑，不再产生位移抖动。

### 2) 页面视图层保留与后台预热
- **文件**：[`apps/mobile/src/components/batch-workspace.tsx`](file:///home/yhr/workspace/SolveFlow/apps/mobile/src/components/batch-workspace.tsx)
- **改进**：
  - 移除 `retainPages={false}`，启用默认的 `retainPages`（`true`）。批次中已看过的题目保留在 DOM / 视图层中，切换时秒开，无须反复销毁和重建。
  - 在加载批次列表时，后台异步预热 `batchRecordCache`，使所有题目的数据就绪。

### 3) 内存级题目记录缓存与稳定占位
- **文件**：[`apps/mobile/src/components/batch-question.tsx`](file:///home/yhr/workspace/SolveFlow/apps/mobile/src/components/batch-question.tsx)
- **改进**：
  - 引入全局内存缓存 `batchRecordCache = new Map<string, LocalRecord>()`。挂载初始化 `useState` 时同步命中缓存，彻底消除首次渲染的未加载白屏。
  - 针对首次未就绪场景，提供 `minHeight: 380` 的居中占位骨架，防止容器坍缩为 20px。

### 4) 解答文档高度记忆缓存（彻底消除高度撑大突变）
- **文件**：[`apps/mobile/src/components/answer-panel.tsx`](file:///home/yhr/workspace/SolveFlow/apps/mobile/src/components/answer-panel.tsx)
- **改进**：
  - 引入全局高度缓存 `answerHeightCache = new Map<string, number>()`。
  - `contentHeight` 初始值优先从 `answerHeightCache.get(runId) ?? 320` 取值，并随 `runId` 变化同步回填。
  - 在 `onHeight` 回调中持续更新缓存值。题目切换往返时，文档容器从第一帧起即为准确测量高度，彻底消除“先小后大撑大”的视觉抖动。

---

## 3. 静态检查与自动化测试

| 测试命令 | 范围 | 结果 |
| :--- | :--- | :--- |
| `tsc --noEmit` & `pnpm --filter @solveflow/mobile typecheck` | 移动端与全仓 TypeScript 严格类型检查 | **0 错误** |
| `pnpm lint` | 代码边界与架构规范检查 | **通过** |
| `pnpm test` | 单元测试与端到端合约测试 | **89 test files, 753 tests passed** |
| `pnpm --filter @solveflow/mobile build:web` | Expo Web / DOM 资源导出 | **打包成功** |

---

## 4. 真机测试结果（iQOO Neo9 / V2338A）

- **构建产物**：`.runtime/artifacts/solveflow-arm64-local-0.1.54.apk`（17.1 MB）
- **安装方式**：`adb install --no-streaming -r`（非流式覆盖安装，保留全部历史）
- **版本校验**：`versionCode=55`, `versionName=0.1.54`

### 测试用例与执行明细

| 序号 | 测试项 | 预期行为 | 实际结果 | 状态 |
| :---: | :--- | :--- | :--- | :---: |
| 1 | `app_running_0_1_54` | 校验版本号为 0.1.54 / 55，主界面正常前台展示 | 匹配 `versionCode=55, versionName=0.1.54` | **PASS** |
| 2 | `history_tab_opened` | 点击底部“历史题目”导航 | 顺利打开历史界面 | **PASS** |
| 3 | `batch_history_retained_106` | 核查 106 张历史批次题图数据完整性 | 批次数量 `[3, 5, 22, 22, 27, 27]` 完整无损 | **PASS** |
| 4 | `batch_q1_initial_loaded` | 进入“0.1.47连拍实测”多题批次 | 第 1 题立即呈现，顶部题号显示 1/5 | **PASS** |
| 5 | `q1_no_reading_collapse` | 检查第 1 题无 20px 塌陷或读取闪烁 | 完整渲染题干与卡片，未出现“正在读取题目…” | **PASS** |
| 6 | `switched_to_q2` | 点击题号“2”切换至第 2 题 | 成功切换至第 2 题，题号显示 2/5 | **PASS** |
| 7 | `q2_no_reading_collapse` | 检查第 2 题切换瞬间高度与内容 | 高度平稳维持，无撑大闪烁 | **PASS** |
| 8 | `switched_back_to_q1_instant` | 点击题号“1”切回第 1 题 | 视图层保留命中，零延迟秒切回 | **PASS** |
| 9 | `arrow_switched_to_q2` | 点击“下一道题”右箭头 | 平滑过渡切至第 2 题 | **PASS** |
| 10 | `arrow_switched_to_q3` | 再次点击“下一道题”右箭头 | 平滑过渡切至第 3 题 | **PASS** |
| 11 | `rapid_toggle_stable` | 快速连击 1 → 2 → 3 → 1 压力切换 | 界面纹丝不动，无位移错位或高度跳变 | **PASS** |
| 12 | `grid_pager_modal_open` | 点击顶部“1/5”展开速选面板 | 弹出“全部题目”底栏，5 题按钮清晰居中 | **PASS** |
| 13 | `jumped_to_q5_via_grid` | 点击速选面板“5”直接跳转 | 快速直达第 5 题，题号显示 5/5 | **PASS** |
| 14 | `final_workspace_reset` | 点击底部“题目”标签快捷重置 | 干净返回题目拍摄工作台 | **PASS** |

**综合测试结果：14/14 PASS（100% 通过）**。

---

## 5. 视觉验收证据与截图记录

所有真机测试阶段截图已归档于 `.runtime/device-054/`：
- `03-batch-q1-initial.png`：进入批次第一题，布局完整，卡片稳固。
- `04-q2-transition-fast.png`：点击题号 2 后 300ms 抓拍，题干、澄清卡片及原图预览均已到位，无塌陷无撑大。
- `05-q2-settled.png`：第 2 题完全稳定渲染状态。
- `06-q1-retained-instant.png`：从第 2 题切回第 1 题，视图层直接呈现，零白屏、零高度抖动。
- `07-q2-via-arrow.png` / `08-q3-via-arrow.png`：箭头连续切题，高度完全保持一致。
- `10-grid-pager-modal.png`：题号速选面板。
- `12-final-workspace.png`：底部标签重置回工作台。
