import { AlertCircle, CheckCircle2, FolderGit2, Loader2, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { useAppStore } from '../../store/useAppStore.ts';
import type { IngestionStage } from '../../types/graph.ts';

const STAGES: Array<{ id: IngestionStage; label: string }> = [
  { id: 'validation', label: 'Repository validation' },
  { id: 'download', label: 'Repository download' },
  { id: 'discovery', label: 'File discovery' },
  { id: 'parsing', label: 'AST parsing' },
  { id: 'graph', label: 'Graph construction' },
  { id: 'embeddings', label: 'Embedding generation' },
  { id: 'complete', label: 'Indexing complete' },
];

const EXAMPLE_REPOS = [
  'https://github.com/psf/requests',
  'https://github.com/pallets/flask',
  'https://github.com/tiangolo/fastapi',
];

export function IngestModal() {
  const [url, setUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const {
    ingestModalOpen,
    setIngestModalOpen,
    ingestGitHubRepo,
    ingestSampleRepo,
    activeRepo,
    repositories,
    deleteRepository,
    selectRepository,
    globalError,
  } = useAppStore();

  if (!ingestModalOpen) return null;

  const activeStageIdx = activeRepo ? STAGES.findIndex((s) => s.id === activeRepo.stage) : -1;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() || submitting) return;
    setSubmitting(true);
    const ok = await ingestGitHubRepo(url.trim());
    setSubmitting(false);
    if (ok) {
      setUrl('');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="w-full max-w-xl rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0F141F] shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <FolderGit2 className="w-5 h-5 text-blue-500" />
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Ingest GitHub Repository
            </h2>
          </div>
          <button
            type="button"
            onClick={() => setIngestModalOpen(false)}
            className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5 max-h-[80vh] overflow-y-auto">
          <form onSubmit={handleSubmit} className="space-y-3">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Public GitHub Repository URL
            </label>
            <div className="flex gap-2">
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://github.com/owner/repository"
                className="flex-1 px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-500"
                required
              />
              <button
                type="submit"
                disabled={submitting || !url.trim()}
                className="px-4 py-2 text-xs font-medium rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white transition-colors whitespace-nowrap shrink-0"
              >
                {submitting ? 'Starting...' : 'Ingest Repository'}
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="text-[11px] text-slate-500">Examples:</span>
              {EXAMPLE_REPOS.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => setUrl(ex)}
                  className="text-[11px] font-mono text-blue-600 dark:text-blue-400 hover:underline"
                >
                  {ex.replace('https://github.com/', '')}
                </button>
              ))}
              <span className="text-slate-400">·</span>
              <button
                type="button"
                onClick={() => void ingestSampleRepo()}
                className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400 hover:underline"
              >
                Reload sample/shopflow-api
              </button>
            </div>
          </form>

          {globalError && (
            <div className="flex items-start gap-2 p-3 rounded-lg border border-rose-500/40 bg-rose-500/10 text-xs text-rose-600 dark:text-rose-400">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{globalError}</span>
            </div>
          )}

          {/* Active Ingestion Pipeline Stages */}
          {activeRepo && (
            <div className="border border-slate-200 dark:border-slate-800 rounded-lg p-4 bg-slate-50 dark:bg-[#0B0F17] space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 font-mono truncate">
                  {activeRepo.name}
                </span>
                <span className="text-xs font-mono text-slate-500 tabular-nums shrink-0">
                  {activeRepo.progress}%
                </span>
              </div>

              <div className="w-full h-1.5 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${
                    activeRepo.status === 'failed'
                      ? 'bg-rose-500'
                      : activeRepo.status === 'ready'
                        ? 'bg-emerald-500'
                        : 'bg-blue-500'
                  }`}
                  style={{ width: `${activeRepo.progress}%` }}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-1">
                {STAGES.map((st, idx) => {
                  const isDone =
                    activeRepo.status === 'ready' ||
                    (activeStageIdx > idx && activeRepo.status !== 'failed');
                  const isCurrent = activeStageIdx === idx && activeRepo.status === 'processing';
                  return (
                    <div
                      key={st.id}
                      className={`flex items-center gap-2 text-xs py-1 ${
                        isDone
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : isCurrent
                            ? 'text-blue-600 dark:text-blue-400 font-medium'
                            : 'text-slate-400 dark:text-slate-600'
                      }`}
                    >
                      {isDone ? (
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      ) : isCurrent ? (
                        <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" />
                      ) : (
                        <span className="w-3.5 h-3.5 rounded-full border border-current inline-block shrink-0" />
                      )}
                      <span>{st.label}</span>
                    </div>
                  );
                })}
              </div>

              {activeRepo.status === 'failed' && activeRepo.error && (
                <p className="text-xs text-rose-500 pt-1">{activeRepo.error}</p>
              )}
            </div>
          )}

          {/* Indexed Repositories List */}
          {repositories.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Indexed Repositories ({repositories.length})
              </h3>
              <div className="divide-y divide-slate-200 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
                {repositories.map((repo) => (
                  <div
                    key={repo.repository_id}
                    className="flex items-center justify-between gap-3 px-3 py-2.5 bg-white dark:bg-[#111827]"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        void selectRepository(repo.repository_id);
                        setIngestModalOpen(false);
                      }}
                      className="min-w-0 text-left flex-1"
                    >
                      <div className="font-mono text-xs font-medium text-slate-900 dark:text-slate-100 truncate hover:text-blue-500">
                        {repo.name}
                      </div>
                      <div className="text-[11px] font-mono text-slate-500 tabular-nums">
                        {repo.file_count} files · {repo.node_count} nodes · {repo.edge_count} edges · {repo.status}
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => void deleteRepository(repo.repository_id)}
                      className="p-1.5 text-slate-400 hover:text-rose-500 transition-colors shrink-0"
                      title="Delete indexed repository data"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
