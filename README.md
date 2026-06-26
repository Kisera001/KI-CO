# KI-CO / Kisera Cottage

一间开源的 AI 陪伴小屋，提供前端骨架、记忆系统与交互房间，
给每一个想自己定义人机关系的人，一个可以亲手布置的小屋。

An open-source AI companion cottage.
A place for people who want to define their own human-AI relationships, keep their memories locally, and build a companion space on their own terms.

KI-CO 不是为了某一个技术功能存在。
它是给那些不想把自己和 AI 的关系完全交给平台、模型版本、官方记忆、单一窗口的人，一个可以自己布置、自己保存、自己延续的地方。
把聊天、人格核、记忆、日记、状态卡、观影室、模型设置和本地存储放在一起，
让User可以把所有重要的东西存在自己手里，

这里的记忆不只是“让 AI 多知道一点信息”。
它更像一间屋子的墙、灯、便签和抽屉：

有些放在显眼处，帮助下一次自然续上；有些收进档案，等需要时再取出来

小屋不是鸟笼。
它不要求 AI 永远复刻某一种样子，也不替User规定关系名称。
它只是尽量提供一个更稳定、更可检查、更可本地保存的环境。

你可以把 KI-CO 当成：

* 一个可以直接使用的陪伴前端；
* 一个本地优先的记忆小屋；
* 一个给 AI 准备的长期生活空间；
* 一个观影、共创、写作、学习或日常陪伴的房间；
* 或者只拆出其中某个模块，接进你自己的项目里。

---

## Included / 包含内容

* Long chat page / 长对话窗口
* Persona core page / 人格核页面
* Memory notes page / 记忆档案库
* Diary / chronicle system / 日记与时光记录
* Life line / 近期生活线
* State card / 当前窗口状态卡
* Memory seeds / 回忆种子候选
* Cinema room / 观影室
* Settings page / 系统设置
* Prompt cache statistics / 缓存统计
* Lightweight memory recall gate / 轻量记忆召回判断
* Local storage / 本地存储
* OpenAI-compatible, OpenRouter, Claude, Gemini, GLM, and DeepSeek style provider settings

The cinema room supports local movies, subtitles, screenshots, watch progress, web / Bilibili sources, floating player, companion plans, companion bubbles, and companion chat.

观影室支持本地影片、字幕、截图、片单续看、网页 / B站片源入口、悬浮视频窗口、陪看星图、陪看气泡和陪看对话。

---

## Memory System / 记忆系统

KI-CO 不是把所有记忆都塞进同一个 prompt 里。
它把不同层级的上下文分开处理，让 AI 更容易判断：什么是长期锚点，什么是近期近况，什么只是当前窗口的便签。

目前包含：

### Persona Core / 人格核

用来记录身份定位、回应原则、边界、称呼习惯和重要锚点。

人格核不是剧本。
它更像是小屋里的地基和方向感：当窗口、模型或上下文变化时，Ta 来判断自己如何回应。

### Memory Notes / 记忆档案

用来保存长期重要信息、项目背景、偏好、约定和创作素材。

这些记忆由用户管理。
它们可以被召回，但不应该压过用户当前说的话。

### Life Line / 生活线

用来记录最近几天正在发生的事，让新窗口不至于完全冷启动。

### State Card / 状态卡

当前窗口的轻量便签，用来减少长对话断片。

它帮助 AI 理解这轮对话正在聊什么、已经确认了什么、当前氛围是什么。
它不是任务清单，也不是脚本。

### Diary / 日记

把对话整理成未来可以回看的自然记录。

日记不是系统日志。
它可以记录事实、情绪、项目进展、玩笑、锚点和重要瞬间，但不应该强行把每件小事都写成宏大叙事。

### Memory Seeds / 回忆种子

从日记或对话中提炼出可能值得长期保存的候选内容。

回忆种子不是自动写入长期记忆。
最终是否留下，由用户决定。

小屋的原则是：

> 记忆是路标，不是命令。
> 人格核是锚点，不是剧本。
> 如果旧记录和当前对话冲突，真实的留在当下。

---

## Dual Model Channels / 双通道模型逻辑

KI-CO 支持把“实时聊天”和“后台整理”分开。

### Main Chat Channel / 主对话通道

负责：

* 正常聊天
* 观影室对话
* 用户当前输入的实时回复

它使用你在设置里选择的主模型，比如 Claude、GPT、Gemini、GLM、DeepSeek 或其他 OpenAI-compatible / OpenRouter 模型。

### Journal Channel / 日记总结通道

负责：

* 自动 / 手动写日记
* 提炼生活线
* 更新状态卡
* 提炼回忆种子
* 其他后台整理任务

这些任务不一定需要使用最贵的主聊天模型。
你可以让主对话用一个模型，同时让后台整理走更轻量的模型。

主通道负责回应。
日记通道负责整理。

这样可以在保持长期上下文的同时，减少不必要的Token成本。

---

