import type {
  CitationItem,
  EdgeType,
  GraphEdge,
  GraphNode,
  RetrievalScoreDetail,
} from '../../src/types/graph.ts';
import {
  cosineSimilarity,
  embedQuery,
  getRepositoryVectors,
} from '../embeddings/embedding_service.ts';
import { graphStore } from '../graph/graph_store.ts';
import { BM25Index } from './bm25.ts';

export interface HybridRetrievalOptions {
  topSeeds?: number;
  maxHops?: number;
  maxNodes?: number;
  allowedEdgeTypes?: EdgeType[];
  mode?: 'hybrid-graph-rag' | 'vector-only';
}

export interface HybridRetrievalResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  seedNodeIds: string[];
  orderedPathNodeIds: string[];
  citations: CitationItem[];
  scores: RetrievalScoreDetail[];
  retrievalMode: 'hybrid-graph-rag' | 'vector-only';
  embeddingProvider: 'gemini-embedding-2' | 'lexical-fallback';
}

const bm25Cache = new Map<string, BM25Index>();

export function buildBm25Index(repositoryId: string, nodes: GraphNode[]): void {
  bm25Cache.set(repositoryId, new BM25Index(nodes));
}

export function deleteBm25Index(repositoryId: string): void {
  bm25Cache.delete(repositoryId);
}

