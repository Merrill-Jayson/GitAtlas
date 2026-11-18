import 'dotenv/config';
import express, { type Express } from 'express';
import type { GraphEdge, GraphNode } from '../src/types/graph.ts';
import { streamChatAnswer } from './chat/chat_service.ts';
import { runRepositoryEvaluation } from './evaluation/eval_service.ts';
import { graphStore } from './graph/graph_store.ts';
import {
  deleteRepositoryData,
  ensureSampleRepositoryReady,
  getRepositoryStatus,
  getRepositoryTree,
  getSourceLines,
  hydratePersistedRepositories,
  listRepositories,
  rehydrateRepositoryFromGraph,
  startGitHubIngestion,
} from './ingestion/ingest_service.ts';
import { DEFAULT_CHAT_MODEL, getGeminiClient } from './llm/gemini_client.ts';
import { retrieveCodeContext } from './retrieval/hybrid_retriever.ts';

let initPromise: Promise<void> | null = null;

export async function ensureBackendInitialized(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      hydratePersistedRepositories();
      if (listRepositories().length === 0) {
        await ensureSampleRepositoryReady();
      }
    })();
  }
  await initPromise;
}

export function createApiApp(): Express {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // Ensure sample repo / persisted repos are ready even on serverless cold starts
  app.use('/api', async (_req, _res, next) => {
    try {
      await ensureBackendInitialized();
      next();
    } catch (err) {
      next(err);
    }
  });

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
    const body = req.body as { github_url?: string; sample?: boolean; async?: boolean };
    if (body?.sample) {
      const sample = await ensureSampleRepositoryReady();
      const serialized = graphStore.serialize(sample.repository_id);
      res.json({
        repository_id: sample.repository_id,
        status: sample.status,
        message: sample.message,
        repository: sample,
        graph: { nodes: serialized.nodes, edges: serialized.edges },
        tree: getRepositoryTree(sample.repository_id),
      });
      return;
    }

    const githubUrl = body?.github_url ?? '';
    // Run inline by default unless caller explicitly requests async background mode (and not on Vercel)
    const isServerless = Boolean(process.env.VERCEL === '1' || process.env.VERCEL_ENV);
    const waitForCompletion = isServerless || body?.async !== true;

    const result = await startGitHubIngestion(githubUrl, { waitForCompletion });
    if (result.error || !result.summary) {
      res.status(400).json({ error: result.error ?? 'Failed to ingest repository.' });
      return;
    }

    if (waitForCompletion) {
      res.status(200).json({
        repository_id: result.summary.repository_id,
        status: result.summary.status,
        message: result.summary.message,
        repository: result.summary,
        graph: result.graph,
        tree: result.tree,
      });
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

    const fallbackLines =
      src?.lines && src.lines.length > 0
        ? src.lines
        : (node.code_snippet ?? '').split('\n').map((content, idx) => ({
            line_number: node.start_line + idx,
            content,
          }));

    res.json({
      node,
      incoming,
      outgoing,
      source_lines: fallbackLines,
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
    const { repository_id, question, mode, fallback_graph } = req.body as {
      repository_id?: string;
      question?: string;
      mode?: 'hybrid-graph-rag' | 'vector-only';
      fallback_graph?: { nodes: GraphNode[]; edges: GraphEdge[] };
    };

    if (!repository_id || !question?.trim()) {
      res.status(400).json({ error: 'repository_id and question are required' });
      return;
    }

    if (!graphStore.hasRepository(repository_id) && fallback_graph?.nodes?.length) {
      await rehydrateRepositoryFromGraph(repository_id, fallback_graph.nodes, fallback_graph.edges ?? []);
    }

    await streamChatAnswer(res, repository_id, question.trim(), mode ?? 'hybrid-graph-rag');
  });

  app.post('/api/chat', async (req, res) => {
    const { repository_id, question, mode, fallback_graph } = req.body as {
      repository_id?: string;
      question?: string;
      mode?: 'hybrid-graph-rag' | 'vector-only';
      fallback_graph?: { nodes: GraphNode[]; edges: GraphEdge[] };
    };

    if (!repository_id || !question?.trim()) {
      res.status(400).json({ error: 'repository_id and question are required' });
      return;
    }

    try {
      if (!graphStore.hasRepository(repository_id) && fallback_graph?.nodes?.length) {
        await rehydrateRepositoryFromGraph(repository_id, fallback_graph.nodes, fallback_graph.edges ?? []);
      }

      const retrieval = await retrieveCodeContext(repository_id, question.trim(), {
        mode: mode ?? 'hybrid-graph-rag',
        topSeeds: 5,
        maxHops: 2,
        maxNodes: 24,
      });

      const ai = getGeminiClient();
      if (!ai) {
        res.status(503).json({
          error: 'GEMINI_API_KEY is not configured in server environment secrets.',
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

  return app;
}
