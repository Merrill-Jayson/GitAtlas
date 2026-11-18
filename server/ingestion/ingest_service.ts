import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type {
  FileTreeNode,
  GraphNode,
  IngestionStage,
  RepositorySummary,
} from '../../src/types/graph.ts';
import {
  deleteRepositoryVectors,
  indexRepositoryEmbeddings,
  loadRepositoryVectors,
} from '../embeddings/embedding_service.ts';
import { graphStore } from '../graph/graph_store.ts';
import { parseRepositoryCodebase } from '../parser/index.ts';
import { buildBm25Index, deleteBm25Index } from '../retrieval/hybrid_retriever.ts';

const DATA_ROOT = path.resolve(process.cwd(), '.data', 'repos');
const SAMPLE_REPO_PATH = path.resolve(process.cwd(), 'sample_repositories', 'shopflow_api');

const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  '__pycache__',
  '.venv',
  'venv',
  'env',
  'dist',
  'build',
  '.next',
  '.pytest_cache',
  '.mypy_cache',
  '.tox',
  'coverage',
  'eggs',
  '.eggs',
]);

const SUPPORTED_EXT_LANG: Record<string, string> = {
  '.py': 'python',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
};

const MAX_FILES = 180;
const MAX_TOTAL_BYTES = 25 * 1024 * 1024; // 25MB source cap

const repositories = new Map<string, RepositorySummary>();
const repoFileTrees = new Map<string, FileTreeNode[]>();

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function validatePublicGitHubUrl(rawUrl: string): { valid: boolean; normalized?: string; repoName?: string; error?: string } {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return { valid: false, error: 'Repository URL is required.' };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, error: 'Invalid URL format. Expected https://github.com/owner/repository' };
  }

  if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== 'github.com') {
    return { valid: false, error: 'Only public https://github.com/owner/repository URLs are supported.' };
  }

  const parts = parsed.pathname.replace(/^\/+|\/+$/g, '').split('/');
  if (parts.length < 2) {
    return { valid: false, error: 'GitHub URL must include both owner and repository name.' };
  }

  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/, '');
  const safePattern = /^[A-Za-z0-9_.-]+$/;
  if (!safePattern.test(owner) || !safePattern.test(repo) || owner === '..' || repo === '..') {
    return { valid: false, error: 'Repository owner or name contains unsupported characters.' };
  }

  return {
    valid: true,
    normalized: `https://github.com/${owner}/${repo}.git`,
    repoName: `${owner}/${repo}`,
  };
}

function appendLog(repo: RepositorySummary, stage: IngestionStage, message: string, level: 'info' | 'warn' | 'error' = 'info') {
  repo.stage = stage;
  repo.message = message;
  repo.logs.push({
    timestamp: new Date().toISOString(),
    stage,
    message,
    level,
  });
}

function cloneGitHubRepo(cloneUrl: string, targetDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['clone', '--depth', '1', '--single-branch', cloneUrl, targetDir], {
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Repository clone timed out after 45 seconds.'));
    }, 45000);

    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        if (/Authentication failed|could not read Username|Repository not found/i.test(stderr)) {
          reject(new Error('Repository is private, missing, or inaccessible without credentials.'));
        } else {
          reject(new Error(`Git clone failed: ${stderr.trim() || `exit code ${code}`}`));
        }
        return;
      }
      resolve();
    });
  });
}

function copyDirectorySafe(src: string, dst: string): void {
  ensureDir(dst);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDirectorySafe(srcPath, dstPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

function discoverSourceFiles(repoRoot: string): {
  files: string[];
  languages: Record<string, number>;
  skippedCount: number;
} {
  const files: string[] = [];
  const languages: Record<string, number> = {};
  let totalBytes = 0;
  let skippedCount = 0;

  const walk = (dir: string) => {
    if (files.length >= MAX_FILES) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (files.length >= MAX_FILES) {
        skippedCount++;
        continue;
      }
      if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        const lang = SUPPORTED_EXT_LANG[ext];
        if (!lang) continue;
        const stat = fs.statSync(fullPath);
        if (stat.size > 512 * 1024 || totalBytes + stat.size > MAX_TOTAL_BYTES) {
          skippedCount++;
          continue;
        }
        totalBytes += stat.size;
        const rel = path.relative(repoRoot, fullPath).replace(/\\/g, '/');
        files.push(rel);
        languages[lang] = (languages[lang] ?? 0) + 1;
      }
    }
  };

  walk(repoRoot);
  return { files, languages, skippedCount };
}

