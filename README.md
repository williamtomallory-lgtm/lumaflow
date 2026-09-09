# LumaFlow

LumaFlow 是一个本地优先的销售知识库与多 Agent 工作台。这个仓库把原先分开的两个工程放在同一处：

- `frontend/`：Next.js 管理界面、知识库、智能搜索、销售助手与模型选择。
- `backend/`：基于 CowAgent 的 Agent 运行时、个人微信与企业微信群通道、多实例路由、定时任务和记忆能力。

## 本机端口

- LumaFlow：`http://127.0.0.1:3000/?ui=agents-v2`
- CowAgent API：`http://127.0.0.1:9876`
- Ollama：`http://127.0.0.1:11434`

所有服务默认只监听 loopback。本机 `.env`、微信凭据、二维码会话、知识文件、数据库、模型权重和运行日志均被 Git 忽略。

## 启动前端

```powershell
cd frontend
npm ci
npm run build
npm start
```

Windows 新电脑也可以双击 `frontend/Start-LumaFlow.cmd`，由前端引导脚本准备 Node、Ollama、Qwen3 8B 和生产构建。

## 启动 CowAgent

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item config-template.json config.json
$env:COW_WEB_PORT = "9876"
$env:COW_LUMAFLOW_UI_URL = "http://127.0.0.1:3000/?ui=agents-v2"
.\.venv\Scripts\python.exe app.py
```

`Qwen/Qwen3.8-Flash-Next` 目前只是模型目录项，不会自动下载。笔记本演示模型使用 Ollama `qwen3:8b`。

## 验证

```powershell
cd frontend
npm test
npm run lint
npx tsc --noEmit
npm run build

cd ..\backend
.\.venv\Scripts\python.exe -m pytest -q tests/test_agent_admin.py tests/test_agent_registry.py tests/test_agent_routing.py tests/test_agent_web_management.py tests/test_channel_agent_types.py tests/test_channel_instances.py tests/test_multi_agent_runtime.py tests/test_web_channel_disconnect.py tests/test_weixin_credentials_path.py tests/test_weixin_attachments.py tests/test_lumaflow_primary_ui.py
```

个人微信扫码登录表示一个真实微信账号接入一个 Agent 实例，并不会把多个软件 Agent 变成同一微信账号里的多个新好友。企业微信群 Agent 使用独立的企业微信机器人凭据。实际扫码与企业微信应用凭据必须由部署者本人提供。

## 来源与许可证

后端基于 [CowAgent](https://github.com/zhayujie/CowAgent) 扩展。仓库按根目录 `LICENSE` 中的 Apache-2.0 条款分发；第三方依赖仍遵循各自许可证。
