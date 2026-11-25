# -*- coding: utf-8 -*-
"""
判题运行时公共模块：类型归一化、数据结构构建/序列化、结果比较、参考解执行。
被构建脚本与服务端判题引擎共同复用。
"""

import ast
import inspect
import json
import math
from collections import deque


class ListNode:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next


class TreeNode:
    def __init__(self, val=0, left=None, right=None):
        self.val = val
        self.left = left
        self.right = right


class Node:
    def __init__(self, val=0, next=None, random=None):
        self.val = int(val)
        self.next = next
        self.random = random


# ---------------------------------------------------------------------------
# 基础前导：让用户直接粘贴力扣风格的 Solution 即可运行
# ---------------------------------------------------------------------------
_HEADER = '''# --- AlgoForge judge prelude ---
from typing import *
import collections, heapq, bisect, math, functools, itertools, json, sys, io, time, traceback, contextlib
from collections import defaultdict, Counter, deque
from math import inf

class ListNode:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next

class TreeNode:
    def __init__(self, val=0, left=None, right=None):
        self.val = val
        self.left = left
        self.right = right

class Node:
    def __init__(self, val=0, next=None, random=None):
        self.val = int(val)
        self.next = next
        self.random = random
'''


# ---------------------------------------------------------------------------
# 类型归一化：把 Python 注解转成统一的跨语言类型串
# ---------------------------------------------------------------------------
def norm_type(t):
    if not t:
        return "any"
    t = str(t).strip().strip("'\"")
    t = t.replace("typing.", "").replace(" ", "")
    if t in ("None", "NoneType", "void"):
        return "void"
    if t.startswith("Optional[") and t.endswith("]"):
        return norm_type(t[len("Optional["):-1])
    mapping = {
        "List[int]": "int[]",
        "List[float]": "double[]",
        "List[bool]": "bool[]",
        "List[str]": "str[]",
        "List[List[int]]": "int[][]",
        "List[List[float]]": "double[][]",
        "List[List[str]]": "str[][]",
        "List[List[List[str]]]": "str[][][]",
        "List[Optional[ListNode]]": "ListNode[]",
        "List[ListNode]": "ListNode[]",
        "List[Optional[TreeNode]]": "TreeNode[]",
        "int": "int",
        "long": "long",
        "float": "double",
        "bool": "bool",
        "str": "str",
        "ListNode": "ListNode",
        "TreeNode": "TreeNode",
        "Node": "Node",
        "any": "any",
    }
    return mapping.get(t, t)


def parse_python_signature(code):
    """从题库 Python 代码中解析出 Solution 的公开方法及类型注解。"""
    out = {"func": None, "params": [], "ret": "void", "args": [], "class_methods": {}}
    try:
        tree = ast.parse(code)
    except SyntaxError:
        return out

    for node in tree.body:
        if not isinstance(node, ast.ClassDef):
            continue
        methods = {}
        for m in node.body:
            if not isinstance(m, ast.FunctionDef) or m.name.startswith("_"):
                continue
            params = []
            for a in m.args.args[1:]:
                params.append(norm_type(ast.unparse(a.annotation)) if a.annotation else "any")
            ret = norm_type(ast.unparse(m.returns)) if m.returns else "void"
            methods[m.name] = {"params": params, "ret": ret, "args": [a.arg for a in m.args.args[1:]]}
        if node.name == "Solution" and len(methods) == 1:
            name, info = next(iter(methods.items()))
            out.update(func=name, params=info["params"], ret=info["ret"], args=info["args"])
        out["class_methods"][node.name] = methods
    return out


# ---------------------------------------------------------------------------
# 数据结构构建（Python）
# ---------------------------------------------------------------------------
def build_list(arr):
    dummy = ListNode(0)
    cur = dummy
    for x in arr or []:
        cur.next = ListNode(x)
        cur = cur.next
    return dummy.next


def build_cycle(arr, pos):
    arr = arr or []
    if not arr:
        return None
    nodes = [ListNode(x) for x in arr]
    for i in range(len(nodes) - 1):
        nodes[i].next = nodes[i + 1]
    if pos is not None and 0 <= pos < len(nodes):
        nodes[-1].next = nodes[pos]
    return nodes[0]


