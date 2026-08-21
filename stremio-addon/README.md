# Kazumi Stremio Add-on Bridge

这是 Kazumi 本地 fork 中隔离维护的 Stremio 兼容插件。`0.4.0-dev.2` 已同时兼容 Kazumi 旧式 XPath 规则和 API level 8 的 JSON API 规则，并将 Bangumi 周播目录、动画元数据、搜索、选集、多来源线路和播放页构造统一转换成 Stremio 资源。插件不内置第三方影视内容，只加载服务运行者明确配置且有权使用的本地规则。

## 当前验证范围

- Stremio `manifest`、`catalog`、`meta`、`stream` 完整调用链；
- KDTIVI、Nuvio、Stremio 可使用的标准插件地址；
- HTTPS/HLS 公网播放；
- CORS、健康检查、静态托管包和 Node 服务包；
- Windows 本地打包和 GitHub Actions 自动产物。
- Kazumi 旧式 XPath JSON 规则读取、校验和同源安全边界；
- Kazumi API level 8 的 `searchMode/chapterMode=api`、受限 JSONPath 和请求模板；
- API 搜索内部 ID、嵌套 JSON 选集、分隔字符串选集和播放页模板；
- Bangumi 公共周播目录、封面、简介、年份、标签与基础内存缓存；
- 同一 Bangumi 动画下的多条 Kazumi 规则、多线路和统一剧集聚合；
- GET/POST 搜索、详情选集、多线路和 Stremio 搜索目录转换；
- HLS/MP4 等直链与 User-Agent/Referer 播放请求头输出；
- `<video>`、`<source>` 和常见内联播放器配置中的 HLS/MP4 媒体探测；
- WebView/JS Hook 播放页的显式降级，不把未解析页面伪装成视频直链。
- 默认保持网络和宿主中立，输出规则解析到的全部媒体候选；需要时可显式启用普通 HTTPS HLS 筛选。

## 本地运行

需要 Node.js 20 或更高版本：

```powershell
corepack enable
pnpm install --frozen-lockfile
node src/server.mjs
```

默认插件地址为：

```text
http://127.0.0.1:7000/manifest.json
```

默认不加载任何动态规则。将一个只包含可信 Kazumi JSON 文件的目录通过环境变量传入后，manifest 会自动增加“Kazumi 规则搜索”目录：

```powershell
$env:KAZUMI_RULES_DIR = "C:\path\to\authorized-rules"
node src/server.mjs
```

规则目录在启动时读取，修改规则后需要重启服务。XPath 模式兼容 `baseURL`、`searchURL`、`searchList`、`searchName`、`searchResult`、`chapterRoads`、`chapterResult`、`usePost`、`userAgent` 和 `referer`；XPath 采用 Kazumi 常见的元素、层级、序号、属性条件和 `text()` 子集。

API 模式兼容 Kazumi API level 8 的 `searchMode`、`chapterMode`、`searchApiConfig` 和 `chapterApiConfig`。支持 GET/POST、JSON/表单请求体、请求头、查询参数、`@keyword`、`@source`、响应变量、线路/剧集序号和播放页模板。JSONPath 与 Kazumi 一样只接受字段、数组下标、通配符和带引号字段名，不执行过滤器、递归查找或表达式。

## Bangumi 原生目录

加载至少一条规则后，可以启用更接近 Kazumi 的原生浏览方式：

```powershell
$env:KAZUMI_RULES_DIR = ".\rules"
$env:KAZUMI_BANGUMI_MODE = "true"
node src/server.mjs
```

此模式把 KDTIVI 首个目录显示为“Kazumi 本周放送”，目录和详情使用 Bangumi 公共 API 的真实封面、标题、简介、年份和标签，不需要 Bangumi Access Token。打开动画详情时，服务依次使用中文名和原名检索已加载的 Kazumi 规则；若存在精确标题结果，会优先聚合精确结果，再把来源名与线路名一起显示给宿主。

目录、单条元数据和聚合结果使用短时内存缓存，避免宿主刷新页面时反复请求 Bangumi 和来源站。服务重启后缓存自然清空，不会在磁盘保存 Bangumi 或来源响应。

不依赖第三方内容的动态验收模式：

```powershell
$env:KAZUMI_DEMO_MODE = "true"
node src/server.mjs
```

安装该 Node 服务的 manifest 后，优先从 KDTIVI 的电视节目分类选择“Kazumi 动态规则验收”，再打开“Kazumi 动态规则播放演示”。详情由规则解析出 2 集和三类媒体候选，服务默认使用通用的 `all` 策略，不根据 VPN、IP、域名或特定宿主改写结果。这条链路会实际经过搜索 XPath、详情 XPath、多线路转换和播放页媒体探测。

