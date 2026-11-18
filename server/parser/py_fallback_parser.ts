import fs from 'fs';
import path from 'path';
import type { GraphEdge, GraphNode } from '../../src/types/graph.ts';

function fileToModuleName(relPath: string): string {
  let norm = relPath.replace(/\\/g, '/');
  if (norm.endsWith('/__init__.py')) norm = norm.slice(0, -'/__init__.py'.length);
  else if (norm.endsWith('.py')) norm = norm.slice(0, -'.py'.length);
  return norm.replace(/\//g, '.').replace(/^\.+|\.+$/g, '');
}

function getIndent(line: string): number {
  const m = line.match(/^(\s*)/);
  return m ? m[1].replace(/\t/g, '    ').length : 0;
}

function findPythonBlockEnd(lines: string[], startIndex: number, baseIndent: number): number {
  let lastContentLine = startIndex + 1;
  for (let i = startIndex + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const indent = getIndent(lines[i]);
    if (indent <= baseIndent) {
      return lastContentLine;
    }
    lastContentLine = i + 1;
  }
  return lastContentLine;
}

function extractTripleDocstring(lines: string[], bodyStartIdx: number): string {
  for (let i = bodyStartIdx; i < Math.min(lines.length, bodyStartIdx + 4); i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    const quote = trimmed.startsWith('"""') ? '"""' : trimmed.startsWith("'''") ? "'''" : null;
    if (!quote) return '';
    const rest = trimmed.slice(3);
    const endIdx = rest.indexOf(quote);
    if (endIdx !== -1) return rest.slice(0, endIdx).trim();
    const acc = [rest];
    for (let j = i + 1; j < Math.min(lines.length, i + 12); j++) {
      const l = lines[j];
      const close = l.indexOf(quote);
      if (close !== -1) {
        acc.push(l.slice(0, close));
        break;
      }
      acc.push(l.trim());
    }
    return acc.join(' ').trim();
  }
  return '';
}

/**
 * Pure TypeScript fallback parser for Python files when the python3 binary is not
 * available in the runtime (such as Node.js serverless environments).
 */
export function parsePythonFallback(
  repoRoot: string,
  relPaths: string[],
): { nodes: GraphNode[]; edges: GraphEdge[]; warnings: string[] } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const warnings: string[] = [];

  const realRoot = fs.realpathSync(repoRoot);
  const moduleToFile = new Map<string, string>();
  const symbolIndex = new Map<string, string>();
  const simpleClassIndex = new Map<string, string[]>();
  const simpleFuncIndex = new Map<string, string[]>();
  const rawImports: Array<{ modId: string; targetMod: string }> = [];
  const callSites: Array<{ callerId: string; relPath: string; clsId: string | null; snippet: string }> = [];

  for (const relPath of relPaths) {
    const modName = fileToModuleName(relPath);
    if (modName) moduleToFile.set(modName, relPath);
  }

  for (const relPath of relPaths) {
    const absPath = fs.realpathSync(path.join(repoRoot, relPath));
    if (!absPath.startsWith(realRoot + path.sep) && absPath !== realRoot) {
      warnings.push(`Skipped unsafe path: ${relPath}`);
      continue;
    }

    try {
      const source = fs.readFileSync(absPath, 'utf-8');
      const lines = source.split('\n');
      const modName = fileToModuleName(relPath);
      const fileId = `file:${relPath}`;
      const modId = `mod:${modName || relPath}`;
      const fileDoc = extractTripleDocstring(lines, 0);

      nodes.push({
        id: fileId,
        type: 'File',
        name: path.basename(relPath),
        file_path: relPath,
        start_line: 1,
        end_line: Math.max(1, lines.length),
        signature: relPath,
        docstring: fileDoc,
        language: 'python',
        module: modName,
        code_snippet: lines.slice(0, 40).join('\n'),
      });

      nodes.push({
        id: modId,
        type: 'Module',
        name: modName || path.basename(relPath),
        file_path: relPath,
        start_line: 1,
        end_line: Math.max(1, lines.length),
        signature: `module ${modName}`,
        docstring: fileDoc,
        language: 'python',
        module: modName,
      });

      edges.push({
        id: `edge:${fileId}->CONTAINS->${modId}`,
        source: fileId,
        target: modId,
        type: 'CONTAINS',
      });

      let activeClass: { id: string; name: string; endLine: number; indent: number } | null = null;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNo = i + 1;
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        const indent = getIndent(line);
        if (activeClass && (lineNo > activeClass.endLine || indent <= activeClass.indent)) {
          activeClass = null;
        }

        const fromImp = trimmed.match(/^from\s+([A-Za-z0-9_.]+)\s+import\s+(.+)$/);
        if (fromImp) {
          const base = fromImp[1].replace(/^\.+/, '');
          rawImports.push({ modId, targetMod: base });
          continue;
        }
        const plainImp = trimmed.match(/^import\s+([A-Za-z0-9_.]+)/);
        if (plainImp) {
          rawImports.push({ modId, targetMod: plainImp[1] });
          continue;
        }

        const clsMatch = trimmed.match(/^class\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(([^)]*)\))?\s*:/);
        if (clsMatch && indent === 0) {
          const clsName = clsMatch[1];
          const bases = (clsMatch[2] ?? '')
            .split(',')
            .map((b) => b.trim().split('[')[0].trim())
            .filter(Boolean);
          const endLine = findPythonBlockEnd(lines, i, indent);
          const clsId = `cls:${relPath}:${clsName}`;
          const snippet = lines.slice(i, endLine).join('\n');

          nodes.push({
            id: clsId,
            type: 'Class',
            name: clsName,
            file_path: relPath,
            start_line: lineNo,
            end_line: endLine,
            signature: bases.length ? `class ${clsName}(${bases.join(', ')})` : `class ${clsName}`,
            docstring: extractTripleDocstring(lines, i + 1),
            language: 'python',
            module: modName,
            parent_classes: bases,
            code_snippet: snippet,
          });

          edges.push({ id: `edge:${fileId}->CONTAINS->${clsId}`, source: fileId, target: clsId, type: 'CONTAINS' });
          edges.push({ id: `edge:${clsId}->DEFINED_IN->{fileId}`.replace('{fileId}', fileId), source: clsId, target: fileId, type: 'DEFINED_IN' });

          if (modName) symbolIndex.set(`${modName}.${clsName}`, clsId);
          simpleClassIndex.set(clsName, [...(simpleClassIndex.get(clsName) ?? []), clsId]);
          activeClass = { id: clsId, name: clsName, endLine, indent };
          continue;
        }

        const fnMatch = trimmed.match(/^(async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*(?:->\s*([^:]+))?\s*:/);
        if (fnMatch) {
          const isAsync = Boolean(fnMatch[1]);
          const fnName = fnMatch[2];
          const rawArgs = fnMatch[3] ?? '';
          const retType = fnMatch[4]?.trim();
          const params = rawArgs
            .split(',')
            .map((p) => p.trim().split(/[:=]/)[0].trim())
            .filter(Boolean);
          const endLine = findPythonBlockEnd(lines, i, indent);
          const isMethod = Boolean(activeClass && indent > activeClass.indent);
          const qualName = isMethod ? `${activeClass!.name}.${fnName}` : fnName;
          const fnId = `fn:${relPath}:${qualName}`;
          const snippet = lines.slice(i, endLine).join('\n');

          nodes.push({
            id: fnId,
            type: 'Function',
            name: qualName,
            file_path: relPath,
            start_line: lineNo,
            end_line: endLine,
            signature: `${isAsync ? 'async def' : 'def'} ${fnName}(${rawArgs.trim()})${retType ? ` -> ${retType}` : ''}`,
            docstring: extractTripleDocstring(lines, i + 1),
            language: 'python',
            module: modName,
            parameters: params,
            return_type: retType,
            code_snippet: snippet,
          });

          const containerId = isMethod ? activeClass!.id : fileId;
          edges.push({ id: `edge:${containerId}->CONTAINS->${fnId}`, source: containerId, target: fnId, type: 'CONTAINS' });
          edges.push({ id: `edge:${fnId}->DEFINED_IN->${fileId}`, source: fnId, target: fileId, type: 'DEFINED_IN' });

          if (modName) symbolIndex.set(`${modName}.${qualName}`, fnId);
          simpleFuncIndex.set(fnName, [...(simpleFuncIndex.get(fnName) ?? []), fnId]);
          callSites.push({ callerId: fnId, relPath, clsId: isMethod ? activeClass!.id : null, snippet });
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
    if (moduleToFile.has(imp.targetMod)) {
      addEdge({ id: `edge:${imp.modId}->IMPORTS->mod:${imp.targetMod}`, source: imp.modId, target: `mod:${imp.targetMod}`, type: 'IMPORTS' });
    }
  }

  for (const n of nodes) {
    if (n.type === 'Class' && n.parent_classes?.length) {
      for (const b of n.parent_classes) {
        const matches = simpleClassIndex.get(b) ?? [];
        if (matches.length > 0) {
          addEdge({ id: `edge:${n.id}->EXTENDS->${matches[0]}`, source: n.id, target: matches[0], type: 'EXTENDS' });
        }
      }
    }
  }

  const callRegex = /\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
  for (const site of callSites) {
    let m: RegExpExecArray | null;
    while ((m = callRegex.exec(site.snippet)) !== null) {
      const sym = m[1];
      if (['def', 'class', 'if', 'for', 'while', 'return', 'print', 'len', 'str', 'int', 'dict', 'list', 'set'].includes(sym)) {
        continue;
      }
      if (['getattr', 'eval', 'exec', '__import__'].includes(sym)) {
        addEdge({
          id: `edge:${site.callerId}->CALLS->${site.clsId ?? `file:${site.relPath}`}`,
          source: site.callerId,
          target: site.clsId ?? `file:${site.relPath}`,
          type: 'CALLS',
          uncertain: true,
          reason: `Dynamic reflection via ${sym}() cannot be statically resolved`,
        });
        continue;
      }
      const matches = simpleFuncIndex.get(sym) ?? [];
      if (matches.length === 1) {
        addEdge({
          id: `edge:${site.callerId}->CALLS->${matches[0]}`,
          source: site.callerId,
          target: matches[0],
          type: 'CALLS',
        });
      }
    }
  }

  return { nodes, edges, warnings };
}
