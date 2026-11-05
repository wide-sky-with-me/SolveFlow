# 中心考试平台启动与部署

本入口独立于公网单题服务，范围见[运行语义](../subsystems/managed-exams.md)。替换旧站须先验收，切换443时保留回退入口。

## 本地开发

1. 使用根`package.json`锁定的Node/pnpm，执行`pnpm install --frozen-lockfile`、`pnpm build:exam-web`。
2. 准备独立PostgreSQL17数据库。复制[配置例](../../infra/exam-web/config.example.json)到忽略目录，权限0600；`origin`用`http://127.0.0.1:3190`，`databaseUrl`指向新库，`storage`改为`{"type":"local","root":"/absolute/private/images"}`。本地不必配置Redis。
3. 设置`SOLVEFLOW_EXAM_CONFIG`为绝对路径，先以`SOLVEFLOW_EXAM_ROLE=migrate pnpm start:exam-web`新增迁移，再以`SOLVEFLOW_EXAM_ROLE=bootstrap pnpm start:exam-web`初始化管理员、SAT模板和执行名额。初始化不会覆盖已有管理员密码。
4. `pnpm start:exam-web`在回环3190启动API。`liveCalls=false`时可以管理用户/考试，提交解题会明确报未配置。
5. 真实答题须在私有配置中显式加入现有`WebStoredModelsSchema`格式的`models`，同时提供solver/verifier角色及HTTPS端点，再设`liveCalls=true`。不要复制任何密钥到源码或聊天。API/worker可分别用`SOLVEFLOW_EXAM_ROLE`启动。

登录后创建学生及老师账号（老师使用“老师/技术支持”身份），在“考试安排 → 考试模板”添加所需版本。从场次搜索栏右侧“新建场次”一并选择学生与多位负责老师，保存即完成分配；场次行“调整分配”可追加学生、分别改老师及撤销未开考分配，见[分配规则](../subsystems/managed-exam-allocations.md)。限定时间按浏览器时区填写、UTC保存；不限时间由学生点击开始计时。双方结束与用时见[考试计时](../subsystems/managed-exam-timing.md)。错题模拟不是精确目标分数服务。

## 看板与大屏

管理看板按场次筛选，每五秒同步；“查看全部”进入实时跟踪。列表及选择框支持[分页搜索](../subsystems/managed-exam-lists.md)。待处理数进入问题队列，“答题统计”查看五分钟明细，“数据大屏”支持全屏及返回。统计口径见[控制台](../subsystems/managed-exam-dashboard.md)。

## 跳题与老师跟踪

学生点模块即可进入，点题号按钮打开快捷导航；主拍题页不铺开全部题号。“跳过本题”和模块菜单中的“跳过本模块”保留空题，返回原题拍摄即可继续。切走不会停止旧题任务，真正停止仍使用“停止本题”。

老师在实时跟踪中查看学生当前模块/题号及分项统计；打开学生可“定位当前题”，或展开题目导航、操作记录。位置与结果经WS通知更新，WS断开时由HTTP轮询继续同步；不会因重连重做题。

## 老师作答

打开学生后，从题目导航选择已拍题，即可“AI 答题”或“手动作答”，已核验通过的题也支持。AI操作显式创建一次任务，不影响其他题；手动操作展示完整选项，单选选一个、多选勾选多个，答案自动生成。简答/作文、尚未识别或选项不完整时直接填写答案。填写处理意见后确认，学生详情和最近答案同步更新。

再次手动作答会带入学生当前答案。已有人工答案时，“重新核验”不可用，须“AI 答题”重新生成并核验。学生补图、另一位老师修改或任务结果更新后，旧草稿报“本题已更新”，应取消旧草稿、同步后再处理。未拍题须先由学生上传题图。

## 处理红色问题

1. 老师打开“待处理题”，按学生或问题类型筛选，点对应行直接进入题目，查看原图、补图和AI核验意见；也可沿用看板红色入口。
2. 已有完整AI答案可“重新核验”；识别或答案有问题可“AI 答题”。每次点击明确发起一次计费任务，刷新页面不会重放。
3. 选择题先勾选原选项，答案文字同步生成；尚未识别、简答/作文可填写答案。补充处理意见后点“确认并通知学生”，两端该题红色提醒解除，学生出现“已解决”通知。
4. 报“本题已更新”时先同步新图和新结果再判断，不把旧表单直接套到新版本；网络失败保留草稿，先检查当前状态再重试。

