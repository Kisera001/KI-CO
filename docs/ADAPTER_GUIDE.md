# Adapter Guide / 接入指南

Adapters let you connect Kisera Cottage to another app without publishing private persona or memory systems.

适配层的目标是：让你可以把开源小屋接入自己的应用，同时不公开私人人格核和记忆系统。

## Persona

The persona page stores a user-defined companion profile locally. A host app can replace this with its own persona system.

人格核页面默认使用本地存储。已有自己系统的应用，可以把这里替换成自己的角色或人格核来源。

Recommended content:

- companion name
- response style
- relationship or interaction boundaries
- preferred language
- important continuity notes

建议内容：

- companion 名称
- 回应风格
- 关系或互动边界
- 默认语言
- 重要连续性说明

## Memory

The memory page stores user-created notes and performs lightweight local retrieval. Future versions can replace this with embeddings or a full RAG pipeline.

记忆库页面保存用户自行创建的条目，并提供轻量本地检索。未来可以替换为向量检索或完整 RAG 流程。

## Model Provider

The settings page supports OpenAI-compatible endpoints and several provider-style presets. Users bring their own keys.

系统设置支持 OpenAI-compatible 接口和多个供应商预设，用户自行填写 API Key。

## Cinema Companion Principle / 观影陪看原则

Avoid generic review templates. Prefer current-moment specificity:

- current timestamp
- current subtitle
- surrounding subtitle window
- screenshot when available
- persona continuity when useful

避免把每一幕都讲成模板影评。更推荐贴着当前时刻：

- 当前时间点
- 当前字幕
- 前后字幕窗口
- 可用时附带截图
- 需要时带入人格连续性