若某个宿主只适合普通 HTTPS HLS，可由部署者显式启用可选策略：

```powershell
$env:KAZUMI_STREAM_POLICY = "hls-only"
node src/server.mjs
```

不同宿主对 Stremio 搜索目录的支持并不一致。KDTIVI 的全局搜索可能只显示宿主自己的 TMDB 结果；这些结果不是 Kazumi 规则返回的，也不会自动使用仅声明 `kazumi-` ID 的桥接流。因此动态验收应从上述专用目录进入，避免把宿主元数据结果误认为 Kazumi 内容。

KDTIVI 163 当前只实际请求 manifest 中的首个普通目录，因此动态模式会复用首个 `kazumi-network-test` 目录 ID 并将它显示为“Kazumi 动态规则验收”。搜索专用目录仍保留给完整实现 Stremio 搜索协议的宿主。

iPhone 不能访问电脑的 `127.0.0.1`。局域网测试应使用电脑的局域网地址，例如 `http://192.168.1.20:7000/manifest.json`，并允许 Windows 防火墙的对应入站访问。公网使用应部署静态包到 HTTPS 站点，或为 Node 服务配置 HTTPS 反向代理。

## 检查与打包

```powershell
.\scripts\build.ps1
```

脚本依次执行语法检查、自动测试、静态插件生成和 ZIP 打包，产物位于 `release/`：

- `kazumi-stremio-addon-server-v<版本>.zip`：Node 服务；
- `kazumi-stremio-addon-static-v<版本>.zip`：可部署到静态 HTTPS 站点；
- `SHA256SUMS.txt`：产物校验值。

若 Node.js 不在 PATH，可指定可执行文件：

```powershell
.\scripts\build.ps1 -NodePath "C:\path\to\node.exe"
```

## Docker / NAS

```powershell
docker compose -f .\stremio-addon\compose.yaml up -d --build
```

这条命令需要在仓库根目录执行。Compose 会把 `stremio-addon/rules/` 只读挂载到容器；服务监听 `7000` 端口，后续迁移到 NAS 时可继续使用同一个镜像和插件地址。

## GitHub Pages HTTPS

仓库包含 `deploy-stremio-addon-pages.yml`。远程 fork 建立并启用 GitHub Pages 的 GitHub Actions 来源后，推送到 `main` 会部署静态插件。安装地址格式为：

```text
https://<GitHub用户名>.github.io/<仓库名>/manifest.json
```

Pages 版本适合当前固定公网测试源。需要动态执行 Kazumi 规则后，应改用 Node/Docker 服务。

Pages 构建会通过 `PUBLIC_URL` 写入绝对封面与背景地址；手工构建要部署的静态包时也应设置该 HTTPS 地址：

```powershell
$env:PUBLIC_URL = "https://example.com/kazumi-addon"
pnpm run build:static
```

## KDTIVI 验证

1. 将静态包部署到 HTTPS 站点，或者在局域网启动 Node 服务。
2. 在 KDTIVI 的 Addons 页面粘贴完整的 `manifest.json` 地址。
3. 固定 Pages 版打开“Kazumi 网络源验证”；动态服务版选择“Kazumi 动态规则验收”目录。支持 Stremio 搜索目录的宿主也可由“Kazumi 规则搜索”返回结果。
4. 进入“第 1 集 · HLS 兼容流”，选择“兼容 HLS”线路。
5. 记录目录、封面、播放、拖动、音轨、字幕和进度恢复结果。

## 下一阶段边界

下一阶段将增加规则健康检查、失败来源降权、搜索别名回退和可控的持久缓存。当前媒体探测不会执行第三方 JavaScript；需要 WebView、验证码、JS Hook、Cookie 验证或 HLS 广告过滤的规则仍只返回外部播放页，尚未达到 Kazumi 客户端的完整原生解析能力。

插件只用于用户拥有或获授权访问的来源。规则文件是可执行网络配置，只应从可信位置加载；服务不会从客户端请求任意规则地址。

## 网络排查

如果同一地址关闭 VPN 后可正常加载，而开启 VPN 后出现 TLS 错误，并且服务日志中没有对应请求，故障位于 VPN 到该公网域名的 DNS、TLS 检查或出口链路，而不在 Kazumi/Stremio 协议。开发验收可临时使用不同域名体系的第二条 HTTPS 隧道；长期部署应使用固定域名和受控反向代理，避免依赖临时隧道的随机域名与会话寿命。
