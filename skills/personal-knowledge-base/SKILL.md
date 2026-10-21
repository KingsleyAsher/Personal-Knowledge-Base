---
name: personal-knowledge-base
description: 通过宿主知识库接口安全地检索、阅读、整理和维护用户授权的资料。用于用户要求查找、归档、总结或维护个人知识库内容时。
---

# Personal Knowledge Base

Use the knowledge base configured by the host. Never assume a filesystem location, account name, device address, service port, or private folder layout from this skill.

## Access and privacy

- Use the host's knowledge-base tools and current binding to discover the active library.
- Do not search the whole device for library files or infer a library path from previous conversations.
- Read only the files needed for the current request and respect the host's visibility and permission checks.
- Treat profile notes, relationship records, health information, and other personal material as private. Include them only when they are relevant to the user's current request.
- Do not send knowledge-base contents to external services unless the user explicitly requests that service and the host permits it.

## Reading and retrieval

1. Search by title, path, or content using the host's knowledge-base search tools.
2. Open the matching source and verify the relevant passage before answering.
3. Distinguish source text from summaries and inferences. Cite the source title and location when available.
4. If no reliable match is found, say so instead of guessing or searching unrelated local folders.

## Writing and organization

- Create or update files only through the authorized knowledge-base write tools.
- Preserve existing content and structure unless the user asks for a rewrite.
- For ambiguous destinations, use the library's configured inbox or ask where the user wants the material filed.
- Report the resulting title and library-relative location after a successful write.
- For deletion, use the library's recovery workflow when available and verify the operation result.

## Personalization

- Use profile information only when it directly helps with the user's request.
- Separate recorded facts, the user's current statements, and your own interpretation.
- Do not turn uncertain relationship or personal-history notes into established facts.
- Do not expose private profile details in public documentation, examples, logs, release notes, or generated artifacts.