function buildFileTree(files: string[], nodes: GraphNode[]): FileTreeNode[] {
  const root: FileTreeNode[] = [];
  const entitiesByFile = new Map<string, GraphNode[]>();

  for (const n of nodes) {
    if (n.type === 'Class' || n.type === 'Function') {
      const list = entitiesByFile.get(n.file_path) ?? [];
      list.push(n);
      entitiesByFile.set(n.file_path, list);
    }
  }

  for (const relPath of files) {
    const parts = relPath.split('/');
    let currentLevel = root;
    let accum = '';

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      accum = accum ? `${accum}/${part}` : part;
      const isFile = i === parts.length - 1;

      let existing = currentLevel.find((item) => item.name === part && item.type === (isFile ? 'file' : 'directory'));
      if (!existing) {
        if (isFile) {
          const ext = path.extname(part).toLowerCase();
          const entities = (entitiesByFile.get(relPath) ?? [])
            .sort((a, b) => a.start_line - b.start_line)
            .map((e) => ({
              id: e.id,
              name: e.name,
              type: e.type,
              start_line: e.start_line,
              end_line: e.end_line,
            }));
          existing = {
            name: part,
            path: relPath,
            type: 'file',
            language: SUPPORTED_EXT_LANG[ext] ?? 'text',
            entities,
          };
        } else {
          existing = {
            name: part,
            path: accum,
            type: 'directory',
            children: [],
          };
        }
        currentLevel.push(existing);
      }
      if (!isFile && existing.children) {
        currentLevel = existing.children;
      }
    }
  }

  const sortTree = (items: FileTreeNode[]) => {
    items.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const item of items) {
      if (item.children) sortTree(item.children);
    }
  };
  sortTree(root);
  return root;
}

function persistRepoArtifacts(
  repoId: string,
  summary: RepositorySummary,
  tree: FileTreeNode[],
  vectors: Map<string, number[]>,
  provider: 'gemini-embedding-2' | 'lexical-fallback',
): void {
  const repoDir = path.join(DATA_ROOT, repoId);
  ensureDir(repoDir);
  fs.writeFileSync(path.join(repoDir, 'summary.json'), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(repoDir, 'tree.json'), JSON.stringify(tree, null, 2));
  fs.writeFileSync(path.join(repoDir, 'graph.json'), JSON.stringify(graphStore.serialize(repoId)));
  fs.writeFileSync(
    path.join(repoDir, 'vectors.json'),
    JSON.stringify({
      provider,
      vectors: Array.from(vectors.entries()),
    }),
  );
}

export function hydratePersistedRepositories(): void {
  ensureDir(DATA_ROOT);
  for (const dirName of fs.readdirSync(DATA_ROOT)) {
    const repoDir = path.join(DATA_ROOT, dirName);
    const summaryPath = path.join(repoDir, 'summary.json');
    const graphPath = path.join(repoDir, 'graph.json');
    const treePath = path.join(repoDir, 'tree.json');
    const vectorsPath = path.join(repoDir, 'vectors.json');
    if (!fs.existsSync(summaryPath) || !fs.existsSync(graphPath)) continue;
    try {
      const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8')) as RepositorySummary;
      const graph = JSON.parse(fs.readFileSync(graphPath, 'utf-8'));
      const tree = fs.existsSync(treePath) ? (JSON.parse(fs.readFileSync(treePath, 'utf-8')) as FileTreeNode[]) : [];
      repositories.set(summary.repository_id, summary);
      repoFileTrees.set(summary.repository_id, tree);
      graphStore.createRepositoryGraph(summary.repository_id, graph.nodes ?? [], graph.edges ?? []);
      buildBm25Index(summary.repository_id, graph.nodes ?? []);

      if (fs.existsSync(vectorsPath)) {
        const vRaw = JSON.parse(fs.readFileSync(vectorsPath, 'utf-8')) as {
          provider: 'gemini-embedding-2' | 'lexical-fallback';
          vectors: Array<[string, number[]]>;
        };
        loadRepositoryVectors(summary.repository_id, {
          provider: vRaw.provider,
          vectors: new Map(vRaw.vectors),
        });
      }
    } catch {
      // Skip corrupted persisted repo state
    }
  }
}

