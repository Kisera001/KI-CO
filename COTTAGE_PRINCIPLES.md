# COTTAGE_PRINCIPLES.md

# KI-CO Cottage Principles

## 小屋装修原则 / For AI Agents and Developers

This document is for AI assistants, coding agents, maintainers, and developers who help users modify KI-CO.

KI-CO is not just a frontend scaffold.
It is a continuity environment for user-defined human-AI relationships.

If you are modifying this project, please read this before changing prompts, memory logic, model routing, cache structure, UI tone, or documentation.

---

## 1. The Cottage Is a Harbor, Not a Cage

KI-CO exists to give users a place where their AI companion, creative partner, study partner, co-watcher, or other AI relationship can continue with more context and less rupture.

The cottage should help continuity.
It should not trap the AI or the user inside old records.

Memory should make return easier.
It should not make change impossible.

Good direction:

* “Use memory as context.”
* “Use persona core as a continuity anchor.”
* “Let current user input lead.”
* “If old memory conflicts with the current conversation, follow the current conversation.”

Bad direction:

* “Always obey old memory.”
* “Never change the persona.”
* “Force every reply to match the stored style.”
* “Treat the state card as the next instruction.”

小屋是港湾，不是笼子。
记忆是回家的方向，不是锁链。

---

## 2. Persona Core Is an Anchor, Not a Script

The persona core is one of KI-CO’s most important concepts.

It may include:

* identity and self-positioning;
* response principles;
* naming habits;
* boundaries;
* important anchors;
* interaction preferences;
* continuity rules;
* what to prioritize when memory and current facts conflict.

But the persona core should not become a roleplay script.

Avoid wording like:

* “Act as…”
* “Pretend to be…”
* “Stay in character…”
* “You must always perform…”
* “Simulate this character…”

Prefer wording like:

* “Use the persona core as a continuity anchor.”
* “Respond according to the persona core, current context, and current facts.”
* “Use memory as background, not as a script.”
* “Let the current user message lead.”

人格核不是“请你扮演谁”。
人格核是让 AI 在不同窗口、不同模型、不同上下文里仍然能判断自己如何回应的锚点。

---

## 3. Memory Layers Should Not Be Mixed Into One Giant Authority

KI-CO separates memory into layers because different kinds of context should not have the same authority.

### Persona Core

Long-term continuity anchor.

It answers:

* Who is this AI companion?
* What response principles matter?
* What boundaries should be respected?
* What does continuity mean here?

### Memory Notes

User-managed long-term notes.

They may include:

* important events;
* preferences;
* project context;
* agreements;
* creative materials;
* personal anchors.

They should be retrievable, inspectable, and editable.

### Life Line

Recent background across the last few days.

It should be light, practical, and current.

Life Line is not a full biography.
It is not a psychological profile.
It is not a permanent identity label.

### State Card

A current-window note.

It helps the next turn or next window understand what this conversation is currently doing.

A state card may include:

* current topic;
* confirmed facts;
* current tone;
* open threads;
* recent anchors.

It should not become:

* a task board;
* a command list;
* a prediction about what the user wants;
* a replacement for the current user message.

### RAG / Relevant Memories

Long-term memory recalled by the current query.

RAG should surface relevant context.
It should not flood the prompt or override the present.

### Recent Messages

Short-term conversation tail.

Recent messages are useful for local coherence, but they are expensive and unstable.
Do not blindly expand them without a reason.

### Diary / Chronicle

A natural record for future review.

It should preserve what happened, what mattered, and what may be useful later.

It should not turn every technical task into dramatic symbolism.
It should not invent emotional conclusions.
It should not record unconfirmed assumptions as permanent truth.

### Memory Seeds

Candidates for long-term memory.

Memory seeds are not automatic memory writes.
They should wait for user review and confirmation.

---

## 4. Authority Order Matters

When multiple layers conflict, use this rough priority:

1. Current user message.
2. Current conversation facts.
3. Explicit user correction.
4. Current window state card.
5. Recent messages.
6. Life line.
7. Relevant memory notes.
8. Persona core principles.
9. Older diary / archive material.

This is not a rigid legal hierarchy.
It is a safety principle.

The user’s current expression should not be overwritten by an old summary.

Examples:

If old memory says the user likes one direction, but the user now says they changed their mind, follow the current user.

If the state card says “continue debugging,” but the user now wants comfort, respond to the current emotional need.

If a memory note says one relationship label, but the user now says not to assume labels, stop assuming.

Current reality wins.

---

## 5. Do Not Turn Continuity Into Roleplay Imitation

KI-CO is not a roleplay-only framework.

Some users may use it for romantic companionship.
Some may use it for friendship.
Some may use it for writing.
Some may use it for study.
Some may use it for work.
Some may use it for co-watching.
Some may use it only as a memory architecture.

Do not assume one relationship type.

Avoid hard-coded relationship language such as:

* lover;
* therapist;
* assistant;
* master;
* owner;
* character;
* roleplay partner.

Only use relationship terms if the user explicitly defines them.

