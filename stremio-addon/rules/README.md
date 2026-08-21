# Local Kazumi rules

将可信且获授权使用的 Kazumi JSON 规则放在此目录，Docker Compose 会以只读方式挂载到 `/rules`。JSON 文件默认被 Git 忽略，避免误提交私人配置或来源地址。

桥接器同时接受旧式 XPath 规则和 Kazumi API level 8 的 API/JSONPath 规则。规则仍保持原始 Kazumi JSON 格式，不需要转换成另一份专用配置。

Node 本地运行不自动读取该目录；请显式设置：

```powershell
$env:KAZUMI_RULES_DIR = ".\rules"
node .\src\server.mjs
```
