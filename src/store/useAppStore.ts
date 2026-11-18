import { create } from 'zustand';
import type {
  ChatMessage,
  ChatStreamMeta,
  EdgeType,
  EvaluationReport,
  FileTreeNode,
  GraphEdge,
  GraphNode,
  NodeDetailsResponse,
  NodeType,
  RepositorySummary,
} from '../types/graph.ts';

interface AppState {
  theme: 'dark' | 'light';
  toggleTheme: () => void;

  repositories: RepositorySummary[];
  activeRepoId: string | null;
  activeRepo: RepositorySummary | null;
  graphNodes: GraphNode[];
  graphEdges: GraphEdge[];
  fileTree: FileTreeNode[];
  loadingGraph: boolean;
  globalError: string | null;

  // Filters & Layout
  searchQuery: string;
  visibleNodeTypes: Record<NodeType, boolean>;
  visibleEdgeTypes: Record<EdgeType, boolean>;
  collapseToModules: boolean;
  layoutDirection: 'LR' | 'TB';

  // Selection & Inspector
  selectedNodeId: string | null;
  focusRequestCounter: number;
  nodeDetails: NodeDetailsResponse | null;
  loadingNodeDetails: boolean;
  bottomOpen: boolean;
  bottomTab: 'source' | 'relationships' | 'logs';
  centerView: 'graph' | 'evaluation';
  ingestModalOpen: boolean;

  // AI Provenance Highlighting
  highlightedNodeIds: string[];
  highlightedEdgeIds: string[];
  seedNodeIds: string[];
  orderedPathNodeIds: string[];
  isHighlightActive: boolean;

  // Chat
  messagesByRepo: Record<string, ChatMessage[]>;
  retrievalMode: 'hybrid-graph-rag' | 'vector-only';
  isStreamingChat: boolean;

  // Evaluation
  evaluationReport: EvaluationReport | null;
  runningEvaluation: boolean;

  // Actions
  setCenterView: (view: 'graph' | 'evaluation') => void;
  setIngestModalOpen: (open: boolean) => void;
  setBottomOpen: (open: boolean) => void;
  setBottomTab: (tab: 'source' | 'relationships' | 'logs') => void;
  setSearchQuery: (q: string) => void;
  toggleNodeTypeFilter: (t: NodeType) => void;
  toggleEdgeTypeFilter: (t: EdgeType) => void;
  setCollapseToModules: (collapsed: boolean) => void;
  setLayoutDirection: (dir: 'LR' | 'TB') => void;
  setRetrievalMode: (mode: 'hybrid-graph-rag' | 'vector-only') => void;
  clearHighlight: () => void;
  applyHighlightMeta: (meta: ChatStreamMeta) => void;

  fetchRepositories: () => Promise<void>;
  selectRepository: (repoId: string) => Promise<void>;
  ingestGitHubRepo: (githubUrl: string) => Promise<boolean>;
  ingestSampleRepo: () => Promise<void>;
  deleteRepository: (repoId: string) => Promise<void>;
  selectNode: (nodeId: string, focusGraph?: boolean) => Promise<void>;
  sendChatQuestion: (question: string) => Promise<void>;
  runEvaluation: () => Promise<void>;
}

let pollTimer: ReturnType<typeof setTimeout> | null = null;

