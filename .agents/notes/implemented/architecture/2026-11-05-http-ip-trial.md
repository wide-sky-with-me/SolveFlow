# HTTP独立试用与双来源

日期：2026-11-05。状态：implemented。范围：中心考试HTTP临时入口、来源校验和浏览器请求标识。

## 背景

用户要求在明确放行的18443端口测试HTTP加IP，随后明确原域名也需HTTP不带端口。原服务默认HTTPS，安全Cookie与randomUUID不能直接套用普通公网HTTP；已有域名还存在上游备案拦截，不能把修改协议视为解决备案。实际证据见[验收](../../../../docs/postmortem/2026-11-05-http-ip-trial.md)。

## 决定

[传输校验](../../../../apps/exam-web/src/server/transport.ts)默认保持HTTPS或回环；只有独立配置显式启用试用，才允许IPv4高位端口及最多两个精确HTTP别名。别名可用80或同一试用端口。HTTP及WS执行同一白名单，不接受任意Origin。

[单独API容器](../../../../infra/exam-web/compose.http-trial.yaml)共享既有PG/Redis/S3与worker，原HTTPS配置不变；服务另命名，避免外部网络中的api别名冲突。HTTP使用另一个Cookie名称；不能通过网关改写Origin或移除Secure来冒充HTTPS登录。

[请求标识](../../../../apps/exam-web/src/browser/request-id.ts)在HTTP缺少randomUUID时，用WebCrypto的getRandomValues生成标准v4版本/变体位；不存在安全随机数则失败。默认HTTPS继续使用原生UUID。私有S3和模型不允许HTTP，浏览器试用不扩大文件或费用权限。

## 放弃的方案

直接关闭主入口HTTPS会扩大已有会话与配置影响；反向代理伪造Origin和删除Secure会掩盖授权边界。HTTP API放进原api服务名会影响同网DNS解析，因此独立命名。给平台随机函数打全局补丁会影响其他依赖；采用局部共享函数。未采用弱随机数或新的UUID依赖。

## 后果与限制

浏览器到试用API为明文；不同主机分别登录，共享考试和配额。它是明确授权的测试路径，不是正式TLS或备案替代。域名80转发不能解除云平台阻断或浏览器已有HSTS。关闭要先恢复网关，再停试用API，过程归[指南](../../../../docs/cookbook/managed-exam-http-trial.md)。

## 验证

[传输单元](../../../../apps/exam-web/src/server/transport.test.ts)、[UUID单元](../../../../apps/exam-web/src/browser/request-id.test.ts)与[隔离浏览器](../../../../apps/exam-web/src/server/managed.integration.test.ts)覆盖显式开关、来源、Cookie、上传和通知。18项定向单元与129项隔离回归通过；HTTP并行入口已部署。公网、Mac与域名部分网络仍被拦截的范围以验收记录为准，不据此声明iPhone真机通过。

## 2026-11-06 内存预算调整

[试用API](../../../../infra/exam-web/compose.http-trial.yaml)的`mem_limit`从384m提到512m。依据是同日[延迟排查](../../../../docs/postmortem/2026-11-06-teacher-image-latency.md)记录的持续换页：`memory.events`的`max`计数8小时内累计34072次，`memory.swap.current`约200MiB，匿名内存与换出量合计约507MiB，等于真实需求已超出原配额。宿主当时约1.8GiB可用，单容器提高128MiB不影响既有容器配额。

未把swap上限一并调大，也未加`--max-old-space-size`：Docker按两倍内存推导总限额，容器最多可用1GiB；先观察512m下`max`事件与换出是否归零，若不归零再压V8堆上限或继续提高配额。调整只重建`http-trial-api`，原HTTPS项目、数据库、存储和worker不改；回退只需恢复同目录`compose.http-trial.yaml.bak-20261106-1718`并重新`up -d`。
