# -*- coding: utf-8 -*-
"""
AlgoForge 判题引擎：LeetCode 式逐用例判题。

支持语言：Python 3 / C++17 / Java / C11
- Python：注入 ListNode/TreeNode 前导，直接 exec 用户代码，逐用例调用
- C++/Java/C：按题目签名生成驱动代码，编译后运行，逐用例输出 ###CASE### 协议
- 比较与判定统一在 Python 侧完成，支持乱序、浮点、回文、BST 校验与原地修改
"""

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
TOOLS_DIR = BASE_DIR / "tools"
MINGW_BIN = TOOLS_DIR / "mingw64" / "bin"
JUDGE_INCLUDE = BASE_DIR / "judge" / "include"
TMP_ROOT = BASE_DIR / "data" / "judge_tmp"

from judge.runtime import compare, make_python_runner  # noqa: E402

_DB = None


def get_db():
    global _DB
    if _DB is None:
        p = BASE_DIR / "judge" / "judge_data.json"
        _DB = json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}
    return _DB


def reload_db():
    global _DB
    _DB = None
    return get_db()


# ---------------------------------------------------------------------------
# 通用工具
# ---------------------------------------------------------------------------
def _tool(name):
    exe = MINGW_BIN / (name + ".exe")
    if exe.exists():
        return str(exe)
    return shutil.which(name)


def _find_javac():
    cands = []
    jh = os.environ.get("JAVA_HOME")
    if jh:
        cands.append(Path(jh) / "bin" / "javac.exe")
    cands += [
        Path(r"D:\JAVA\jdk-25.0.2\bin\javac.exe"),
        Path(r"C:\Program Files\Java\jdk-25.0.2\bin\javac.exe"),
    ]
    for c in cands:
        if c.exists():
            return str(c), str(c.parent / "java.exe")
    j = shutil.which("javac")
    return (j, shutil.which("java")) if j else (None, None)


def _env():
    env = os.environ.copy()
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"
    if MINGW_BIN.exists():
        env["PATH"] = str(MINGW_BIN) + os.pathsep + env.get("PATH", "")
    return env


def _no_window():
    return subprocess.CREATE_NO_WINDOW if sys.platform.startswith("win") else 0


def _write_tmp(name, text):
    TMP_ROOT.mkdir(parents=True, exist_ok=True)
    d = TMP_ROOT / (time.strftime("%Y%m%d") + "-" + uuid.uuid4().hex[:10])
    d.mkdir(parents=True, exist_ok=True)
    p = d / name
    p.write_text(text, encoding="utf-8")
    return d, p


def reset_tmp(max_age_hours=6.0):
    """清理历史运行目录（只删够旧的，避免打断正在进行的判题 / 自测）。

    之前是整体 rmtree，导致「服务端启动」与「自测」并发时会把对方正在编译的
    临时目录删掉（表现为 ld: cannot open output file app.exe 或 NoClassDefFoundError）。
    """
    try:
        TMP_ROOT.mkdir(parents=True, exist_ok=True)
        cutoff = time.time() - max_age_hours * 3600
        for d in TMP_ROOT.iterdir():
            try:
                if d.is_dir() and d.stat().st_mtime < cutoff:
                    shutil.rmtree(d, ignore_errors=True)
            except Exception:
                continue
    except Exception:
        pass


_NODE_DEF_RE = re.compile(r"^\s*(?://+\s*)?(?:struct|class)\s+(?:ListNode|TreeNode|Node)\s*\{")


def strip_node_defs(code):
    """去掉用户粘贴的完整代码里重复的 ListNode / TreeNode / Node 定义。

    力扣编辑器由系统预置这些结构体，用户若把「可本地运行版」整段贴进来会与
    判题预置定义冲突（C/C++ 报 redefinition、Java 报 duplicate class），这里就地剥离。

    按行扫描而不是按字符扫描：题库里的参考解经常把定义写成注释
    （`// struct ListNode { ... // };`），按字符扫描会吞掉紧随其后的函数签名。
    """
    if not code or ("ListNode" not in code and "TreeNode" not in code and "Node" not in code):
        return code
    lines = code.split("\n")
    out, i = [], 0
    while i < len(lines):
        line = lines[i]
        if _NODE_DEF_RE.match(line):
            depth = line.count("{") - line.count("}")
            i += 1
            if depth <= 0:  # 单行定义，如 class ListNode { ... }
                continue
            while i < len(lines) and depth > 0:
                depth += lines[i].count("{") - lines[i].count("}")
                i += 1
            continue
        out.append(line)
        i += 1
    return "\n".join(out)


def _parse_cases(stdout, total):
    recs = {}
    for line in (stdout or "").splitlines():
        idx = line.find("###CASE###")
        if idx < 0:
            continue
        try:
            rec = json.loads(line[idx + len("###CASE###"):].strip())
            recs[int(rec.get("i", len(recs)))] = rec
        except Exception:
            continue
    return recs


def _case_status(actual, expected, cmp_name, args):
    return "AC" if compare(actual, expected, cmp_name, args) else "WA"


def _case_ok(actual, expected, cmp_name, args):
    """注意：必须返回 bool。历史上这里直接用了返回 "AC"/"WA" 字符串的
    _case_status，字符串恒为真值，导致「答案错误」也被判成 AC。"""
    return bool(compare(actual, expected, cmp_name, args))


def _assemble(prob, selected, recs, compile_err=None, timed_out=False, stderr="", elapsed=0):
    """把 harness 记录组装为最终判题结果。"""
    cases_out = []
    passed = 0
    has_wa = has_re = False
    cmp_name = prob.get("cmp", "exact")

    for local_i, (orig_i, case) in enumerate(selected):
        rec = recs.get(local_i)
        item = {
            "index": orig_i,
            "sample": bool(case.get("sample")),
            "input": case["args"] if prob.get("mode") == "design" else case["args"],
            "expected": case.get("expect"),
            "expectedArgs": case.get("expectArgs") or [],
            "actual": None,
            "actualArgs": [],
            "ms": None,
            "stdout": "",
            "error": "",
            "status": "SKIP",
        }
        if rec is None:
            if timed_out:
                item["status"] = "TLE"
                item["error"] = "执行超时（超过限制时间，可能存在死循环或复杂度过高）"
                has_wa = True
            elif compile_err:
                item["status"] = "CE"
            else:
                item["status"] = "RE"
                item["error"] = (stderr or "程序异常退出").strip()[-800:]
                has_re = True
        elif not rec.get("ok"):
            item["status"] = "RE"
            item["error"] = (rec.get("error") or "运行时错误").strip()[:1200]
            item["stdout"] = (rec.get("stdout") or "")[:2000]
            has_re = True
        else:
            item["actual"] = rec.get("ret")
            item["actualArgs"] = rec.get("argsAfter") or []
            item["ms"] = rec.get("ms")
            item["stdout"] = (rec.get("stdout") or "")[:2000]
            ok = _case_ok(rec.get("ret"), case.get("expect"), cmp_name, case.get("args"))
            for j, exp in enumerate(case.get("expectArgs") or []):
                act = (rec.get("argsAfter") or [])
                if j >= len(act) or act[j] != exp:
                    ok = False
            item["status"] = "AC" if ok else "WA"
            if ok:
                passed += 1
            else:
                has_wa = True
        cases_out.append(item)

    total = len(selected)
    if compile_err:
        status = "CE"
    elif has_re:
        status = "RE"
    elif timed_out:
        status = "TLE"
    elif passed == total and total > 0:
        status = "AC"
    elif has_wa:
        status = "WA"
    else:
        status = "WA"

    return {
        "ok": status == "AC",
        "status": status,
        "passed": passed,
        "total": total,
        "cases": cases_out,
        "compileError": compile_err or "",
        "message": "",
        "elapsedMs": round(elapsed, 1),
    }


def _select(prob, mode):
    out = []
    for i, c in enumerate(prob["cases"]):
        if mode == "run" and not c.get("sample"):
            continue
        out.append((i, c))
    return out


def _base_spec(prob, selected):
    mode = prob.get("mode", "function")
    return {
        "mode": mode,
        "func": prob.get("func"),
        "class": prob.get("class"),
        "params": prob.get("params") or [],
        "ret": prob.get("ret") or "void",
        "checks": prob.get("checks") or [],
        "adapt": prob.get("adapt"),
        "retSer": prob.get("retSer"),
        "ops": prob.get("ops") or [],
        "cases": ([c for _, c in selected] if mode == "design" else [c["args"] for _, c in selected]),
    }


# ===========================================================================
# Python
# ===========================================================================
def judge_python(prob, code, selected, t0):
    spec = _base_spec(prob, selected)
    if spec["mode"] == "design":
        from judge.runtime import make_design_python_runner
        src = make_design_python_runner(spec, code)
    else:
        src = make_python_runner(spec, code)
    d, path = _write_tmp("solution.py", src)
    try:
        proc = subprocess.run(
            [sys.executable, str(path)],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=8.5, cwd=str(BASE_DIR), env=_env(), creationflags=_no_window(),
        )
        stderr = proc.stderr or ""
        if "SyntaxError" in stderr or "IndentationError" in stderr or "TabError" in stderr:
            return _assemble(prob, selected, {}, compile_err=stderr.strip()[-3000:], elapsed=(time.perf_counter() - t0) * 1000)
        recs = _parse_cases(proc.stdout, len(selected))
        return _assemble(prob, selected, recs, stderr=stderr, elapsed=(time.perf_counter() - t0) * 1000)
    except subprocess.TimeoutExpired as e:
        recs = _parse_cases((e.stdout or b"").decode("utf-8", "replace") if isinstance(e.stdout, bytes) else (e.stdout or ""), len(selected))
        return _assemble(prob, selected, recs, timed_out=True, elapsed=(time.perf_counter() - t0) * 1000)


