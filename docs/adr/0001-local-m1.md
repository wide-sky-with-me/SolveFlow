# ADR 0001：本地 M1 纵切与移动端

2026-09-10，用户明确要求继续推进数据库、上传、API 和移动适配 Web。开始这些实现，不再将 M0 所有安全评审结束作为开发前置条件；M0 未验收项继续保留，不据此宣称适合公网发布。

沿用 PostgreSQL/Drizzle、私有 MinIO、Hono、Next.js/React/Tailwind/KaTeX。新增依赖从 npm 发布元数据核实并精确固定；Next MIT约185MB、React/ReactDOM MIT约8.3MB、Hono/Node适配器 MIT约1.5MB、Drizzle Apache-2.0约10.4MB、pg MIT约100KB、sharp Apache-2.0约960KB（不含libvips）、AWS S3 SDK Apache-2.0约3.3MB、KaTeX MIT约4MB、Tailwind/PostCSS MIT约873KB、Playwright Apache-2.0（测试用，使用本机Chrome）。均为当前维护的既有方案依赖；体积是发布包未压缩值，不是浏览器bundle。保留24小时发布冷却策略，React选19.2.4、AWS SDK选3.1128.0。Pi不升级，不新增ORM/Agent框架。

预览采用同源、每次校验owner的图片代理，内部由S3签名请求读取私有对象。相较原设计浏览器直接使用5分钟S3签名URL，这避免手机访问服务器loopback地址、签名URL出现在浏览器/代理日志，并使删除/身份撤销即时生效；不产生可绕过owner校验的公共图片URL。外部图片URL仍不接受。

开发服务只监听127.0.0.1，通过Next同源代理访问API。移动响应式用真实浏览器视口/触摸模式测试；手机实机访问需要独立部署可信HTTPS入口，不自动开放局域网或公网。没有Service Worker缓存私有数据。

真实执行沿用同一累计30元账本和每请求预占，不能新建/重置账本。开发/测试的合成执行器必须显式标记，普通界面不把固定答案当真实模型；模型不可用、预算不足或未配置明确返回错误。创建任务、终态、幂等和事件以数据库事务为准。