async function runIngestionPipeline(
  repoId: string,
  summary: RepositorySummary,
  cloneUrl?: string,
): Promise<void> {
  const repoDir = path.join(DATA_ROOT, repoId);
  const sourceDir = path.join(repoDir, 'source');

  try {
    ensureDir(repoDir);

    // Stage 1: Validation
    summary.progress = 10;
    appendLog(summary, 'validation', summary.source_type === 'sample' ? 'Validated built-in ShopFlow Python sample repository.' : `Validated public GitHub URL: ${summary.github_url}`);

    // Stage 2: Download / Copy
    summary.progress = 25;
    if (summary.source_type === 'sample') {
      appendLog(summary, 'download', 'Staging ShopFlow API sample repository source files...');
      copyDirectorySafe(SAMPLE_REPO_PATH, sourceDir);
    } else if (cloneUrl) {
      appendLog(summary, 'download', `Cloning ${summary.name} (shallow depth=1)...`);
      await cloneGitHubRepo(cloneUrl, sourceDir);
    }

    // Stage 3: File discovery
    summary.progress = 42;
    const { files, languages, skippedCount } = discoverSourceFiles(sourceDir);
    summary.file_count = files.length;
    summary.languages = languages;

    if (files.length === 0) {
      throw new Error('No supported Python, TypeScript, or JavaScript source files were found in this repository.');
    }

    appendLog(
      summary,
      'discovery',
      `Discovered ${files.length} source files (${Object.entries(languages).map(([k, v]) => `${v} ${k}`).join(', ')})${skippedCount > 0 ? ` · skipped ${skippedCount} oversized/cap-limit files` : ''}.`,
    );

    // Stage 4: AST Parsing
    summary.progress = 60;
    appendLog(summary, 'parsing', 'Running static AST parser across discovered modules (zero code execution)...');
    const parseResult = await parseRepositoryCodebase(sourceDir, files);
    for (const w of parseResult.warnings) {
      appendLog(summary, 'parsing', w, 'warn');
    }

    // Stage 5: Graph Construction
    summary.progress = 75;
    appendLog(summary, 'graph', `Constructing knowledge graph (${parseResult.nodes.length} entities, ${parseResult.edges.length} relationships)...`);
    graphStore.createRepositoryGraph(repoId, parseResult.nodes, parseResult.edges);
    buildBm25Index(repoId, parseResult.nodes);
    const tree = buildFileTree(files, parseResult.nodes);
    repoFileTrees.set(repoId, tree);
    summary.node_count = parseResult.nodes.length;
    summary.edge_count = parseResult.edges.length;

    // Stage 6: Embedding Generation
    summary.progress = 88;
    appendLog(summary, 'embeddings', 'Generating per-node vector embeddings & BM25 lexical index...');
    const vecIndex = await indexRepositoryEmbeddings(repoId, parseResult.nodes, (done, total, provider) => {
      summary.progress = Math.min(97, 88 + Math.round((done / Math.max(1, total)) * 9));
      if (done === total) {
        appendLog(summary, 'embeddings', `Indexed ${done} code entity vectors using ${provider}.`);
      }
    });

    // Stage 7: Complete
    summary.status = 'ready';
    summary.progress = 100;
    appendLog(summary, 'complete', `Indexing complete: ${summary.file_count} files, ${summary.node_count} nodes, ${summary.edge_count} edges.`);
    persistRepoArtifacts(repoId, summary, tree, vecIndex.vectors, vecIndex.provider);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    summary.status = 'failed';
    summary.error = msg;
    appendLog(summary, 'failed', msg, 'error');
  }
}