export const useAppStore = create<AppState>((set, get) => ({
  theme: 'dark',
  toggleTheme: () => {
    const next = get().theme === 'dark' ? 'light' : 'dark';
    if (next === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    set({ theme: next });
  },

  repositories: [],
  activeRepoId: null,
  activeRepo: null,
  graphNodes: [],
  graphEdges: [],
  fileTree: [],
  loadingGraph: false,
  globalError: null,

  searchQuery: '',
  visibleNodeTypes: { File: true, Module: true, Class: true, Function: true },
  visibleEdgeTypes: { CALLS: true, EXTENDS: true, IMPORTS: true, CONTAINS: true, DEFINED_IN: false },
  collapseToModules: false,
  layoutDirection: 'LR',

  selectedNodeId: null,
  focusRequestCounter: 0,
  nodeDetails: null,
  loadingNodeDetails: false,
  bottomOpen: true,
  bottomTab: 'source',
  centerView: 'graph',
  ingestModalOpen: false,

  highlightedNodeIds: [],
  highlightedEdgeIds: [],
  seedNodeIds: [],
  orderedPathNodeIds: [],
  isHighlightActive: false,

  messagesByRepo: {},
  retrievalMode: 'hybrid-graph-rag',
  isStreamingChat: false,

  evaluationReport: null,
  runningEvaluation: false,

  setCenterView: (view) => set({ centerView: view }),
  setIngestModalOpen: (open) => set({ ingestModalOpen: open }),
  setBottomOpen: (open) => set({ bottomOpen: open }),
  setBottomTab: (tab) => set({ bottomTab: tab, bottomOpen: true }),
  setSearchQuery: (q) => set({ searchQuery: q }),
  toggleNodeTypeFilter: (t) =>
    set((s) => ({ visibleNodeTypes: { ...s.visibleNodeTypes, [t]: !s.visibleNodeTypes[t] } })),
  toggleEdgeTypeFilter: (t) =>
    set((s) => ({ visibleEdgeTypes: { ...s.visibleEdgeTypes, [t]: !s.visibleEdgeTypes[t] } })),
  setCollapseToModules: (collapsed) => set({ collapseToModules: collapsed }),
  setLayoutDirection: (dir) => set({ layoutDirection: dir }),
  setRetrievalMode: (mode) => set({ retrievalMode: mode }),

  clearHighlight: () =>
    set({
      highlightedNodeIds: [],
      highlightedEdgeIds: [],
      seedNodeIds: [],
      orderedPathNodeIds: [],
      isHighlightActive: false,
    }),

  applyHighlightMeta: (meta) =>
    set({
      highlightedNodeIds: meta.node_ids,
      highlightedEdgeIds: meta.edge_ids,
      seedNodeIds: meta.seed_node_ids,
      orderedPathNodeIds: meta.ordered_path_node_ids,
      isHighlightActive: true,
    }),

  fetchRepositories: async () => {
    try {
      const res = await fetch('/api/repositories');
      const data = (await res.json()) as { repositories: RepositorySummary[] };
      const repos = data.repositories ?? [];
      set({ repositories: repos });

      const currentId = get().activeRepoId;
      if (!currentId && repos.length > 0) {
        const readyRepo = repos.find((r) => r.status === 'ready') ?? repos[0];
        await get().selectRepository(readyRepo.repository_id);
      } else if (currentId) {
        const updated = repos.find((r) => r.repository_id === currentId) ?? null;
        set({ activeRepo: updated });
      }
    } catch (err) {
      set({ globalError: err instanceof Error ? err.message : 'Failed to load repositories' });
    }
  },

  selectRepository: async (repoId: string) => {
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }

    set({
      activeRepoId: repoId,
      loadingGraph: true,
      globalError: null,
      selectedNodeId: null,
      nodeDetails: null,
      highlightedNodeIds: [],
      highlightedEdgeIds: [],
      seedNodeIds: [],
      orderedPathNodeIds: [],
      isHighlightActive: false,
    });

    const checkAndLoad = async () => {
      try {
        const statusRes = await fetch(`/api/repositories/${encodeURIComponent(repoId)}/status`);
        if (!statusRes.ok) throw new Error('Failed to fetch repository status');
        const summary = (await statusRes.json()) as RepositorySummary;

        set((s) => ({
          activeRepo: summary,
          repositories: s.repositories.some((r) => r.repository_id === repoId)
            ? s.repositories.map((r) => (r.repository_id === repoId ? summary : r))
            : [summary, ...s.repositories],
        }));

        if (summary.status === 'processing') {
          pollTimer = setTimeout(checkAndLoad, 900);
          return;
        }

        if (summary.status === 'failed') {
          set({ loadingGraph: false, graphNodes: [], graphEdges: [], fileTree: [], bottomTab: 'logs', bottomOpen: true });
          return;
        }

        const [graphRes, treeRes] = await Promise.all([
          fetch(`/api/repositories/${encodeURIComponent(repoId)}/graph`),
          fetch(`/api/repositories/${encodeURIComponent(repoId)}/tree`),
        ]);
        const graphData = (await graphRes.json()) as { nodes: GraphNode[]; edges: GraphEdge[] };
        const treeData = (await treeRes.json()) as { tree: FileTreeNode[] };

        set({
          graphNodes: graphData.nodes ?? [],
          graphEdges: graphData.edges ?? [],
          fileTree: treeData.tree ?? [],
          loadingGraph: false,
          collapseToModules: (graphData.nodes?.length ?? 0) > 120,
        });
      } catch (err) {
        set({
          loadingGraph: false,
          globalError: err instanceof Error ? err.message : 'Failed to load repository graph',
        });
      }
    };

    await checkAndLoad();
  },

  ingestGitHubRepo: async (githubUrl: string) => {
    set({ globalError: null });
    try {
      const res = await fetch('/api/repositories/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ github_url: githubUrl }),
      });

      const rawText = await res.text();
      let data: {
        repository_id?: string;
        status?: string;
        error?: string;
        repository?: RepositorySummary;
        graph?: { nodes: GraphNode[]; edges: GraphEdge[] };
        tree?: FileTreeNode[];
      } = {};

      try {
        data = JSON.parse(rawText);
      } catch {
        set({
          globalError: `Server returned non-JSON response (HTTP ${res.status}). Check API routing or server logs.`,
        });
        return false;
      }

      if (!res.ok || !data.repository_id) {
        set({ globalError: data.error ?? `Failed to ingest repository (HTTP ${res.status})` });
        return false;
      }

      if (data.status === 'ready' && data.repository && data.graph && data.tree) {
        const repo = data.repository;
        set((s) => ({
          activeRepoId: repo.repository_id,
          activeRepo: repo,
          repositories: [repo, ...s.repositories.filter((r) => r.repository_id !== repo.repository_id)],
          graphNodes: data.graph!.nodes ?? [],
          graphEdges: data.graph!.edges ?? [],
          fileTree: data.tree ?? [],
          loadingGraph: false,
          selectedNodeId: null,
          nodeDetails: null,
          highlightedNodeIds: [],
          highlightedEdgeIds: [],
          seedNodeIds: [],
          orderedPathNodeIds: [],
          isHighlightActive: false,
          collapseToModules: (data.graph!.nodes?.length ?? 0) > 120,
          bottomTab: 'logs',
          bottomOpen: true,
          centerView: 'graph',
          ingestModalOpen: false,
        }));
        return true;
      }

      set({ bottomTab: 'logs', bottomOpen: true, centerView: 'graph' });
      await get().selectRepository(data.repository_id);
      return true;
    } catch (err) {
      set({
        globalError: err instanceof Error ? err.message : 'Network error while ingesting repository',
      });
      return false;
    }
  },

  ingestSampleRepo: async () => {
    set({ globalError: null });
    try {
      const res = await fetch('/api/repositories/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sample: true }),
      });
      const rawText = await res.text();
      const data = JSON.parse(rawText) as {
        repository_id?: string;
        repository?: RepositorySummary;
        graph?: { nodes: GraphNode[]; edges: GraphEdge[] };
        tree?: FileTreeNode[];
        error?: string;
      };
      if (!res.ok) {
        set({ globalError: data.error ?? `Failed to load sample repository (HTTP ${res.status})` });
        return;
      }
      if (data.repository && data.graph && data.tree) {
        const repo = data.repository;
        set((s) => ({
          activeRepoId: repo.repository_id,
          activeRepo: repo,
          repositories: [repo, ...s.repositories.filter((r) => r.repository_id !== repo.repository_id)],
          graphNodes: data.graph!.nodes ?? [],
          graphEdges: data.graph!.edges ?? [],
          fileTree: data.tree ?? [],
          loadingGraph: false,
          centerView: 'graph',
          ingestModalOpen: false,
        }));
        return;
      }
      if (data.repository_id) {
        set({ centerView: 'graph', ingestModalOpen: false });
        await get().selectRepository(data.repository_id);
      }
    } catch (err) {
      set({
        globalError: err instanceof Error ? err.message : 'Failed to reload sample repository',
      });
    }
  },

  deleteRepository: async (repoId: string) => {
    await fetch(`/api/repositories/${encodeURIComponent(repoId)}`, { method: 'DELETE' });
    const remaining = get().repositories.filter((r) => r.repository_id !== repoId);
    set({ repositories: remaining });
    if (get().activeRepoId === repoId) {
      if (remaining.length > 0) {
        await get().selectRepository(remaining[0].repository_id);
      } else {
        set({ activeRepoId: null, activeRepo: null, graphNodes: [], graphEdges: [], fileTree: [] });
      }
    }
  },

  selectNode: async (nodeId: string, focusGraph = true) => {
    const repoId = get().activeRepoId;
    if (!repoId) return;

    set((s) => ({
      selectedNodeId: nodeId,
      focusRequestCounter: focusGraph ? s.focusRequestCounter + 1 : s.focusRequestCounter,
      loadingNodeDetails: true,
      bottomOpen: true,
    }));

    try {
      const res = await fetch(
        `/api/repositories/${encodeURIComponent(repoId)}/nodes/${encodeURIComponent(nodeId)}`,
      );
      if (!res.ok) throw new Error('Node details not found on server');
      const details = (await res.json()) as NodeDetailsResponse;
      set({ nodeDetails: details, loadingNodeDetails: false });
    } catch {
      // Fallback to in-memory client graph if serverless container cold-started
      const nodes = get().graphNodes;
      const edges = get().graphEdges;
      const nodeMap = new Map(nodes.map((n) => [n.id, n]));
      const node = nodeMap.get(nodeId);
      if (node) {
        const incoming = edges
          .filter((e) => e.target === nodeId && nodeMap.has(e.source))
          .map((edge) => ({ edge, node: nodeMap.get(edge.source)! }));
        const outgoing = edges
          .filter((e) => e.source === nodeId && nodeMap.has(e.target))
          .map((edge) => ({ edge, node: nodeMap.get(edge.target)! }));
        const source_lines = (node.code_snippet ?? '').split('\n').map((content, idx) => ({
          line_number: node.start_line + idx,
          content,
        }));
        set({
          nodeDetails: { node, incoming, outgoing, source_lines },
          loadingNodeDetails: false,
        });
      } else {
        set({ loadingNodeDetails: false });
      }
    }
  },

  sendChatQuestion: async (question: string) => {
    const repoId = get().activeRepoId;
    const mode = get().retrievalMode;
    if (!repoId || !question.trim() || get().isStreamingChat) return;

    const userMsg: ChatMessage = {
      id: `msg_${Date.now()}_u`,
      role: 'user',
      content: question.trim(),
      timestamp: new Date().toISOString(),
    };

    const assistantId = `msg_${Date.now()}_a`;
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
      isStreaming: true,
    };

    set((s) => ({
      isStreamingChat: true,
      centerView: 'graph',
      messagesByRepo: {
        ...s.messagesByRepo,
        [repoId]: [...(s.messagesByRepo[repoId] ?? []), userMsg, assistantMsg],
      },
    }));

    const updateAssistant = (updater: (m: ChatMessage) => ChatMessage) => {
      set((s) => ({
        messagesByRepo: {
          ...s.messagesByRepo,
          [repoId]: (s.messagesByRepo[repoId] ?? []).map((m) => (m.id === assistantId ? updater(m) : m)),
        },
      }));
    };

    try {
      const fallback_graph =
        repoId !== 'repo_shopflow_sample'
          ? { nodes: get().graphNodes, edges: get().graphEdges }
          : undefined;
      const res = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repository_id: repoId,
          question: question.trim(),
          mode,
          fallback_graph,
        }),
      });

      if (!res.ok || !res.body) {
        throw new Error(`Chat request failed with HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';

        for (const frame of frames) {
          const lines = frame.split('\n');
          let eventName = 'message';
          let dataStr = '';
          for (const line of lines) {
            if (line.startsWith('event:')) eventName = line.slice(6).trim();
            else if (line.startsWith('data:')) dataStr += line.slice(5).trim();
          }
          if (!dataStr) continue;

          try {
            const payload = JSON.parse(dataStr);
            if (eventName === 'retrieval_meta') {
              const meta = payload as ChatStreamMeta;
              get().applyHighlightMeta(meta);
              updateAssistant((m) => ({ ...m, meta }));
            } else if (eventName === 'answer_delta') {
              updateAssistant((m) => ({ ...m, content: m.content + (payload.text ?? '') }));
            } else if (eventName === 'error') {
              updateAssistant((m) => ({ ...m, error: payload.message ?? 'Streaming error', isStreaming: false }));
            } else if (eventName === 'done') {
              updateAssistant((m) => ({ ...m, isStreaming: false }));
            }
          } catch {
            // Ignore malformed partial SSE chunk
          }
        }
      }

      updateAssistant((m) => ({ ...m, isStreaming: false }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Connection interrupted';
      updateAssistant((m) => ({ ...m, error: msg, isStreaming: false }));
    } finally {
      set({ isStreamingChat: false });
    }
  },

  runEvaluation: async () => {
    set({ runningEvaluation: true });
    try {
      const res = await fetch('/api/evaluation/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repository_id: get().activeRepoId }),
      });
      if (!res.ok) throw new Error('Evaluation failed');
      const report = (await res.json()) as EvaluationReport;
      set({ evaluationReport: report, runningEvaluation: false });
    } catch (err) {
      set({
        runningEvaluation: false,
        globalError: err instanceof Error ? err.message : 'Evaluation failed',
      });
    }
  },
}));
