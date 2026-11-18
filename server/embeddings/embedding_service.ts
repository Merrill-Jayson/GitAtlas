import type { GraphNode } from '../../src/types/graph.ts';
import { DEFAULT_EMBEDDING_MODEL, getGeminiClient } from '../llm/gemini_client.ts';

export interface VectorRecord {
  nodeId: string;
  embedding: number[];
}

export interface RepoVectorIndex {
  provider: 'gemini-embedding-2' | 'lexical-fallback';
  vectors: Map<string, number[]>;
}

const vectorStore = new Map<string, RepoVectorIndex>();

export function buildEntityEmbeddingText(node: GraphNode): string {
  const parts = [
    `${node.type}: ${node.name}`,
    `File: ${node.file_path}:${node.start_line}-${node.end_line}`,
    node.signature ? `Signature: ${node.signature}` : '',
    node.docstring ? `Docstring: ${node.docstring}` : '',
    node.parent_classes?.length ? `Inherits: ${node.parent_classes.join(', ')}` : '',
    node.code_snippet ? `Code:\n${node.code_snippet.slice(0, 1200)}` : '',
  ];
  return parts.filter(Boolean).join('\n');
}

function deterministicLexicalVector(text: string, dims = 128): number[] {
  const vec = new Float64Array(dims);
  const tokens = text
    .toLowerCase()
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length >= 2);

  for (const tok of tokens) {
    let hash = 2166136261;
    for (let i = 0; i < tok.length; i++) {
      hash ^= tok.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    const idx = Math.abs(hash) % dims;
    vec[idx] += 1;
  }

  let norm = 0;
  for (let i = 0; i < dims; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;
  return Array.from(vec, (v) => v / norm);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

export async function indexRepositoryEmbeddings(
  repositoryId: string,
  nodes: GraphNode[],
  onProgress?: (done: number, total: number, provider: string) => void,
): Promise<RepoVectorIndex> {
  const ai = getGeminiClient();
  const vectors = new Map<string, number[]>();
  const targetNodes = nodes.filter((n) => n.type === 'Function' || n.type === 'Class' || n.type === 'Module' || n.type === 'File');

  if (!ai) {
    for (let i = 0; i < targetNodes.length; i++) {
      const node = targetNodes[i];
      vectors.set(node.id, deterministicLexicalVector(buildEntityEmbeddingText(node)));
    }
    const index: RepoVectorIndex = { provider: 'lexical-fallback', vectors };
    vectorStore.set(repositoryId, index);
    onProgress?.(targetNodes.length, targetNodes.length, 'lexical-fallback');
    return index;
  }

  let provider: 'gemini-embedding-2' | 'lexical-fallback' = 'gemini-embedding-2';
  const batchSize = 20;

  for (let i = 0; i < targetNodes.length; i += batchSize) {
    const batch = targetNodes.slice(i, i + batchSize);
    const texts = batch.map(buildEntityEmbeddingText);
    try {
      const res = await ai.models.embedContent({
        model: DEFAULT_EMBEDDING_MODEL,
        contents: texts,
      });
      const embeddings = res.embeddings ?? [];
      for (let j = 0; j < batch.length; j++) {
        const vals = embeddings[j]?.values;
        if (vals && vals.length > 0) {
          vectors.set(batch[j].id, vals);
        } else {
          vectors.set(batch[j].id, deterministicLexicalVector(texts[j]));
        }
      }
    } catch {
      provider = 'lexical-fallback';
      for (let j = 0; j < batch.length; j++) {
        vectors.set(batch[j].id, deterministicLexicalVector(texts[j]));
      }
    }
    onProgress?.(Math.min(i + batch.length, targetNodes.length), targetNodes.length, provider);
  }

  const index: RepoVectorIndex = { provider, vectors };
  vectorStore.set(repositoryId, index);
  return index;
}

export function loadRepositoryVectors(repositoryId: string, index: RepoVectorIndex): void {
  vectorStore.set(repositoryId, index);
}

export function getRepositoryVectors(repositoryId: string): RepoVectorIndex | undefined {
  return vectorStore.get(repositoryId);
}

export function deleteRepositoryVectors(repositoryId: string): void {
  vectorStore.delete(repositoryId);
}

export async function embedQuery(
  query: string,
  preferredProvider: 'gemini-embedding-2' | 'lexical-fallback',
): Promise<number[]> {
  const ai = getGeminiClient();
  if (!ai || preferredProvider === 'lexical-fallback') {
    return deterministicLexicalVector(query);
  }
  try {
    const res = await ai.models.embedContent({
      model: DEFAULT_EMBEDDING_MODEL,
      contents: [query],
    });
    const vals = res.embeddings?.[0]?.values;
    if (vals && vals.length > 0) return vals;
  } catch {
    // Fall back to deterministic vector matching stored vectors if API throttles
  }
  return deterministicLexicalVector(query);
}
