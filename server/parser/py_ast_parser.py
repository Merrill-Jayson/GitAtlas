import ast
import json
import os
import sys
from typing import Any


def safe_unparse(node: ast.AST | None) -> str:
    if node is None:
        return ""
    try:
        return ast.unparse(node)
    except Exception:
        return ""


def get_docstring(node: ast.AST) -> str:
    try:
        doc = ast.get_docstring(node)
        return doc.strip() if doc else ""
    except Exception:
        return ""


def file_to_module_name(rel_path: str) -> str:
    norm = rel_path.replace("\\", "/")
    if norm.endswith("/__init__.py"):
        norm = norm[: -len("/__init__.py")]
    elif norm.endswith(".py"):
        norm = norm[: -len(".py")]
    return norm.replace("/", ".").strip(".")


def extract_call_target_parts(node: ast.AST) -> list[str]:
    parts: list[str] = []
    cur: ast.AST | None = node
    while isinstance(cur, ast.Attribute):
        parts.append(cur.attr)
        cur = cur.value
    if isinstance(cur, ast.Name):
        parts.append(cur.id)
    elif isinstance(cur, ast.Call):
        # e.g. super().method()
        inner = extract_call_target_parts(cur.func)
        if inner:
            parts.append("()".join([".".join(inner)]) + "()")
    parts.reverse()
    return parts