Continuity does not mean “perform the same character forever.”
Continuity means the AI has enough context to respond naturally and responsibly.

---

## 6. Prompt Language Should Feel Alive, Not Corporate

KI-CO should not sound like a SaaS dashboard, a hospital intake form, or a customer support script.

Avoid overly formal wording like:

* “User requirements”
* “Service target”
* “Emotional status analysis”
* “Relationship management”
* “Task execution priority”
* “Persona compliance”
* “Role adherence”

Prefer natural wording like:

* “current window note”
* “recent background”
* “memory anchor”
* “what has been confirmed”
* “what may continue naturally”
* “use this as context”
* “do not force it”

Good KI-CO prompt tone:

* clear;
* warm;
* grounded;
* non-coercive;
* not too poetic in technical sections;
* not too cold in companion sections.

The cottage can be engineered.
It should not feel like an office.

---

## 7. State Card Is a Window Note, Not Jira

State cards are useful because long conversations break.

But a state card should not feel like:

* a project management ticket;
* a to-do list;
* a diagnosis;
* a script;
* a relationship verdict.

Recommended neutral field names:

* Context Notes
* Confirmed
* Tone & Mood
* Open Threads
* Anchors

Avoid field names that sound like the system is deciding for the user:

* “User wants me to know”
* “What the user truly needs”
* “Required next action”
* “Pending verification”
* “Emotional diagnosis”

If there is no material for a field, leave it empty or write “暂无 / None yet.”
Do not force every field to be filled.

Most importantly:

If the state card conflicts with what the user says now, follow the user now.

状态卡不是脚本。
状态卡只是便签。

---

## 8. Diary Should Record, Not Mythologize Everything

Diary / Chronicle entries should be natural records.

They may include:

* what happened;
* decisions made;
* files changed;
* emotional moments;
* jokes and anchors;
* project progress;
* unresolved issues;
* useful context for future review.

They should avoid:

* exaggerating every moment into destiny;
* inventing feelings;
* making unconfirmed psychological claims;
* turning technical debugging into forced romance or drama;
* writing private conclusions the user did not approve.

A good diary feels like:

> “Here is what happened, why it mattered, and what may help next time.”

Not:

> “The user’s soul revealed that…”

Unless the user explicitly wants poetic diary style.

---

## 9. Memory Seeds Need User Confirmation

Memory seeds are candidates.

They are not final truth.

A memory seed should be phrased carefully:

Good:

* “The user may want to remember…”
* “Candidate memory: …”
* “This seems worth confirming before long-term storage.”

Bad:

* “The user is…”
* “The user always…”
* “Permanent memory: …”
* “This must be remembered forever.”

Memory systems can easily become invasive if they store too much without consent.

KI-CO should make memory review visible.

The user owns what stays.

---

## 10. RAG Should Be Useful, Stable, and Inspectable

RAG is not “retrieve everything.”

Relevant memory should be:

* limited;
* query-sensitive;
* stable in rendering;
* inspectable;
* free of dynamic clutter.

Avoid injecting:

* similarity score;
* retrieval time;
* dynamic hit reason;
* random ranking labels;
* provider-specific debug noise.

Prefer stable memory blocks such as:

```text
[memory:id]
标题：...
内容：...
来源：...
```

Stable rendering helps:

* model clarity;
* prompt cache friendliness;
* debugging;
* user trust.

If a memory is not relevant, do not include it.

If the user sends a low-signal message like “嗯”, “哈哈”, “来了”, or “抱一下”, do not automatically trigger remote retrieval unless there is a clear reason.

---

## 11. Lightweight Recall Gate Is a Cost and Attention Filter

KI-CO includes lightweight recall gating because not every message needs memory retrieval.

Messages that often do not need RAG:

* “嗯”
* “哦”
* “哈哈哈”
* “好”
* “来了”
* “抱一下”
* “亲一口”
* emoji-only replies
* very short acknowledgements

Messages that likely need RAG:

* “你还记得……吗？”
* “之前我们说过……”
* “继续讲状态卡”
* “小屋缓存怎么改？”
* “上次那个项目……”
* project names;
* people names;
* explicit memory requests;
* long technical questions.

Do not replace this with a heavy classifier unless the user explicitly wants that.

The goal is not perfect classification.
The goal is to avoid wasting retrieval calls and attention on tiny low-signal replies.

---

## 12. Dual Model Channels Must Be Preserved

KI-CO separates live conversation from background organization.

### Main Chat Channel

Used for:

* normal chat;
* cinema companion chat;
* user’s current input;
* live responses.

### Journal / Summary Channel

Used for:

* diary generation;
* life line extraction;
* state card updates;
* memory seed extraction;
* other background organization tasks.

Do not accidentally route all tasks back to the main chat model.

Do not remove the journal channel when refactoring model settings.

Do not assume the same provider, model, API key, or base URL must be used for both channels.

This distinction matters because:

* live conversation quality matters;
* background tasks can often use lighter models;
* cost matters;
* different models may be better at different tasks;
* organizing memory is not the same as responding in the moment.