# ===========================================================================
# C++ 代码生成
# ===========================================================================
CPP_PRELUDE = r'''
#include <iostream>
#include <vector>
#include <string>
#include <algorithm>
#include <unordered_map>
#include <unordered_set>
#include <map>
#include <set>
#include <queue>
#include <stack>
#include <deque>
#include <climits>
#include <cmath>
#include <numeric>
#include <functional>
#include <tuple>
#include <utility>
#include <sstream>
#include <iomanip>
#include <cstring>
#include <cstdio>
#include <cstdlib>
#include <optional>
#include <chrono>
using namespace std;

struct ListNode {
    int val;
    ListNode *next;
    ListNode() : val(0), next(nullptr) {}
    ListNode(int x) : val(x), next(nullptr) {}
    ListNode(int x, ListNode *next) : val(x), next(next) {}
};
struct TreeNode {
    int val;
    TreeNode *left, *right;
    TreeNode() : val(0), left(nullptr), right(nullptr) {}
    TreeNode(int x) : val(x), left(nullptr), right(nullptr) {}
    TreeNode(int x, TreeNode *left, TreeNode *right) : val(x), left(left), right(right) {}
};
struct Node {
    int val;
    Node *next, *random;
    Node(int x = 0) : val(x), next(nullptr), random(nullptr) {}
    Node(int x, Node *next, Node *random) : val(x), next(next), random(random) {}
};

static string jsonEscape(const string& s) {
    string o = "\"";
    for (size_t i = 0; i < s.size(); ++i) {
        unsigned char c = s[i];
        switch (c) {
            case '"': o += "\\\""; break;
            case '\\': o += "\\\\"; break;
            case '\n': o += "\\n"; break;
            case '\r': o += "\\r"; break;
            case '\t': o += "\\t"; break;
            default:
                if (c < 0x20) { char b[8]; snprintf(b, sizeof(b), "\\u%04x", c); o += b; }
                else o += (char)c;
        }
    }
    return o + "\"";
}
static string jsonVec(const vector<int>& v) {
    string o = "["; for (size_t i=0;i<v.size();++i){ if(i)o+=","; o+=to_string(v[i]); } return o+"]";
}
static string jsonVecVec(const vector<vector<int>>& v) {
    string o="["; for(size_t i=0;i<v.size();++i){ if(i)o+=","; o+=jsonVec(v[i]); } return o+"]";
}
static string jsonVecStr(const vector<string>& v) {
    string o="["; for(size_t i=0;i<v.size();++i){ if(i)o+=","; o+=jsonEscape(v[i]); } return o+"]";
}
static string jsonDesignOut(const vector<string>& v) {
    string o="["; for(size_t i=0;i<v.size();++i){ if(i)o+=","; o += (v[i]=="null" ? "null" : v[i]); } return o+"]";
}
static string jsonVecVecStr(const vector<vector<string>>& v) {
    string o="["; for(size_t i=0;i<v.size();++i){ if(i)o+=","; o+=jsonVecStr(v[i]); } return o+"]";
}
static string jsonVecChar(const vector<vector<char>>& v) {
    string o="["; for(size_t i=0;i<v.size();++i){ if(i)o+=","; o+="["; for(size_t j=0;j<v[i].size();++j){ if(j)o+=","; o+=jsonEscape(string(1,v[i][j])); } o+="]"; } return o+"]";
}
static string jsonList(ListNode* h) {
    string o="["; int n=0; while(h && n<20000){ if(n)o+=","; o+=to_string(h->val); h=h->next; ++n; } return o+"]";
}
static string jsonTree(TreeNode* root) {
    if(!root) return "[]";
    vector<string> out; queue<TreeNode*> q; q.push(root);
    while(!q.empty()) {
        TreeNode* n=q.front(); q.pop();
        if(!n){ out.push_back("null"); continue; }
        out.push_back(to_string(n->val)); q.push(n->left); q.push(n->right);
    }
    while(!out.empty() && out.back()=="null") out.pop_back();
    string o="["; for(size_t i=0;i<out.size();++i){ if(i)o+=","; o+=out[i]; } return o+"]";
}
static string jsonRandom(Node* h) {
    vector<Node*> nodes; unordered_map<Node*,int> idx;
    for(Node* p=h; p && !idx.count(p); p=p->next){ idx[p]=(int)nodes.size(); nodes.push_back(p); }
    string o="["; for(size_t i=0;i<nodes.size();++i){ if(i)o+=","; o+="["+to_string(nodes[i]->val)+",";
        if(nodes[i]->random && idx.count(nodes[i]->random)) o+=to_string(idx[nodes[i]->random]); else o+="null"; o+="]"; }
    return o+"]";
}
static string jsonFlatten(TreeNode* root) {
    string o="["; int n=0; while(root && n<20000){ if(n)o+=","; o+=to_string(root->val); root=root->right; ++n; } return o+"]";
}
static string jnum(double v) { ostringstream os; os<<setprecision(10)<<v; return os.str(); }
static string jany(int v){ return to_string(v); }
static string jany(long long v){ return to_string(v); }
static string jany(double v){ return jnum(v); }
static string jany(bool v){ return v?"true":"false"; }
static string jany(const string& v){ return jsonEscape(v); }
static string jany(const char* v){ return jsonEscape(string(v?v:"")); }
static string jnode(ListNode* p){ return p?to_string(p->val):"null"; }
static string jnode(TreeNode* p){ return p?to_string(p->val):"null"; }

static ListNode* buildList(initializer_list<int> vals) {
    ListNode dummy; ListNode* cur=&dummy;
    for(int v: vals){ cur->next=new ListNode(v); cur=cur->next; }
    return dummy.next;
}
static ListNode* buildList(const vector<int>& vals) {
    ListNode dummy; ListNode* cur=&dummy;
    for(int v: vals){ cur->next=new ListNode(v); cur=cur->next; }
    return dummy.next;
}
static ListNode* buildCycle(initializer_list<int> vals, int pos) {
    vector<int> a(vals); if(a.empty()) return nullptr;
    vector<ListNode*> ns; for(int v:a) ns.push_back(new ListNode(v));
    for(size_t i=0;i+1<ns.size();++i) ns[i]->next=ns[i+1];
    if(pos>=0 && pos<(int)ns.size()) ns.back()->next=ns[pos];
    return ns[0];
}
static TreeNode* buildTree(initializer_list<optional<int>> vals) {
    vector<optional<int>> a(vals);
    if(a.empty() || !a[0]) return nullptr;
    TreeNode* root=new TreeNode(*a[0]); queue<TreeNode*> q; q.push(root); size_t i=1;
    while(!q.empty() && i<a.size()) {
        TreeNode* n=q.front(); q.pop();
        if(i<a.size()){ if(a[i]){ n->left=new TreeNode(*a[i]); q.push(n->left);} ++i; }
        if(i<a.size()){ if(a[i]){ n->right=new TreeNode(*a[i]); q.push(n->right);} ++i; }
    }
    return root;
}
static Node* buildRandomList(initializer_list<pair<int,int>> vals) {
    vector<pair<int,int>> a(vals); if(a.empty()) return nullptr;
    vector<Node*> ns; for(auto& p:a) ns.push_back(new Node(p.first));
    for(size_t i=0;i+1<ns.size();++i) ns[i]->next=ns[i+1];
    for(size_t i=0;i<a.size();++i) ns[i]->random = (a[i].second>=0 && a[i].second<(int)ns.size()) ? ns[a[i].second] : nullptr;
    return ns[0];
}
static pair<ListNode*,ListNode*> buildIntersect(initializer_list<int> aa, initializer_list<int> bb, int sa, int sb) {
    vector<int> a(aa), b(bb);
    vector<int> tail; for(int i=sa;i<(int)a.size();++i) tail.push_back(a[i]);
    vector<int> pa(a.begin(), a.begin()+min((int)a.size(), sa));
    vector<int> pb(b.begin(), b.begin()+min((int)b.size(), sb));
    ListNode* shared=buildList(tail);
    ListNode* ha; ListNode* hb;
    if(sa>0){ ha=buildList(pa); ListNode* c=ha; while(c->next)c=c->next; c->next=shared; } else ha=shared;
    if(sb>0){ hb=buildList(pb); ListNode* c=hb; while(c->next)c=c->next; c->next=shared; } else hb=shared;
    return {ha,hb};
}
static TreeNode* findNode(TreeNode* root, int val) {
    if(!root) return nullptr; queue<TreeNode*> q; q.push(root);
    while(!q.empty()){ TreeNode* n=q.front(); q.pop(); if(n->val==val) return n; if(n->left)q.push(n->left); if(n->right)q.push(n->right); }
    return nullptr;
}
'''


def _cpp_char(ch):
    ch = str(ch)
    if ch == "\\":
        return "'\\\\'"
    if ch == "'":
        return "'\\''"
    if ch == "\n":
        return "'\\n'"
    return "'" + ch + "'"


