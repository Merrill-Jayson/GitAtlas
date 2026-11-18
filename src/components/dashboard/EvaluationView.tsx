import { CheckCircle2, Play, XCircle } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore.ts';

export function EvaluationView() {
  const { evaluationReport, runningEvaluation, runEvaluation } = useAppStore();

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 dark:bg-[#0B0F17] p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
          <div>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
              Retrieval Evaluation: Hybrid Graph-RAG vs. Vector-Only Baseline
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Executes live multi-hop architectural queries against the indexed ShopFlow repository and compares recall, subgraph connectivity, and node citation accuracy.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void runEvaluation()}
            disabled={runningEvaluation}
            className="flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white transition-colors whitespace-nowrap shrink-0"
          >
            <Play className="w-3.5 h-3.5" />
            {runningEvaluation ? 'Running Benchmark...' : 'Run Benchmark'}
          </button>
        </div>

        {!evaluationReport ? (
          <div className="border border-slate-200 dark:border-slate-800 rounded-xl p-10 text-center bg-white dark:bg-[#111827] space-y-3">
            <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
              No evaluation run executed yet in this session.
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
              Click Run Benchmark to execute the 5 ground-truth architectural test queries in real time without fabricated metrics.
            </p>
          </div>
        ) : (
          <>
            {/* Summary Metrics Strip */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
                <div className="text-xs text-slate-500 dark:text-slate-400">Hybrid Graph-RAG Recall</div>
                <div className="text-2xl font-semibold font-mono tabular-nums text-emerald-600 dark:text-emerald-400 mt-1">
                  {Math.round(evaluationReport.summary.avg_hybrid_recall * 100)}%
                </div>
              </div>

              <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
                <div className="text-xs text-slate-500 dark:text-slate-400">Vector-Only Recall</div>
                <div className="text-2xl font-semibold font-mono tabular-nums text-slate-700 dark:text-slate-300 mt-1">
                  {Math.round(evaluationReport.summary.avg_vector_recall * 100)}%
                </div>
              </div>

              <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
                <div className="text-xs text-slate-500 dark:text-slate-400">Citation Validity</div>
                <div className="text-2xl font-semibold font-mono tabular-nums text-blue-600 dark:text-blue-400 mt-1">
                  {Math.round(evaluationReport.summary.avg_citation_accuracy * 100)}%
                </div>
              </div>

              <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
                <div className="text-xs text-slate-500 dark:text-slate-400">Multi-Hop Connectivity</div>
                <div className="text-2xl font-semibold font-mono tabular-nums text-sky-600 dark:text-sky-400 mt-1">
                  {Math.round(evaluationReport.summary.multi_hop_connection_rate * 100)}%
                </div>
              </div>
            </div>

            {/* Per-case Table */}
            <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden bg-white dark:bg-[#111827]">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0F141F] text-slate-500 dark:text-slate-400">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium">Test Query</th>
                      <th className="text-right px-3 py-3 font-medium">Graph-RAG Recall</th>
                      <th className="text-right px-3 py-3 font-medium">Vector-Only Recall</th>
                      <th className="text-right px-3 py-3 font-medium">Subgraph</th>
                      <th className="text-center px-3 py-3 font-medium">Connected</th>
                      <th className="text-right px-4 py-3 font-medium">Latency</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {evaluationReport.cases.map((c) => (
                      <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-900 dark:text-slate-100">{c.question}</div>
                          <div className="font-mono text-[11px] text-slate-500 mt-0.5">
                            Matched: {c.hybrid_found_nodes.join(', ') || 'None'}
                          </div>
                        </td>
                        <td className="px-3 py-3 text-right font-mono tabular-nums text-emerald-600 dark:text-emerald-400 font-semibold">
                          {Math.round(c.hybrid_recall * 100)}% ({c.hybrid_found_nodes.length}/{c.expected_nodes.length})
                        </td>
                        <td className="px-3 py-3 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400">
                          {Math.round(c.vector_recall * 100)}% ({c.vector_found_nodes.length}/{c.expected_nodes.length})
                        </td>
                        <td className="px-3 py-3 text-right font-mono tabular-nums text-slate-500">
                          {c.hybrid_subgraph_size} vs {c.vector_subgraph_size}
                        </td>
                        <td className="px-3 py-3 text-center">
                          {c.multi_hop_connected ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-500 inline" />
                          ) : (
                            <XCircle className="w-4 h-4 text-rose-500 inline" />
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-500">
                          {c.latency_ms} ms
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
