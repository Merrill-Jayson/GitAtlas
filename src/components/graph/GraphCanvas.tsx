import dagre from '@dagrejs/dagre';
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
} from '@xyflow/react';
import { Expand, Focus, Layers, Maximize2, Minimize2, Sparkles, X } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { useAppStore } from '../../store/useAppStore.ts';
import type { EdgeType, GraphEdge, GraphNode } from '../../types/graph.ts';
import { CodeNodeCard, type CodeFlowNodeData } from './CodeNodeCard.tsx';

const nodeTypes = { codeNode: CodeNodeCard };

const EDGE_COLORS: Record<EdgeType, string> = {
  CALLS: '#38BDF8',
  EXTENDS: '#F59E0B',
  IMPORTS: '#22D3EE',
  CONTAINS: '#64748B',
  DEFINED_IN: '#475569',
};

function computeDagreLayout(
  rawNodes: GraphNode[],
  rawEdges: GraphEdge[],
  direction: 'LR' | 'TB',
): Map<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: direction,
    nodesep: 42,
    ranksep: 88,
    marginx: 32,
    marginy: 32,
  });

  const NODE_W = 232;
  const NODE_H = 104;

  for (const n of rawNodes) {
    g.setNode(n.id, { width: NODE_W, height: NODE_H });
  }
  for (const e of rawEdges) {
    g.setEdge(e.source, e.target);
  }

  dagre.layout(g);

  const positions = new Map<string, { x: number; y: number }>();
  for (const n of rawNodes) {
    const pos = g.node(n.id);
    positions.set(n.id, {
      x: (pos?.x ?? 0) - NODE_W / 2,
      y: (pos?.y ?? 0) - NODE_H / 2,
    });
  }
  return positions;
}