def cpp_lit(t, v):
    """生成 C++ 参数表达式与类型声明。"""
    t = t or "any"
    if t in ("int", "long"):
        return "int", str(int(v))
    if t == "double":
        return "double", repr(float(v))
    if t == "bool":
        return "bool", "true" if v else "false"
    if t == "str":
        return "string", json.dumps(v, ensure_ascii=False)
    if t == "int[]":
        return "vector<int>", "{" + ",".join(str(int(x)) for x in v) + "}"
    if t == "double[]":
        return "vector<double>", "{" + ",".join(repr(float(x)) for x in v) + "}"
    if t == "bool[]":
        return "vector<bool>", "{" + ",".join("true" if x else "false" for x in v) + "}"
    if t == "int[][]":
        return "vector<vector<int>>", "{" + ",".join("{" + ",".join(str(int(x)) for x in row) + "}" for row in v) + "}"
    if t == "str[]":
        return "vector<string>", "{" + ",".join(json.dumps(x, ensure_ascii=False) for x in v) + "}"
    if t == "str[][]":
        return "vector<vector<char>>", "{" + ",".join(
            "{" + ",".join(_cpp_char(ch) for ch in row) + "}" for row in v
        ) + "}"
    if t == "ListNode":
        return "ListNode*", "buildList({" + ",".join(str(int(x)) for x in v) + "})"
    if t == "ListNode[]":
        parts = []
        for lst in v:
            if lst:
                parts.append("buildList({" + ",".join(str(int(x)) for x in lst) + "})")
            else:
                parts.append("(ListNode*)nullptr")
        return "vector<ListNode*>", "{" + ",".join(parts) + "}"
    if t == "TreeNode":
        return "TreeNode*", "buildTree({" + ",".join("nullopt" if x is None else str(int(x)) for x in v) + "})"
    return "int", str(v)


def cpp_case_block(prob, local_i, case, shared=None):
    """生成一个用例的 C++ 代码块。"""
    args = case["args"]
    adapter = prob.get("adapt")
    lines = ["    {", "        auto _t0 = chrono::steady_clock::now();", "        bool _ok = true;", "        string _err = \"\";"]
    call_args = []
    after = []

    if adapter == "cycle":
        lines.append("        ListNode* a0 = buildCycle({" + ",".join(str(int(x)) for x in args[0]) + "}, " + str(int(args[1])) + ");")
        call_args = ["a0"]
    elif adapter == "intersect":
        lines.append(
            "        auto _pr = buildIntersect({" + ",".join(str(int(x)) for x in args[0]) + "}, {"
            + ",".join(str(int(x)) for x in args[1]) + "}, " + str(int(args[2])) + ", " + str(int(args[3])) + ");"
        )
        lines.append("        ListNode* a0 = _pr.first; ListNode* a1 = _pr.second;")
        call_args = ["a0", "a1"]
    elif adapter == "random_list":
        pairs = ",".join("{" + str(int(p[0])) + "," + (str(int(p[1])) if p[1] is not None else "-1") + "}" for p in args[0])
        lines.append("        Node* a0 = buildRandomList({" + pairs + "});")
        call_args = ["a0"]
    elif adapter == "tree_nodes":
        lines.append("        TreeNode* a0 = buildTree({" + ",".join("nullopt" if x is None else str(int(x)) for x in args[0]) + "});")
        lines.append("        TreeNode* a1 = findNode(a0, " + str(int(args[1])) + ");")
        lines.append("        TreeNode* a2 = findNode(a0, " + str(int(args[2])) + ");")
        call_args = ["a0", "a1", "a2"]
    else:
        types = prob.get("params") or []
        for i, (t, v) in enumerate(zip(types, args)):
            ct, expr = cpp_lit(t, v)
            lines.append("        " + ct + " a" + str(i) + " = " + expr + ";")
            call_args.append("a" + str(i))

    ret_t = prob.get("ret") or "void"
    call = "sol." + prob["func"] + "(" + ", ".join(call_args) + ")"
    lines.append("        Solution sol;")
    lines.append("        try {")
    if ret_t == "void":
        lines.append("            " + call + ";")
        lines.append("            string _ret = \"null\";")
    else:
        lines.append("            auto _ret_v = " + call + ";")
        lines.append("            string _ret = " + _cpp_ser(prob, "_ret_v") + ";")
    # 原地修改校验
    for ch in prob.get("checks") or []:
        arg_i = ch.get("arg", 0)
        after.append(_cpp_ser_arg(prob, "a" + str(arg_i), ch))
    lines.append("            cout << \"\\n###CASE###{\\\"i\\\":" + str(local_i) + ",\\\"ok\\\":true,\\\"ret\\\":\" << _ret << \",\\\"argsAfter\\\":[\"")
    lines.append("                 << " + (" + \",\" + ".join(after) if after else "\"\"") + " << \"],\\\"ms\\\":\"")
    lines.append("                 << chrono::duration<double, milli>(chrono::steady_clock::now()-_t0).count()")
    lines.append("                 << \",\\\"stdout\\\":\\\"\\\"}\" << flush;")
    lines.append("        } catch (const exception& e) {")
    lines.append("            cout << \"\\n###CASE###{\\\"i\\\":" + str(local_i) + ",\\\"ok\\\":false,\\\"error\\\":\" << jsonEscape(e.what()) << \",\\\"ms\\\":0,\\\"stdout\\\":\\\"\\\"}\" << flush;")
    lines.append("        } catch (...) {")
    lines.append("            cout << \"\\n###CASE###{\\\"i\\\":" + str(local_i) + ",\\\"ok\\\":false,\\\"error\\\":\\\"Unknown runtime error\\\",\\\"ms\\\":0,\\\"stdout\\\":\\\"\\\"}\" << flush;")
    lines.append("        }")
    lines.append("    }")
    return "\n".join(lines)


def _cpp_ser(prob, var):
    t = prob.get("ret") or "void"
    ret_ser = prob.get("retSer")
    if t == "int":
        return "to_string(" + var + ")"
    if t == "double":
        return "jnum(" + var + ")"
    if t == "bool":
        return "(" + var + " ? \"true\" : \"false\")"
    if t == "str":
        return "jsonEscape(" + var + ")"
    if t == "int[]":
        return "jsonVec(" + var + ")"
    if t == "double[]":
        return "jsonVec(" + var + ")"  # 暂不涉及
    if t == "int[][]":
        return "jsonVecVec(" + var + ")"
    if t == "str[]":
        return "jsonVecStr(" + var + ")"
    if t == "str[][]":
        return "jsonVecVecStr(" + var + ")"
    if t == "ListNode":
        return "jnode(" + var + ")" if ret_ser == "node_val" else "jsonList(" + var + ")"
    if t == "TreeNode":
        return "jnode(" + var + ")" if ret_ser == "node_val" else "jsonTree(" + var + ")"
    if t == "Node":
        return "jsonRandom(" + var + ")"
    return "string(\"null\")"


def _cpp_ser_arg(prob, var, ch):
    if ch.get("mode") == "tree_flatten":
        return "jsonFlatten(" + var + ")"
    return "jsonVecVec(" + var + ")" if prob.get("params", [None])[0] == "int[][]" else "jsonVec(" + var + ")"


def cpp_design_block(prob, local_i, case):
    cls = prob["class"]
    api = (prob.get("api") or {}).get("cpp") or {}
    ctor = api.get("ctor") or []
    methods = api.get("methods") or {}
    ops = prob["ops"]
    args = case["args"]
    lines = ["    {", "        auto _t0 = chrono::steady_clock::now();", "        vector<string> _out;", "        try {"]
    for op, a in zip(ops, args):
        if op == cls:
            vals = ", ".join(str(int(x)) for x in a)
            lines.append("        " + cls + "* obj = new " + cls + "(" + vals + "); _out.push_back(\"null\");")
        else:
            mi = methods.get(op) or {}
            ret = mi.get("ret", "void")
            vals = ", ".join(json.dumps(x, ensure_ascii=False) if isinstance(x, str) else str(int(x)) for x in a)
            call = "obj->" + op + "(" + vals + ")"
            if ret == "void":
                lines.append("        " + call + "; _out.push_back(\"null\");")
            else:
                lines.append("        _out.push_back(jany(" + call + "));")
    lines.append("        cout << \"\\n###CASE###{\\\"i\\\":" + str(local_i) + ",\\\"ok\\\":true,\\\"ret\\\":\" << jsonDesignOut(_out)")
    lines.append("             << \",\\\"argsAfter\\\":[],\\\"ms\\\":\" << chrono::duration<double, milli>(chrono::steady_clock::now()-_t0).count() << \",\\\"stdout\\\":\\\"\\\"}\" << flush;")
    lines.append("        } catch (const exception& e) {")
    lines.append("            cout << \"\\n###CASE###{\\\"i\\\":" + str(local_i) + ",\\\"ok\\\":false,\\\"error\\\":\" << jsonEscape(e.what()) << \",\\\"ms\\\":0,\\\"stdout\\\":\\\"\\\"}\" << flush;")
    lines.append("        }")
    lines.append("    }")
    return "\n".join(lines)


