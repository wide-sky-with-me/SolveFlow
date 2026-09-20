# M0 → 本地 M1 实施基线

## 当前增量（2026-09-15）

用户已授权 Android/iOS/Web 全部统一 React Native。`apps/mobile` 的 Expo 通用界面替代默认 Next 入口，`packages/client` 共享网络/状态/提交恢复，API 增加原生身份协议；Pi、数据库和私有存储继续复用。详见 [ADR 0012](adr/0012-react-native-universal-client.md) 与 [RN 验收](REACT_NATIVE_ACCEPTANCE.md)。原生工程已生成，安装包编译、真机相机/键盘/后台恢复和公网发布尚未验收。

当前累计费用默认无限、Solver最多16轮，分别以ADR 0005和0011为准。下文30元、8轮和尚未验证追问等说明为最初M0/M1基线；后续真实追问和课程样例的实际状态以 `PI_COMPATIBILITY.md` 各日期记录为准。

## 已确认决策

- 原先按M0→M1推进；用户随后明确授权在保留M0安全未验收项的同时实施本地M1（ADR 0001），不直接生成完整MVP。
- 仅开发者本地自测，不开放公网；签名匿名身份仍需跨 owner 隔离测试。
- Solver：读取服务端SOLVEFLOW_SOLVER_MODEL及供应商配置。
- Verifier：读取独立SOLVEFLOW_VERIFIER_MODEL，可使用不同供应商/凭据；独立上下文、原图与候选证据，无工具。
- 指定型号到期/不可用时停止真实解题，不自动换模型；替换须人工批准并重新探针。
- M0–M1 真实调用累计预算人民币 30 元，包含校验、修正、失败调用；不是每日额度。没有可信价格/用量/剩余额度时不得把估算当硬费用保证。
- 开发阶段只用自制、真值明确的清晰代数题，加模糊/缺失条件等失败样本。
- 有有效候选但校验 FAIL/UNKNOWN/超时时，按技术方案保留并醒目标记 unverified；型号不可用不是静默继续解题的许可。
- PostgreSQL/MinIO 使用 Docker Compose；Web/API/worker 使用本机 pnpm。
- 真实探针失败仍可推进初始化、离线契约和安全测试，但不得宣布 M0 通过。

## 当前实施顺序

1. 核实并固定发布包、Node engines、许可证、上游来源。
2. 在真实 Pi SDK 上使用 fake provider 验证图片结构、受控 ResourceLoader、Skill/read、工具选择、事件与取消清理。
3. 本地真实 MCP stdio/Streamable HTTP 协议测试，过滤、调用、取消、连接清理；不注册生产外部 MCP。
4. 显式 opt-in 的限费的已配置供应商真实图片/工具/校验探针。所需凭据仅在本机服务端配置，不发送到聊天。
5. 用户于2026-09-10明确授权推进数据库/上传/API/移动Web，本地M1已实现；M0未完成门槛仍保留，不等于批准公网发布。见[M1记录](M1_ACCEPTANCE.md)与[ADR](adr/0001-local-m1.md)。

## 配置交接

已交付 `pnpm probe:offline`、`pnpm probe:ledger:init`、`pnpm probe:live`，见 docs/M0_PROBE.md。真实探针执行入口已建立；当前令牌硬额度设置已由用户确认；真实模型结果见兼容性记录。凭据不得写入本文、提交 Git 或输出日志。没有获准凭据时只跑 fake；真实付费测试不会在普通 test/CI 中运行。

## 范围外

上传前裁切与澄清/追问连续性已按用户新授权提前实施，见 [ADR 0008](adr/0008-learning-continuity.md)。M2 生产搜索/MCP、隔离 SymPy 完善与 M3 PWA/发布不计入本轮 M1 交付。数学服务未经隔离验收不注册。当前 M1 样本不构成全学科准确率声明。

当前本地M1实现、启动方式和实际测试见 [M1_ACCEPTANCE.md](M1_ACCEPTANCE.md)。

2026-09-10本地M1最小纵切已通过真实网页清晰代数题与确定性失败场景验收，见[M1真实记录](M1_LIVE_ACCEPTANCE.md)。真实追问尚未追加付费验证，后续测试受原30元累计预算限制；不扩大M2/M3范围。
