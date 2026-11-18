export type NodeType = 'File' | 'Module' | 'Class' | 'Function';

export type EdgeType = 'CALLS' | 'IMPORTS' | 'EXTENDS' | 'CONTAINS' | 'DEFINED_IN';

export type IngestionStage =
  | 'validation'
  | 'download'
  | 'discovery'
  | 'parsing'
  | 'graph'
  | 'embeddings'
  | 'complete'
  | 'failed';

export interface GraphNode {
  id: string;
  type: NodeType;
  name: string;
  file_path: string;
  start_line: number;
  end_line: number;
  signature: string;
  docstring: string;
  language: string;
  module?: string;
  parent_classes?: string[];
  parameters?: string[];
  return_type?: string;
  code_snippet?: string;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: EdgeType;
  uncertain?: boolean;
  reason?: string;
}

export interface FileTreeNode {
  name: string;
  path: string;
  type: 'directory' | 'file';
  language?: string;
  children?: FileTreeNode[];
  entities?: Array<{
    id: string;
    name: string;
    type: NodeType;
    start_line: number;
    end_line: number;
  }>;
}

export interface RepositorySummary {
  repository_id: string;
  name: string;
  source_type: 'github' | 'sample';
  github_url?: string;
  status: 'processing' | 'ready' | 'failed';
  stage: IngestionStage;
  progress: number;
  message: string;
  error?: string;
  file_count: number;
  node_count: number;
  edge_count: number;
  languages: Record<string, number>;
  created_at: string;
  logs: Array<{
    timestamp: string;
    stage: IngestionStage;
    message: string;
    level: 'info' | 'warn' | 'error';
  }>;
}

export interface GraphPayload {
  repository_id: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface NodeDetailsResponse {
  node: GraphNode;
  incoming: Array<{ edge: GraphEdge; node: GraphNode }>;
  outgoing: Array<{ edge: GraphEdge; node: GraphNode }>;
  source_lines: Array<{ line_number: number; content: string }>;
}

export interface RetrievalScoreDetail {
  node_id: string;
  name: string;
  type: NodeType;
  file_path: string;
  start_line: number;
  end_line: number;
  bm25_score: number;
  vector_score: number;
  rrf_score: number;
  hop_distance: number;
  is_seed: boolean;
}

export interface CitationItem {
  node_id: string;
  name: string;
  type: NodeType;
  file_path: string;
  start_line: number;
  end_line: number;
}

export interface ChatStreamMeta {
  node_ids: string[];
  edge_ids: string[];
  seed_node_ids: string[];
  ordered_path_node_ids: string[];
  citations: CitationItem[];
  retrieval_scores: RetrievalScoreDetail[];
  retrieval_mode: 'hybrid-graph-rag' | 'vector-only';
  embedding_provider: 'gemini-embedding-2' | 'lexical-fallback';
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  isStreaming?: boolean;
  error?: string;
  meta?: ChatStreamMeta;
}

export interface EvaluationCaseResult {
  id: string;
  question: string;
  expected_nodes: string[];
  hybrid_recall: number;
  vector_recall: number;
  hybrid_found_nodes: string[];
  vector_found_nodes: string[];
  hybrid_subgraph_size: number;
  vector_subgraph_size: number;
  multi_hop_connected: boolean;
  citation_accuracy: number;
  latency_ms: number;
}

export interface EvaluationReport {
  repository_id: string;
  repository_name: string;
  ran_at: string;
  summary: {
    total_cases: number;
    avg_hybrid_recall: number;
    avg_vector_recall: number;
    avg_citation_accuracy: number;
    multi_hop_connection_rate: number;
  };
  cases: EvaluationCaseResult[];
}