def judge_cpp(prob, code, selected, t0):
    sig = prob.get("langs", {}).get("cpp")
    if prob.get("mode") != "design" and not sig:
        return _assemble(prob, selected, {}, compile_err="该题暂未提供 C++ 函数签名", elapsed=(time.perf_counter() - t0) * 1000)
    gxx = _tool("g++")
    if not gxx:
        return _assemble(prob, selected, {}, compile_err="未找到 g++ 编译器，请确认 tools/mingw64 已安装", elapsed=(time.perf_counter() - t0) * 1000)

    code = re.sub(r"#\s*include\s*<bits/stdc\+\+\.h>\s*", "", code)
    code = strip_node_defs(code)
    blocks = []
    for li, (_, case) in enumerate(selected):
        blocks.append(cpp_design_block(prob, li, case) if prob.get("mode") == "design" else cpp_case_block(prob, li, case))
    src = CPP_PRELUDE + "\n" + code + "\n\nint main() {\n" + "\n".join(blocks) + "\n    return 0;\n}\n"
    d, path = _write_tmp("main.cpp", src)
    exe = d / "app.exe"
    try:
        comp = subprocess.run(
            [gxx, "-std=c++17", "-O2", "-static", "-pipe", "-o", str(exe), str(path)],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=40, env=_env(), creationflags=_no_window(),
        )
        if comp.returncode != 0:
            return _assemble(prob, selected, {}, compile_err=_clean_compile(comp.stderr), elapsed=(time.perf_counter() - t0) * 1000)
        proc = subprocess.run(
            [str(exe)], capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=7.5, env=_env(), creationflags=_no_window(),
        )
        recs = _parse_cases(proc.stdout, len(selected))
        return _assemble(prob, selected, recs, stderr=proc.stderr, elapsed=(time.perf_counter() - t0) * 1000)
    except subprocess.TimeoutExpired:
        return _assemble(prob, selected, {}, timed_out=True, elapsed=(time.perf_counter() - t0) * 1000)


# ===========================================================================
# Java 代码生成
# ===========================================================================
JAVA_PRELUDE = r'''
import java.util.*;
import java.io.*;

class ListNode {
    int val; ListNode next;
    ListNode() {}
    ListNode(int x) { val = x; }
    ListNode(int x, ListNode n) { val = x; next = n; }
}
class TreeNode {
    int val; TreeNode left, right;
    TreeNode() {}
    TreeNode(int x) { val = x; }
    TreeNode(int x, TreeNode l, TreeNode r) { val = x; left = l; right = r; }
}
class Node {
    int val; Node next, random;
    Node(int x) { val = x; }
    Node(int x, Node next, Node random) { val = x; this.next = next; this.random = random; }
}

class Main {
    static String q(String s) {
        if (s == null) return "null";
        StringBuilder b = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': b.append("\\\""); break;
                case '\\': b.append("\\\\"); break;
                case '\n': b.append("\\n"); break;
                case '\r': b.append("\\r"); break;
                case '\t': b.append("\\t"); break;
                default:
                    if (c < 0x20) b.append(String.format("\\u%04x", (int) c));
                    else b.append(c);
            }
        }
        return b.append("\"").toString();
    }
    static String json(Object o) {
        if (o == null) return "null";
        if (o instanceof String) return q((String) o);
        if (o instanceof Character) return q(String.valueOf(o));
        if (o instanceof Boolean) return ((Boolean) o) ? "true" : "false";
        if (o instanceof Double || o instanceof Float) {
            double d = ((Number) o).doubleValue();
            if (d == Math.rint(d) && Math.abs(d) < 1e15) return String.valueOf((long) d) + ".0";
            return String.valueOf(d);
        }
        if (o instanceof Number) return o.toString();
        if (o instanceof int[]) {
            int[] a = (int[]) o; StringBuilder b = new StringBuilder("[");
            for (int i = 0; i < a.length; i++) { if (i > 0) b.append(","); b.append(a[i]); }
            return b.append("]").toString();
        }
        if (o instanceof long[]) {
            long[] a = (long[]) o; StringBuilder b = new StringBuilder("[");
            for (int i = 0; i < a.length; i++) { if (i > 0) b.append(","); b.append(a[i]); }
            return b.append("]").toString();
        }
        if (o instanceof double[]) {
            double[] a = (double[]) o; StringBuilder b = new StringBuilder("[");
            for (int i = 0; i < a.length; i++) { if (i > 0) b.append(","); b.append(a[i]); }
            return b.append("]").toString();
        }
        if (o instanceof boolean[]) {
            boolean[] a = (boolean[]) o; StringBuilder b = new StringBuilder("[");
            for (int i = 0; i < a.length; i++) { if (i > 0) b.append(","); b.append(a[i]); }
            return b.append("]").toString();
        }
        if (o instanceof String[]) {
            String[] a = (String[]) o; StringBuilder b = new StringBuilder("[");
            for (int i = 0; i < a.length; i++) { if (i > 0) b.append(","); b.append(q(a[i])); }
            return b.append("]").toString();
        }
        if (o instanceof char[][]) {
            char[][] a = (char[][]) o; StringBuilder b = new StringBuilder("[");
            for (int i = 0; i < a.length; i++) {
                if (i > 0) b.append(",");
                b.append("[");
                for (int j = 0; j < a[i].length; j++) { if (j > 0) b.append(","); b.append(q(String.valueOf(a[i][j]))); }
                b.append("]");
            }
            return b.append("]").toString();
        }
        if (o instanceof int[][]) {
            int[][] a = (int[][]) o; StringBuilder b = new StringBuilder("[");
            for (int i = 0; i < a.length; i++) { if (i > 0) b.append(","); b.append(json(a[i])); }
            return b.append("]").toString();
        }
        if (o instanceof List) {
            List<?> a = (List<?>) o; StringBuilder b = new StringBuilder("[");
            for (int i = 0; i < a.size(); i++) { if (i > 0) b.append(","); b.append(json(a.get(i))); }
            return b.append("]").toString();
        }
        if (o instanceof ListNode) {
            StringBuilder b = new StringBuilder("["); ListNode p = (ListNode) o; int n = 0;
            while (p != null && n < 20000) { if (n > 0) b.append(","); b.append(p.val); p = p.next; n++; }
            return b.append("]").toString();
        }
        if (o instanceof TreeNode) {
            TreeNode root = (TreeNode) o;
            List<String> out = new ArrayList<>();
            Queue<TreeNode> qu = new LinkedList<>(); qu.add(root);
            while (!qu.isEmpty()) {
                TreeNode n = qu.poll();
                if (n == null) { out.add("null"); continue; }
                out.add(String.valueOf(n.val)); qu.add(n.left); qu.add(n.right);
            }
            while (!out.isEmpty() && out.get(out.size() - 1).equals("null")) out.remove(out.size() - 1);
            StringBuilder b = new StringBuilder("[");
            for (int i = 0; i < out.size(); i++) { if (i > 0) b.append(","); b.append(out.get(i)); }
            return b.append("]").toString();
        }
        if (o instanceof Node) {
            List<Node> nodes = new ArrayList<>(); Map<Node, Integer> idx = new IdentityHashMap<>();
            for (Node p = (Node) o; p != null && !idx.containsKey(p); p = p.next) { idx.put(p, nodes.size()); nodes.add(p); }
            StringBuilder b = new StringBuilder("[");
            for (int i = 0; i < nodes.size(); i++) {
                if (i > 0) b.append(",");
                b.append("[").append(nodes.get(i).val).append(",");
                Node r = nodes.get(i).random;
                b.append(r != null && idx.containsKey(r) ? idx.get(r) : "null").append("]");
            }
            return b.append("]").toString();
        }
        return q(String.valueOf(o));
    }
    static String jsonFlatten(TreeNode root) {
        StringBuilder b = new StringBuilder("["); TreeNode p = root; int n = 0;
        while (p != null && n < 20000) { if (n > 0) b.append(","); b.append(p.val); p = p.right; n++; }
        return b.append("]").toString();
    }
    static ListNode buildList(int[] a) {
        ListNode dummy = new ListNode(0), cur = dummy;
        for (int v : a) { cur.next = new ListNode(v); cur = cur.next; }
        return dummy.next;
    }
    static ListNode[] buildLists(int[][] lists) {
        ListNode[] out = new ListNode[lists.length];
        for (int i = 0; i < lists.length; i++) out[i] = buildList(lists[i]);
        return out;
    }
    static ListNode buildCycle(int[] a, int pos) {
        if (a.length == 0) return null;
        ListNode[] ns = new ListNode[a.length];
        for (int i = 0; i < a.length; i++) ns[i] = new ListNode(a[i]);
        for (int i = 0; i + 1 < a.length; i++) ns[i].next = ns[i + 1];
        if (pos >= 0 && pos < a.length) ns[a.length - 1].next = ns[pos];
        return ns[0];
    }
    static ListNode[] buildIntersect(int[] a, int[] b, int sa, int sb) {
        ListNode shared = buildList(Arrays.copyOfRange(a, Math.min(sa, a.length), a.length));
        ListNode ha = sa > 0 ? buildList(Arrays.copyOfRange(a, 0, sa)) : shared;
        ListNode hb = sb > 0 ? buildList(Arrays.copyOfRange(b, 0, sb)) : shared;
        if (sa > 0) { ListNode c = ha; while (c.next != null) c = c.next; c.next = shared; }
        if (sb > 0) { ListNode c = hb; while (c.next != null) c = c.next; c.next = shared; }
        return new ListNode[]{ha, hb};
    }
    static TreeNode buildTree(Integer[] a) {
        if (a == null || a.length == 0 || a[0] == null) return null;
        TreeNode root = new TreeNode(a[0]);
        Queue<TreeNode> qu = new LinkedList<>(); qu.add(root); int i = 1;
        while (!qu.isEmpty() && i < a.length) {
            TreeNode n = qu.poll();
            if (i < a.length) { if (a[i] != null) { n.left = new TreeNode(a[i]); qu.add(n.left); } i++; }
            if (i < a.length) { if (a[i] != null) { n.right = new TreeNode(a[i]); qu.add(n.right); } i++; }
        }
        return root;
    }
    static Node buildRandomList(int[][] pairs) {
        if (pairs == null || pairs.length == 0) return null;
        Node[] ns = new Node[pairs.length];
        for (int i = 0; i < pairs.length; i++) ns[i] = new Node(pairs[i][0]);
        for (int i = 0; i + 1 < pairs.length; i++) ns[i].next = ns[i + 1];
        for (int i = 0; i < pairs.length; i++) {
            int r = pairs[i][1];
            ns[i].random = (r >= 0 && r < ns.length) ? ns[r] : null;
        }
        return ns[0];
    }
    static TreeNode findNode(TreeNode root, int val) {
        if (root == null) return null;
        Queue<TreeNode> qu = new LinkedList<>(); qu.add(root);
        while (!qu.isEmpty()) {
            TreeNode n = qu.poll();
            if (n.val == val) return n;
            if (n.left != null) qu.add(n.left);
            if (n.right != null) qu.add(n.right);
        }
        return null;
    }
'''


