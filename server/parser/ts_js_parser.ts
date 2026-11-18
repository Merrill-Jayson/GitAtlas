import fs from 'fs';
import path from 'path';
import type { GraphEdge, GraphNode } from '../../src/types/graph.ts';

function findBlockEndLine(lines: string[], startIndex: number): number {
  let depth = 0;
  let seenOpen = false;
  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];
    for (let c = 0; c < line.length; c++) {
      const ch = line[c];
      if (ch === '{') {
        depth++;
        seenOpen = true;
      } else if (ch === '}') {
        depth--;
        if (seenOpen && depth <= 0) {
          return i + 1;
        }
      }
    }
  }
  return Math.min(lines.length, startIndex + 15);
}

export function parseTsJsFiles(
  repoRoot: string,
  relPaths: string[],
): { nodes: GraphNode[]; edges: GraphEdge[]; warnings: string[] } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const warnings: string[] = [];

  const fileSet = new Set(relPaths);
  const symbolToId = new Map<string, string>();
  const simpleSymbolIndex = new Map<string, string[]>();
  const rawImports: Array<{ modId: string; fromFile: string; spec: string }> = [];
  const callSites: Array<{ callerId: string; relPath: string; snippet: string }> = [];

  const realRoot = fs.realpathSync(repoRoot);

  for (const relPath of relPaths) {
    const absPath = fs.realpathSync(path.join(repoRoot, relPath));
    if (!absPath.startsWith(realRoot + path.sep) && absPath !== realRoot) {
      warnings.push(`Skipped unsafe path: ${relPath}`);
      continue;
    }

    try {
      const content = fs.readFileSync(absPath, 'utf-8');
      const lines = content.split('\n');
      const ext = path.extname(relPath);
      const language = ext === '.ts' || ext === '.tsx' ? 'typescript' : 'javascript';
      const modName = relPath.replace(/\.(tsx?|jsx?|mjs)$/, '').replace(/\//g, '.');

      const fileId = `file:${relPath}`;
      const modId = `mod:${modName}`;

      nodes.push({
        id: fileId,
        type: 'File',
        name: path.basename(relPath),
        file_path: relPath,
        start_line: 1,
        end_line: Math.max(1, lines.length),
        signature: relPath,
        docstring: '',
        language,
        module: modName,
        code_snippet: lines.slice(0, 40).join('\n'),
      });

      nodes.push({
        id: modId,
        type: 'Module',
        name: modName,
        file_path: relPath,
        start_line: 1,
        end_line: Math.max(1, lines.length),
        signature: `module ${modName}`,
        docstring: '',
        language,
        module: modName,
      });

      edges.push({
        id: `edge:${fileId}->CONTAINS->${modId}`,
        source: fileId,
        target: modId,
        type: 'CONTAINS',
      });

      const sliceCode = (start: number, end: number) =>
        lines.slice(Math.max(0, start - 1), Math.min(lines.length, end)).join('\n');

      // Extract imports
      const importRegex = /^\s*import\s+.*?\s+from\s+['"]([^'"]+)['"]/;
      // Extract classes
      const classRegex = /^\s*(?:export\s+(?:default\s+)?)?(?:abstract\s+)?class\s+([A-Za-z0-9_]+)(?:\s+extends\s+([A-Za-z0-9_.,\s]+))?/;
      // Extract functions
      const fnRegex = /^\s*(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)/;
      const arrowFnRegex = /^\s*(?:export\s+)?(?:const|let)\s+([A-Za-z0-9_]+)\s*=\s*(?:async\s+)?\(([^)]*)\)\s*(?::\s*([^=]+))?\s*=>/;

      let activeClass: { id: string; name: string; endLine: number } | null = null;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNo = i + 1;

        if (activeClass && lineNo > activeClass.endLine) {
          activeClass = null;
        }

        const impMatch = line.match(importRegex);
        if (impMatch) {
          rawImports.push({ modId, fromFile: relPath, spec: impMatch[1] });
          continue;
        }

        const clsMatch = line.match(classRegex);
        if (clsMatch) {
          const clsName = clsMatch[1];
          const parents = clsMatch[2]
            ? clsMatch[2].split(',').map((s) => s.trim().split(/[\s<]/)[0]).filter(Boolean)
            : [];
          const endLine = findBlockEndLine(lines, i);
          const clsId = `cls:${relPath}:${clsName}`;
          const snippet = sliceCode(lineNo, endLine);

          nodes.push({
            id: clsId,
            type: 'Class',
            name: clsName,
            file_path: relPath,
            start_line: lineNo,
            end_line: endLine,
            signature: parents.length ? `class ${clsName} extends ${parents.join(', ')}` : `class ${clsName}`,
            docstring: '',
            language,
            module: modName,
            parent_classes: parents,
            code_snippet: snippet,
          });

          edges.push({ id: `edge:${fileId}->CONTAINS->${clsId}`, source: fileId, target: clsId, type: 'CONTAINS' });
          edges.push({ id: `edge:${clsId}->DEFINED_IN->${fileId}`, source: clsId, target: fileId, type: 'DEFINED_IN' });

          symbolToId.set(`${relPath}:${clsName}`, clsId);
          simpleSymbolIndex.set(clsName, [...(simpleSymbolIndex.get(clsName) ?? []), clsId]);
          activeClass = { id: clsId, name: clsName, endLine };
          continue;
        }

        const fnMatch = line.match(fnRegex) ?? line.match(arrowFnRegex);
        if (fnMatch) {
          const fnName = fnMatch[1];
          const rawParams = fnMatch[2] ?? '';
          const params = rawParams
            .split(',')
            .map((p) => p.trim().split(/[:=]/)[0].trim())
            .filter(Boolean);
          const endLine = findBlockEndLine(lines, i);
          const fnId = `fn:${relPath}:${fnName}`;
          const snippet = sliceCode(lineNo, endLine);

          nodes.push({
            id: fnId,
            type: 'Function',
            name: fnName,
            file_path: relPath,
            start_line: lineNo,
            end_line: endLine,
            signature: `function ${fnName}(${params.join(', ')})`,
            docstring: '',
            language,
            module: modName,
            parameters: params,
            code_snippet: snippet,
          });

          edges.push({ id: `edge:${fileId}->CONTAINS->${fnId}`, source: fileId, target: fnId, type: 'CONTAINS' });
          edges.push({ id: `edge:${fnId}->DEFINED_IN->${fileId}`, source: fnId, target: fileId, type: 'DEFINED_IN' });
          symbolToId.set(`${relPath}:${fnName}`, fnId);
          simpleSymbolIndex.set(fnName, [...(simpleSymbolIndex.get(fnName) ?? []), fnId]);
          callSites.push({ callerId: fnId, relPath, snippet });
          continue;
        }

        if (activeClass) {
          const methodMatch = line.match(/^\s+(?:public|private|protected|async|static|\s)*([A-Za-z0-9_]+)\s*\(([^)]*)\)\s*(?::\s*[^{]+)?\s*\{/);
          if (methodMatch && !['if', 'for', 'while', 'switch', 'catch'].includes(methodMatch[1])) {
            const mName = methodMatch[1];
            const rawParams = methodMatch[2] ?? '';
            const params = rawParams
              .split(',')
              .map((p) => p.trim().split(/[:=]/)[0].trim())
              .filter(Boolean);
            const endLine = findBlockEndLine(lines, i);
            const fnQual = `${activeClass.name}.${mName}`;
            const fnId = `fn:${relPath}:${fnQual}`;
            const snippet = sliceCode(lineNo, endLine);

            nodes.push({
              id: fnId,
              type: 'Function',
              name: fnQual,
              file_path: relPath,
              start_line: lineNo,
              end_line: endLine,
              signature: `${mName}(${params.join(', ')})`,
              docstring: '',
              language,
              module: modName,
              parameters: params,
              code_snippet: snippet,
            });

            edges.push({ id: `edge:${activeClass.id}->CONTAINS->${fnId}`, source: activeClass.id, target: fnId, type: 'CONTAINS' });
            edges.push({ id: `edge:${fnId}->DEFINED_IN->${fileId}`, source: fnId, target: fileId, type: 'DEFINED_IN' });
            symbolToId.set(`${relPath}:${fnQual}`, fnId);
            simpleSymbolIndex.set(mName, [...(simpleSymbolIndex.get(mName) ?? []), fnId]);
            callSites.push({ callerId: fnId, relPath, snippet });
          }
        }
      }
    } catch (err) {
      warnings.push(`Failed parsing ${relPath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const seenEdges = new Set(edges.map((e) => e.id));
  const addEdge = (edge: GraphEdge) => {
    if (seenEdges.has(edge.id) || edge.source === edge.target) return;
    seenEdges.add(edge.id);
    edges.push(edge);
  };

  for (const imp of rawImports) {
    if (!imp.spec.startsWith('.')) continue;
    const baseDir = path.posix.dirname(imp.fromFile.replace(/\\/g, '/'));
    const joined = path.posix.normalize(path.posix.join(baseDir, imp.spec));
    const candidates = [
      joined,
      `${joined}.ts`,
      `${joined}.tsx`,
      `${joined}.js`,
      `${joined}.jsx`,
      `${joined}/index.ts`,
      `${joined}/index.tsx`,
      `${joined}/index.js`,
    ];
    const match = candidates.find((c) => fileSet.has(c));
    if (match) {
      const targetMod = `mod:${match.replace(/\.(tsx?|jsx?|mjs)$/, '').replace(/\//g, '.')}`;
      addEdge({ id: `edge:${imp.modId}->IMPORTS->${targetMod}`, source: imp.modId, target: targetMod, type: 'IMPORTS' });
    }
  }

  for (const n of nodes) {
    if (n.type === 'Class' && n.parent_classes?.length) {
      for (const p of n.parent_classes) {
        const matches = simpleSymbolIndex.get(p) ?? [];
        if (matches.length > 0) {
          addEdge({ id: `edge:${n.id}->EXTENDS->${matches[0]}`, source: n.id, target: matches[0], type: 'EXTENDS' });
        }
      }
    }
  }

  const callExprRegex = /\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
  for (const site of callSites) {
    let match: RegExpExecArray | null;
    while ((match = callExprRegex.exec(site.snippet)) !== null) {
      const name = match[1];
      if (['if', 'for', 'while', 'switch', 'catch', 'function', 'return'].includes(name)) continue;
      const sameFile = symbolToId.get(`${site.relPath}:${name}`);
      if (sameFile) {
        addEdge({ id: `edge:${site.callerId}->CALLS->${sameFile}`, source: site.callerId, target: sameFile, type: 'CALLS' });
      } else {
        const globalMatches = simpleSymbolIndex.get(name) ?? [];
        if (globalMatches.length === 1) {
          addEdge({
            id: `edge:${site.callerId}->CALLS->${globalMatches[0]}`,
            source: site.callerId,
            target: globalMatches[0],
            type: 'CALLS',
            uncertain: true,
            reason: `Resolved ${name}() by unique repository symbol match`,
          });
        }
      }
    }
  }

  return { nodes, edges, warnings };
}
