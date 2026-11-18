import { spawn } from 'child_process';
import path from 'path';
import type { GraphEdge, GraphNode } from '../../src/types/graph.ts';
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

  return new Promise((resolve, reject) => {
    const scriptPath = path.resolve(process.cwd(), 'server', 'parser', 'py_ast_parser.py');
    const child = spawn('python3', [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Python AST parser timed out after 30s'));
    }, 30000);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`Python AST parser exited with code ${code}: ${stderr}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as ParseResult;
        resolve(parsed);
      } catch (err) {
        reject(new Error(`Invalid JSON from Python AST parser: ${err instanceof Error ? err.message : String(err)}`));
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
