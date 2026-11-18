import type { GraphNode } from '../../src/types/graph.ts';

export function tokenizeCode(text: string): string[] {
  const splitIdentifiers = text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[._/:()-]/g, ' ');
  const rawTokens = splitIdentifiers.toLowerCase().split(/\s+/).filter(Boolean);
  const exactIdentifiers = text.toLowerCase().match(/[a-z_][a-z0-9_]{2,}/g) ?? [];
  return [...rawTokens, ...exactIdentifiers].filter((t) => t.length >= 2);
}

export interface BM25Hit {
  nodeId: string;
  score: number;
}

export class BM25Index {
  private docs: Array<{ nodeId: string; tf: Map<string, number>; len: number }> = [];
  private df = new Map<string, number>();
  private avgdl = 1;
  private k1 = 1.5;
  private b = 0.75;

  constructor(nodes: GraphNode[]) {
    let totalLen = 0;
    for (const node of nodes) {
      const searchable = [
        node.name,
        node.name,
        node.signature,
        node.docstring,
        node.file_path,
        node.code_snippet ?? '',
      ].join(' ');
      const tokens = tokenizeCode(searchable);
      const tf = new Map<string, number>();
      for (const t of tokens) {
        tf.set(t, (tf.get(t) ?? 0) + 1);
      }
      for (const term of tf.keys()) {
        this.df.set(term, (this.df.get(term) ?? 0) + 1);
      }
      this.docs.push({ nodeId: node.id, tf, len: tokens.length });
      totalLen += tokens.length;
    }
    this.avgdl = this.docs.length > 0 ? totalLen / this.docs.length : 1;
  }

  search(query: string, limit = 15): BM25Hit[] {
    const qTokens = tokenizeCode(query);
    const N = this.docs.length;
    if (N === 0 || qTokens.length === 0) return [];

    const hits: BM25Hit[] = [];
    for (const doc of this.docs) {
      let score = 0;
      for (const term of qTokens) {
        const tf = doc.tf.get(term) ?? 0;
        if (tf === 0) continue;
        const df = this.df.get(term) ?? 0;
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        const denom = tf + this.k1 * (1 - this.b + (this.b * doc.len) / this.avgdl);
        score += idf * ((tf * (this.k1 + 1)) / denom);
      }
      if (score > 0) {
        hits.push({ nodeId: doc.nodeId, score });
      }
    }

    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, limit);
  }
}