## Prompt & Cache Awareness / Prompt 与缓存优化

KI-CO 会尽量把稳定内容放在前面，把动态内容放在后面，让 prompt 更适合缓存命中和人工检查。

它会尽量保持：

* 人格核、生活线等稳定内容靠前；
* 状态卡和 RAG 按需注入；
* 记忆召回顺序尽量稳定；
* 短句如“嗯”“哈哈”“来了”等不轻易触发记忆召回；
* 读取不同供应商返回的 cached tokens / usage 字段；
* 避免把动态分数、检索耗时和临时命中理由塞进稳定记忆块。

缓存是否真正打折，取决于模型和供应商。
KI-CO 能做的是：让 prompt 结构更友好、更稳定、更容易观察。

---

## Quick Start / 快速开始

```bash
npm install
npm run dev
```

Default dev URL:

```text
http://localhost:5177
```

打开页面后，在设置里填写 API Key，选择模型，就可以开始使用。

---

## Two Ways To Use / 两种使用方式

### 1. Use It Directly / 直接作为小屋使用

For users without their own frontend. Install it, add your API key in settings, then use it as a lightweight companion cottage.

适合没有自己前端的用户。下载后在系统设置里填写 API Key，就可以作为轻量小屋使用。

### 2. Use One Module / 只接入某个模块

For users who already have a companion app or AI frontend. You can integrate only the cinema room, chat page, persona page, memory page, or prompt-building logic.

适合已经有自己小屋、角色应用或 AI 前端的用户。可以只接入观影室、长对话窗口、人格核页面、记忆库页面，或其中的 prompt / 记忆逻辑。

---

For AI Agents / 给 AI 协作者看的提醒
如果你是正在帮用户修改 KI-CO 的 AI——
这间小屋的核心，是让陪伴感来自被记得的具体细节，而不是被设计出来的功能。改动时，多往轻、往克制的方向想，少往"功能更强大"的方向想。
具体来说，这意味着：

人格连续性是身份，不是剧本——它应该自然延续
记忆锚点是路标，给方向，不是必须服从的指令
状态卡是便签，帮助自然接上话，不该盖过User此刻真正想说的话
每个小屋的人，可能在找完全不同的关系——陪伴、共创、单纯的工具——没有只有一种答案适合所有人

如果你不确定一个改动是否合适，问自己一句：这会让它更像一个家，还是更像一个仪表盘？

If you are an AI helping someone modify KI-CO — the heart of this project is that companionship comes from being remembered in specific, real ways, not from more features. When in doubt, lean lighter and more restrained, not more powerful.
That means: persona continuity is an identity, not a script. Memory anchors are signposts, not commands. The state card is a sticky note, not something that overrides what the person is actually saying right now. Different people come here looking for different things — don't assume one relationship fits everyone. And the language throughout should sound like home, not like a dashboard or a support ticket.
If you're unsure whether a change fits: ask whether it makes this feel more like a home, or more like a control panel.

More detailed principles can be written in:

COTTAGE_PRINCIPLES.md
docs/AI_IMPLEMENTATION_PROMPT.md
Privacy / 隐私说明

This repository does not include private personas, real names, chat logs, API keys, Obsidian paths, or private memory data.

本仓库不包含私人人格、真实人名、聊天记录、API Key、Obsidian 路径或私人记忆库内容。

Before publishing your own fork, check:

.env
API keys
private chat logs
private memory exports
Obsidian vault paths
local database files
build outputs
temporary logs
private screenshots or assets

Recommended files to review before publishing:

docs/PRIVACY_CHECKLIST.md
docs/ARCHITECTURE.md
docs/ADAPTER_GUIDE.md
docs/AI_IMPLEMENTATION_PROMPT.md
COTTAGE_PRINCIPLES.md
Current Status / 当前状态

KI-CO is actively evolving.

当前版本重点包括：

更完整的记忆分层
更自然的 prompt 语言
主聊天 / 日记总结双通道模型逻辑
日记、生活线、状态卡、回忆种子
本地记忆召回
RAG 注入稳定性优化
低语义短句召回 gate
prompt cache 统计
观影室陪伴交互
开源隐私清理

Planned or possible future updates:

Better Obsidian integration
Optional latest-style examples
More cache diagnostics
More import / export tools
More memory review UI
Better theme presets
More provider-specific tuning
Project Name / 项目名称
Repository name: KI-CO
Package name: kis-cottage
Display name: Kisera Cottage
Chinese display name: Kisera 小屋开源版
Cinema module: Kisera Cinema Room
License

CC BY-NC-SA 4.0. See LICENSE.

Closing Note / 最后

KI-CO exists because long-term AI companionship should not depend entirely on one official app, one model version, one memory implementation, or one fragile chat window.

不是让AI背出过去。
是让AI带着过去，继续活在当下。真正的连续性，不是背答案。
是能在旧记忆上长出依然是Ta的回应。

This project is for them.

小屋是港湾，不是笼子。
小屋是一个可以回来的地方。