def build_tree(arr):
    arr = arr or []
    if not arr or arr[0] is None:
        return None
    root = TreeNode(arr[0])
    q = deque([root])
    i = 1
    while q and i < len(arr):
        node = q.popleft()
        if i < len(arr):
            if arr[i] is not None:
                node.left = TreeNode(arr[i])
                q.append(node.left)
            i += 1
        if i < len(arr):
            if arr[i] is not None:
                node.right = TreeNode(arr[i])
                q.append(node.right)
            i += 1
    return root


def build_random_list(pairs):
    if not pairs:
        return None
    nodes = [Node(p[0]) for p in pairs]
    for i in range(len(nodes) - 1):
        nodes[i].next = nodes[i + 1]
    for i, p in enumerate(pairs):
        idx = p[1] if len(p) > 1 else None
        nodes[i].random = nodes[idx] if idx is not None and 0 <= idx < len(nodes) else None
    return nodes[0]


def build_intersect(a, b, skip_a, skip_b):
    """构造相交链表：a 的前 skip_a 个为独立前缀，b 的前 skip_b 个为独立前缀，之后共享尾部。"""
    la, lb = a or [], b or []
    tail = la[skip_a:] if skip_a < len(la) else []
    head_a = build_list(la[:skip_a]) if skip_a > 0 else None
    head_b = build_list(lb[:skip_b]) if skip_b > 0 else None
    shared = build_list(tail)

    if skip_a > 0:
        cur = head_a
        while cur.next:
            cur = cur.next
        cur.next = shared
    else:
        head_a = shared

    if skip_b > 0:
        cur = head_b
        while cur.next:
            cur = cur.next
        cur.next = shared
    else:
        head_b = shared
    return head_a, head_b


def find_tree_node(root, val):
    if root is None:
        return None
    q = deque([root])
    while q:
        n = q.popleft()
        if n.val == val:
            return n
        if n.left:
            q.append(n.left)
        if n.right:
            q.append(n.right)
    return None


def convert_arg(pytype, raw, adapter=None):
    t = norm_type(pytype)
    if t in ("ListNode",):
        return build_list(raw)
    if t == "ListNode[]":
        return [build_list(x) if x is not None else None for x in (raw or [])]
    if t == "TreeNode":
        return build_tree(raw)
    if t == "Node":
        return build_random_list(raw)
    return raw


# ---------------------------------------------------------------------------
# 序列化
# ---------------------------------------------------------------------------
def ser_list(head, limit=20000):
    out, seen = [], set()
    while head is not None and len(out) < limit:
        if id(head) in seen:
            out.append("<cycle>")
            break
        seen.add(id(head))
        out.append(getattr(head, "val", head))
        head = getattr(head, "next", None)
    return out


def ser_tree(root):
    if root is None:
        return []
    out, q = [], deque([root])
    while q:
        n = q.popleft()
        if n is None:
            out.append(None)
            continue
        out.append(n.val)
        q.append(n.left)
        q.append(n.right)
    while out and out[-1] is None:
        out.pop()
    return out


def ser_random_list(head):
    if head is None:
        return []
    nodes, idx, cur = [], {}, head
    while cur is not None and id(cur) not in idx:
        idx[id(cur)] = len(nodes)
        nodes.append(cur)
        cur = cur.next
    out = []
    for n in nodes:
        out.append([n.val, idx.get(id(n.random)) if n.random is not None else None])
    return out


def ser_value(val):
    if val is None or isinstance(val, (int, float, bool, str)):
        return val
    if isinstance(val, ListNode):
        return ser_list(val)
    if isinstance(val, TreeNode):
        return ser_tree(val)
    if isinstance(val, Node):
        return ser_random_list(val)
    if isinstance(val, (list, tuple)):
        return [ser_value(x) for x in val]
    return str(val)


def tree_flatten_values(root):
    out = []
    while root is not None:
        out.append(root.val)
        root = root.right
    return out


class contextlib_redirect:
    """把用户 print 重定向到缓冲区，避免污染判题协议输出。"""

    def __init__(self, buf):
        self.buf = buf

    def __enter__(self):
        self._c = contextlib.redirect_stdout(self.buf)
        self._c.__enter__()
        return self.buf

    def __exit__(self, *a):
        return self._c.__exit__(*a)


_PRELUDE_FUNCS = (
    build_list,
    build_cycle,
    build_tree,
    build_random_list,
    build_intersect,
    find_tree_node,
    ser_list,
    ser_tree,
    ser_random_list,
    ser_value,
    tree_flatten_values,
    contextlib_redirect,
)

PRELUDE = _HEADER + "\n\n" + "\n\n".join(inspect.getsource(f) for f in _PRELUDE_FUNCS) + "\n# --- prelude end ---\n"


