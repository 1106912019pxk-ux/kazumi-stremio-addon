# Kazumi Stremio Add-on Bridge

这是 Kazumi 本地 fork 中隔离维护的 Stremio 兼容插件。当前 `0.1.0` 是协议验证版，只包含 Apple 官方公网 HLS 测试流，不读取 Kazumi 规则，也不提供第三方影视内容。

## 当前验证范围

- Stremio `manifest`、`catalog`、`meta`、`stream` 完整调用链；
- KDTIVI、Nuvio、Stremio 可使用的标准插件地址；
- HTTPS/HLS 公网播放；
- CORS、健康检查、静态托管包和 Node 服务包；
- Windows 本地打包和 GitHub Actions 自动产物。

## 本地运行

需要 Node.js 20 或更高版本：

```powershell
node src/server.mjs
```

默认插件地址为：

```text
http://127.0.0.1:7000/manifest.json
```

iPhone 不能访问电脑的 `127.0.0.1`。局域网测试应使用电脑的局域网地址，例如 `http://192.168.1.20:7000/manifest.json`，并允许 Windows 防火墙的对应入站访问。公网使用应部署静态包到 HTTPS 站点，或为 Node 服务配置 HTTPS 反向代理。

## 检查与打包

```powershell
.\scripts\build.ps1
```

脚本依次执行语法检查、自动测试、静态插件生成和 ZIP 打包，产物位于 `release/`：

- `kazumi-stremio-addon-server-v0.1.0.zip`：Node 服务；
- `kazumi-stremio-addon-static-v0.1.0.zip`：可部署到静态 HTTPS 站点；
- `SHA256SUMS.txt`：产物校验值。

若 Node.js 不在 PATH，可指定可执行文件：

```powershell
.\scripts\build.ps1 -NodePath "C:\path\to\node.exe"
```

## Docker / NAS

```powershell
docker compose -f .\stremio-addon\compose.yaml up -d --build
```

这条命令需要在仓库根目录执行。服务监听 `7000` 端口；后续迁移到 NAS 时可继续使用同一个镜像和插件地址。

## GitHub Pages HTTPS

仓库包含 `deploy-stremio-addon-pages.yml`。远程 fork 建立并启用 GitHub Pages 的 GitHub Actions 来源后，推送到 `main` 会部署静态插件。安装地址格式为：

```text
https://<GitHub用户名>.github.io/<仓库名>/manifest.json
```

Pages 版本适合当前固定公网测试源。需要动态执行 Kazumi 规则后，应改用 Node/Docker 服务。

## KDTIVI 验证

1. 将静态包部署到 HTTPS 站点，或者在局域网启动 Node 服务。
2. 在 KDTIVI 的 Addons 页面粘贴完整的 `manifest.json` 地址。
3. 打开“Kazumi 网络源验证”。
4. 进入“第 1 集 · Bip Bop HLS”，选择“Apple HLS”。
5. 记录目录、封面、播放、拖动、音轨、字幕和进度恢复结果。

## 下一阶段边界

协议和真机播放验证通过后，再增加 Kazumi JSON 规则加载、搜索、选集、播放地址解析、请求头代理和规则健康检查。插件只用于用户拥有或获授权访问的来源。