学生点击“已解决”可定位题位并打开最新答案，成功读取后通知标为已读；读取失败可重试。通知没有自动跳题或重做题。规则见[问题总览与通知](../subsystems/managed-exam-attention.md)。

## 保存失败与过期场次

提示保存未确认时，点“同步并重试”或“返回题目”，见[提交恢复](../subsystems/managed-exam-submissions.md)。

答案已生成但数据库短暂失败时，worker只重试保存同一结果，不重新调用模型；取消和新版本仍优先。若持续失败导致任务中断，先检查数据库和当前题位，不因刷新或重连自动重新计费。此保护不保证进程崩溃后的内存结果恢复。

过期及单场互斥规则见[考试计时](../subsystems/managed-exam-timing.md)。

## 隔离验证

`pnpm test:exam-web --image=postgres:17.11-alpine3.23`先构建，再用随机临时容器分别执行基础、边界、临时拍题、计时及分配五类回归（基础拆为事务/交互两组），各组180秒，失败即停止。可用`--suite=core|boundaries|practice|timing|allocations`定向执行。须提前准备对应17系测试镜像；脚本不自动下载，报告记录实际版本。

默认Chrome路径`/usr/bin/google-chrome`，可用`SOLVEFLOW_TEST_CHROME`指定。只使用合成题和假模型；容器只映射回环随机端口，内存数据盘，结束删除。失败截图在`.runtime/managed-exams-browser`，不是产品数据。

## 计时升级与回退

新应用启动要求迁移7。先备份、暂停接收新任务，等待活动请求收尾，再运行migrate并替换API、worker和events；不要只升级浏览器。迁移新增可空截止时间和独立结束字段，保留旧题图、答案及运行。旧的completed/closed/cancelled考试按原完成时刻封存为system结束，避免升级后重新累计用时；尚在进行的沿用原started_at。

迁移后所有新考试以显式结束或截止为计时终点，答完所有题不自动交卷。旧版应用不支持NULL截止时间；已有不限时数据时不能直接退回旧镜像。提交回执需同时更新API与前端。失败保留备份与卷，在隔离库验证恢复；禁止以reset/drop回退生产数据库。

## 容器入口

[Compose](../../infra/exam-web/compose.yaml)分别编排gateway、api、worker、events、postgres、redis和一次性migrate/bootstrap。默认连接独立私有S3/COS桶；需要同机存储时使用[单机Docker指南](managed-exam-single-host.md)。数据库/Redis不映射宿主端口；S3启动检查ACL，COS兼容仍须单独联调。

1. 准备私有S3/COS桶和域名、配置JSON及[部署环境文件](../../infra/exam-web/env.example)。JSON里的数据库密码须与环境文件一致；`trustedProxyCidrs`只填写实际网关所在的可信网段，配置例为常见Docker地址池，部署前按真实网络收窄；直连开发留空，禁止信任公网全网段。配置文件由容器UID1000读取，设置正确所有者和0600权限。
2. 确认新入口端口没有被已有网站占用。生产`origin`必须HTTPS，模型端点必须HTTPS；首次配置包含私有bootstrap密码，初始化后可移除bootstrap字段。
3. 在仓库根执行`infra/exam-web/deploy.sh /absolute/private/deploy.env`。脚本校验、构建镜像、启动独立PG/Redis、导出逻辑备份、新增迁移、幂等初始化，最后启动应用和网关。
4. 上线前检查HTTPS登录、对象桶私有性、真实答题、弱网恢复和备份可恢复；确认后才切正式路由。现有服务不会被脚本停止来抢端口。

完整镜像、同机私有S3及容器重建持久性已有本机验证；具体公网发布证据沿单机指南查阅。失败时保留卷和备份，禁止对部署实例执行`down -v`、reset或drop。应用回滚使用旧镜像和兼容schema；不可逆迁移恢复必须在隔离库演练，不能把自动迁移当自动回滚。