def _java_char(ch):
    ch = str(ch)
    if ch == "\\":
        return "'\\\\'"
    if ch == "'":
        return "'\\''"
    if ch == "\n":
        return "'\\n'"
    return "'" + ch + "'"


def java_expr(t, v):
    """返回 (Java 类型, 表达式)。"""
    t = t or "any"
    if t in ("int", "long"):
        return "int", str(int(v))
    if t == "double":
        return "double", repr(float(v))
    if t == "bool":
        return "boolean", "true" if v else "false"
    if t == "str":
        return "String", json.dumps(v, ensure_ascii=False)
    if t == "int[]":
        return "int[]", "new int[]{" + ",".join(str(int(x)) for x in v) + "}"
    if t == "int[][]":
        return "int[][]", "new int[][]{" + ",".join("new int[]{" + ",".join(str(int(x)) for x in row) + "}" for row in v) + "}"
    if t == "str[]":
        return "String[]", "new String[]{" + ",".join(json.dumps(x, ensure_ascii=False) for x in v) + "}"
    if t == "str[][]":
        return "char[][]", "new char[][]{" + ",".join(
            "new char[]{" + ",".join(_java_char(ch) for ch in row) + "}" for row in v
        ) + "}"
    if t == "ListNode":
        return "ListNode", "buildList(new int[]{" + ",".join(str(int(x)) for x in v) + "})"
    if t == "ListNode[]":
        return "ListNode[]", "buildLists(new int[][]{" + ",".join(
            "new int[]{" + ",".join(str(int(x)) for x in row) + "}" for row in v
        ) + "})"
    if t == "TreeNode":
        return "TreeNode", "buildTree(new Integer[]{" + ",".join("null" if x is None else str(int(x)) for x in v) + "})"
    if t == "Node":
        return "Node", "buildRandomList(new int[][]{" + ",".join(
            "new int[]{" + str(int(p[0])) + "," + (str(int(p[1])) if p[1] is not None else "-1") + "}" for p in v
        ) + "})"
    return "int", str(v)


def java_case_block(prob, local_i, case):
    args = case["args"]
    adapter = prob.get("adapt")
    lines = ["        {", "            long _t0 = System.nanoTime();", "            boolean _ok = true;", "            String _err = \"\";"]
    call_args = []
    after = []

    if adapter == "cycle":
        lines.append("            ListNode a0 = buildCycle(new int[]{" + ",".join(str(int(x)) for x in args[0]) + "}, " + str(int(args[1])) + ");")
        call_args = ["a0"]
    elif adapter == "intersect":
        lines.append("            ListNode[] _pr = buildIntersect(new int[]{" + ",".join(str(int(x)) for x in args[0]) + "}, new int[]{"
                     + ",".join(str(int(x)) for x in args[1]) + "}, " + str(int(args[2])) + ", " + str(int(args[3])) + ");")
        lines.append("            ListNode a0 = _pr[0], a1 = _pr[1];")
        call_args = ["a0", "a1"]
    elif adapter == "random_list":
        pairs = ",".join("new int[]{" + str(int(p[0])) + "," + (str(int(p[1])) if p[1] is not None else "-1") + "}" for p in args[0])
        lines.append("            Node a0 = buildRandomList(new int[][]{" + pairs + "});")
        call_args = ["a0"]
    elif adapter == "tree_nodes":
        lines.append("            TreeNode a0 = buildTree(new Integer[]{" + ",".join("null" if x is None else str(int(x)) for x in args[0]) + "});")
        lines.append("            TreeNode a1 = findNode(a0, " + str(int(args[1])) + ");")
        lines.append("            TreeNode a2 = findNode(a0, " + str(int(args[2])) + ");")
        call_args = ["a0", "a1", "a2"]
    else:
        types = prob.get("params") or []
        # 题库里有题目的 Java 签名用的是集合类型（如 86 题 wordBreak 的 List<String>），
        # 此时不能照搬 Python 的 str[] → String[]，需要包一层 Arrays.asList。
        jsig_params = ((prob.get("langs") or {}).get("java") or {}).get("params") or []
        for i, (t, v) in enumerate(zip(types, args)):
            jt, expr = java_expr(t, v)
            if i < len(jsig_params):
                jtp = (jsig_params[i].get("type") or "").replace("final ", "").strip()
                if jtp.startswith("List<") and jt.endswith("[]") and jt not in ("int[]", "double[]", "char[]", "boolean[]"):
                    expr = "new java.util.ArrayList<>(java.util.Arrays.asList(" + expr + "))"
                    jt = jtp
            lines.append("            " + jt + " a" + str(i) + " = " + expr + ";")
            call_args.append("a" + str(i))

    ret_t = prob.get("ret") or "void"
    call = "new Solution()." + prob["func"] + "(" + ", ".join(call_args) + ")"
    lines.append("            Object _ret_v = null;")
    lines.append("            try {")
    if ret_t != "void":
        lines.append("                _ret_v = " + call + ";")
    else:
        lines.append("                " + call + ";")
    for ch in prob.get("checks") or []:
        arg_i = ch.get("arg", 0)
        if ch.get("mode") == "tree_flatten":
            after.append("jsonFlatten(a" + str(arg_i) + ")")
        else:
            after.append("json(a" + str(arg_i) + ")")
    lines.append("                StringBuilder _sb = new StringBuilder();")
    if prob.get("retSer") == "node_val" and ret_t in ("ListNode", "TreeNode"):
        # 返回节点时只取 val（力扣 22/26/49 这类题期望的是节点值，不是整条链表/子树）
        lines.append(
            "                _sb.append(\"{\\\"i\\\":" + str(local_i) + ",\\\"ok\\\":true,\\\"ret\\\":\").append("
            "_ret_v == null ? \"null\" : String.valueOf(((" + ret_t + ")_ret_v).val));"
        )
    else:
        if ret_t in ("ListNode", "TreeNode", "Node"):
            # 空链表 / 空树输出 []（力扣约定），而不是 null
            lines.append(
                "                _sb.append(\"{\\\"i\\\":" + str(local_i) + ",\\\"ok\\\":true,\\\"ret\\\":\").append("
                "_ret_v == null ? \"[]\" : json(_ret_v));"
            )
        else:
            lines.append("                _sb.append(\"{\\\"i\\\":" + str(local_i) + ",\\\"ok\\\":true,\\\"ret\\\":\").append(json(_ret_v));")
    lines.append("                _sb.append(\",\\\"argsAfter\\\":[\").append(" + (" + \",\" + ".join(after) if after else "\"\"") + ").append(\"]\");")
    lines.append("                _sb.append(\",\\\"ms\\\":\").append((System.nanoTime()-_t0)/1000000.0).append(\",\\\"stdout\\\":\\\"\\\"}\");")
    lines.append("                System.out.println(\"\\n###CASE###\" + _sb);")
    lines.append("            } catch (Throwable e) {")
    lines.append("                System.out.println(\"\\n###CASE###{\\\"i\\\":" + str(local_i) + ",\\\"ok\\\":false,\\\"error\\\":\" + q(String.valueOf(e)) + \",\\\"ms\\\":0,\\\"stdout\\\":\\\"\\\"}\");")
    lines.append("            }")
    lines.append("        }")
    return "\n".join(lines)