function GraphCanvasInner() {
  const { fitView, setCenter, getNode } = useReactFlow();
  const {
    theme,
    graphNodes,
    graphEdges,
    loadingGraph,
    activeRepo,
    searchQuery,
    visibleNodeTypes,
    visibleEdgeTypes,
    collapseToModules,
    setCollapseToModules,
    layoutDirection,
    setLayoutDirection,
    selectedNodeId,
    focusRequestCounter,
    selectNode,
    highlightedNodeIds,
    highlightedEdgeIds,
    seedNodeIds,
    orderedPathNodeIds,
    isHighlightActive,
    clearHighlight,
  } = useAppStore();

  const highlightNodeSet = useMemo(() => new Set(highlightedNodeIds), [highlightedNodeIds]);
  const highlightEdgeSet = useMemo(() => new Set(highlightedEdgeIds), [highlightedEdgeIds]);
  const seedNodeSet = useMemo(() => new Set(seedNodeIds), [seedNodeIds]);
  const pathIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    orderedPathNodeIds.forEach((id, idx) => {
      if (!map.has(id)) map.set(id, idx + 1);
    });
    return map;
  }, [orderedPathNodeIds]);

  const { flowNodes, flowEdges } = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    // Filter nodes by type, module-collapse, and search
    const filteredNodes = graphNodes.filter((n) => {
      if (!visibleNodeTypes[n.type]) return false;
      // When collapsed to modules, hide Class/Function unless currently highlighted by AI or selected
      if (collapseToModules && (n.type === 'Class' || n.type === 'Function')) {
        if (!highlightNodeSet.has(n.id) && n.id !== selectedNodeId) {
          return false;
        }
      }
      if (q) {
        const hay = `${n.name} ${n.file_path} ${n.signature}`.toLowerCase();
        if (!hay.includes(q) && !highlightNodeSet.has(n.id)) return false;
      }
      return true;
    });

    // Cap visible unhighlighted nodes for massive repos while preserving highlighted subgraph
    const cappedNodes =
      filteredNodes.length > 140
        ? filteredNodes
            .sort((a, b) => Number(highlightNodeSet.has(b.id)) - Number(highlightNodeSet.has(a.id)))
            .slice(0, 140)
        : filteredNodes;

    const visibleIds = new Set(cappedNodes.map((n) => n.id));
    const filteredEdges = graphEdges.filter(
      (e) => visibleEdgeTypes[e.type] && visibleIds.has(e.source) && visibleIds.has(e.target),
    );

    const positions = computeDagreLayout(cappedNodes, filteredEdges, layoutDirection);

    const nodes: Node<CodeFlowNodeData>[] = cappedNodes.map((n) => {
      const isHighlighted = highlightNodeSet.has(n.id);
      const isDimmed = isHighlightActive && !isHighlighted && n.id !== selectedNodeId;
      return {
        id: n.id,
        type: 'codeNode',
        position: positions.get(n.id) ?? { x: 0, y: 0 },
        data: {
          entity: n,
          isSelected: n.id === selectedNodeId,
          isHighlighted,
          isSeed: seedNodeSet.has(n.id),
          isDimmed,
          stepOrder: isHighlightActive ? (pathIndexMap.get(n.id) ?? null) : null,
        },
      };
    });

    const edges: Edge[] = filteredEdges.map((e) => {
      const isHighlighted = highlightEdgeSet.has(e.id);
      const isDimmed = isHighlightActive && !isHighlighted;
      const baseColor = EDGE_COLORS[e.type];
      const strokeColor = isHighlighted ? '#38BDF8' : baseColor;

      return {
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.uncertain ? `${e.type} ?` : e.type,
        animated: isHighlighted && (e.type === 'CALLS' || e.type === 'EXTENDS' || e.type === 'IMPORTS'),
        className: isHighlighted ? 'edge-flow-animated' : undefined,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 16,
          height: 16,
          color: strokeColor,
        },
        style: {
          stroke: strokeColor,
          strokeWidth: isHighlighted ? 2.4 : 1.25,
          strokeDasharray: e.uncertain ? '4 4' : undefined,
          opacity: isDimmed ? 0.14 : isHighlighted ? 1 : 0.65,
        },
        labelStyle: {
          fill: isDimmed
            ? 'transparent'
            : theme === 'dark'
              ? isHighlighted
                ? '#E0F2FE'
                : '#94A3B8'
              : '#334155',
          fontSize: 10,
          fontFamily: 'JetBrains Mono, monospace',
          fontWeight: isHighlighted ? 600 : 500,
        },
        labelBgStyle: {
          fill: theme === 'dark' ? '#0B0F17' : '#FFFFFF',
          fillOpacity: isDimmed ? 0 : 0.85,
        },
        labelBgPadding: [4, 2] as [number, number],
      };
    });

    return { flowNodes: nodes, flowEdges: edges };
  }, [
    graphNodes,
    graphEdges,
    visibleNodeTypes,
    visibleEdgeTypes,
    collapseToModules,
    searchQuery,
    layoutDirection,
    selectedNodeId,
    isHighlightActive,
    highlightNodeSet,
    highlightEdgeSet,
    seedNodeSet,
    pathIndexMap,
    theme,
  ]);

  // Fit view on initial graph load or layout direction change
  useEffect(() => {
    if (flowNodes.length === 0) return;
    const t = setTimeout(() => {
      void fitView({ padding: 0.18, duration: 350 });
    }, 60);
    return () => clearTimeout(t);
  }, [activeRepo?.repository_id, layoutDirection, collapseToModules, fitView]);

  // Focus & zoom onto a selected node when triggered from chat citation or explorer
  useEffect(() => {
    if (!selectedNodeId || focusRequestCounter === 0) return;
    const node = getNode(selectedNodeId);
    if (node) {
      void setCenter(node.position.x + 116, node.position.y + 52, { zoom: 1.08, duration: 400 });
    }
  }, [selectedNodeId, focusRequestCounter, getNode, setCenter]);

  // Fit highlighted subgraph when an AI provenance trace arrives
  useEffect(() => {
    if (!isHighlightActive || highlightedNodeIds.length === 0) return;
    const t = setTimeout(() => {
      const targetNodes = highlightedNodeIds.map((id) => ({ id }));
      void fitView({ nodes: targetNodes, padding: 0.25, duration: 450, maxZoom: 1.15 });
    }, 90);
    return () => clearTimeout(t);
  }, [isHighlightActive, highlightedNodeIds, fitView]);

  if (loadingGraph && graphNodes.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-slate-500 dark:text-slate-400">
        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm font-medium">
          {activeRepo?.message || 'Building AST knowledge graph...'}
        </p>
        {activeRepo && (
          <div className="w-64 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-all duration-300"
              style={{ width: `${activeRepo.progress}%` }}
            />
          </div>
        )}
      </div>
    );
  }

  if (activeRepo?.status === 'failed') {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 text-center max-w-md mx-auto">
        <p className="text-sm font-semibold text-rose-500 mb-1">Repository ingestion failed</p>
        <p className="text-xs text-slate-500 dark:text-slate-400">{activeRepo.error}</p>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full bg-slate-50 dark:bg-[#0B0F17]">
      {/* Compact Floating Graph Toolbar */}
      <div className="absolute top-3 left-3 z-10 flex flex-wrap items-center gap-1.5">
        <div className="flex items-center gap-1 p-1 rounded-lg border border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-[#111827]/95 backdrop-blur-sm">
          <button
            type="button"
            onClick={() => void fitView({ padding: 0.18, duration: 350 })}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
            title="Fit graph to viewport"
          >
            <Maximize2 className="w-3.5 h-3.5" />
            Fit
          </button>

          <button
            type="button"
            onClick={() => setLayoutDirection(layoutDirection === 'LR' ? 'TB' : 'LR')}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
            title="Toggle horizontal or vertical Dagre layout"
          >
            <Layers className="w-3.5 h-3.5" />
            {layoutDirection === 'LR' ? 'Left-Right' : 'Top-Down'}
          </button>

          <button
            type="button"
            onClick={() => setCollapseToModules(!collapseToModules)}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
              collapseToModules
                ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400'
                : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
            title="Collapse classes and functions to module level"
          >
            {collapseToModules ? <Expand className="w-3.5 h-3.5" /> : <Minimize2 className="w-3.5 h-3.5" />}
            {collapseToModules ? 'Expand Entities' : 'Module View'}
          </button>
        </div>

        {isHighlightActive && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300 text-xs font-medium">
            <Sparkles className="w-3.5 h-3.5 shrink-0" />
            <span className="tabular-nums">
              Highlighting {highlightedNodeIds.length} nodes · {highlightedEdgeIds.length} edges
            </span>
            <button
              type="button"
              onClick={() =>
                void fitView({
                  nodes: highlightedNodeIds.map((id) => ({ id })),
                  padding: 0.25,
                  duration: 350,
                })
              }
              className="p-0.5 hover:text-sky-900 dark:hover:text-white transition-colors"
              title="Focus highlighted subgraph"
            >
              <Focus className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={clearHighlight}
              className="p-0.5 hover:text-sky-900 dark:hover:text-white transition-colors"
              title="Clear AI highlight"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Edge Legend */}
      <div className="hidden sm:flex absolute bottom-3 left-3 z-10 items-center gap-3 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white/90 dark:bg-[#111827]/90 text-[11px] font-mono text-slate-600 dark:text-slate-400">
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-0.5 bg-sky-400 inline-block" /> CALLS
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-0.5 bg-amber-500 inline-block" /> EXTENDS
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-0.5 bg-cyan-400 inline-block" /> IMPORTS
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-0.5 bg-slate-500 inline-block" /> CONTAINS
        </span>
      </div>

      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        onNodeClick={(_event, node) => {
          void selectNode(node.id, false);
        }}
        fitView
        minZoom={0.15}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color={theme === 'dark' ? '#1E293B' : '#CBD5E1'}
        />
        <Controls position="bottom-right" showInteractive={false} />
        <MiniMap
          position="top-right"
          pannable
          zoomable
          nodeColor={(node) => {
            const d = node.data as CodeFlowNodeData | undefined;
            if (d?.isHighlighted) return '#38BDF8';
            if (d?.entity.type === 'Class') return '#F59E0B';
            if (d?.entity.type === 'Function') return '#3B82F6';
            if (d?.entity.type === 'Module') return '#06B6D4';
            return '#64748B';
          }}
          maskColor={theme === 'dark' ? 'rgba(11, 15, 23, 0.72)' : 'rgba(248, 250, 252, 0.72)'}
          className="!bg-white dark:!bg-[#111827]"
        />
      </ReactFlow>
    </div>
  );
}

export function GraphCanvas() {
  return (
    <ReactFlowProvider>
      <GraphCanvasInner />
    </ReactFlowProvider>
  );
}
