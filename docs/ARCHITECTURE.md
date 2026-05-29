# Architecture / 架构说明

## Goal / 目标

Kisera Cottage extracts a reusable companion-cottage experience into a public, privacy-safe React app.

Kisera Cottage 把“小屋式 AI companion 体验”整理成一个可公开、可复用、隐私安全的 React 应用。

The open-source layer handles:

- video playback
- subtitle parsing
- timestamp sync
- screenshot capture
- watch progress
- companion prompt construction
- lightweight chat, persona, memory, and settings pages

开源层负责：

- 视频播放
- 字幕解析
- 时间点同步
- 截图
- 续看记录
- 陪看 prompt 构建
- 轻量长对话、人设、记忆库和设置页面

The open-source layer does not include:

- private persona cores
- private memory databases
- private diaries
- private chat logs
- private local paths

## Main Modules / 主要模块

### UI

`src/components/CinemaCompanionRoom.tsx`

Handles local video upload, subtitles, Bilibili/web source entry, floating player, screenshots, playlist progress, companion plans, and companion chat.

负责本地影片上传、字幕、B站/网页片源入口、悬浮播放器、截图、片单续看、陪看星图和陪看对话。

### Utilities

`src/utils/subtitles.ts`

Parses SRT, VTT, ASS, and SSA subtitles.

`src/utils/media.ts`

Compresses the current video frame into a model-friendly image data URL.

### Storage

`src/storage/*`

Stores conversations, persona settings, memory notes, watch records, and lightweight diagnostics in `localStorage`.

### Provider Settings

The app stores provider configuration locally. Users bring their own API keys.

模型供应商配置保存在本地，用户自行填写 API Key。

## Flow / 调用流程

1. The user sends a message or triggers a cinema action.
2. The app collects current conversation, persona core, selected memory notes, and cinema context when needed.
3. The request is sent to the configured model provider.
4. The response is streamed or rendered back into the current page.
5. Lightweight diagnostics record retrieval and cache statistics.

## Privacy Boundary / 隐私边界

Private continuity should be provided by the user or host app. This repository only ships generic defaults and local demo storage.

私人的连续性应由用户或宿主应用自行提供。本仓库只提供通用默认值和本地轻量存储。