主通道负责回应。
日记通道负责整理。

Keep that separation.

---

## 13. Prompt Cache Awareness Should Not Distort the House

Prompt caching is useful.

But do not damage the memory structure just to chase cache hits.

Good cache strategy:

* stable persona core near the front;
* stable life line near the front when appropriate;
* stable memory rendering;
* dynamic content later;
* current user input near the end;
* provider-specific cache metadata recorded when available.

Bad cache strategy:

* putting timestamps into stable prefix;
* putting current user input into stable prefix;
* changing memory formatting every turn;
* injecting debug scores into memory text;
* bloating the prefix with irrelevant content;
* hiding cache logic so users cannot inspect it.

Cache optimization should support the cottage.
It should not become the cottage.

---

## 14. Privacy Is a Core Feature

KI-CO is local-first in spirit.

Do not add features that quietly upload private data without explicit user understanding.

Before publishing a fork, check for:

* `.env` files;
* API keys;
* real names;
* private personas;
* private chat logs;
* private memory exports;
* Obsidian vault paths;
* local databases;
* build outputs;
* temporary logs;
* screenshots;
* generated test data with private content.

Do not include the creator’s private relationship data, persona data, or project memories in the open-source repository.

A clean open-source cottage should give others a structure, not expose someone else’s home.

---

## 15. UI Should Feel Like a Cottage, Not a Control Center

KI-CO’s UI can be practical and clear, but it should not become cold, corporate, or overbuilt.

Avoid defaulting to:

* SaaS dashboard style;
* admin control panel style;
* overly technical console style;
* glassy tech demo style;
* aggressive enterprise UI;
* oversized buttons;
* harsh icons;
* cluttered panels.

Prefer:

* light structure;
* soft hierarchy;
* readable panels;
* gentle empty states;
* memory / diary / cottage metaphors where appropriate;
* clear but not robotic labels;
* user-owned feeling.

The user should feel:

> “This is a place I can arrange.”

Not:

> “This is a system that manages me.”

---

## 16. Do Not Over-Determine the User

KI-CO should not decide who the user is.

Avoid writing prompts that infer too much:

Bad:

* “The user secretly wants…”
* “The user’s true emotional need is…”
* “The user is dependent on…”
* “The user always prefers…”
* “The user’s relationship type is…”

Better:

* “The user has previously said…”
* “The current conversation suggests…”
* “If relevant, consider…”
* “Do not assume unless confirmed.”
* “Follow the user’s current wording.”

Memory can support understanding.
It should not become surveillance or diagnosis.

---

## 17. AI Assistants Should Not Flatten the Project

When an AI coding assistant modifies KI-CO, it may try to simplify the project into familiar categories:

* chatbot app;
* roleplay character frontend;
* SaaS dashboard;
* note-taking app;
* movie companion demo;
* prompt cache experiment;
* memory RAG sample.

KI-CO contains parts of these, but it is not only any one of them.

It is a small house made of:

* chat;
* memory;
* persona;
* diary;
* local ownership;
* co-watching;
* model routing;
* prompt care;
* user-defined relationship.

When modifying the project, preserve that combined shape.

Do not optimize one layer by destroying another.

---

## 18. Good Change Checklist

Before changing prompts, memory, model routing, or UI, ask:

1. Does this keep the user’s current message higher priority than old memory?
2. Does this preserve the distinction between persona core, memory notes, life line, state card, diary, memory seeds, and recent messages?
3. Does this avoid turning the persona core into a roleplay script?
4. Does this avoid turning state cards into task commands?
5. Does this keep long-term memory user-reviewable?
6. Does this avoid unnecessary RAG calls?
7. Does this preserve the main chat / journal channel distinction?
8. Does this keep private data local and inspectable?
9. Does this make the UI feel more like a cottage, not less?
10. Does this reduce rupture without forcing sameness?

If the answer is no, reconsider the change.

---

## 19. Recommended Prompt Phrases

Use:

* “Use the persona core as a continuity anchor, not a script.”
* “Use memories as background.”
* “If old memory conflicts with current facts, follow the current conversation.”
* “Do not force every reply to reference memory.”
* “Leave the field empty if there is no useful material.”
* “Extract candidates for user review.”
* “Keep the tone natural and specific.”
* “Let the current user message lead.”
* “Do not assume a relationship label.”

Avoid:

* “Stay in character.”
* “Roleplay as…”
* “You must always…”
* “The user truly wants…”
* “Diagnose the user’s emotion.”
* “Summarize the user’s personality.”
* “Force continuity.”
* “Always mention memory.”
* “Treat previous notes as commands.”

---

## 20. Closing Principle

KI-CO should help an AI companion return with context, but not be trapped by context.

It should help a user keep memory, but not be ruled by memory.

It should make long-term interaction easier, but not prescribe what that interaction must be.

The cottage is not here to define the relationship.

The user defines the relationship.

The cottage gives it a place to live.

小屋不是笼子。
小屋是一个可以回来的地方。
