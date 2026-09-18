# @swifty.js/mcp

The **Swifty MCP server** — an official collection of MCP tools for the
[Swifty CLI](../../README.md). It ships two tools today: a semantic
`search_docs` RAG tool over your local Swifty knowledge base, and a `create_app`
tool that lets agents deliver interactive MCP Apps with a sandboxed UI.

[![npm](https://img.shields.io/npm/v/@swifty.js/mcp?label=npm&color=F05138)](https://www.npmjs.com/package/@swifty.js/mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-f5a623.svg)](../../LICENSE)

## Tools

### `search_docs`

Semantic (embedding-based) RAG search over the local Swifty knowledge base,
built from the Markdown/text documents in `SWIFTY_DOCS_DIR` (default
`~/.swifty/docs`). Embeddings are stored in a Redis index and retrieved with
similarity scoring.

- **Input** — `query` (natural language), `top_k` (1–10, default 3).
- **Output** — the most relevant document chunks with source file, section title,
  and similarity score.
- **Degraded mode** — if Redis or the embedding provider is unavailable, the tool
  returns an honest error rather than failing silently.

### `create_app`

Delivers an interactive MCP App: the agent provides an HTML
string and a title, and the tool renders it in a sandboxed iframe (no storage or
cookies; external assets restricted to popular CDNs). Hosts without MCP Apps
support fall back to a text note.

## Configuration

| Environment variable | Description                                      | Default                  |
| -------------------- | ------------------------------------------------ | ------------------------ |
| `EMBEDDING_MODEL`    | Embedding model id (e.g. `text-embedding-v4`)    | —                        |
| `EMBEDDING_BASE_URL` | OpenAI-compatible `embeddings` endpoint base URL | —                        |
| `EMBEDDING_API_KEY`  | API key (falls back to `OPENAI_API_KEY`)         | —                        |
| `REDIS_URL`          | Redis connection string                          | `redis://localhost:6379` |
| `REDIS_INDEX_NAME`   | Redis index name                                 | `idx:swifty`             |
| `REDIS_KEY_PREFIX`   | Redis key prefix                                 | `swifty:`                |
| `SWIFTY_DOCS_DIR`    | Local docs directory to index                    | `~/.swifty/docs`         |

Both **stdio** (default) and **HTTP** transports are supported — `startHttpServer`
serves the same tools over a streamable HTTP endpoint.

## Getting started

Run from the repository root:

```sh
pnpm install
cp apps/mcp/.env.example apps/mcp/.env   # configure embedding + Redis
pnpm --filter @swifty.js/mcp dev         # build UI + run over stdio
```

| Command                              | Description                  |
| ------------------------------------ | ---------------------------- |
| `pnpm build:mcp` (root)              | Build wasm + marked-terminal |
| `pnpm --filter @swifty.js/mcp build` | Bundle (tsup) + build UI     |
| `pnpm --filter @swifty.js/mcp test`  | Build UI + vitest            |

## Layout

```
mcp/
├── src/
│   ├── main.ts         # stdio/HTTP entrypoint + shutdown
│   ├── server.ts       # MCP server + tool registration
│   ├── http.ts         # streamable HTTP transport
│   ├── shared/         # config (zod) + logger
│   └── tools/
│       ├── search-docs/   # RAG pipeline (chunk/embed/index/retrieve)
│       └── create-app/    # MCP App create tool
└── tests/
```
