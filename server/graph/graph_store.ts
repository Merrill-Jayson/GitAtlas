import type { EdgeType, GraphEdge, GraphNode, GraphPayload } from '../../src/types/graph.ts';

export interface TraversalOptions {
  maxHops?: number;
  maxNodes?: number;
  allowedEdgeTypes?: EdgeType[];
  direction?: 'both' | 'outgoing' | 'incoming';
}

export interface NeighborEntry {
  edge: GraphEdge;
  node: GraphNode;
  direction: 'incoming' | 'outgoing';
}

export interface IGraphStore {
  createRepositoryGraph(repositoryId: string, nodes: GraphNode[], edges: GraphEdge[]): void;
  hasRepository(repositoryId: string): boolean;
  deleteRepository(repositoryId: string): void;
  getNode(repositoryId: string, nodeId: string): GraphNode | undefined;
  getAllNodes(repositoryId: string): GraphNode[];
  getAllEdges(repositoryId: string): GraphEdge[];
  getNeighbors(repositoryId: string, nodeId: string, allowedTypes?: EdgeType[]): NeighborEntry[];
  getCallers(repositoryId: string, nodeId: string): NeighborEntry[];
  getCallees(repositoryId: string, nodeId: string): NeighborEntry[];
  traverseNHops(repositoryId: string, seedIds: string[], options?: TraversalOptions): {
    nodes: GraphNode[];
    edges: GraphEdge[];
    hopDistance: Map<string, number>;
    orderedPathNodeIds: string[];
  };
  serialize(repositoryId: string): GraphPayload;
}

interface RepoGraphData {
  nodes: Map<string, GraphNode>;
  edges: Map<string, GraphEdge>;
  outgoing: Map<string, GraphEdge[]>;
  incoming: Map<string, GraphEdge[]>;
}

/**
 * In-memory property graph engine mirroring NetworkX directed multigraph semantics.
 * Behind IGraphStore abstraction so Neo4jGraphStore can be swapped in without changing callers.
 */
export class PropertyGraphStore implements IGraphStore {
  private repos = new Map<string, RepoGraphData>();

  createRepositoryGraph(repositoryId: string, nodes: GraphNode[], edges: GraphEdge[]): void {
    const nodeMap = new Map<string, GraphNode>();
    const edgeMap = new Map<string, GraphEdge>();
    const outgoing = new Map<string, GraphEdge[]>();
    const incoming = new Map<string, GraphEdge[]>();

    for (const node of nodes) {
      nodeMap.set(node.id, node);
      outgoing.set(node.id, []);
      incoming.set(node.id, []);
    }

    for (const edge of edges) {
      if (!nodeMap.has(edge.source) || !nodeMap.has(edge.target)) continue;
      edgeMap.set(edge.id, edge);
      outgoing.get(edge.source)?.push(edge);
      incoming.get(edge.target)?.push(edge);
    }

    this.repos.set(repositoryId, { nodes: nodeMap, edges: edgeMap, outgoing, incoming });
  }

  hasRepository(repositoryId: string): boolean {
    return this.repos.has(repositoryId);
  }

  deleteRepository(repositoryId: string): void {
    this.repos.delete(repositoryId);
  }

  getNode(repositoryId: string, nodeId: string): GraphNode | undefined {
    return this.repos.get(repositoryId)?.nodes.get(nodeId);
  }

  getAllNodes(repositoryId: string): GraphNode[] {
    const repo = this.repos.get(repositoryId);
    return repo ? Array.from(repo.nodes.values()) : [];
  }

  getAllEdges(repositoryId: string): GraphEdge[] {
    const repo = this.repos.get(repositoryId);
    return repo ? Array.from(repo.edges.values()) : [];
  }

  getNeighbors(repositoryId: string, nodeId: string, allowedTypes?: EdgeType[]): NeighborEntry[] {
    const repo = this.repos.get(repositoryId);
    if (!repo) return [];
    const results: NeighborEntry[] = [];

    for (const edge of repo.outgoing.get(nodeId) ?? []) {
      if (allowedTypes && !allowedTypes.includes(edge.type)) continue;
      const node = repo.nodes.get(edge.target);
      if (node) results.push({ edge, node, direction: 'outgoing' });
    }
    for (const edge of repo.incoming.get(nodeId) ?? []) {
      if (allowedTypes && !allowedTypes.includes(edge.type)) continue;
      const node = repo.nodes.get(edge.source);
      if (node) results.push({ edge, node, direction: 'incoming' });
    }
    return results;
  }

  getCallers(repositoryId: string, nodeId: string): NeighborEntry[] {
    const repo = this.repos.get(repositoryId);
    if (!repo) return [];
    return (repo.incoming.get(nodeId) ?? [])
      .filter((e) => e.type === 'CALLS')
      .map((edge) => ({ edge, node: repo.nodes.get(edge.source)!, direction: 'incoming' as const }))
      .filter((item) => Boolean(item.node));
  }

