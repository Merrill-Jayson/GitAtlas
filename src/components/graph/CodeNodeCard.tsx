import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Box, Braces, FileCode2, Layers } from 'lucide-react';
import { memo } from 'react';
import type { GraphNode, NodeType } from '../../types/graph.ts';

export interface CodeFlowNodeData extends Record<string, unknown> {
  entity: GraphNode;
  isSelected: boolean;
  isHighlighted: boolean;
  isSeed: boolean;
  isDimmed: boolean;
  stepOrder: number | null;
}

const TYPE_META: Record<
  NodeType,
  {
    label: string;
    accentBorder: string;
    iconColor: string;
    headerBg: string;
  }
> = {
  File: {
    label: 'File',
    accentBorder: 'border-slate-300 dark:border-slate-700',
    iconColor: 'text-slate-500 dark:text-slate-400',
    headerBg: 'bg-slate-100/80 dark:bg-slate-800/70',
  },
  Module: {
    label: 'Module',
    accentBorder: 'border-cyan-500/40 dark:border-cyan-500/40',
    iconColor: 'text-cyan-600 dark:text-cyan-400',
    headerBg: 'bg-cyan-500/10 dark:bg-cyan-500/10',
  },
  Class: {
    label: 'Class',
    accentBorder: 'border-amber-500/45 dark:border-amber-500/40',
    iconColor: 'text-amber-600 dark:text-amber-400',
    headerBg: 'bg-amber-500/10 dark:bg-amber-500/10',
  },
  Function: {
    label: 'Function',
    accentBorder: 'border-blue-500/45 dark:border-blue-500/40',
    iconColor: 'text-blue-600 dark:text-blue-400',
    headerBg: 'bg-blue-500/10 dark:bg-blue-500/10',
  },
};

function TypeIcon({ type, className }: { type: NodeType; className: string }) {
  if (type === 'File') return <FileCode2 className={className} />;
  if (type === 'Module') return <Layers className={className} />;
  if (type === 'Class') return <Box className={className} />;
  return <Braces className={className} />;
}

export const CodeNodeCard = memo(function CodeNodeCard({ data }: NodeProps) {
  const { entity, isSelected, isHighlighted, isSeed, isDimmed, stepOrder } = data as CodeFlowNodeData;
  const meta = TYPE_META[entity.type];

  return (
    <div
      className={[
        'w-[232px] rounded-lg border bg-white dark:bg-[#111827] transition-all duration-200 select-none',
        isSelected
          ? 'border-blue-500 ring-2 ring-blue-500/40 shadow-lg shadow-blue-500/10'
          : isHighlighted
            ? isSeed
              ? 'border-sky-400 ring-2 ring-sky-400/35 shadow-md shadow-sky-500/15'
              : 'border-blue-500/70 ring-1 ring-blue-500/25'
            : meta.accentBorder,
        isDimmed ? 'opacity-25 saturate-50' : 'opacity-100',
      ].join(' ')}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!w-2 !h-2 !bg-slate-400 dark:!bg-slate-600 !border-0"
      />
      <Handle
        type="target"
        position={Position.Top}
        id="top"
        className="!w-2 !h-2 !bg-slate-400 dark:!bg-slate-600 !border-0 opacity-0"
      />

      {/* Node Header */}
      <div className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-t-[7px] border-b border-slate-200/80 dark:border-slate-800 ${meta.headerBg}`}>
        <div className="flex items-center gap-1.5 min-w-0">
          <TypeIcon type={entity.type} className={`w-3.5 h-3.5 shrink-0 ${meta.iconColor}`} />
          <span className="text-[11px] font-medium text-slate-600 dark:text-slate-300 truncate">
            {meta.label}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0 font-mono text-[10px] text-slate-500 dark:text-slate-400 tabular-nums">
          {stepOrder !== null && (
            <span className="text-sky-600 dark:text-sky-400 font-semibold">
              Step {stepOrder}
            </span>
          )}
          {stepOrder !== null && <span aria-hidden="true">·</span>}
          <span>
            L{entity.start_line}–{entity.end_line}
          </span>
        </div>
      </div>

      {/* Node Body */}
      <div className="px-2.5 py-2 space-y-1">
        <div className="font-mono text-xs font-semibold text-slate-900 dark:text-slate-100 truncate" title={entity.name}>
          {entity.name}
        </div>
        <div className="font-mono text-[10px] text-slate-500 dark:text-slate-400 truncate" title={entity.file_path}>
          {entity.file_path}
        </div>
        {entity.docstring && (
          <p className="text-[11px] leading-snug text-slate-600 dark:text-slate-400 line-clamp-2 pt-0.5">
            {entity.docstring}
          </p>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="!w-2 !h-2 !bg-slate-400 dark:!bg-slate-600 !border-0"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom"
        className="!w-2 !h-2 !bg-slate-400 dark:!bg-slate-600 !border-0 opacity-0"
      />
    </div>
  );
});
