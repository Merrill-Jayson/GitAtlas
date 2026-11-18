import { spawn } from 'child_process';
import path from 'path';
import type { GraphEdge, GraphNode } from '../../src/types/graph.ts';
import { parsePythonFallback } from './py_fallback_parser.ts';
import { parseTsJsFiles } from './ts_js_parser.ts';

export interface ParseResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  warnings: string[];
}

function runPythonAstParser(repoRoot: string, pyFiles: string[]): Promise<ParseResult> {
  if (pyFiles.length === 0) {
    return Promise.resolve({ nodes: [], edges: [], warnings: [] });
  }

  return new Promise((resolve) => {
    const scriptPath = path.resolve(process.cwd(), 'server', 'parser', 'py_ast_parser.py');
    const child = spawn('python3', [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const fallback = (reason: string) => {
      if (settled) return;
      settled = true;
      const res = parsePythonFallback(repoRoot, pyFiles);
      res.warnings.unshift(`Used TypeScript Python parser fallback (${reason}).`);
      resolve(res);
    };

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      fallback('python3 timed out');
    }, 25000);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      fallback(err.message);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (settled) return;
      if (code !== 0) {
        fallback(`python3 exit ${code}: ${stderr.trim()}`);
        return;
      }
      try {
        settled = true;
        resolve(JSON.parse(stdout) as ParseResult);
      } catch (err) {
        fallback(err instanceof Error ? err.message : 'invalid JSON');
      }
    });

    child.stdin.write(JSON.stringify({ repo_root: repoRoot, files: pyFiles }));
    child.stdin.end();
  });
}

export async function parseRepositoryCodebase(repoRoot: string, files: string[]): Promise<ParseResult> {
  const pyFiles = files.filter((f) => f.endsWith('.py'));
  const tsJsFiles = files.filter((f) => /\.(ts|tsx|js|jsx|mjs)$/.test(f));

  const [pyResult, tsResult] = await Promise.all([
    runPythonAstParser(repoRoot, pyFiles),
    Promise.resolve(tsJsFiles.length > 0 ? parseTsJsFiles(repoRoot, tsJsFiles) : { nodes: [], edges: [], warnings: [] }),
  ]);

  return {
    nodes: [...pyResult.nodes, ...tsResult.nodes],
    edges: [...pyResult.edges, ...tsResult.edges],
    warnings: [...pyResult.warnings, ...tsResult.warnings],
  };
}