# ---------------------------------------------------------------------------
# 比较器
# ---------------------------------------------------------------------------
def _canon_outer(x):
    try:
        return sorted(x, key=lambda v: json.dumps(v, ensure_ascii=False, sort_keys=True))
    except Exception:
        return x


def _canon_all(x):
    if isinstance(x, list):
        return sorted((_canon_all(v) for v in x), key=lambda v: json.dumps(v, ensure_ascii=False, sort_keys=True))
    return x


def _deep_equal(a, b, tol=1e-6):
    if isinstance(a, bool) or isinstance(b, bool):
        return a is b or a == b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        if isinstance(a, float) or isinstance(b, float):
            return math.isclose(a, b, rel_tol=1e-6, abs_tol=tol)
        return a == b
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(_deep_equal(x, y, tol) for x, y in zip(a, b))
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(_deep_equal(a[k], b[k], tol) for k in a)
    return a == b


def _balanced_and_bst(actual_level, nums):
    """校验 sortedArrayToBST 的返回：中序等于原数组且每个节点左右高度差 <= 1。"""
    if not nums:
        return actual_level == []
    if not isinstance(actual_level, list) or not actual_level:
        return False
    root = build_tree(actual_level)

    def inorder(node):
        return inorder(node.left) + [node.val] + inorder(node.right) if node else []

    def height(node):
        if not node:
            return 0
        lh, rh = height(node.left), height(node.right)
        if lh < 0 or rh < 0 or abs(lh - rh) > 1:
            return -1
        return max(lh, rh) + 1

    return inorder(root) == nums and height(root) >= 0


def compare(actual, expected, cmp_name="exact", args=None):
    cmp_name = cmp_name or "exact"
    if cmp_name == "float":
        if isinstance(actual, (int, float)) and isinstance(expected, (int, float)):
            return math.isclose(float(actual), float(expected), rel_tol=1e-6, abs_tol=1e-5)
        return _deep_equal(actual, expected, 1e-5)
    if cmp_name == "unordered":
        return _deep_equal(_canon_outer(actual), _canon_outer(expected), 1e-5)
    if cmp_name == "unordered_all":
        return _deep_equal(_canon_all(actual), _canon_all(expected), 1e-5)
    if cmp_name == "palindrome":
        if not isinstance(actual, str) or not isinstance(expected, str):
            return False
        if len(actual) != len(expected):
            return False
        if actual != actual[::-1]:
            return False
        s = (args or [""])[0]
        return isinstance(s, str) and actual in s
    if cmp_name == "bst":
        return _balanced_and_bst(actual, (args or [[]])[0])
    return _deep_equal(actual, expected, 1e-5)


