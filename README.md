# GitAtlas — AI-Powered Graph-RAG Codebase Visualizer & Explainer

> Navigating Complex Software Ecosystems Through Hybrid Knowledge Graphs and Semantic Retrieval.

GitAtlas ingests public GitHub repositories (or the included multi-module Python sample repository `shopflow_api`), parses source files into an AST knowledge graph, generates per-node embeddings, and lets developers ask architectural questions with **live SSE streaming** and **synchronized visual graph provenance**.

## Architecture

- **Frontend**: React 19, TypeScript, Tailwind CSS v4, React Flow (`@xyflow/react`), Dagre (`@dagrejs/dagre`), Zustand, Lucide React.
- **Backend**: Express (`server.ts`) on port `3000` with Vite middleware in development, plus modular backend engines under `server/`:
  - `server/parser/py_ast_parser.py`: Python 3 stdlib `ast` static analyzer extracting `File`, `Module`, `Class`, and `Function` entities plus `CONTAINS`, `DEFINED_IN`, `IMPORTS`, `EXTENDS`, and `CALLS` edges (and flagging dynamic reflection such as `getattr` as `uncertain: true`).
  - `server/parser/ts_js_parser.ts`: TypeScript compiler API AST parser for `.ts`, `.tsx`, `.js`, `.jsx` files.
  - `server/graph/graph_store.ts`: `IGraphStore` property graph abstraction (`PropertyGraphStore` in-memory directed multigraph + JSON persistence, alongside `Neo4jGraphStoreAdapter` boundary).
  - `server/embeddings/embedding_service.ts`: Per-node embeddings via Gemini (`gemini-embedding-2`) with deterministic lexical fallback if unconfigured.
  - `server/retrieval/`: BM25 Okapi lexical search + Vector cosine similarity + Reciprocal Rank Fusion (RRF) + configurable N-hop graph expansion.
  - `server/chat/chat_service.ts`: Grounded SSE streaming explanations via `gemini-4-hydrogen` (`@google/genai`) emitting `retrieval_meta` (`node_ids`, `edge_ids`, `ordered_path_node_ids`, `citations`, `retrieval_scores`) and `answer_delta` chunks.
  - `server/evaluation/eval_service.ts`: Live benchmark runner comparing Hybrid Graph-RAG against a Vector-Only baseline.

> **Environment Note**: Because this workspace runs Node.js 22 without `pip`, the Express server executes Python's built-in `ast` module directly via `python3` subprocess (`server/parser/py_ast_parser.py`) while exposing the full Graph-RAG REST & SSE contract on port `3000`.

## Running Locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Running Verification Tests

```bash
npx tsx tests/test_graph_rag.ts
```

## Docker

```bash
GEMINI_API_KEY=your_key docker compose up --build
```
