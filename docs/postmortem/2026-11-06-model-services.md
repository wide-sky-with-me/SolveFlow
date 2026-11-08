# 中心考试双服务方案与API易替换验收

日期：2026-11-06。范围：`feat/public-photo-web`工作区的服务配置、学生偏好、任务固定版本及腾讯云发布；完整版main只替换本机和Mac私有模型预设。

结论：此前授权的`20261106-model-services`已完成发布。其后用户要求新修改先留本地，本报告不表示可继续替换正在使用的远程系统。当前语义和部署前提归[模型服务方案](../subsystems/managed-model-services.md)。

## 实现与验证

学生头像提供主/备用两套完整方案，只显示名称与可用性；管理员维护解题、核验、自动备用角色及高级参数。PG加密保存不可变版本，入队固定版本；后续切换不改变已接受任务。迁移8兼容增加表和引用，不修改旧迁移。没有把供应商凭据传给浏览器。

当时版本的证据位于忽略目录`.runtime/model-services-20261106/`：

- 既有隔离回归168项通过，分组为core 46、core-ui 75、boundaries 16、practice 5、timing 18、allocations 8，见`full-regression-2.log`；最终模型方案回归10项通过，见`models-complete.log`。合计178个不同用例，不重复累计复测。
- 新回归覆盖角色隔离、密钥不回传、加密/AAD及错误主密钥拒绝启动、保存冲突、学生偏好、已入队版本固定、禁用拒绝新任务、临时拍题和Chrome/WebKit。明暗主题320/390/1440截图在`screens/`，已人工检查手机选择框及桌面配置页。
- `pnpm build:exam-web`、`pnpm exec tsc --noEmit`、`pnpm lint`、`pnpm docs:test`（20项）及`git diff --check`均退出0。日志分别为`build-complete.log`、`typecheck-final.log`、`lint-complete.log`和`docs-tests-escalated.log`。
- 首次迁移断言仍期待7，改为新增版本8并保留旧7版本检查；单选框被全局input尺寸覆盖，修正组件选择器，未放宽几何断言。初次文档测试在沙箱中失败，同命令获准重跑20项通过；失败日志保留。
- 沿用户真实模型授权，使用合成2+2题图调用API易Qwen3.8 Max，解题及核验共2次请求，13.141秒完成，选项B与预期一致、核验通过，见`live-apiyi.json`。不涉及真实学生题图，不能代表复杂数学准确率或耗时。

## 腾讯云与main预设

腾讯云基于原应用镜像更新两个API、worker和events，统一使用`solveflow/exam-web:20261106-model-services`。镜像ID为`sha256:77256b86a12da771ee410d82d8bc317bea6c145d91535f34fabd889723e083d4`；浏览器入口`main-IHY3MNGX.js`。完整编译产物245份，压缩包4692411字节，SHA-256为`9fd262089dc2c78015a47f4a16608814ec102540bec796977e3018e8330dba6e`。工作区未提交，基线HEAD为`62572c2b3e8f454d3506c62ff69583aeb8a91dd2`，不把该HEAD单独当作发布源码。

发布前两次数据库检查均为活动任务0、45秒在线人数0。辅助HTTPS连接检查存在换行转义错误，不能据此证明当时无外连；已修正辅助脚本，原脚本留档。PG及私有配置先备份，数据库备份517590字节，`pg_restore --list`可读，未演练完整恢复。发布后schema8、两套服务存在；两个API健康，worker/events运行，业务表计数与网关/数据容器身份和启动时间保持。未重置账号、考试或学生偏好，计数比较不等于逐行校验。

公网IP18443、HTTP域名80、HTTPS域名443的HTML、JS摘要和health一致。Chrome/WebKit三角色共六组登录/退出、学生公开投影/取消保留偏好、老师无配置权限及管理员API易目录检查通过，见`deployment/public-assets.json`、`public-smoke.json`。只允许登录/退出和目录检查写请求，考试写入及推理请求为0。学生有新考试准备弹窗，验收只选“稍后开始”；前两轮脚本受异步弹窗遮挡，最终用准确的弹窗处理器通过，未为测试开考。

新主密钥和两端配置均私有保存，备份包含主密钥；丢失不能重新生成替代。发布覆盖及回执登记于`shared/frontend-release.json`，按[单机指南](../cookbook/managed-exam-single-host.md)维护，应用回退不撤销增量schema。

main源码没有TokenPlus常量。本机和远程Mac私有预设改为API易，使用服务目录实际存在的`qwen3.8-max`，原DMX生效配置、其他预设及32/32并发保留。Mac目录检查HTTP200、模型存在、推理请求0；本机服务停止后原子更新私有预设并保留备份，没有切换分支或提交密钥。临时公网登录凭据已删除。

## 限制

240秒主解题等待及原并发未改，不宣称已解决慢数学题。未测试iPhone/macOS真机、跨网络域名可达性、持续负载、主密钥轮换或完整备份恢复。服务选择与[错题模拟](../subsystems/managed-exam-answers.md)独立；模拟只适用于有效单选替换，不保证指定错题数或目标分数。