def java_design_block(prob, local_i, case):
    cls = prob["class"]
    api = (prob.get("api") or {}).get("java") or {}
    methods = api.get("methods") or {}
    ops = prob["ops"]
    args = case["args"]
    lines = ["        {", "            long _t0 = System.nanoTime();", "            List<Object> _out = new ArrayList<>();"]
    lines.append("            try {")
    for op, a in zip(ops, args):
        if op == cls:
            vals = ", ".join(str(int(x)) for x in a)
            lines.append("                " + cls + " obj = new " + cls + "(" + vals + "); _out.add(null);")
        else:
            mi = methods.get(op) or {}
            ret = mi.get("ret", "void")
            vals = ", ".join(json.dumps(x, ensure_ascii=False) if isinstance(x, str) else str(int(x)) for x in a)
            call = "obj." + op + "(" + vals + ")"
            if ret == "void":
                lines.append("                " + call + "; _out.add(null);")
            else:
                lines.append("                _out.add(" + call + ");")
    lines.append("                StringBuilder _sb = new StringBuilder();")
    lines.append("                _sb.append(\"{\\\"i\\\":" + str(local_i) + ",\\\"ok\\\":true,\\\"ret\\\":\").append(json(_out));")
    lines.append("                _sb.append(\",\\\"argsAfter\\\":[],\\\"ms\\\":\").append((System.nanoTime()-_t0)/1000000.0).append(\",\\\"stdout\\\":\\\"\\\"}\");")
    lines.append("                System.out.println(\"\\n###CASE###\" + _sb);")
    lines.append("            } catch (Throwable e) {")
    lines.append("                System.out.println(\"\\n###CASE###{\\\"i\\\":" + str(local_i) + ",\\\"ok\\\":false,\\\"error\\\":\" + q(String.valueOf(e)) + \",\\\"ms\\\":0,\\\"stdout\\\":\\\"\\\"}\");")
    lines.append("            }")
    lines.append("        }")
    return "\n".join(lines)


def judge_java(prob, code, selected, t0):
    if prob.get("mode") != "design" and not prob.get("langs", {}).get("java"):
        return _assemble(prob, selected, {}, compile_err="该题暂未提供 Java 函数签名", elapsed=(time.perf_counter() - t0) * 1000)
    javac, java = _find_javac()
    if not javac or not java:
        return _assemble(prob, selected, {}, compile_err="未找到 JDK（javac/java），请确认已安装 JDK 25", elapsed=(time.perf_counter() - t0) * 1000)

    blocks = []
    for li, (_, case) in enumerate(selected):
        blocks.append(java_design_block(prob, li, case) if prob.get("mode") == "design" else java_case_block(prob, li, case))
    main_src = JAVA_PRELUDE + "\n    public static void main(String[] args) throws Exception {\n" + "\n".join(blocks) + "\n    }\n}\n"

    code = re.sub(
        r"\bpublic\s+(final\s+|abstract\s+)?(class|interface|enum)\s+",
        lambda m: (m.group(1) or "") + m.group(2) + " ",
        code,
    )
    code = strip_node_defs(code)
    fname = "Solution.java"
    code = "import java.util.*;\nimport java.io.*;\n" + code
    d, sol_path = _write_tmp(fname, code)
    main_path = d / "Main.java"
    main_path.write_text(main_src, encoding="utf-8")
    outdir = d / "out"
    outdir.mkdir(exist_ok=True)
    try:
        comp = subprocess.run(
            [javac, "-encoding", "UTF-8", "-nowarn", "-d", str(outdir), str(sol_path), str(main_path)],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=45, env=_env(), creationflags=_no_window(),
        )
        if comp.returncode != 0:
            return _assemble(prob, selected, {}, compile_err=_clean_compile(comp.stderr or comp.stdout), elapsed=(time.perf_counter() - t0) * 1000)
        proc = subprocess.run(
            [java, "-Xss64m", "-XX:+UseSerialGC", "-cp", str(outdir), "Main"],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=9, env=_env(), creationflags=_no_window(),
        )
        recs = _parse_cases(proc.stdout, len(selected))
        return _assemble(prob, selected, recs, stderr=proc.stderr, elapsed=(time.perf_counter() - t0) * 1000)
    except subprocess.TimeoutExpired:
        return _assemble(prob, selected, {}, timed_out=True, elapsed=(time.perf_counter() - t0) * 1000)


# ===========================================================================
# C 代码生成
# ===========================================================================
C_PRELUDE = r'''
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdbool.h>
#include <limits.h>
#include <math.h>
#include <stdint.h>
#include <time.h>
#include "uthash.h"

struct ListNode { int val; struct ListNode *next; };
struct TreeNode { int val; struct TreeNode *left, *right; };
struct Node { int val; struct Node *next, *random; };

static void _jf_s(const char* s) {
    printf("\"");
    if (!s) { printf("\""); return; }
    for (const unsigned char* p=(const unsigned char*)s; *p; ++p) {
        unsigned char c=*p;
        if (c=='"' || c=='\\') { printf("\\%c", c); }
        else if (c=='\n') printf("\\n");
        else if (c=='\r') printf("\\r");
        else if (c=='\t') printf("\\t");
        else if (c<0x20) printf("\\u%04x", c);
        else putchar(c);
    }
    printf("\"");
}
static void _jf_ia(int* a, int n) {
    printf("["); for(int i=0;i<n;i++){ if(i)printf(","); printf("%d", a[i]); } printf("]");
}
static void _jf_im(int** a, int n, int* cols) {
    printf("["); for(int i=0;i<n;i++){ if(i)printf(","); _jf_ia(a[i], cols?cols[i]:0); } printf("]");
}
static void _jf_sa(char** a, int n) {
    printf("["); for(int i=0;i<n;i++){ if(i)printf(","); _jf_s(a[i]); } printf("]");
}
static void _jf_sm(char*** a, int n, int* cols) {
    printf("["); for(int i=0;i<n;i++){ if(i)printf(","); _jf_sa(a[i], cols?cols[i]:0); } printf("]");
}
static void _jf_li(struct ListNode* h) {
    printf("["); int n=0; while(h && n<20000){ if(n)printf(","); printf("%d", h->val); h=h->next; ++n; } printf("]");
}
static void _jf_tr(struct TreeNode* root) {
    if(!root){ printf("[]"); return; }
    int cap=256, n=0;
    struct TreeNode** q=(struct TreeNode**)malloc(sizeof(void*)*cap);
    int* vals=(int*)malloc(sizeof(int)*cap);
    int* isnull=(int*)calloc(cap,sizeof(int));
    int head=0; q[n++]=root;
    int cnt=0;
    while(head<n){
        struct TreeNode* x=q[head++];
        if(n+2>=cap){
            cap*=2;
            vals=(int*)realloc(vals,sizeof(int)*cap);
            isnull=(int*)realloc(isnull,sizeof(int)*cap);
            q=(struct TreeNode**)realloc(q,sizeof(void*)*cap);
        }
        if(!x){ isnull[cnt]=1; vals[cnt]=0; }
        else { vals[cnt]=x->val; q[n++]=x->left; q[n++]=x->right; }
        cnt++;
    }
    int last=cnt-1; while(last>=0 && isnull[last]) last--;
    printf("["); for(int i=0;i<=last;i++){ if(i)printf(","); if(isnull[i])printf("null"); else printf("%d", vals[i]); } printf("]");
    free(q); free(vals); free(isnull);
}
static void _jf_rd(struct Node* h) {
    struct Node* ns[20000]; int n=0;
    for(struct Node* p=h; p && n<20000; p=p->next) ns[n++]=p;
    printf("["); for(int i=0;i<n;i++){ if(i)printf(","); printf("[%d,", ns[i]->val);
        int idx=-1; for(int j=0;j<n;j++) if(ns[j]==ns[i]->random){ idx=j; break; }
        if(idx>=0) printf("%d", idx); else printf("null"); printf("]"); }
    printf("]");
}
static void _jf_fl(struct TreeNode* r) {
    printf("["); int n=0; while(r && n<20000){ if(n)printf(","); printf("%d", r->val); r=r->right; ++n; } printf("]");
}
static void _jf_nv(void* p) { if(!p) printf("null"); else printf("%d", *(int*)p); }
static void _jf_nvl(struct ListNode* p) { if(!p) printf("null"); else printf("%d", p->val); }
static void _jf_nvt(struct TreeNode* p) { if(!p) printf("null"); else printf("%d", p->val); }
static void _jf_num(double v){ printf("%.10g", v); }

static struct ListNode* _jf_bl(int* a, int n) {
    struct ListNode dummy; dummy.next=NULL; struct ListNode* cur=&dummy;
    for(int i=0;i<n;i++){ struct ListNode* nd=(struct ListNode*)malloc(sizeof(struct ListNode)); nd->val=a[i]; nd->next=NULL; cur->next=nd; cur=nd; }
    return dummy.next;
}
static struct ListNode* _jf_bc(int* a, int n, int pos) {
    if(n<=0) return NULL;
    struct ListNode** ns=(struct ListNode**)malloc(sizeof(void*)*n);
    for(int i=0;i<n;i++){ ns[i]=(struct ListNode*)malloc(sizeof(struct ListNode)); ns[i]->val=a[i]; ns[i]->next=NULL; }
    for(int i=0;i+1<n;i++) ns[i]->next=ns[i+1];
    if(pos>=0 && pos<n) ns[n-1]->next=ns[pos];
    struct ListNode* h=ns[0]; free(ns); return h;
}
static void _jf_bi(int* a, int na, int* b, int nb, int sa, int sb, struct ListNode** outA, struct ListNode** outB) {
    struct ListNode* shared = _jf_bl(a+sa, na-sa);
    if(sa>0){ *outA=_jf_bl(a, sa); struct ListNode* c=*outA; while(c->next)c=c->next; c->next=shared; } else *outA=shared;
    if(sb>0){ *outB=_jf_bl(b, sb); struct ListNode* c=*outB; while(c->next)c=c->next; c->next=shared; } else *outB=shared;
}
static struct TreeNode* _jf_bt(int* a, int n) {
    if(n<=0 || a[0]==INT_MIN) return NULL;
    struct TreeNode** q=(struct TreeNode**)malloc(sizeof(void*)*(2*n+2)); int head=0, tail=0;
    struct TreeNode* root=(struct TreeNode*)calloc(1,sizeof(struct TreeNode)); root->val=a[0]; q[tail++]=root;
    int i=1;
    while(head<tail && i<n){
        struct TreeNode* cur=q[head++];
        if(i<n){ if(a[i]!=INT_MIN){ cur->left=(struct TreeNode*)calloc(1,sizeof(struct TreeNode)); cur->left->val=a[i]; q[tail++]=cur->left; } i++; }
        if(i<n){ if(a[i]!=INT_MIN){ cur->right=(struct TreeNode*)calloc(1,sizeof(struct TreeNode)); cur->right->val=a[i]; q[tail++]=cur->right; } i++; }
    }
    free(q); return root;
}
static struct TreeNode* _jf_fn(struct TreeNode* root, int val) {
    if(!root) return NULL;
    struct TreeNode** q=(struct TreeNode**)malloc(sizeof(void*)*200000); int head=0, tail=0; q[tail++]=root;
    while(head<tail){ struct TreeNode* n=q[head++]; if(n->val==val){ free(q); return n; } if(n->left)q[tail++]=n->left; if(n->right)q[tail++]=n->right; }
    free(q); return NULL;
}
static struct Node* _jf_brl(int* vals, int* rnd, int n) {
    if(n<=0) return NULL;
    struct Node** ns=(struct Node**)malloc(sizeof(void*)*n);
    for(int i=0;i<n;i++){ ns[i]=(struct Node*)calloc(1,sizeof(struct Node)); ns[i]->val=vals[i]; }
    for(int i=0;i+1<n;i++) ns[i]->next=ns[i+1];
    for(int i=0;i<n;i++) ns[i]->random=(rnd[i]>=0 && rnd[i]<n)?ns[rnd[i]]:NULL;
    struct Node* h=ns[0]; free(ns); return h;
}
'''