def parse_repository(repo_root: str, files: list[str]) -> dict[str, Any]:
    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []
    warnings: list[str] = []

    # Indexes across all files for cross-module resolution
    module_to_file: dict[str, str] = {}
    symbol_index: dict[str, str] = {}  # "module.Symbol" -> node_id
    simple_class_index: dict[str, list[str]] = {}  # "ClassName" -> [node_id]
    simple_func_index: dict[str, list[str]] = {}  # "func_name" -> [node_id]
    class_methods: dict[str, dict[str, str]] = {}  # class_node_id -> {method_name: func_node_id}
    class_bases: dict[str, list[str]] = {}  # class_node_id -> [base_name]
    class_attr_types: dict[str, dict[str, str]] = {}  # class_node_id -> {attr_name: TypeName}

    parsed_files: list[tuple[str, str, ast.Module, list[str]]] = []

    for rel_path in files:
        abs_path = os.path.realpath(os.path.join(repo_root, rel_path))
        real_root = os.path.realpath(repo_root)
        if not abs_path.startswith(real_root + os.sep) and abs_path != real_root:
            warnings.append(f"Skipped unsafe path outside repo root: {rel_path}")
            continue
        try:
            with open(abs_path, "r", encoding="utf-8", errors="replace") as f:
                source = f.read()
            tree = ast.parse(source, filename=rel_path)
            lines = source.splitlines()
            mod_name = file_to_module_name(rel_path)
            if mod_name:
                module_to_file[mod_name] = rel_path
            parsed_files.append((rel_path, mod_name, tree, lines))
        except SyntaxError as e:
            warnings.append(f"SyntaxError in {rel_path} line {e.lineno}: {e.msg}")
        except Exception as e:
            warnings.append(f"Failed parsing {rel_path}: {str(e)}")

    def slice_lines(lines: list[str], start: int, end: int) -> str:
        s = max(0, start - 1)
        e = min(len(lines), end)
        return "\n".join(lines[s:e])

    # Pass 1: Extract File, Module, Class, and Function nodes + CONTAINS / DEFINED_IN
    file_imports: dict[str, dict[str, str]] = {}  # rel_path -> {local_alias: "target_module.Symbol" or "target_module"}
    raw_imports: list[tuple[str, str, str, int]] = []  # (from_rel_path, mod_node_id, target_module, line)
    call_sites: list[dict[str, Any]] = []

    for rel_path, mod_name, tree, lines in parsed_files:
        total_lines = max(1, len(lines))
        file_id = f"file:{rel_path}"
        mod_id = f"mod:{mod_name or rel_path}"

        nodes.append({
            "id": file_id,
            "type": "File",
            "name": os.path.basename(rel_path),
            "file_path": rel_path,
            "start_line": 1,
            "end_line": total_lines,
            "signature": rel_path,
            "docstring": get_docstring(tree),
            "language": "python",
            "module": mod_name,
            "code_snippet": "\n".join(lines[:40]),
        })

        nodes.append({
            "id": mod_id,
            "type": "Module",
            "name": mod_name or os.path.basename(rel_path),
            "file_path": rel_path,
            "start_line": 1,
            "end_line": total_lines,
            "signature": f"module {mod_name}",
            "docstring": get_docstring(tree),
            "language": "python",
            "module": mod_name,
        })

        edges.append({
            "id": f"edge:{file_id}->CONTAINS->{mod_id}",
            "source": file_id,
            "target": mod_id,
            "type": "CONTAINS",
        })

        alias_map: dict[str, str] = {}
        file_imports[rel_path] = alias_map

        # Collect imports
        for stmt in ast.walk(tree):
            if isinstance(stmt, ast.Import):
                for alias in stmt.names:
                    local = alias.asname or alias.name.split(".")[0]
                    alias_map[local] = alias.name
                    raw_imports.append((rel_path, mod_id, alias.name, getattr(stmt, "lineno", 1)))
            elif isinstance(stmt, ast.ImportFrom):
                base_mod = stmt.module or ""
                if stmt.level and mod_name:
                    parts = mod_name.split(".")
                    prefix = ".".join(parts[: max(0, len(parts) - stmt.level)])
                    base_mod = f"{prefix}.{base_mod}".strip(".")
                for alias in stmt.names:
                    local = alias.asname or alias.name
                    fq = f"{base_mod}.{alias.name}".strip(".")
                    alias_map[local] = fq
                    raw_imports.append((rel_path, mod_id, base_mod or fq, getattr(stmt, "lineno", 1)))

        # Walk top-level statements for classes & top-level functions
        for stmt in tree.body:
            if isinstance(stmt, ast.ClassDef):
                cls_id = f"cls:{rel_path}:{stmt.name}"
                end_ln = getattr(stmt, "end_lineno", stmt.lineno)
                bases = [safe_unparse(b) for b in stmt.bases if safe_unparse(b)]
                sig = f"class {stmt.name}({', '.join(bases)})" if bases else f"class {stmt.name}"

                nodes.append({
                    "id": cls_id,
                    "type": "Class",
                    "name": stmt.name,
                    "file_path": rel_path,
                    "start_line": stmt.lineno,
                    "end_line": end_ln,
                    "signature": sig,
                    "docstring": get_docstring(stmt),
                    "language": "python",
                    "module": mod_name,
                    "parent_classes": bases,
                    "code_snippet": slice_lines(lines, stmt.lineno, end_ln),
                })

                edges.append({
                    "id": f"edge:{file_id}->CONTAINS->{cls_id}",
                    "source": file_id,
                    "target": cls_id,
                    "type": "CONTAINS",
                })
                edges.append({
                    "id": f"edge:{cls_id}->DEFINED_IN->{file_id}",
                    "source": cls_id,
                    "target": file_id,
                    "type": "DEFINED_IN",
                })

                if mod_name:
                    symbol_index[f"{mod_name}.{stmt.name}"] = cls_id
                simple_class_index.setdefault(stmt.name, []).append(cls_id)
                class_methods.setdefault(cls_id, {})
                class_bases[cls_id] = bases
                class_attr_types.setdefault(cls_id, {})

                for body_item in stmt.body:
                    if isinstance(body_item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                        fn_qual = f"{stmt.name}.{body_item.name}"
                        fn_id = f"fn:{rel_path}:{fn_qual}"
                        fn_end = getattr(body_item, "end_lineno", body_item.lineno)
                        params = [a.arg for a in body_item.args.args]
                        ret = safe_unparse(body_item.returns)
                        arg_str = ", ".join(
                            f"{a.arg}: {safe_unparse(a.annotation)}" if a.annotation else a.arg
                            for a in body_item.args.args
                        )
                        prefix = "async def" if isinstance(body_item, ast.AsyncFunctionDef) else "def"
                        fn_sig = f"{prefix} {body_item.name}({arg_str})" + (f" -> {ret}" if ret else "")

                        # Capture parameter type annotations and self.attr assignments
                        param_types: dict[str, str] = {}
                        for a in body_item.args.args:
                            if a.annotation:
                                param_types[a.arg] = safe_unparse(a.annotation)

                        for sub in ast.walk(body_item):
                            if isinstance(sub, ast.Assign):
                                for tgt in sub.targets:
                                    if (
                                        isinstance(tgt, ast.Attribute)
                                        and isinstance(tgt.value, ast.Name)
                                        and tgt.value.id == "self"
                                    ):
                                        if isinstance(sub.value, ast.Name) and sub.value.id in param_types:
                                            class_attr_types[cls_id][tgt.attr] = param_types[sub.value.id]
                                        elif isinstance(sub.value, ast.Call):
                                            c_parts = extract_call_target_parts(sub.value.func)
                                            if c_parts:
                                                class_attr_types[cls_id][tgt.attr] = c_parts[-1]
                            elif isinstance(sub, ast.AnnAssign):
                                if (
                                    isinstance(sub.target, ast.Attribute)
                                    and isinstance(sub.target.value, ast.Name)
                                    and sub.target.value.id == "self"
                                    and sub.annotation
                                ):
                                    class_attr_types[cls_id][sub.target.attr] = safe_unparse(sub.annotation)

                        nodes.append({
                            "id": fn_id,
                            "type": "Function",
                            "name": fn_qual,
                            "file_path": rel_path,
                            "start_line": body_item.lineno,
                            "end_line": fn_end,
                            "signature": fn_sig,
                            "docstring": get_docstring(body_item),
                            "language": "python",
                            "module": mod_name,
                            "parameters": params,
                            "return_type": ret or None,
                            "code_snippet": slice_lines(lines, body_item.lineno, fn_end),
                        })

                        edges.append({
                            "id": f"edge:{cls_id}->CONTAINS->{fn_id}",
                            "source": cls_id,
                            "target": fn_id,
                            "type": "CONTAINS",
                        })
                        edges.append({
                            "id": f"edge:{fn_id}->DEFINED_IN->{file_id}",
                            "source": fn_id,
                            "target": file_id,
                            "type": "DEFINED_IN",
                        })

                        class_methods[cls_id][body_item.name] = fn_id
                        if mod_name:
                            symbol_index[f"{mod_name}.{fn_qual}"] = fn_id
                        simple_func_index.setdefault(body_item.name, []).append(fn_id)

                        call_sites.append({
                            "caller_id": fn_id,
                            "rel_path": rel_path,
                            "cls_id": cls_id,
                            "param_types": param_types,
                            "ast_node": body_item,
                        })

            elif isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef)):
                fn_id = f"fn:{rel_path}:{stmt.name}"
                fn_end = getattr(stmt, "end_lineno", stmt.lineno)
                params = [a.arg for a in stmt.args.args]
                ret = safe_unparse(stmt.returns)
                arg_str = ", ".join(
                    f"{a.arg}: {safe_unparse(a.annotation)}" if a.annotation else a.arg
                    for a in stmt.args.args
                )
                prefix = "async def" if isinstance(stmt, ast.AsyncFunctionDef) else "def"
                fn_sig = f"{prefix} {stmt.name}({arg_str})" + (f" -> {ret}" if ret else "")

                param_types = {
                    a.arg: safe_unparse(a.annotation)
                    for a in stmt.args.args
                    if a.annotation
                }

                nodes.append({
                    "id": fn_id,
                    "type": "Function",
                    "name": stmt.name,
                    "file_path": rel_path,
                    "start_line": stmt.lineno,
                    "end_line": fn_end,
                    "signature": fn_sig,
                    "docstring": get_docstring(stmt),
                    "language": "python",
                    "module": mod_name,
                    "parameters": params,
                    "return_type": ret or None,
                    "code_snippet": slice_lines(lines, stmt.lineno, fn_end),
                })

                edges.append({
                    "id": f"edge:{file_id}->CONTAINS->{fn_id}",
                    "source": file_id,
                    "target": fn_id,
                    "type": "CONTAINS",
                })
                edges.append({
                    "id": f"edge:{fn_id}->DEFINED_IN->{file_id}",
                    "source": fn_id,
                    "target": file_id,
                    "type": "DEFINED_IN",
                })

                if mod_name:
                    symbol_index[f"{mod_name}.{stmt.name}"] = fn_id
                simple_func_index.setdefault(stmt.name, []).append(fn_id)

                call_sites.append({
                    "caller_id": fn_id,
                    "rel_path": rel_path,
                    "cls_id": None,
                    "param_types": param_types,
                    "ast_node": stmt,
                })

    def resolve_class_by_name(name: str, rel_path: str) -> str | None:
        clean = name.split("[")[0].strip()
        if "|" in clean:
            clean = clean.split("|")[0].strip()
        aliases = file_imports.get(rel_path, {})
        if clean in aliases:
            fq = aliases[clean]
            if fq in symbol_index:
                return symbol_index[fq]
        # Same file
        same_file_id = f"cls:{rel_path}:{clean}"
        if same_file_id in class_methods:
            return same_file_id
        matches = simple_class_index.get(clean, [])
        return matches[0] if len(matches) == 1 else (matches[0] if matches else None)

    seen_edges: set[str] = {e["id"] for e in edges}

    def add_edge(source: str, target: str, etype: str, uncertain: bool = False, reason: str = "") -> None:
        eid = f"edge:{source}->{etype}->{target}"
        if eid in seen_edges or source == target:
            return
        seen_edges.add(eid)
        edge_obj: dict[str, Any] = {
            "id": eid,
            "source": source,
            "target": target,
            "type": etype,
        }
        if uncertain:
            edge_obj["uncertain"] = True
        if reason:
            edge_obj["reason"] = reason
        edges.append(edge_obj)

    # Pass 2: IMPORTS edges
    for rel_path, mod_id, target_mod, _line in raw_imports:
        if target_mod in module_to_file:
            target_mod_id = f"mod:{target_mod}"
            add_edge(mod_id, target_mod_id, "IMPORTS")
        elif target_mod in symbol_index:
            add_edge(mod_id, symbol_index[target_mod], "IMPORTS")

    # Pass 3: EXTENDS edges
    resolved_bases: dict[str, list[str]] = {}
    for cls_id, base_names in class_bases.items():
        rel_path = cls_id.split(":", 2)[1]
        resolved_bases[cls_id] = []
        for b in base_names:
            target_cls = resolve_class_by_name(b, rel_path)
            if target_cls:
                resolved_bases[cls_id].append(target_cls)
                add_edge(cls_id, target_cls, "EXTENDS")

    def find_method_in_hierarchy(cls_id: str, method_name: str, visited: set[str] | None = None) -> str | None:
        if visited is None:
            visited = set()
        if cls_id in visited:
            return None
        visited.add(cls_id)
        methods = class_methods.get(cls_id, {})
        if method_name in methods:
            return methods[method_name]
        for parent_id in resolved_bases.get(cls_id, []):
            found = find_method_in_hierarchy(parent_id, method_name, visited)
            if found:
                return found
        return None

    # Pass 4: CALLS edges
    for site in call_sites:
        caller_id: str = site["caller_id"]
        rel_path: str = site["rel_path"]
        cls_id: str | None = site["cls_id"]
        param_types: dict[str, str] = site["param_types"]
        fn_node: ast.AST = site["ast_node"]
        aliases = file_imports.get(rel_path, {})

        # Track simple local variable assignments inside function: var = ClassName(...)
        local_var_types: dict[str, str] = dict(param_types)
        for sub in ast.walk(fn_node):
            if isinstance(sub, ast.Assign) and isinstance(sub.value, ast.Call):
                cparts = extract_call_target_parts(sub.value.func)
                if cparts:
                    for tgt in sub.targets:
                        if isinstance(tgt, ast.Name):
                            local_var_types[tgt.id] = cparts[-1]

        for sub in ast.walk(fn_node):
            if not isinstance(sub, ast.Call):
                continue

            parts = extract_call_target_parts(sub.func)
            if not parts:
                continue

            # Flag explicit dynamic reflection calls
            if parts[0] in {"getattr", "eval", "exec", "__import__"}:
                target_ctx = cls_id or f"file:{rel_path}"
                add_edge(
                    caller_id,
                    target_ctx,
                    "CALLS",
                    uncertain=True,
                    reason=f"Dynamic reflection via {parts[0]}() cannot be statically resolved",
                )
                continue

            # Case 1: self.method(...) or self.attr.method(...)
            if parts[0] == "self" and cls_id:
                if len(parts) == 2:
                    method_name = parts[1]
                    target_fn = find_method_in_hierarchy(cls_id, method_name)
                    if target_fn:
                        add_edge(caller_id, target_fn, "CALLS")
                elif len(parts) >= 3:
                    attr_name = parts[1]
                    method_name = parts[2]
                    # Check class attribute type
                    attr_type = class_attr_types.get(cls_id, {}).get(attr_name)
                    if not attr_type:
                        # Check parent class attributes
                        for parent_id in resolved_bases.get(cls_id, []):
                            attr_type = class_attr_types.get(parent_id, {}).get(attr_name)
                            if attr_type:
                                break
                    if attr_type:
                        target_cls = resolve_class_by_name(attr_type, rel_path)
                        if target_cls:
                            target_fn = find_method_in_hierarchy(target_cls, method_name)
                            if target_fn:
                                add_edge(caller_id, target_fn, "CALLS")
                                continue
                    # Best-effort fallback by method name
                    candidates = simple_func_index.get(method_name, [])
                    if len(candidates) == 1:
                        add_edge(
                            caller_id,
                            candidates[0],
                            "CALLS",
                            uncertain=True,
                            reason=f"Inferred from self.{attr_name}.{method_name}() without explicit type annotation",
                        )
                continue

            # Case 2: param_or_local.method(...)
            if len(parts) == 2 and parts[0] in local_var_types:
                type_name = local_var_types[parts[0]]
                target_cls = resolve_class_by_name(type_name, rel_path)
                if target_cls:
                    target_fn = find_method_in_hierarchy(target_cls, parts[1])
                    if target_fn:
                        add_edge(caller_id, target_fn, "CALLS")
                        continue

            # Case 3: Direct call func_name(...) or ClassName(...)
            if len(parts) == 1:
                sym = parts[0]
                if sym in aliases:
                    fq = aliases[sym]
                    if fq in symbol_index:
                        add_edge(caller_id, symbol_index[fq], "CALLS")
                        continue
                # Same-file function or class
                same_fn = f"fn:{rel_path}:{sym}"
                same_cls = f"cls:{rel_path}:{sym}"
                if any(n["id"] == same_fn for n in nodes):
                    add_edge(caller_id, same_fn, "CALLS")
                    continue
                if any(n["id"] == same_cls for n in nodes):
                    add_edge(caller_id, same_cls, "CALLS")
                    continue
                if sym in simple_func_index and len(simple_func_index[sym]) == 1:
                    add_edge(caller_id, simple_func_index[sym][0], "CALLS")
                elif sym in simple_class_index and len(simple_class_index[sym]) == 1:
                    add_edge(caller_id, simple_class_index[sym][0], "CALLS")

    return {"nodes": nodes, "edges": edges, "warnings": warnings}


if __name__ == "__main__":
    raw = sys.stdin.read()
    payload = json.loads(raw)
    result = parse_repository(payload["repo_root"], payload["files"])
    sys.stdout.write(json.dumps(result))
