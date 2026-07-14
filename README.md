# 栖言 Qiyan
<img width="76" height="76" alt="download" src="https://github.com/user-attachments/assets/e27f42f2-06da-429d-a4b2-035227e572c5" />

让对话、灵感和文档安静地落在本机。栖言是一款本地优先的 Windows AI 工作台，包含 AI 聊天、灵感笔记、哄哄模拟器和 ChatPDF 四项核心功能。

名称“栖言”表达语言与知识在本机安稳落脚；四段式 Q 图标对应四个核心功能，中心星芒代表模型能力。内部项目标识继续沿用 `ChatAgentApp`，以保持已有配置与升级兼容。

作者：`why` · 仓库：[why1101-why/QiyanChatAgent](https://github.com/why1101-why/QiyanChatAgent)

## 主要能力

- 支持 OpenAI、DeepSeek、Anthropic、Gemini、Ollama 与自定义 OpenAI Compatible 接口。
- AI 聊天支持通过文件按钮、剪贴板粘贴和拖拽添加图片或音频，可在发送前预览和移除附件。
- 可保存多套模型配置，并在已配置模型列表中切换、编辑或删除；每套配置独立保存供应商、模型参数与加密密钥。
- 四项功能可分别指定聊天模型，ChatPDF 可单独配置 Embedding 模型。
- 流式回复支持停止、超时和错误恢复；哄哄模拟器在模型异常时使用本地规则完成回合。
- 灵感笔记支持文件夹、标签、全文搜索、Markdown 预览与导出，并在本机自动保存；AI 处理结果先预览，再由用户选择替换、插入、追加或复制。
- ChatPDF 在本机解析 PDF，完整展示文档全部页面，并支持关键词/向量混合检索、连续追问和引用页码。
- 设置中心包含供应商、功能模型、安全与上下文、提示词、外观、数据管理和关于；通知入口可随时回看版本说明与使用指南。
- API Key 由 Electron `safeStorage` 使用当前 Windows 用户的 DPAPI 加密，不写入导出备份。

## v0.5.0 更新

- AI 聊天新增图片与音频附件：支持点击选择、直接粘贴和拖拽添加，也支持仅发送附件进行识别。
- 支持 PNG、JPEG、WebP、GIF 与常见音频格式；每条消息最多 6 个附件，单张图片 8 MB、单个音频 20 MB、总计 24 MB。
- OpenAI Compatible 与 Gemini 可发送图片和音频；Anthropic 支持图片；Ollama 支持视觉模型图片输入，不支持的组合会显示明确错误。
- 附件名称、类型和大小随会话保存，Base64 文件内容只保留在当前运行会话，不长期写入浏览器本地存储。

## v0.4.1 更新

- 新增首次启动欢迎通知，集中介绍最近更新、三步使用流程和四个工作区。
- 在侧栏设置按钮上方新增通知入口；窄屏布局可从顶部栏重新打开通知。
- “关于栖言”补充作者 `why` 与 GitHub 仓库链接，并统一应用版本信息。
- 同一版本关闭通知后不再自动弹出，后续仍可手动回看。

## v0.4.0 更新

- 用“灵感笔记”替换原有智能客服，形成面向个人使用的完整 AI 工作台。
- 新增笔记文件夹、标签、全文搜索、置顶、自动保存、Markdown 预览和导出。
- 新增整理结构、摘要、润色、续写、中英互译、待办提取和自定义 AI 处理。
- 旧模型配置中的客服模型槽位自动作为灵感笔记模型使用，不影响已有模型列表和加密密钥。

## 本地开发

```bash
npm install
npm run dev
```

Web 构建与 Windows 安装包：

```bash
npm run build
npm run desktop:build
```

产物输出到 `release/Qiyan-Setup-<version>.exe`。未签名的本地构建可能触发 Windows SmartScreen 提示。

## 验证

```bash
npm run build
npx electron . --smoke-test
```

模型协议契约测试使用 `_qa/mock-openai.mjs`，不依赖真实 API Key。发布前需同时检查 `1280x800`、最小桌面窗口和亮/暗主题。