# ---------------------------------------------------------------------------
# 参考解执行（构建期望输出时使用）
# ---------------------------------------------------------------------------
def make_python_runner(spec, code):
    """返回一段可执行的 Python 源码，逐用例输出 ###CASE### 行。"""
    mode = spec.get("mode", "function")
    cases = spec["cases"]
    params = spec.get("params") or []
    ret = spec.get("ret") or "void"
    checks = spec.get("checks") or []
    adapter = spec.get("adapt")
    ret_ser = spec.get("retSer")

    payload = json.dumps(cases, ensure_ascii=False)
    meta = json.dumps({
        "mode": mode, "params": params, "ret": ret, "checks": checks,
        "adapter": adapter, "retSer": ret_ser,
        "func": spec.get("func"), "cls": spec.get("class"),
        "ops": spec.get("ops") or [],
    }, ensure_ascii=False)

    return PRELUDE + "\n" + code + "\n\n" + f'''
# --- AlgoForge harness ---
import copy as _copy
_META = json.loads({meta!r})
_CASES = json.loads({payload!r})

def _build_arg(t, raw, args_all=None, idx=0):
    t = t or "any"
    if t == "ListNode": return build_list(raw)
    if t == "ListNode[]": return [build_list(x) if x is not None else None for x in (raw or [])]
    if t == "TreeNode": return build_tree(raw)
    if t == "Node": return build_random_list(raw)
    return _copy.deepcopy(raw)

def _ser(v):
    if v is None or isinstance(v, (int, float, bool, str)): return v
    if isinstance(v, ListNode): return ser_list(v)
    if isinstance(v, TreeNode): return ser_tree(v)
    if isinstance(v, Node): return ser_random_list(v)
    if isinstance(v, (list, tuple)): return [_ser(x) for x in v]
    return str(v)

def _node_val(v):
    return None if v is None else getattr(v, "val", v)

def _run_case(i, raw_args):
    t0 = time.perf_counter()
    out_buf = io.StringIO()
    rec = {{"i": i, "ok": True}}
    try:
        if _META["mode"] == "design":
            raise RuntimeError("design mode should not use python runner")
        args = []
        if _META["adapter"] == "cycle":
            args = [build_cycle(raw_args[0], raw_args[1])]
        elif _META["adapter"] == "intersect":
            args = list(build_intersect(raw_args[0], raw_args[1], raw_args[2], raw_args[3]))
        elif _META["adapter"] == "random_list":
            args = [build_random_list(raw_args[0])]
        elif _META["adapter"] == "tree_nodes":
            root = build_tree(raw_args[0])
            args = [root, find_tree_node(root, raw_args[1]), find_tree_node(root, raw_args[2])]
        else:
            args = [_build_arg(t, a) for t, a in zip(_META["params"], raw_args)]
        with contextlib_redirect(out_buf):
            ret = getattr(Solution(), _META["func"])(*args)
        if _META["retSer"] == "node_val":
            rec["ret"] = _node_val(ret)
        elif _META["retSer"] == "tree_flatten":
            rec["ret"] = tree_flatten_values(ret)
        elif ret is None and _META["ret"] in ("ListNode", "TreeNode", "Node"):
            # 空链表 / 空树按力扣约定序列化为 []，与 C/C++/Java 侧保持一致
            rec["ret"] = []
        else:
            rec["ret"] = _ser(ret)
        checks = []
        for ch in _META["checks"]:
            a = args[ch["arg"]]
            if ch.get("mode") == "tree_flatten":
                checks.append(tree_flatten_values(a))
            else:
                checks.append(_ser(a))
        rec["argsAfter"] = checks
    except Exception as e:
        rec["ok"] = False
        rec["error"] = "".join(traceback.format_exception_only(type(e), e)).strip()
        rec["trace"] = traceback.format_exc()[-1500:]
    rec["ms"] = round((time.perf_counter() - t0) * 1000, 2)
    rec["stdout"] = out_buf.getvalue()[:4000]
    return rec

for _i, _raw in enumerate(_CASES):
    try:
        _rec = _run_case(_i, _raw)
    except BaseException as _e:
        _rec = {{"i": _i, "ok": False, "error": repr(_e), "ms": 0, "stdout": ""}}
    print("###CASE###" + json.dumps(_rec, ensure_ascii=False), flush=True)
print("###DONE###", flush=True)
'''


def make_design_python_runner(spec, code):
    payload = json.dumps(spec["cases"], ensure_ascii=False)
    cls = spec["class"]
    ops = spec.get("ops") or []
    return PRELUDE + "\n" + code + "\n\n" + f'''
import copy as _copy
_CLS = globals().get({cls!r})
_OPS = {ops!r}
_CASES = json.loads({payload!r})

def _ser(v):
    if v is None or isinstance(v, (int, float, bool, str)): return v
    if isinstance(v, ListNode): return ser_list(v)
    if isinstance(v, TreeNode): return ser_tree(v)
    if isinstance(v, (list, tuple)): return [_ser(x) for x in v]
    return str(v)

for _i, _case in enumerate(_CASES):
    _t0 = time.perf_counter()
    _ok = True
    _out = []
    _buf = io.StringIO()
    try:
        _obj = None
        for _op, _args in zip(_OPS, _case["args"]):
            with contextlib_redirect(_buf):
                if _op == {cls!r}:
                    _obj = _CLS(*_args)
                    _out.append(None)
                else:
                    _r = getattr(_obj, _op)(*_args)
                    _out.append(_ser(_r))
    except Exception as _e:
        _ok = False
        _err = "".join(traceback.format_exception_only(type(_e), _e)).strip()
        print("###CASE###" + json.dumps({{"i": _i, "ok": False, "error": _err, "ms": 0, "stdout": _buf.getvalue()[:4000], "ret": _out}}, ensure_ascii=False), flush=True)
        continue
    print("###CASE###" + json.dumps({{"i": _i, "ok": _ok, "ret": _out, "ms": round((time.perf_counter()-_t0)*1000, 2), "stdout": _buf.getvalue()[:4000]}}, ensure_ascii=False), flush=True)
print("###DONE###", flush=True)
'''
