import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  GitBranch,
  Send,
  Sparkles,
} from 'lucide-react';
import { Fragment, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../store/useAppStore.ts';
import type { ChatMessage } from '../../types/graph.ts';

const SAMPLE_PROMPTS = [
  'How does authentication reach the database?',
  'What happens when a user places an order?',
  'Which functions call process_refund?',
  'Which classes inherit from BaseRepository?',
];

function FormattedAnswer({
  content,
  validNodeIds,
  onSelectNode,
}: {
  content: string;
  validNodeIds: Set<string>;
  onSelectNode: (nodeId: string) => void;
}) {
  // Split on backticked spans so cited node IDs become interactive focus links
  const lines = content.split('\n');

  const renderInline = (text: string) => {
    const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
    return parts.map((part, idx) => {
      if (part.startsWith('`') && part.endsWith('`')) {
        const inner = part.slice(1, -1);
        const isNodeRef =
          validNodeIds.has(inner) ||
          /^(fn|cls|file|mod):/.test(inner);
        if (isNodeRef) {
          return (
            <button
              key={idx}
              type="button"
              onClick={() => onSelectNode(inner)}
              className="inline-flex items-center px-1.5 py-0.5 mx-0.5 rounded bg-sky-500/15 hover:bg-sky-500/25 text-sky-700 dark:text-sky-300 font-mono text-[11px] transition-colors text-left"
              title="Focus node on graph and inspect source"
            >
              {inner}
            </button>
          );
        }
        return (
          <code
            key={idx}
            className="px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono text-[11px] text-slate-800 dark:text-slate-200"
          >
            {inner}
          </code>
        );
      }
      if (part.startsWith('**') && part.endsWith('**')) {
        return (
          <strong key={idx} className="font-semibold text-slate-900 dark:text-white">
            {part.slice(2, -2)}
          </strong>
        );
      }
      return <Fragment key={idx}>{part}</Fragment>;
    });
  };

  return (
    <div className="space-y-1.5 text-[13px] leading-relaxed text-slate-700 dark:text-slate-300">
      {lines.map((line, idx) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={idx} className="h-1" />;
        if (trimmed.startsWith('### ')) {
          return (
            <h4 key={idx} className="text-xs font-semibold text-slate-900 dark:text-slate-100 pt-1.5">
              {renderInline(trimmed.slice(4))}
            </h4>
          );
        }
        if (trimmed.startsWith('## ')) {
          return (
            <h3 key={idx} className="text-sm font-semibold text-slate-900 dark:text-slate-100 pt-2">
              {renderInline(trimmed.slice(3))}
            </h3>
          );
        }
        if (/^(\d+\.|-|\*)\s/.test(trimmed)) {
          return (
            <div key={idx} className="pl-3 flex gap-2">
              <span className="text-slate-400 shrink-0">•</span>
              <span className="min-w-0">{renderInline(trimmed.replace(/^(\d+\.|-|\*)\s/, ''))}</span>
            </div>
          );
        }
        return <p key={idx}>{renderInline(line)}</p>;
      })}
    </div>
  );
}

