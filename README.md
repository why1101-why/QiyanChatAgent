<p align="center">
  <img src="./build/icon.png" width="96" alt="栖言 Qiyan 图标">
</p>

<h1 align="center">栖言 Qiyan</h1>

<p align="center">
  本地优先、支持 BYOK 的 Windows AI 桌面工作台
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Electron-43-47848F?logo=electron&logoColor=white">
  <img src="https://img.shields.io/badge/Vue-3-4FC08D?logo=vuedotjs&logoColor=white">
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white">
  <img src="https://img.shields.io/badge/Windows-10%20%7C%2011-0078D4?logo=windows">
</p>

## 简介

栖言是一款本地优先的 Windows AI 桌面应用。用户可以配置自己的 API Key 或连接本地 Ollama，在一个安静、简洁的工作台中使用 AI 聊天、灵感笔记、哄哄模拟器和 ChatPDF。

应用不提供模型额度中转服务，模型请求会直接发送至用户选择的供应商。

## 核心功能

- **AI 聊天**：流式多轮对话，适用于问答、写作、分析与代码辅助。
- **灵感笔记**：支持文件夹、标签、搜索、置顶、Markdown 预览和自动保存。
- **AI 笔记整理**：支持摘要、润色、续写、翻译、待办提取及自定义处理。
- **哄哄模拟器**：具有情境、回合、好感度与结局的互动对话体验。
- **ChatPDF**：导入 PDF、查看全部页面，并根据原文和页码进行文档问答。
- **多模型配置**：保存、编辑、切换多套模型供应商与参数配置。

## 支持的模型服务

- OpenAI
- DeepSeek
- Anthropic Claude
- Google Gemini
- Ollama
- 自定义 OpenAI Compatible API

不同功能可以分别指定模型，ChatPDF 还可单独配置 Embedding 模型。

## 隐私与安全

- API Key 使用 Windows DPAPI 加密保存。
- 导出的备份文件不包含 API Key。
- 会话、笔记和应用设置默认保存在当前设备。
- 浏览器预览模式不会持久化 API Key。
- 应用不会将用户数据上传到栖言自有服务器。

## 安装使用

前往 [Releases](https://github.com/why1101-why/QiyanChatAgent/releases) 下载最新的 Windows 安装包：

```text
Qiyan-Setup-0.4.0.exe
```

安装完成后，打开“设置”，添加模型供应商、API Key 和模型名称，即可使用全部功能。

> 当前安装包尚未进行商业代码签名，Windows SmartScreen 可能显示安全提示。

## 本地开发

环境要求：Node.js 20.19+、npm、Windows 10/11。

```bash
git clone https://github.com/why1101-why/QiyanChatAgent.git
cd QiyanChatAgent
npm install
npm run dev
```

构建 Web 资源：

```bash
npm run build
```

生成 Windows 安装包：

```bash
npm run desktop:build
```

构建结果位于 `release/` 目录。

## 技术栈

- Electron
- Vue 3
- TypeScript
- Vite
- Pinia
- PDF.js
- Lucide Icons

## 问题反馈

发现问题或有功能建议，请前往 [Issues](https://github.com/why1101-why/QiyanChatAgent/issues) 提交。

提交问题时建议附上应用版本、模型供应商、复现步骤和错误截图，请勿提交 API Key。

## 许可证

本项目目前未附加开源许可证。未经作者明确授权，不代表允许复制、修改、分发或用于商业用途。