  getCallees(repositoryId: string, nodeId: string): NeighborEntry[] {
    const repo = this.repos.get(repositoryId);
    if (!repo) return [];
    return (repo.outgoing.get(nodeId) ?? [])
      .filter((e) => e.type === 'CALLS')
      .map((edge) => ({ edge, node: repo.nodes.get(edge.target)!, direction: 'outgoing' as const }))
      .filter((item) => Boolean(item.node));
  }

  traverseNHops(
    repositoryId: string,
    seedIds: string[],
    options: TraversalOptions = {},
  ): {
    nodes: GraphNode[];
    edges: GraphEdge[];
    hopDistance: Map<string, number>;
    orderedPathNodeIds: string[];
  } {
    const repo = this.repos.get(repositoryId);
    if (!repo) {
      return { nodes: [], edges: [], hopDistance: new Map(), orderedPathNodeIds: [] };
    }

    const maxHops = options.maxHops ?? 2;
    const maxNodes = options.maxNodes ?? 26;
    const allowed = options.allowedEdgeTypes ?? ['CALLS', 'EXTENDS', 'IMPORTS', 'CONTAINS', 'DEFINED_IN'];
    const direction = options.direction ?? 'both';

    const hopDistance = new Map<string, number>();
    const queue: Array<{ id: string; depth: number }> = [];
    const orderedPathNodeIds: string[] = [];

    for (const seedId of seedIds) {
      if (repo.nodes.has(seedId) && !hopDistance.has(seedId)) {
        hopDistance.set(seedId, 0);
        queue.push({ id: seedId, depth: 0 });
        orderedPathNodeIds.push(seedId);
      }
    }

    // Prioritize semantic execution edges (CALLS, EXTENDS, IMPORTS) before structural containment
    const edgePriority: Record<EdgeType, number> = {
      CALLS: 0,
      EXTENDS: 1,
      IMPORTS: 2,
      CONTAINS: 3,
      DEFINED_IN: 4,
    };

    while (queue.length > 0 && hopDistance.size < maxNodes) {
      const current = queue.shift()!;
      if (current.depth >= maxHops) continue;

      const candidateEdges: Array<{ edge: GraphEdge; nextId: string }> = [];
      if (direction === 'both' || direction === 'outgoing') {
        for (const e of repo.outgoing.get(current.id) ?? []) {
          if (allowed.includes(e.type)) {
            candidateEdges.push({ edge: e, nextId: e.target });
          }
        }
      }
      if (direction === 'both' || direction === 'incoming') {
        for (const e of repo.incoming.get(current.id) ?? []) {
          if (allowed.includes(e.type)) {
            candidateEdges.push({ edge: e, nextId: e.source });
          }
        }
      }

      candidateEdges.sort((a, b) => edgePriority[a.edge.type] - edgePriority[b.edge.type]);

      for (const { edge, nextId } of candidateEdges) {
        if (hopDistance.size >= maxNodes) break;
        // Skip noisy File-level fanout if hopping through DEFINED_IN unless depth 0
        const nextNode = repo.nodes.get(nextId);
        if (!nextNode) continue;
        if (edge.type === 'CONTAINS' && nextNode.type === 'Function' && current.depth > 0) {
          continue;
        }
        if (!hopDistance.has(nextId)) {
          hopDistance.set(nextId, current.depth + 1);
          queue.push({ id: nextId, depth: current.depth + 1 });
          if (edge.type === 'CALLS' || edge.type === 'EXTENDS' || edge.type === 'IMPORTS') {
            orderedPathNodeIds.push(nextId);
          }
        }
      }
    }

    const visitedSet = new Set(hopDistance.keys());
    const nodes = Array.from(visitedSet)
      .map((id) => repo.nodes.get(id)!)
      .filter(Boolean);

    const edges: GraphEdge[] = [];
    for (const edge of repo.edges.values()) {
      if (visitedSet.has(edge.source) && visitedSet.has(edge.target) && allowed.includes(edge.type)) {
        edges.push(edge);
      }
    }

    return { nodes, edges, hopDistance, orderedPathNodeIds };
  }

  serialize(repositoryId: string): GraphPayload {
    return {
      repository_id: repositoryId,
      nodes: this.getAllNodes(repositoryId),
      edges: this.getAllEdges(repositoryId),
    };
  }
}

/**
 * Production Neo4j adapter boundary documenting Cypher schema parity with PropertyGraphStore.
 */
export class Neo4jGraphStoreAdapter {
  readonly uri: string;
  constructor(uri: string) {
    this.uri = uri;
  }
  isConfigured(): boolean {
    return Boolean(this.uri && process.env.NEO4J_PASSWORD);
  }
}

export const graphStore = new PropertyGraphStore();
