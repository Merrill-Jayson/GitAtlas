import { BarChart3, FolderGit2, Moon, Network, Plus, Sun } from 'lucide-react';
import { useEffect } from 'react';
import { ChatPanel } from './components/chat/ChatPanel.tsx';
import { InspectorDrawer } from './components/code-viewer/InspectorDrawer.tsx';
import { EvaluationView } from './components/dashboard/EvaluationView.tsx';
import { GraphCanvas } from './components/graph/GraphCanvas.tsx';
import { IngestModal } from './components/repository/IngestModal.tsx';
import { SidebarExplorer } from './components/repository/SidebarExplorer.tsx';
import { useAppStore } from './store/useAppStore.ts';

export default function App() {
  const {
    theme,
    toggleTheme,
    repositories,
    activeRepoId,
    activeRepo,
    fetchRepositories,
    selectRepository,
    centerView,
    setCenterView,
    setIngestModalOpen,
  } = useAppStore();

  useEffect(() => {
    void fetchRepositories();
  }, [fetchRepositories]);

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-slate-50 dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100">
      {/* Top Navigation Bar — clean 3-zone header */}
      <header className="h-14 shrink-0 px-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0F141F] flex items-center justify-between gap-6">
        {/* Zone 1: Brand Wordmark */}
        <div className="flex items-center gap-2.5 shrink-0">
          <Network className="w-5 h-5 text-blue-500" />
          <span className="font-display text-base font-bold tracking-tight whitespace-nowrap">
            GitAtlas
          </span>
        </div>

        {/* Zone 2: Repository Selector & View Switch */}
        <div className="flex items-center gap-4 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <FolderGit2 className="w-4 h-4 text-slate-400 shrink-0 hidden sm:block" />
            <select
              value={activeRepoId ?? ''}
              onChange={(e) => void selectRepository(e.target.value)}
              aria-label="Active repository"
              className="max-w-[220px] px-2.5 py-1.5 text-xs font-mono rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0F17] text-slate-800 dark:text-slate-200 focus:outline-none focus:border-blue-500 truncate"
            >
              {repositories.map((repo) => (
                <option key={repo.repository_id} value={repo.repository_id}>
                  {repo.name}
                </option>
              ))}
            </select>
          </div>

          {activeRepo && (
            <div className="hidden md:flex items-center gap-2 text-xs font-mono text-slate-500 dark:text-slate-400 tabular-nums whitespace-nowrap">
              <span>{activeRepo.file_count} files</span>
              <span aria-hidden="true">·</span>
              <span>{activeRepo.node_count} nodes</span>
              <span aria-hidden="true">·</span>
              <span>{activeRepo.edge_count} edges</span>
            </div>
          )}

          <nav className="hidden sm:flex items-center gap-1 p-0.5 rounded-md bg-slate-100 dark:bg-[#0B0F17] border border-slate-200/70 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setCenterView('graph')}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                centerView === 'graph'
                  ? 'bg-white dark:bg-[#1E293B] text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              Knowledge Graph
            </button>
            <button
              type="button"
              onClick={() => setCenterView('evaluation')}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                centerView === 'evaluation'
                  ? 'bg-white dark:bg-[#1E293B] text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5" />
              Evaluation
            </button>
          </nav>
        </div>

        {/* Zone 3: Primary Action & Theme Toggle */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={toggleTheme}
            className="p-2 rounded-md border border-slate-200 dark:border-slate-800 text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          <button
            type="button"
            onClick={() => setIngestModalOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            Ingest Repository
          </button>
        </div>
      </header>

      {/* Main IDE Workspace */}
      <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden">
        <SidebarExplorer />

        <main className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
          {centerView === 'evaluation' ? (
            <EvaluationView />
          ) : (
            <>
              <div className="flex-1 min-h-0 relative">
                <GraphCanvas />
              </div>
              <InspectorDrawer />
            </>
          )}
        </main>

        <ChatPanel />
      </div>

      <IngestModal />
    </div>
  );
}
