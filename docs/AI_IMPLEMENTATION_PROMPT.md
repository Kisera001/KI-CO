# 给其他 Coding AI 的实现提示 / Prompt For Another Coding AI

可以把下面这段发给 Claude Code、Codex 或其他 coding agent。

You can send this to Claude Code, Codex, or another coding agent.

```text
你正在把 kis-cottage 接入一个私人 AI 伴侣应用。

目标：
- 保持观影室模块可复用。
- 不要把私人人格核、日记、记忆库、真实对话写死进开源模块。
- 通过 PersonaAdapter、MemoryAdapter、LLMAdapter 接入宿主应用。
- 保留核心观影体验：当前时间点、字幕、截图、续看、陪看回复必须对齐。

任务：
1. 把 src/components、src/utils、src/storage、src/types 接入宿主应用。
2. 将 PersonaAdapter 连接到宿主应用的人格核。
3. 将 MemoryAdapter 连接到宿主应用的记忆/RAG系统。
4. 将 LLMAdapter 连接到模型供应商。
5. 截图上传模型前要压缩。
6. 不要上传整部电影，只上传当前截图和字幕上下文。
7. 从宿主应用的房间/导航系统添加入口。
8. 测试：
   - 本地 MP4 上传
   - 字幕解析
   - 当前字幕跟随
   - 当前帧截图
   - B站搜索入口
   - 网页片源入口
   - 悬浮视频窗
   - 续看记录
   - prompt preview
   - 有记忆和无记忆两种回复效果

隐私要求：
- 发布前删除私人人名、API keys、私人日志、本地路径、真实截图和对话导出。
- 用户自己的记忆库应该留在宿主应用，不放进开源仓库。
```

English summary:

```text
Integrate kis-cottage into a private AI companion app.
Keep private persona and memory outside this repository.
Use PersonaAdapter, MemoryAdapter, and LLMAdapter as the integration boundary.
Test local video upload, subtitles, screenshots, Bilibili search launcher, floating player, watch progress, and model response.
Do not publish private logs, API keys, paths, screenshots, or memory databases.
```

