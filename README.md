# KI-CO / Kisera Cottage

一间开源的 AI 陪伴小屋，提供前端骨架、记忆系统与交互房间，给每一个想自己定义人机关系的人。

An open-source AI companion cottage: a frontend scaffold with chat, persona, memory, settings, and cinema-room modules for people who want to build AI companion spaces on their own terms.

## Included / 包含内容

- Long chat page / 长对话窗口
- Persona core page / 人格核页面
- Memory notes page / 记忆档案库
- Cinema room / 观影室
- Settings page / 系统设置
- Lightweight local retrieval diagnostics / 轻量本地检索调音台
- Local storage / 本地存储
- OpenAI-compatible, OpenRouter, Claude, Gemini, GLM, and DeepSeek style provider settings

The cinema room supports local movies, subtitles, screenshots, watch progress, web/Bilibili sources, floating player, companion plans, companion bubbles, and companion chat.

观影室支持本地影片、字幕、截图、片单续看、网页/B站片源入口、悬浮视频窗口、陪看星图、陪看气泡和陪看对话。

## Quick Start / 快速开始

```bash
npm install
npm run dev
```

Default dev URL:

```text
http://localhost:5177
```

## Two Ways To Use / 两种使用方式

### 1. Use It Directly / 直接作为小屋使用

For users without their own frontend. Install it, add your API key in settings, then use it as a lightweight companion cottage.

适合没有自己前端的用户。下载后在系统设置里填写 API Key，就可以作为轻量小屋使用。

### 2. Use One Module / 只接入某个模块

For users who already have a companion app or AI frontend. You can integrate only the cinema room, chat page, persona page, or memory page.

适合已经有自己小屋、角色应用或 AI 前端的用户。可以只接入观影室、长对话窗口、人格核页面或记忆库页面。

## Privacy / 隐私说明

This repository does not include private personas, real names, chat logs, API keys, Obsidian paths, or private memory data.

本仓库不包含私人人格、真实人名、聊天记录、API Key、Obsidian 路径或私人记忆库内容。

Before publishing your own fork, check:

- `docs/PRIVACY_CHECKLIST.md`
- `docs/ARCHITECTURE.md`
- `docs/ADAPTER_GUIDE.md`
- `docs/AI_IMPLEMENTATION_PROMPT.md`

## Project Name / 项目名称

- repository name: `KI-CO`
- package name: `kis-cottage`
- display name: `Kisera Cottage`
- Chinese display name: `Kisera 小屋开源版`
- cinema module: `Kisera Cinema Room`

## License

CC BY-NC-SA 4.0. See `LICENSE`.