def c_lit(t, v):
    if t == "int" or t == "long":
        return "int", str(int(v))
    if t == "double":
        return "double", repr(float(v))
    if t == "bool":
        return "bool", "true" if v else "false"
    if t == "str":
        return "char*", json.dumps(v, ensure_ascii=False)
    return None, None


def c_array_decl(name, typ, arr):
    """生成 C 数组声明，返回 (声明行列表, 可用表达式)。"""
    if typ == "int[]":
        vals = ",".join(str(int(x)) for x in arr)
        return ["int " + name + "[] = {" + vals + "};"], name
    if typ == "int[][]":
        lines = []
        for i, row in enumerate(arr):
            lines.append("int " + name + "_r" + str(i) + "[] = {" + ",".join(str(int(x)) for x in row) + "};")
        lines.append("int* " + name + "[] = {" + ",".join(name + "_r" + str(i) for i in range(len(arr))) + "};")
        return lines, name
    if typ == "str[]":
        lines = []
        for i, s in enumerate(arr):
            lines.append("char " + name + "_" + str(i) + "[] = " + json.dumps(s, ensure_ascii=False) + ";")
        lines.append("char* " + name + "[] = {" + ",".join(name + "_" + str(i) for i in range(len(arr))) + "};")
        return lines, name
    if typ == "str[][]":
        lines = []
        for i, row in enumerate(arr):
            lines.append("char " + name + "_r" + str(i) + "[] = " + json.dumps("".join(str(ch) for ch in row), ensure_ascii=False) + ";")
        lines.append("char* " + name + "[] = {" + ",".join(name + "_r" + str(i) for i in range(len(arr))) + "};")
        return lines, name
    return [], name


def c_case_block(prob, local_i, case):
    args = case["args"]
    adapter = prob.get("adapt")
    lines = ["    {", "        clock_t _t0 = clock();", "        bool _ok = true;"]
    call_args = []
    after = []
    pytypes = prob.get("params") or []
    cparams = (prob.get("langs", {}).get("c") or {}).get("params") or []
    ci = len(cparams)

    if adapter == "cycle":
        a = args[0]
        lines.append("        int a0[] = {" + ",".join(str(int(x)) for x in a) + "};")
        lines.append("        struct ListNode* h0 = _jf_bc(a0, " + str(len(a)) + ", " + str(int(args[1])) + ");")
        call_args = ["h0"]
    elif adapter == "intersect":
        a, b = args[0], args[1]
        lines.append("        int a0[] = {" + ",".join(str(int(x)) for x in a) + "};")
        lines.append("        int a1[] = {" + ",".join(str(int(x)) for x in b) + "};")
        lines.append("        struct ListNode *h0=NULL, *h1=NULL;")
        lines.append("        _jf_bi(a0, " + str(len(a)) + ", a1, " + str(len(b)) + ", " + str(int(args[2])) + ", " + str(int(args[3])) + ", &h0, &h1);")
        call_args = ["h0", "h1"]
    elif adapter == "random_list":
        pairs = args[0]
        vals = ",".join(str(int(p[0])) for p in pairs)
        rnd = ",".join(str(int(p[1])) if p[1] is not None else "-1" for p in pairs)
        lines.append("        int _v[] = {" + vals + "}; int _r[] = {" + rnd + "};")
        lines.append("        struct Node* h0 = _jf_brl(_v, _r, " + str(len(pairs)) + ");")
        call_args = ["h0"]
    elif adapter == "tree_nodes":
        a = args[0]
        vals = ",".join("INT_MIN" if x is None else str(int(x)) for x in a)
        lines.append("        int _t[] = {" + (vals if vals else "0") + "};")
        lines.append("        struct TreeNode* root = _jf_bt(_t, " + str(len(a)) + ");")
        lines.append("        struct TreeNode* p = _jf_fn(root, " + str(int(args[1])) + ");")
        lines.append("        struct TreeNode* q = _jf_fn(root, " + str(int(args[2])) + ");")
        call_args = ["root", "p", "q"]
    else:
        # 按 Python 参数类型依次消费 C 参数（数组会附带 size，矩阵附带 colsize）
        ci = 0
        for i, (pt, val) in enumerate(zip(pytypes, args)):
            if ci >= len(cparams):
                break
            cp = cparams[ci]
            name = "a" + str(i)
            if pt in ("int[]", "int[][]", "str[]", "str[][]"):
                decls, expr = c_array_decl(name, pt, val)
                lines += ["        " + x for x in decls]
                call_args.append(expr)
                ci += 1  # array pointer
                # 紧跟的 size 参数
                if ci < len(cparams):
                    sz = cparams[ci]["name"]
                    lines.append("        int " + sz + " = " + str(len(val)) + ";")
                    call_args.append(sz)
                    ci += 1
                if pt in ("int[][]", "str[][]"):
                    if ci < len(cparams):
                        cs = cparams[ci]["name"]
                        cols = ",".join(str(len(row)) for row in val)
                        lines.append("        int " + cs + "[] = {" + (cols if cols else "0") + "};")
                        call_args.append(cs)
                        ci += 1
            elif pt == "str":
                lines.append("        char " + name + "[] = " + json.dumps(val, ensure_ascii=False) + ";")
                call_args.append(name)
                ci += 1
            elif pt == "ListNode":
                vals = ",".join(str(int(x)) for x in val)
                lines.append("        int " + name + "_v[] = {" + (vals if vals else "0") + "};")
                lines.append("        struct ListNode* " + name + " = _jf_bl(" + name + "_v, " + str(len(val)) + ");")
                call_args.append(name)
                ci += 1
            elif pt == "ListNode[]":
                for k, lst in enumerate(val):
                    vv = ",".join(str(int(x)) for x in lst)
                    lines.append("        int " + name + "_" + str(k) + "[] = {" + (vv if vv else "0") + "};")
                lines.append("        struct ListNode* " + name + "[] = {" + ",".join(
                    "_jf_bl(" + name + "_" + str(k) + ", " + str(len(lst)) + ")" for k, lst in enumerate(val)
                ) + "};")
                call_args.append(name)
                ci += 1
                if ci < len(cparams):
                    sz = cparams[ci]["name"]
                    lines.append("        int " + sz + " = " + str(len(val)) + ";")
                    call_args.append(sz)
                    ci += 1
            elif pt == "TreeNode":
                vals = ",".join("INT_MIN" if x is None else str(int(x)) for x in val)
                lines.append("        int " + name + "_v[] = {" + (vals if vals else "0") + "};")
                lines.append("        struct TreeNode* " + name + " = _jf_bt(" + name + "_v, " + str(len(val)) + ");")
                call_args.append(name)
                ci += 1
            else:
                ct, expr = c_lit(pt, val)
                if ct is None:
                    ct, expr = "int", str(val)
                lines.append("        " + ct + " " + name + " = " + expr + ";")
                call_args.append(name)
                ci += 1

    # 剩余参数是输出参数
    out_names = {}
    while ci < len(cparams):
        cp = cparams[ci]
        nm, tp = cp["name"], cp["type"]
        if "ColumnSizes" in nm:
            lines.append("        int* " + nm + " = NULL;")
            out_names[nm] = "cols"
            call_args.append("&" + nm)
        else:
            lines.append("        int " + nm + " = 0;")
            out_names[nm] = "size"
            call_args.append("&" + nm)
        ci += 1

    ret_t = prob.get("ret") or "void"
    c_ret = (prob.get("langs", {}).get("c") or {}).get("ret") or "void"
    call = prob["func"] + "(" + ", ".join(call_args) + ")"
    lines.append("        " + (c_ret if c_ret != "void" else "") + (" ret = " if c_ret != "void" else "") + call + ";")

    size_name = next((k for k, v in out_names.items() if v == "size"), None)
    cols_name = next((k for k, v in out_names.items() if v == "cols"), None)

    for ch in prob.get("checks") or []:
        arg_i = ch.get("arg", 0)
        if ch.get("mode") == "tree_flatten":
            after.append("_jf_fl(a" + str(arg_i) + ")")
        elif pytypes[arg_i] == "int[][]":
            after.append("_jf_im(a" + str(arg_i) + ", " + str(len(args[arg_i])) + ", (int[]){" + ",".join(str(len(r)) for r in args[arg_i]) + "})")
        else:
            after.append("_jf_ia(a" + str(arg_i) + ", " + str(len(args[arg_i])) + ")")

    lines.append("        printf(\"\\n###CASE###{\\\"i\\\":" + str(local_i) + ",\\\"ok\\\":true,\\\"ret\\\":\");")
    ser = _c_ser(prob, "ret", size_name, cols_name)
    lines.append("        " + ser + ";")
    lines.append("        printf(\",\\\"argsAfter\\\":[\");")
    if after:
        for k, a in enumerate(after):
            lines.append("        " + ("if(" + str(k) + ")printf(\",\");" if k else "") + a + ";")
    lines.append("        printf(\"],\\\"ms\\\":%f,\\\"stdout\\\":\\\"\\\"}\\n\", ((double)(clock()-_t0))*1000.0/CLOCKS_PER_SEC);")
    lines.append("    }")
    return "\n".join(lines)


