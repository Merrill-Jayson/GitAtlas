import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { streamChatAnswer } from './server/chat/chat_service.ts';
import { runRepositoryEvaluation } from './server/evaluation/eval_service.ts';
import { graphStore } from './server/graph/graph_store.ts';
import {
  deleteRepositoryData,
  ensureSampleRepositoryReady,
  getRepositoryStatus,
  getRepositoryTree,
  getSourceLines,
  hydratePersistedRepositories,
  listRepositories,
  startGitHubIngestion,
} from './server/ingestion/ingest_service.ts';
import { DEFAULT_CHAT_MODEL, getGeminiClient } from './server/llm/gemini_client.ts';
import { retrieveCodeContext } from './server/retrieval/hybrid_retriever.ts';

const PORT = Number(process.env.PORT ?? 3000);

async function bootstrap() {
  hydratePersistedRepositories();
  if (listRepositories().length === 0) {
    await ensureSampleRepositoryReady();
  }

  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      gemini_configured: Boolean(getGeminiClient()),
      repositories: listRepositories().length,
    });
  });

  app.get('/api/repositories', (_req, res) => {
    res.json({ repositories: listRepositories() });
  });

  app.post('/api/repositories/ingest', async (req, res) => {
    const body = req.body as { github_url?: string; sample?: boolean };
    if (body?.sample) {
      const sample = await ensureSampleRepositoryReady();
      res.json({
        repository_id: sample.repository_id,
        status: sample.status,
        message: sample.message,
      });
      return;
    }

    const githubUrl = body?.github_url ?? '';
    const result = await startGitHubIngestion(githubUrl);
    if (result.error || !result.summary) {
      res.status(400).json({ error: result.error ?? 'Failed to start ingestion.' });
      return;
    }

    res.status(202).json({
      repository_id: result.summary.repository_id,
      status: result.summary.status,
      message: 'Repository ingestion started',
    });
  });

  app.get('/api/repositories/:repository_id/status', (req, res) => {
    const summary = getRepositoryStatus(req.params.repository_id);
    if (!summary) {
      res.status(404).json({ error: 'Repository not found' });
      return;
    }
    res.json(summary);
  });

  app.get('/api/repositories/:repository_id/graph', (req, res) => {
    const repoId = req.params.repository_id;
    if (!graphStore.hasRepository(repoId)) {
      res.status(404).json({ error: 'Graph not indexed for repository' });
      return;
    }
    res.json(graphStore.serialize(repoId));
  });

  app.get('/api/repositories/:repository_id/tree', (req, res) => {
    const repoId = req.params.repository_id;
    if (!getRepositoryStatus(repoId)) {
      res.status(404).json({ error: 'Repository not found' });
      return;
    }
    res.json({ repository_id: repoId, tree: getRepositoryTree(repoId) });
  });

  app.delete('/api/repositories/:repository_id', (req, res) => {
    const deleted = deleteRepositoryData(req.params.repository_id);
    if (!deleted) {
      res.status(404).json({ error: 'Repository not found' });
      return;
    }
    res.json({ deleted: true, repository_id: req.params.repository_id });
  });

  app.get('/api/repositories/:repository_id/nodes/:node_id', (req, res) => {
    const repoId = req.params.repository_id;
    const nodeId = decodeURIComponent(req.params.node_id);
    const node = graphStore.getNode(repoId, nodeId);
    if (!node) {
      res.status(404).json({ error: `Node ${nodeId} not found` });
      return;
    }
    const neighbors = graphStore.getNeighbors(repoId, nodeId);
    const incoming = neighbors.filter((n) => n.direction === 'incoming').map(({ edge, node: n }) => ({ edge, node: n }));
    const outgoing = neighbors.filter((n) => n.direction === 'outgoing').map(({ edge, node: n }) => ({ edge, node: n }));
    const src = getSourceLines(repoId, node.file_path, node.start_line, node.end_line);

    res.json({
      node,
      incoming,
      outgoing,
      source_lines: src?.lines ?? [],
    });
  });

  app.get('/api/repositories/:repository_id/nodes/:node_id/neighbors', (req, res) => {
    const repoId = req.params.repository_id;
    const nodeId = decodeURIComponent(req.params.node_id);
    const node = graphStore.getNode(repoId, nodeId);
    if (!node) {
      res.status(404).json({ error: `Node ${nodeId} not found` });
      return;
    }
    const neighbors = graphStore.getNeighbors(repoId, nodeId);
    res.json({ node, neighbors });
  });

  app.get('/api/repositories/:repository_id/source', (req, res) => {
    const repoId = req.params.repository_id;
    const filePath = String(req.query.file_path ?? '');
    const startLine = req.query.start_line ? Number(req.query.start_line) : undefined;
    const endLine = req.query.end_line ? Number(req.query.end_line) : undefined;

    if (!filePath) {
      res.status(400).json({ error: 'file_path query parameter is required' });
      return;
    }
    const result = getSourceLines(repoId, filePath, startLine, endLine);
    if (!result) {
      res.status(404).json({ error: 'Source file not found or path outside repository root' });
      return;
    }
    res.json({ file_path: filePath, ...result });
  });

  app.post('/api/chat/stream', async (req, res) => {
    const { repository_id, question, mode } = req.body as {
      repository_id?: string;
      question?: string;
      mode?: 'hybrid-graph-rag' | 'vector-only';
    };

    if (!repository_id || !question?.trim()) {
      res.status(400).json({ error: 'repository_id and question are required' });
      return;
    }

    await streamChatAnswer(res, repository_id, question.trim(), mode ?? 'hybrid-graph-rag');
  });

  app.post('/api/chat', async (req, res) => {
    const { repository_id, question, mode } = req.body as {
      repository_id?: string;
      question?: string;
      mode?: 'hybrid-graph-rag' | 'vector-only';
    };

    if (!repository_id || !question?.trim()) {
      res.status(400).json({ error: 'repository_id and question are required' });
      return;
    }

    try {
      const retrieval = await retrieveCodeContext(repository_id, question.trim(), {
        mode: mode ?? 'hybrid-graph-rag',
        topSeeds: 5,
        maxHops: 2,
        maxNodes: 24,
      });

      const ai = getGeminiClient();
      if (!ai) {
        res.status(503).json({
          error: 'GEMINI_API_KEY is not configured in server secrets.',
          node_ids: retrieval.nodes.map((n) => n.id),
          edge_ids: retrieval.edges.map((e) => e.id),
        });
        return;
      }

      const contextText = retrieval.nodes
        .map((n) => `[${n.id}] ${n.file_path}:${n.start_line}-${n.end_line}\n${n.signature}\n${n.code_snippet ?? ''}`)
        .join('\n\n');

      const response = await ai.models.generateContent({
        model: DEFAULT_CHAT_MODEL,
        contents: `Repository Context:\n${contextText}\n\nQuestion: ${question}`,
        config: {
          systemInstruction:
            'Answer using only the provided repository context. Cite file paths, line numbers, and exact node IDs in backticks.',
        },
      });

      res.json({
        answer: response.text ?? '',
        node_ids: retrieval.nodes.map((n) => n.id),
        edge_ids: retrieval.edges.map((e) => e.id),
        citations: retrieval.citations,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Chat error' });
    }
  });

  app.post('/api/evaluation/run', async (req, res) => {
    try {
      const { repository_id } = (req.body ?? {}) as { repository_id?: string };
      const report = await runRepositoryEvaluation(repository_id);
      res.json(report);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Evaluation failed' });
    }
  });

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build output not found. Run npm run build.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`GitAtlas Graph-RAG server running at http://0.0.0.0:${PORT}`);
  });
}

bootstrap().catch((err) => {
  console.error('Fatal server bootstrap error:', err);
  process.exit(1);
});