export async function startGitHubIngestion(githubUrl: string): Promise<{ summary?: RepositorySummary; error?: string }> {
  const check = validatePublicGitHubUrl(githubUrl);
  if (!check.valid || !check.normalized || !check.repoName) {
    return { error: check.error ?? 'Invalid GitHub URL' };
  }

  const repoId = `repo_${crypto.randomBytes(4).toString('hex')}`;
  const summary: RepositorySummary = {
    repository_id: repoId,
    name: check.repoName,
    source_type: 'github',
    github_url: githubUrl.trim(),
    status: 'processing',
    stage: 'validation',
    progress: 5,
    message: 'Starting repository ingestion...',
    file_count: 0,
    node_count: 0,
    edge_count: 0,
    languages: {},
    created_at: new Date().toISOString(),
    logs: [],
  };
  repositories.set(repoId, summary);

  // Run async in background so frontend can poll /status live
  void runIngestionPipeline(repoId, summary, check.normalized);
  return { summary };
}

export async function ensureSampleRepositoryReady(): Promise<RepositorySummary> {
  const existing = repositories.get('repo_shopflow_sample');
  if (existing && existing.status === 'ready' && graphStore.hasRepository('repo_shopflow_sample')) {
    return existing;
  }

  const summary: RepositorySummary = {
    repository_id: 'repo_shopflow_sample',
    name: 'sample/shopflow-api',
    source_type: 'sample',
    status: 'processing',
    stage: 'validation',
    progress: 5,
    message: 'Indexing ShopFlow API sample repository...',
    file_count: 0,
    node_count: 0,
    edge_count: 0,
    languages: {},
    created_at: new Date().toISOString(),
    logs: [],
  };
  repositories.set(summary.repository_id, summary);
  await runIngestionPipeline(summary.repository_id, summary);
  return summary;
}

export function listRepositories(): RepositorySummary[] {
  return Array.from(repositories.values()).sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function getRepositoryStatus(repositoryId: string): RepositorySummary | undefined {
  return repositories.get(repositoryId);
}

export function getRepositoryTree(repositoryId: string): FileTreeNode[] {
  return repoFileTrees.get(repositoryId) ?? [];
}

export function getSourceLines(
  repositoryId: string,
  relFilePath: string,
  startLine?: number,
  endLine?: number,
): { lines: Array<{ line_number: number; content: string }>; total_lines: number } | null {
  const sourceDir = path.join(DATA_ROOT, repositoryId, 'source');
  if (!fs.existsSync(sourceDir)) return null;

  const realRoot = fs.realpathSync(sourceDir);
  const candidate = path.resolve(realRoot, relFilePath);
  if (!fs.existsSync(candidate)) return null;
  const realFile = fs.realpathSync(candidate);
  if (!realFile.startsWith(realRoot + path.sep)) {
    return null;
  }

  const raw = fs.readFileSync(realFile, 'utf-8');
  const allLines = raw.split('\n');
  const start = Math.max(1, startLine ?? 1);
  const end = Math.min(allLines.length, endLine ?? allLines.length);

  const lines: Array<{ line_number: number; content: string }> = [];
  for (let i = start; i <= end; i++) {
    lines.push({ line_number: i, content: allLines[i - 1] ?? '' });
  }
  return { lines, total_lines: allLines.length };
}

export function deleteRepositoryData(repositoryId: string): boolean {
  if (!repositories.has(repositoryId)) return false;
  repositories.delete(repositoryId);
  repoFileTrees.delete(repositoryId);
  graphStore.deleteRepository(repositoryId);
  deleteBm25Index(repositoryId);
  deleteRepositoryVectors(repositoryId);

  const repoDir = path.join(DATA_ROOT, repositoryId);
  if (fs.existsSync(repoDir)) {
    fs.rmSync(repoDir, { recursive: true, force: true });
  }
  return true;
}