export async function retrieveCodeContext(
  repositoryId: string,
  query: string,
  options: HybridRetrievalOptions = {},
): Promise<HybridRetrievalResult> {
  const allNodes = graphStore.getAllNodes(repositoryId);
  if (allNodes.length === 0) {
    return {
      nodes: [],
      edges: [],
      seedNodeIds: [],
      orderedPathNodeIds: [],
      citations: [],
      scores: [],
      retrievalMode: options.mode ?? 'hybrid-graph-rag',
      embeddingProvider: 'lexical-fallback',
    };
  }

  let bm25 = bm25Cache.get(repositoryId);
  if (!bm25) {
    bm25 = new BM25Index(allNodes);
    bm25Cache.set(repositoryId, bm25);
  }

  const vectorIndex = getRepositoryVectors(repositoryId);
  const embeddingProvider = vectorIndex?.provider ?? 'lexical-fallback';
  const queryVec = await embedQuery(query, embeddingProvider);

  // 1. Vector similarity ranking
  const vectorHits: Array<{ nodeId: string; score: number }> = [];
  if (vectorIndex) {
    for (const node of allNodes) {
      const vec = vectorIndex.vectors.get(node.id);
      if (!vec) continue;
      const sim = cosineSimilarity(queryVec, vec);
      vectorHits.push({ nodeId: node.id, score: sim });
    }
    vectorHits.sort((a, b) => b.score - a.score);
  }

  const mode = options.mode ?? 'hybrid-graph-rag';
  const topSeedsCount = options.topSeeds ?? 5;

  if (mode === 'vector-only') {
    const topVector = vectorHits.slice(0, topSeedsCount);
    const nodes = topVector
      .map((h) => graphStore.getNode(repositoryId, h.nodeId)!)
      .filter(Boolean);
    const nodeSet = new Set(nodes.map((n) => n.id));
    const edges = graphStore
      .getAllEdges(repositoryId)
      .filter((e) => nodeSet.has(e.source) && nodeSet.has(e.target));

    const scores: RetrievalScoreDetail[] = topVector.map((h) => {
      const n = graphStore.getNode(repositoryId, h.nodeId)!;
      return {
        node_id: n.id,
        name: n.name,
        type: n.type,
        file_path: n.file_path,
        start_line: n.start_line,
        end_line: n.end_line,
        bm25_score: 0,
        vector_score: Number(h.score.toFixed(4)),
        rrf_score: Number(h.score.toFixed(4)),
        hop_distance: 0,
        is_seed: true,
      };
    });

    return {
      nodes,
      edges,
      seedNodeIds: nodes.map((n) => n.id),
      orderedPathNodeIds: nodes.map((n) => n.id),
      citations: nodes.map((n) => ({
        node_id: n.id,
        name: n.name,
        type: n.type,
        file_path: n.file_path,
        start_line: n.start_line,
        end_line: n.end_line,
      })),
      scores,
      retrievalMode: 'vector-only',
      embeddingProvider,
    };
  }

  // 2. BM25 lexical ranking
  const bm25Hits = bm25.search(query, 25);

  // 3. Reciprocal Rank Fusion (RRF)
  const rrfK = 60;
  const bm25Rank = new Map<string, number>();
  const bm25ScoreMap = new Map<string, number>();
  bm25Hits.forEach((h, idx) => {
    bm25Rank.set(h.nodeId, idx + 1);
    bm25ScoreMap.set(h.nodeId, h.score);
  });

  const vecRank = new Map<string, number>();
  const vecScoreMap = new Map<string, number>();
  vectorHits.slice(0, 30).forEach((h, idx) => {
    vecRank.set(h.nodeId, idx + 1);
    vecScoreMap.set(h.nodeId, h.score);
  });

  const candidateIds = new Set<string>([...bm25Rank.keys(), ...vecRank.keys()]);
  const fused: Array<{ nodeId: string; rrf: number }> = [];

  for (const nodeId of candidateIds) {
    const node = graphStore.getNode(repositoryId, nodeId);
    if (!node) continue;
    let rrf = 0;
    const br = bm25Rank.get(nodeId);
    const vr = vecRank.get(nodeId);
    if (br !== undefined) rrf += 1 / (rrfK + br);
    if (vr !== undefined) rrf += 1 / (rrfK + vr);

    // Slight preference for specific code units (Function / Class) over broad File containers as seeds
    if (node.type === 'Function' || node.type === 'Class') {
      rrf *= 1.15;
    }
    fused.push({ nodeId, rrf });
  }

  fused.sort((a, b) => b.rrf - a.rrf);
  const seedNodeIds = fused.slice(0, topSeedsCount).map((f) => f.nodeId);

  // 4. Graph N-hop traversal expansion
  const traversed = graphStore.traverseNHops(repositoryId, seedNodeIds, {
    maxHops: options.maxHops ?? 2,
    maxNodes: options.maxNodes ?? 24,
    allowedEdgeTypes: options.allowedEdgeTypes ?? ['CALLS', 'EXTENDS', 'IMPORTS', 'CONTAINS', 'DEFINED_IN'],
    direction: 'both',
  });

  const rrfMap = new Map(fused.map((f) => [f.nodeId, f.rrf]));
  const seedSet = new Set(seedNodeIds);

  const scores: RetrievalScoreDetail[] = traversed.nodes
    .map((n) => ({
      node_id: n.id,
      name: n.name,
      type: n.type,
      file_path: n.file_path,
      start_line: n.start_line,
      end_line: n.end_line,
      bm25_score: Number((bm25ScoreMap.get(n.id) ?? 0).toFixed(4)),
      vector_score: Number((vecScoreMap.get(n.id) ?? 0).toFixed(4)),
      rrf_score: Number((rrfMap.get(n.id) ?? 0).toFixed(5)),
      hop_distance: traversed.hopDistance.get(n.id) ?? 0,
      is_seed: seedSet.has(n.id),
    }))
    .sort((a, b) => a.hop_distance - b.hop_distance || b.rrf_score - a.rrf_score);

  const citations: CitationItem[] = traversed.nodes
    .filter((n) => n.type === 'Function' || n.type === 'Class' || seedSet.has(n.id))
    .slice(0, 14)
    .map((n) => ({
      node_id: n.id,
      name: n.name,
      type: n.type,
      file_path: n.file_path,
      start_line: n.start_line,
      end_line: n.end_line,
    }));

  return {
    nodes: traversed.nodes,
    edges: traversed.edges,
    seedNodeIds,
    orderedPathNodeIds: traversed.orderedPathNodeIds,
    citations,
    scores,
    retrievalMode: 'hybrid-graph-rag',
    embeddingProvider,
  };
}