def _c_ser(prob, var, size_name, cols_name):
    t = prob.get("ret") or "void"
    ret_ser = prob.get("retSer")
    if t == "int":
        return 'printf("%d", ' + var + ')'
    if t == "bool":
        return 'printf(' + var + ' ? "true" : "false")'
    if t == "double":
        return "_jf_num(" + var + ")"
    if t == "str":
        return "_jf_s(" + var + ")"
    if t == "int[]":
        return "_jf_ia(" + var + ", " + (size_name or "0") + ")"
    if t == "int[][]":
        return "_jf_im(" + var + ", " + (size_name or "0") + ", " + (cols_name or "NULL") + ")"
    if t == "str[]":
        return "_jf_sa(" + var + ", " + (size_name or "0") + ")"
    if t == "str[][]":
        return "_jf_sm(" + var + ", " + (size_name or "0") + ", " + (cols_name or "NULL") + ")"
    if t == "ListNode":
        return ("_jf_nvl(" + var + ")") if ret_ser == "node_val" else ("_jf_li(" + var + ")")
    if t == "TreeNode":
        return ("_jf_nvt(" + var + ")") if ret_ser == "node_val" else ("_jf_tr(" + var + ")")
    if t == "Node":
        return "_jf_rd(" + var + ")"
    return 'printf("null")'


def c_design_block(prob, local_i, case):
    cls = prob["class"]
    api = (prob.get("api") or {}).get("c") or {}
    ops = prob["ops"]
    args = case["args"]
    lines = ["    {", "        clock_t _t0 = clock();", "        printf(\"\\n###CASE###{\\\"i\\\":" + str(local_i) + ",\\\"ok\\\":true,\\\"ret\\\":[\");"]
    first = True
    for op, a in zip(ops, args):
        if op == cls:
            info = api.get("ctor") or {}
            fn = info.get("func", "")
            vals = ",".join(str(int(x)) for x in a)
            lines.append("        " + cls + "* obj = " + fn + "(" + vals + ");")
            lines.append("        printf(\"null\");")
            first = False
        else:
            info = api.get(op) or {}
            fn = info.get("func", op)
            ret = info.get("ret", "void")
            vals = [("obj" if i == 0 else ("\"" + str(x) + "\"" if isinstance(x, str) else str(int(x)))) for i, x in enumerate(a)]
            # C 接口第一个参数通常是 obj，但 op 参数里没有；按签名参数个数决定
            params = info.get("params") or []
            call_vals = ["obj"] + [("\"" + str(x) + "\"" if isinstance(x, str) else str(int(x))) for x in a]
            if len(params) != len(call_vals):
                call_vals = call_vals[:len(params)]
            call = fn + "(" + ", ".join(call_vals) + ")"
            if not first:
                lines.append("        printf(\",\");")
            if ret == "void":
                lines.append("        " + call + "; printf(\"null\");")
            elif ret == "bool":
                lines.append("        printf(" + call + " ? \"true\" : \"false\");")
            elif ret == "double":
                lines.append("        _jf_num(" + call + ");")
            elif ret.endswith("*"):
                lines.append("        _jf_nv((void*)" + call + ");")
            else:
                lines.append("        printf(\"%d\", " + call + ");")
            first = False
    lines.append("        printf(\"],\\\"argsAfter\\\":[],\\\"ms\\\":%f,\\\"stdout\\\":\\\"\\\"}\\n\", ((double)(clock()-_t0))*1000.0/CLOCKS_PER_SEC);")
    lines.append("    }")
    return "\n".join(lines)


def judge_c(prob, code, selected, t0):
    sig = prob.get("langs", {}).get("c")
    if prob.get("mode") != "design" and not sig:
        return _assemble(prob, selected, {}, compile_err="该题暂未提供 C 函数签名", elapsed=(time.perf_counter() - t0) * 1000)
    gcc = _tool("gcc")
    if not gcc:
        return _assemble(prob, selected, {}, compile_err="未找到 gcc 编译器，请确认 tools/mingw64 已安装", elapsed=(time.perf_counter() - t0) * 1000)

    blocks = []
    for li, (_, case) in enumerate(selected):
        blocks.append(c_design_block(prob, li, case) if prob.get("mode") == "design" else c_case_block(prob, li, case))
    code = strip_node_defs(code)
    src = C_PRELUDE + "\n" + code + "\n\nint main(void) {\n" + "\n".join(blocks) + "\n    return 0;\n}\n"
    d, path = _write_tmp("main.c", src)
    # uthash
    inc = JUDGE_INCLUDE
    inc.mkdir(parents=True, exist_ok=True)
    exe = d / "app.exe"
    try:
        comp = subprocess.run(
            [gcc, "-std=gnu11", "-O2", "-static", "-pipe", "-I", str(inc), "-o", str(exe), str(path)],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=40, env=_env(), creationflags=_no_window(),
        )
        if comp.returncode != 0:
            return _assemble(prob, selected, {}, compile_err=_clean_compile(comp.stderr), elapsed=(time.perf_counter() - t0) * 1000)
        proc = subprocess.run(
            [str(exe)], capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=7.5, env=_env(), creationflags=_no_window(),
        )
        recs = _parse_cases(proc.stdout, len(selected))
        return _assemble(prob, selected, recs, stderr=proc.stderr, elapsed=(time.perf_counter() - t0) * 1000)
    except subprocess.TimeoutExpired:
        return _assemble(prob, selected, {}, timed_out=True, elapsed=(time.perf_counter() - t0) * 1000)


def _clean_compile(text):
    if not text:
        return "编译失败（无输出）"
    text = re.sub(r"[A-Za-z]:\\[^\s:]+\\judge_tmp\\[^\s:]+\\", "", text)
    lines = [l for l in text.splitlines() if l.strip()]
    return "\n".join(lines[:40])[:4000]


# ===========================================================================
# 入口
# ===========================================================================
def judge(problem_id, language, code, mode="submit"):
    t0 = time.perf_counter()
    db = get_db()
    prob = db.get(str(problem_id))
    if not prob:
        return {"ok": False, "status": "CE", "passed": 0, "total": 0, "cases": [], "compileError": "题目不存在", "message": "", "elapsedMs": 0}
    code = (code or "").replace("\r\n", "\n")
    if not code.strip():
        return {"ok": False, "status": "CE", "passed": 0, "total": len(prob["cases"]), "cases": [], "compileError": "代码为空，请先写下你的实现", "message": "", "elapsedMs": 0}
    if len(code) > 120000:
        return {"ok": False, "status": "CE", "passed": 0, "total": 0, "cases": [], "compileError": "代码过长（超过 120KB）", "message": "", "elapsedMs": 0}

    selected = _select(prob, mode)
    lang = (language or "python").lower()
    if lang in ("py", "python3"):
        lang = "python"
    try:
        if lang == "python":
            res = judge_python(prob, code, selected, t0)
        elif lang in ("cpp", "c++"):
            res = judge_cpp(prob, code, selected, t0)
        elif lang == "java":
            res = judge_java(prob, code, selected, t0)
        elif lang == "c":
            res = judge_c(prob, code, selected, t0)
        else:
            res = _assemble(prob, selected, {}, compile_err="不支持的语言：" + str(language), elapsed=0)
    except Exception as e:
        res = _assemble(prob, selected, {}, compile_err="判题服务内部错误：" + repr(e), elapsed=(time.perf_counter() - t0) * 1000)
    res["problemId"] = problem_id
    res["language"] = lang
    res["mode"] = mode
    return res
