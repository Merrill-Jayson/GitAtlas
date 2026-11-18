import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  Code2,
  FileText,
  GitFork,
  Terminal,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore.ts';

export function InspectorDrawer() {
  const {
    bottomOpen,
    setBottomOpen,
    bottomTab,
    setBottomTab,
    nodeDetails,
    loadingNodeDetails,
    activeRepo,
    selectNode,
  } = useAppStore();

  return (
    <section
      className={`border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0F141F] flex flex-col transition-all ${
        bottomOpen ? 'h-[248px]' : 'h-[38px]'
      }`}
    >
      {/* Tab Header Bar */}
      <div className="h-[38px] shrink-0 px-3 flex items-center justify-between border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setBottomTab('source')}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
              bottomOpen && bottomTab === 'source'
                ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <Code2 className="w-3.5 h-3.5" />
            Source Code
          </button>

          <button
            type="button"
            onClick={() => setBottomTab('relationships')}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
              bottomOpen && bottomTab === 'relationships'
                ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <GitFork className="w-3.5 h-3.5" />
            Relationships
            {nodeDetails && (
              <span className="font-mono text-[10px] text-slate-400 tabular-nums">
                ({nodeDetails.incoming.length + nodeDetails.outgoing.length})
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setBottomTab('logs')}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
              bottomOpen && bottomTab === 'logs'
                ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            Ingestion Log
          </button>
        </div>

        <div className="flex items-center gap-3">
          {nodeDetails && (
            <div className="hidden md:flex items-center gap-2 text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums">
              <span>{nodeDetails.node.type}</span>
              <span aria-hidden="true">·</span>
              <span className="text-slate-800 dark:text-slate-200">{nodeDetails.node.file_path}</span>
              <span aria-hidden="true">·</span>
              <span>
                L{nodeDetails.node.start_line}–{nodeDetails.node.end_line}
              </span>
            </div>
          )}
          <button
            type="button"
            onClick={() => setBottomOpen(!bottomOpen)}
            className="p-1 text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
            title={bottomOpen ? 'Collapse inspector' : 'Expand inspector'}
          >
            {bottomOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Body */}
      {bottomOpen && (
        <div className="flex-1 min-h-0 overflow-hidden">
          {bottomTab === 'source' && (
            <div className="h-full flex">
              {loadingNodeDetails ? (
                <div className="flex-1 flex items-center justify-center text-xs text-slate-500">
                  Loading source snippet...
                </div>
              ) : !nodeDetails ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-4 text-slate-500 dark:text-slate-400">
                  <FileText className="w-5 h-5 mb-1.5 opacity-60" />
                  <p className="text-xs font-medium">Select a graph node or citation to inspect its AST metadata and source code.</p>
                </div>
              ) : (
                <>
                  {/* Metadata Left Column */}
                  <div className="w-[290px] shrink-0 border-r border-slate-200 dark:border-slate-800 p-3 overflow-y-auto space-y-2.5 bg-slate-50/50 dark:bg-[#0B0F17]/60">
                    <div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {nodeDetails.node.type} · {nodeDetails.node.language}
                      </div>
                      <div className="font-mono text-xs font-semibold text-slate-900 dark:text-slate-100 break-all mt-0.5">
                        {nodeDetails.node.name}
                      </div>
                    </div>

                    <div>
                      <div className="text-[10px] text-slate-500 mb-0.5">Node ID</div>
                      <div className="font-mono text-[10px] text-slate-700 dark:text-slate-300 break-all bg-slate-100 dark:bg-slate-800/70 px-2 py-1 rounded">
                        {nodeDetails.node.id}
                      </div>
                    </div>

                    <div>
                      <div className="text-[10px] text-slate-500 mb-0.5">Signature</div>
                      <div className="font-mono text-[11px] text-blue-600 dark:text-blue-400 break-all">
                        {nodeDetails.node.signature}
                      </div>
                    </div>

                    {nodeDetails.node.docstring && (
                      <div>
                        <div className="text-[10px] text-slate-500 mb-0.5">Docstring</div>
                        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                          {nodeDetails.node.docstring}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Source Lines Right Column */}
                  <div className="flex-1 overflow-auto bg-slate-50 dark:bg-[#0B0F17] p-2 font-mono text-xs leading-5">
                    {nodeDetails.source_lines.length === 0 ? (
                      <div className="p-4 text-slate-500">Source lines unavailable.</div>
                    ) : (
                      <table className="w-full border-collapse">
                        <tbody>
                          {nodeDetails.source_lines.map((line) => (
                            <tr
                              key={line.line_number}
                              className="hover:bg-slate-100/80 dark:hover:bg-slate-800/40"
                            >
                              <td className="w-12 pr-3 text-right select-none text-slate-400 dark:text-slate-600 tabular-nums align-top">
                                {line.line_number}
                              </td>
                              <td className="whitespace-pre text-slate-800 dark:text-slate-200 pr-4">
                                {line.content || ' '}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {bottomTab === 'relationships' && (
            <div className="h-full overflow-y-auto p-3">
              {!nodeDetails ? (
                <div className="h-full flex items-center justify-center text-xs text-slate-500">
                  Select a node to inspect incoming and outgoing graph edges.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <h4 className="flex items-center gap-1.5 text-xs font-semibold text-slate-800 dark:text-slate-200 mb-2">
                      <ArrowDownLeft className="w-3.5 h-3.5 text-emerald-500" />
                      Incoming ({nodeDetails.incoming.length})
                    </h4>
                    <div className="space-y-1">
                      {nodeDetails.incoming.length === 0 && (
                        <p className="text-xs text-slate-500">No incoming edges.</p>
                      )}
                      {nodeDetails.incoming.map(({ edge, node }) => (
                        <button
                          key={edge.id}
                          type="button"
                          onClick={() => void selectNode(node.id, true)}
                          className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-800 hover:border-blue-500/60 bg-slate-50 dark:bg-[#0B0F17] text-left transition-colors"
                        >
                          <div className="min-w-0">
                            <div className="font-mono text-xs text-slate-900 dark:text-slate-100 truncate">
                              {node.name}
                            </div>
                            <div className="font-mono text-[10px] text-slate-500 truncate">
                              {node.file_path}:{node.start_line}
                            </div>
                          </div>
                          <span className="font-mono text-[10px] text-sky-600 dark:text-sky-400 shrink-0 flex items-center gap-1">
                            {edge.uncertain && <AlertTriangle className="w-3 h-3 text-amber-500" />}
                            {edge.type}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h4 className="flex items-center gap-1.5 text-xs font-semibold text-slate-800 dark:text-slate-200 mb-2">
                      <ArrowUpRight className="w-3.5 h-3.5 text-sky-500" />
                      Outgoing ({nodeDetails.outgoing.length})
                    </h4>
                    <div className="space-y-1">
                      {nodeDetails.outgoing.length === 0 && (
                        <p className="text-xs text-slate-500">No outgoing edges.</p>
                      )}
                      {nodeDetails.outgoing.map(({ edge, node }) => (
                        <button
                          key={edge.id}
                          type="button"
                          onClick={() => void selectNode(node.id, true)}
                          className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-800 hover:border-blue-500/60 bg-slate-50 dark:bg-[#0B0F17] text-left transition-colors"
                        >
                          <div className="min-w-0">
                            <div className="font-mono text-xs text-slate-900 dark:text-slate-100 truncate">
                              {node.name}
                            </div>
                            <div className="font-mono text-[10px] text-slate-500 truncate">
                              {node.file_path}:{node.start_line}
                            </div>
                          </div>
                          <span className="font-mono text-[10px] text-sky-600 dark:text-sky-400 shrink-0 flex items-center gap-1">
                            {edge.uncertain && <AlertTriangle className="w-3 h-3 text-amber-500" />}
                            {edge.type}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {bottomTab === 'logs' && (
            <div className="h-full overflow-y-auto p-3 font-mono text-xs space-y-1 bg-slate-50 dark:bg-[#0B0F17]">
              {!activeRepo || activeRepo.logs.length === 0 ? (
                <div className="text-slate-500">No ingestion log entries recorded.</div>
              ) : (
                activeRepo.logs.map((log, i) => (
                  <div key={i} className="flex items-start gap-2.5">
                    <span className="text-slate-400 shrink-0 tabular-nums">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </span>
                    <span
                      className={`w-24 shrink-0 ${
                        log.level === 'error'
                          ? 'text-rose-500'
                          : log.level === 'warn'
                            ? 'text-amber-500'
                            : 'text-sky-500'
                      }`}
                    >
                      [{log.stage}]
                    </span>
                    <span className="text-slate-700 dark:text-slate-300">{log.message}</span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
