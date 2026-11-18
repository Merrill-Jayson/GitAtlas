import {
  Box,
  Braces,
  ChevronDown,
  ChevronRight,
  FileCode2,
  Folder,
  FolderOpen,
  Search,
} from 'lucide-react';
import { useState } from 'react';
import { useAppStore } from '../../store/useAppStore.ts';
import type { EdgeType, FileTreeNode, NodeType } from '../../types/graph.ts';

function TreeBranch({ item, depth = 0 }: { item: FileTreeNode; depth?: number }) {
  const [open, setOpen] = useState(depth < 2);
  const { selectedNodeId, selectNode, highlightedNodeIds } = useAppStore();
  const highlightSet = new Set(highlightedNodeIds);

  if (item.type === 'directory') {
    return (
      <div>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="w-full flex items-center gap-1.5 py-1 px-2 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/70 rounded transition-colors text-left"
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          {open ? (
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          )}
          {open ? (
            <FolderOpen className="w-3.5 h-3.5 text-blue-500 shrink-0" />
          ) : (
            <Folder className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          )}
          <span className="truncate font-medium">{item.name}</span>
        </button>
        {open &&
          item.children?.map((child) => <TreeBranch key={child.path} item={child} depth={depth + 1} />)}
      </div>
    );
  }

  const fileNodeId = `file:${item.path}`;
  const isFileSelected = selectedNodeId === fileNodeId;

  return (
    <div>
      <div className="flex items-center">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          style={{ marginLeft: `${depth * 12 + 4}px` }}
          title="Toggle entities"
        >
          {item.entities && item.entities.length > 0 ? (
            open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />
          ) : (
            <span className="w-3 inline-block" />
          )}
        </button>
        <button
          type="button"
          onClick={() => void selectNode(fileNodeId, true)}
          className={`flex-1 flex items-center gap-1.5 py-1 px-1.5 text-xs rounded transition-colors text-left min-w-0 ${
            isFileSelected
              ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400 font-medium'
              : highlightSet.has(fileNodeId)
                ? 'bg-sky-500/10 text-sky-600 dark:text-sky-300'
                : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/70'
          }`}
        >
          <FileCode2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <span className="truncate font-mono text-[11px]">{item.name}</span>
        </button>
      </div>

      {open &&
        item.entities?.map((entity) => {
          const isSelected = selectedNodeId === entity.id;
          const isHighlighted = highlightSet.has(entity.id);
          return (
            <button
              key={entity.id}
              type="button"
              onClick={() => void selectNode(entity.id, true)}
              className={`w-full flex items-center justify-between gap-2 py-1 pr-2 text-xs rounded transition-colors text-left ${
                isSelected
                  ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400 font-medium'
                  : isHighlighted
                    ? 'bg-sky-500/10 text-sky-600 dark:text-sky-300'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60'
              }`}
              style={{ paddingLeft: `${(depth + 2) * 12 + 8}px` }}
            >
              <span className="flex items-center gap-1.5 min-w-0">
                {entity.type === 'Class' ? (
                  <Box className="w-3 h-3 text-amber-500 shrink-0" />
                ) : (
                  <Braces className="w-3 h-3 text-blue-500 shrink-0" />
                )}
                <span className="truncate font-mono text-[11px]">{entity.name}</span>
              </span>
              <span className="font-mono text-[10px] text-slate-400 tabular-nums shrink-0">
                :{entity.start_line}
              </span>
            </button>
          );
        })}
    </div>
  );
}

const NODE_TYPES: NodeType[] = ['File', 'Module', 'Class', 'Function'];
const EDGE_TYPES: EdgeType[] = ['CALLS', 'EXTENDS', 'IMPORTS', 'CONTAINS', 'DEFINED_IN'];

export function SidebarExplorer() {
  const [tab, setTab] = useState<'explorer' | 'filters'>('explorer');
  const {
    fileTree,
    graphNodes,
    graphEdges,
    searchQuery,
    setSearchQuery,
    visibleNodeTypes,
    toggleNodeTypeFilter,
    visibleEdgeTypes,
    toggleEdgeTypeFilter,
  } = useAppStore();

  const nodeCounts = NODE_TYPES.reduce<Record<NodeType, number>>(
    (acc, t) => {
      acc[t] = graphNodes.filter((n) => n.type === t).length;
      return acc;
    },
    { File: 0, Module: 0, Class: 0, Function: 0 },
  );

  const edgeCounts = EDGE_TYPES.reduce<Record<EdgeType, number>>(
    (acc, t) => {
      acc[t] = graphEdges.filter((e) => e.type === t).length;
      return acc;
    },
    { CALLS: 0, EXTENDS: 0, IMPORTS: 0, CONTAINS: 0, DEFINED_IN: 0 },
  );

  return (
    <aside className="w-full lg:w-[272px] shrink-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0F141F] flex flex-col min-h-0">
      {/* Search Input */}
      <div className="p-3 border-b border-slate-200 dark:border-slate-800 space-y-2.5">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter nodes, files, symbols..."
            className="w-full pl-8 pr-2.5 py-1.5 text-xs rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-blue-500"
          />
        </div>

        <div className="grid grid-cols-2 gap-1 p-0.5 rounded-md bg-slate-100 dark:bg-[#0B0F17] border border-slate-200/70 dark:border-slate-800">
          <button
            type="button"
            onClick={() => setTab('explorer')}
            className={`py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
              tab === 'explorer'
                ? 'bg-white dark:bg-[#1E293B] text-slate-900 dark:text-slate-100 shadow-xs'
                : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            Explorer
          </button>
          <button
            type="button"
            onClick={() => setTab('filters')}
            className={`py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
              tab === 'filters'
                ? 'bg-white dark:bg-[#1E293B] text-slate-900 dark:text-slate-100 shadow-xs'
                : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            Graph Filters
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {tab === 'explorer' ? (
          fileTree.length > 0 ? (
            <div className="space-y-0.5">
              {fileTree.map((item) => (
                <TreeBranch key={item.path} item={item} />
              ))}
            </div>
          ) : (
            <div className="p-4 text-xs text-slate-500 dark:text-slate-400 text-center">
              No files indexed yet.
            </div>
          )
        ) : (
          <div className="p-2 space-y-5">
            <div>
              <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-200 mb-2">
                Node Categories
              </h3>
              <div className="space-y-1">
                {NODE_TYPES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => toggleNodeTypeFilter(t)}
                    className={`w-full flex items-center justify-between px-2.5 py-1.5 text-xs rounded-md border transition-colors ${
                      visibleNodeTypes[t]
                        ? 'border-blue-500/40 bg-blue-500/10 text-slate-900 dark:text-slate-100'
                        : 'border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                    }`}
                  >
                    <span className="font-medium">{t}</span>
                    <span className="font-mono text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                      {nodeCounts[t]}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-200 mb-2">
                Relationship Types
              </h3>
              <div className="space-y-1">
                {EDGE_TYPES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => toggleEdgeTypeFilter(t)}
                    className={`w-full flex items-center justify-between px-2.5 py-1.5 text-xs rounded-md border transition-colors ${
                      visibleEdgeTypes[t]
                        ? 'border-sky-500/40 bg-sky-500/10 text-slate-900 dark:text-slate-100'
                        : 'border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                    }`}
                  >
                    <span className="font-mono text-[11px]">{t}</span>
                    <span className="font-mono text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                      {edgeCounts[t]}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