function MessageCard({ msg, validNodeIds }: { msg: ChatMessage; validNodeIds: Set<string> }) {
  const [scoresOpen, setScoresOpen] = useState(false);
  const { selectNode, applyHighlightMeta } = useAppStore();

  if (msg.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[88%] rounded-lg px-3.5 py-2.5 bg-blue-600 text-white text-[13px] leading-snug">
          {msg.content}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2.5 border border-slate-200 dark:border-slate-800 rounded-lg p-3.5 bg-slate-50/70 dark:bg-[#0B0F17]">
      {msg.error ? (
        <div className="flex items-start gap-2 text-xs text-rose-600 dark:text-rose-400">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{msg.error}</span>
        </div>
      ) : (
        <>
          <FormattedAnswer
            content={msg.content || (msg.isStreaming ? 'Retrieving subgraph and generating explanation...' : '')}
            validNodeIds={validNodeIds}
            onSelectNode={(id) => void selectNode(id, true)}
          />
          {msg.isStreaming && (
            <div className="text-[11px] font-mono text-sky-500">Streaming grounded response...</div>
          )}
        </>
      )}

      {msg.meta && (
        <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-2">
          <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
            <span className="tabular-nums">
              {msg.meta.node_ids.length} nodes · {msg.meta.edge_ids.length} edges · {msg.meta.embedding_provider}
            </span>
            <button
              type="button"
              onClick={() => applyHighlightMeta(msg.meta!)}
              className="flex items-center gap-1 text-sky-600 dark:text-sky-400 hover:underline font-medium shrink-0"
            >
              <GitBranch className="w-3 h-3" />
              Re-highlight
            </button>
          </div>

          {/* Clickable Citations */}
          {msg.meta.citations.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {msg.meta.citations.slice(0, 8).map((c) => (
                <button
                  key={c.node_id}
                  type="button"
                  onClick={() => void selectNode(c.node_id, true)}
                  className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-[#111827] hover:border-blue-500 text-[11px] font-mono text-slate-700 dark:text-slate-200 transition-colors truncate max-w-full"
                  title={`${c.file_path}:${c.start_line}-${c.end_line}`}
                >
                  {c.name} <span className="text-slate-400">:{c.start_line}</span>
                </button>
              ))}
            </div>
          )}

          {/* Expandable Retrieval Scores */}
          <div>
            <button
              type="button"
              onClick={() => setScoresOpen(!scoresOpen)}
              className="flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
            >
              {scoresOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              Retrieval provenance &amp; RRF scores
            </button>
            {scoresOpen && (
              <div className="mt-2 max-h-40 overflow-y-auto border border-slate-200 dark:border-slate-800 rounded bg-white dark:bg-[#111827]">
                <table className="w-full text-[10px] font-mono tabular-nums">
                  <thead className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                    <tr>
                      <th className="text-left px-2 py-1 font-medium">Entity</th>
                      <th className="text-right px-1.5 py-1 font-medium">Hop</th>
                      <th className="text-right px-1.5 py-1 font-medium">BM25</th>
                      <th className="text-right px-1.5 py-1 font-medium">Vec</th>
                      <th className="text-right px-2 py-1 font-medium">RRF</th>
                    </tr>
                  </thead>
                  <tbody>
                    {msg.meta.retrieval_scores.slice(0, 10).map((s) => (
                      <tr
                        key={s.node_id}
                        onClick={() => void selectNode(s.node_id, true)}
                        className="border-b last:border-0 border-slate-100 dark:border-slate-800/60 hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer"
                      >
                        <td className="px-2 py-1 truncate max-w-[140px] text-slate-800 dark:text-slate-200">
                          {s.name}
                        </td>
                        <td className="px-1.5 py-1 text-right text-slate-500">{s.hop_distance}</td>
                        <td className="px-1.5 py-1 text-right text-slate-500">{s.bm25_score.toFixed(2)}</td>
                        <td className="px-1.5 py-1 text-right text-slate-500">{s.vector_score.toFixed(2)}</td>
                        <td className="px-2 py-1 text-right text-sky-600 dark:text-sky-400">
                          {s.rrf_score.toFixed(4)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function ChatPanel() {
  const [input, setInput] = useState('');
  const endRef = useRef<HTMLDivElement | null>(null);

  const {
    activeRepoId,
    activeRepo,
    graphNodes,
    messagesByRepo,
    isStreamingChat,
    retrievalMode,
    setRetrievalMode,
    sendChatQuestion,
  } = useAppStore();

  const messages = activeRepoId ? (messagesByRepo[activeRepoId] ?? []) : [];
  const validNodeIds = new Set(graphNodes.map((n) => n.id));

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, messages[messages.length - 1]?.content]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isStreamingChat) return;
    const q = input;
    setInput('');
    await sendChatQuestion(q);
  };

  return (
    <aside className="w-full lg:w-[400px] shrink-0 border-l border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0F141F] flex flex-col min-h-0">
      {/* Header */}
      <div className="p-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles className="w-4 h-4 text-blue-500 shrink-0" />
          <h2 className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
            Codebase Explainer
          </h2>
        </div>

        <div className="flex items-center gap-1 p-0.5 rounded-md bg-slate-100 dark:bg-[#0B0F17] border border-slate-200/70 dark:border-slate-800 shrink-0">
          <button
            type="button"
            onClick={() => setRetrievalMode('hybrid-graph-rag')}
            className={`px-2 py-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap ${
              retrievalMode === 'hybrid-graph-rag'
                ? 'bg-white dark:bg-[#1E293B] text-slate-900 dark:text-slate-100 shadow-xs'
                : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            Graph-RAG
          </button>
          <button
            type="button"
            onClick={() => setRetrievalMode('vector-only')}
            className={`px-2 py-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap ${
              retrievalMode === 'vector-only'
                ? 'bg-white dark:bg-[#1E293B] text-slate-900 dark:text-slate-100 shadow-xs'
                : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            Vector-Only
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 ? (
          <div className="space-y-4 pt-2">
            <div className="space-y-1">
              <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                Ask about execution flows &amp; architecture
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Questions trigger BM25 + Gemini vector fusion and N-hop graph expansion. Cited nodes illuminate on the canvas.
              </p>
            </div>

            <div className="space-y-1.5">
              {SAMPLE_PROMPTS.map((q) => (
                <button
                  key={q}
                  type="button"
                  disabled={!activeRepo || activeRepo.status !== 'ready' || isStreamingChat}
                  onClick={() => void sendChatQuestion(q)}
                  className="w-full text-left px-3 py-2 text-xs rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] hover:border-blue-500/60 text-slate-700 dark:text-slate-300 transition-colors disabled:opacity-50"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => <MessageCard key={m.id} msg={m} validNodeIds={validNodeIds} />)
        )}
        <div ref={endRef} />
      </div>

      {/* Input Bar */}
      <form
        onSubmit={handleSubmit}
        className="p-3 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0F141F]"
      >
        <div className="flex items-end gap-2">
          <textarea
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleSubmit(e);
              }
            }}
            placeholder={
              activeRepo?.status === 'ready'
                ? 'Ask how a flow, class, or dependency works...'
                : 'Waiting for repository indexing...'
            }
            disabled={!activeRepo || activeRepo.status !== 'ready' || isStreamingChat}
            className="flex-1 resize-none rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] px-3 py-2 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-blue-500 disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={!input.trim() || isStreamingChat || activeRepo?.status !== 'ready'}
            className="px-3 py-2 rounded-md bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white transition-colors shrink-0 h-[36px] flex items-center justify-center"
            title="Send question"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      </form>
    </aside>
  );
}
