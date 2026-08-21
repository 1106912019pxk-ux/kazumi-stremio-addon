# Kazumi Stremio Add-on Bridge

这是 Kazumi 本地 fork 中隔离维护的 Stremio 兼容插件。`0.3.0-dev` 在 Kazumi JSON/XPath 规则桥接器之外，加入了播放页媒体探测和可供 KDTIVI 真机验收的动态授权演示源。插件不内置第三方影视内容，只加载服务运行者明确配置且有权使用的本地规则。

## 当前验证范围

- Stremio `manifest`、`catalog`、`meta`、`stream` 完整调用链；
- KDTIVI、Nuvio、Stremio 可使用的标准插件地址；
- HTTPS/HLS 公网播放；
- CORS、健康检查、静态托管包和 Node 服务包；
- Windows 本地打包和 GitHub Actions 自动产物。
- Kazumi 旧式 XPath JSON 规则读取、校验和同源安全边界；
- GET/POST 搜索、详情选集、多线路和 Stremio 搜索目录转换；
- HLS/MP4 等直链与 User-Agent/Referer 播放请求头输出；
- `<video>`、`<source>` 和常见内联播放器配置中的 HLS/MP4 媒体探测；
- WebView/JS Hook 播放页的显式降级，不把未解析页面伪装成视频直链。

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

规则目录在启动时读取。修改规则后需要重启服务。当前兼容字段为 `baseURL`、`searchURL`、`searchList`、`searchName`、`searchResult`、`chapterRoads`、`chapterResult`、`usePost`、`userAgent` 和 `referer`；XPath 采用 Kazumi 常见的元素、层级、序号、属性条件和 `text()` 子集。

不依赖第三方内容的动态验收模式：

```powershell
$env:KAZUMI_DEMO_MODE = "true"
node src/server.mjs
```

安装该 Node 服务的 manifest 后，在 KDTIVI 全局搜索输入 `Kazumi`。预期能看到“Kazumi 动态规则播放演示”，其详情包含 2 集、每集 2 条线路；线路由规则先访问本地播放页，再探测并返回 Apple 官方 HLS 测试流。这条链路会实际经过搜索 XPath、详情 XPath、多线路转换和播放页媒体探测。

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
3. 固定 Pages 版打开“Kazumi 网络源验证”；动态服务版可在全局搜索中输入动画名，由“Kazumi 规则搜索”返回结果。
4. 进入“第 1 集 · Bip Bop HLS”，选择“Apple HLS”。
5. 记录目录、封面、播放、拖动、音轨、字幕和进度恢复结果。

## 下一阶段边界

后续将增加规则健康检查、缓存、搜索结果与 Bangumi 元数据映射。当前媒体探测不会执行第三方 JavaScript；需要 WebView、验证码、JS Hook 或 HLS 广告过滤的规则仍只返回外部播放页，尚未达到 Kazumi 客户端的完整原生解析能力。

插件只用于用户拥有或获授权访问的来源。规则文件是可执行网络配置，只应从可信位置加载；服务不会从客户端请求任意规则地址。

## 网络排查

如果同一地址关闭 VPN 后可正常加载，而开启 VPN 后出现 TLS 错误，说明插件协议和服务路由已经可达，问题位于 VPN 的 DNS、证书检查或出口链路。该问题不影响规则引擎开发，可在部署动态服务时单独处理。
