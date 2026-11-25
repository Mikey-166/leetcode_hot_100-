#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
AlgoForge · 力扣 Hot 100 & 华为实习通关教学平台
跨端本地服务引擎 (Windows 网页版 / 桌面软件窗口 / 小米澎湃OS & iOS PWA / 公网隧道)

零第三方依赖，基于 Python 3 标准库：
  · HTTP 静态服务 + PWA
  · SQLite 记录级双向同步（局域网 / 公网隧道）
  · LeetCode 式四语言判题（Python / C++ / Java / C）
  · AST 代码解析 + Python ACM 沙箱
  · Cloudflare 快速隧道一键公网访问
"""

import ast
import hmac
import json
import mimetypes
import os
import re
import secrets
import socket
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

BASE_DIR = Path(__file__).resolve().parent
WEB_DIR = BASE_DIR / "web"
DATA_DIR = BASE_DIR / "data"
DB_PATH = DATA_DIR / "platform.db"
TOKEN_FILE = DATA_DIR / "sync_token.txt"
DEFAULT_PORT = 8765

DB_LOCK = threading.Lock()

mimetypes.add_type("application/manifest+json", ".webmanifest")
mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("application/javascript", ".mjs")
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("image/svg+xml", ".svg")

SYNC_SECTIONS = ("days", "problemRecords", "csChecked", "judgeRecords")
META_KEYS = (
    "version", "theme", "primaryLang", "spoilerMode", "startDate",
    "selectedWeek", "selectedDay", "dailyRoutine", "aiConfig",
)
TUNNEL = {"proc": None, "url": None, "error": None, "startedAt": 0, "log": []}


# ---------------------------------------------------------------------------
# 基础
# ---------------------------------------------------------------------------
def init_db():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with DB_LOCK:
        conn = sqlite3.connect(str(DB_PATH))
        try:
            conn.execute(
                "CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)"
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS code_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    language TEXT NOT NULL,
                    problem_id INTEGER,
                    snippet TEXT NOT NULL,
                    summary TEXT,
                    created_at INTEGER NOT NULL
                )
                """
            )
            conn.commit()
        finally:
            conn.close()


def get_token():
    """首次启动自动生成 8 位访问口令，用于保护公网判题与同步接口。"""
    try:
        if TOKEN_FILE.exists():
            t = TOKEN_FILE.read_text(encoding="utf-8").strip()
            if t:
                return t
        t = secrets.token_hex(4)
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        TOKEN_FILE.write_text(t, encoding="utf-8")
        return t
    except Exception:
        return "algoforge"


def get_lan_ips():
    candidates = []
    if sys.platform.startswith("win"):
        try:
            out = subprocess.check_output(["ipconfig"], stderr=subprocess.DEVNULL)
            txt = out.decode("gbk", errors="ignore")
            for ip in re.findall(r"IPv4[^:\r\n]*:\s*(\d+\.\d+\.\d+\.\d+)", txt):
                if not ip.startswith(("127.", "169.254.", "198.18.")) and ip not in candidates:
                    candidates.append(ip)
        except Exception:
            pass
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.3)
        s.connect(("8.8.8.8", 80))
        primary_ip = s.getsockname()[0]
        s.close()
        if primary_ip and not primary_ip.startswith(("127.", "169.254.", "198.18.")) and primary_ip not in candidates:
            candidates.append(primary_ip)
    except Exception:
        pass
    try:
        hostname = socket.gethostname()
        for info in socket.getaddrinfo(hostname, None, socket.AF_INET):
            ip = info[4][0]
            if ip and not ip.startswith(("127.", "169.254.", "198.18.")) and ip not in candidates:
                candidates.append(ip)
    except Exception:
        pass

    def priority(ip_str):
        if ip_str.startswith(("192.168.56.", "192.168.137.")):
            return 2
        if ip_str.startswith("192.168."):
            return 0
        if ip_str.startswith("10."):
            return 1
        return 3

    candidates.sort(key=priority)
    return candidates


def find_free_port(preferred=DEFAULT_PORT):
    for p in range(preferred, preferred + 20):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(("127.0.0.1", p)) != 0:
                return p
    return preferred


# ---------------------------------------------------------------------------
# 状态合并（记录级 LWW）
# ---------------------------------------------------------------------------
def _merge_dict(local, remote, lts, rts):
    out = dict(local or {})
    ts = dict(lts or {})
    for k, v in (remote or {}).items():
        if rts.get(k, 0) > ts.get(k, 0):
            out[k] = v
            ts[k] = rts.get(k, 0)
    return out, ts


def merge_state(local, remote, local_ts, remote_ts):
    local = local or {}
    remote = remote or {}
    local_ts = local_ts or {}
    remote_ts = remote_ts or {}
    out = dict(local)
    ts = dict(local_ts)

    # 设置类整体 LWW
    if remote_ts.get("meta", 0) > local_ts.get("meta", 0):
        for k in META_KEYS:
            if k in remote:
                out[k] = remote[k]
        ts["meta"] = remote_ts.get("meta", 0)

    # 每日计划：按 day 合并
    ldays = {int(d.get("day", 0)): d for d in (local.get("days") or [])}
    rdays = {int(d.get("day", 0)): d for d in (remote.get("days") or [])}
    lts_days = {str(k): v for k, v in (local_ts.get("days") or {}).items()}
    rts_days = {str(k): v for k, v in (remote_ts.get("days") or {}).items()}
    merged_days_ts = dict(lts_days)
    for day, rec in rdays.items():
        key = str(day)
        if rts_days.get(key, 0) > lts_days.get(key, 0):
            ldays[day] = rec
            merged_days_ts[key] = rts_days.get(key, 0)
    if ldays:
        out["days"] = [ldays[k] for k in sorted(ldays)]
        ts["days"] = merged_days_ts

    # 题目记录 / 八股勾选 / 判题记录
    # 注意：前端 syncTs 里的时间戳键名是短名（problems / cs / judge），
    # 而存档字段是全名（problemRecords / csChecked / judgeRecords），必须映射，
    # 否则 ts 永远取不到值，跨设备的题目与判题记录会被静默丢弃。
    ts_key_of = {"problemRecords": "problems", "csChecked": "cs", "judgeRecords": "judge"}
    for section in ("problemRecords", "csChecked", "judgeRecords"):
        tk = ts_key_of[section]
        merged, mts = _merge_dict(
            local.get(section) or {},
            remote.get(section) or {},
            local_ts.get(tk) or {},
            remote_ts.get(tk) or {},
        )
        out[section] = merged
        ts[tk] = mts

    # STAR 项目整体 LWW
    if remote_ts.get("starProjects", 0) > local_ts.get("starProjects", 0):
        if "starProjects" in remote:
            out["starProjects"] = remote["starProjects"]
        ts["starProjects"] = remote_ts.get("starProjects", 0)

    return out, ts


def load_sync_state():
    with DB_LOCK:
        conn = sqlite3.connect(str(DB_PATH))
        try:
            row = conn.execute("SELECT value, updated_at FROM app_state WHERE key='user_store_v2'").fetchone()
        finally:
            conn.close()
    if not row:
        return None, {}, 0
    try:
        payload = json.loads(row[0])
        return payload.get("state"), payload.get("ts") or {}, row[1]
    except Exception:
        return None, {}, 0


def save_sync_state(state, ts, updated_at):
    raw = json.dumps({"state": state, "ts": ts}, ensure_ascii=False, separators=(",", ":"))
    with DB_LOCK:
        conn = sqlite3.connect(str(DB_PATH))
        try:
            conn.execute(
                "INSERT INTO app_state (key, value, updated_at) VALUES ('user_store_v2', ?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
                (raw, int(updated_at)),
            )
            conn.commit()
        finally:
            conn.close()


# ---------------------------------------------------------------------------
# 云端隧道
# ---------------------------------------------------------------------------
def find_cloudflared():
    for p in (BASE_DIR / "tools" / "cloudflared.exe", BASE_DIR / "tools" / "cloudflared"):
        if p.exists():
            return str(p)
    for p in os.environ.get("PATH", "").split(os.pathsep):
        cand = Path(p) / ("cloudflared.exe" if sys.platform.startswith("win") else "cloudflared")
        if cand.exists():
            return str(cand)
    return None


def tunnel_status():
    proc = TUNNEL.get("proc")
    running = bool(proc and proc.poll() is None)
    err = TUNNEL.get("error")
    if not running and not TUNNEL.get("url"):
        # 进程已退出且没拿到地址：把最后一行日志兜底成错误信息，避免前端只看到「启动失败」
        log = TUNNEL.get("log") or []
        if not err:
            tail = log[-1] if log else ""
            err = "隧道进程已退出" + (f"：{tail}" if tail else "（可稍后重试，或直接用局域网地址）")
        if "429" in " ".join(log):
            err = "Cloudflare 匿名隧道被限流（HTTP 429），请过几分钟重试；局域网同步不受影响"
    return {
        "running": running,
        "url": TUNNEL.get("url"),
        "error": err,
        "startedAt": TUNNEL.get("startedAt"),
        "exe": find_cloudflared(),
        "log": TUNNEL.get("log", [])[-8:],
    }


def stop_tunnel():
    proc = TUNNEL.get("proc")
    if proc and proc.poll() is None:
        try:
            proc.terminate()
        except Exception:
            pass
    TUNNEL.update({"proc": None, "url": None, "error": None, "startedAt": 0, "log": []})


def start_tunnel(port):
    if TUNNEL.get("proc") and TUNNEL["proc"].poll() is None:
        return tunnel_status()
    exe = find_cloudflared()
    if not exe:
        TUNNEL["error"] = "未找到 cloudflared，请先运行『开启公网同步』安装脚本"
        return tunnel_status()

    stop_tunnel()
    TUNNEL["error"] = None
    TUNNEL["log"] = []
    try:
        flags = subprocess.CREATE_NO_WINDOW if sys.platform.startswith("win") else 0
        proc = subprocess.Popen(
            [exe, "tunnel", "--url", f"http://127.0.0.1:{port}", "--no-autoupdate"],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, encoding="utf-8", errors="replace",
            creationflags=flags,
        )
        TUNNEL["proc"] = proc
        TUNNEL["startedAt"] = int(time.time() * 1000)

        def reader():
            for line in proc.stdout:
                line = (line or "").strip()
                if line:
                    TUNNEL["log"].append(line[:300])
                    TUNNEL["log"] = TUNNEL["log"][-30:]
                m = re.search(r"https://[a-z0-9-]+\.trycloudflare\.com", line or "")
                if m and not TUNNEL.get("url"):
                    TUNNEL["url"] = m.group(0)
            if not TUNNEL.get("url") and proc.poll() is not None:
                TUNNEL["error"] = "隧道进程已退出：" + (" | ".join(TUNNEL["log"][-3:]) or "未知原因")

        threading.Thread(target=reader, daemon=True).start()
    except Exception as e:
        TUNNEL["error"] = f"启动隧道失败：{e}"
    return tunnel_status()


# ---------------------------------------------------------------------------
# Python AST / 沙箱（保留原有能力）
# ---------------------------------------------------------------------------
def analyze_python_ast(code: str):
    result = {
        "astValid": False, "syntaxError": None, "functions": [], "classes": [],
        "maxLoopDepth": 0, "hasRecursion": False, "lineHints": {}, "warnings": [],
    }
    try:
        tree = ast.parse(code)
        result["astValid"] = True
    except SyntaxError as e:
        import textwrap
        dedented = textwrap.dedent(code)
        try:
            tree = ast.parse(dedented)
            result["astValid"] = True
        except SyntaxError as e2:
            result["syntaxError"] = f"第 {e2.lineno or e.lineno} 行存在语法残缺或非完整块: {e2.msg}"
            return result

    func_names = set()

    def walk(node, loop_depth=0, current_func=None):
        if isinstance(node, (ast.For, ast.While)):
            loop_depth += 1
            result["maxLoopDepth"] = max(result["maxLoopDepth"], loop_depth)
        if isinstance(node, ast.FunctionDef):
            func_names.add(node.name)
            args = [a.arg for a in node.args.args]
            result["functions"].append({"name": node.name, "args": args, "lineno": node.lineno})
            current_func = node.name
        if isinstance(node, ast.ClassDef):
            result["classes"].append({"name": node.name, "lineno": node.lineno})
        if isinstance(node, ast.Call):
            if isinstance(node.func, ast.Name):
                fn = node.func.id
                if current_func and fn == current_func:
                    result["hasRecursion"] = True
            elif isinstance(node.func, ast.Attribute):
                if node.func.attr == "append" and len(node.args) == 1 and isinstance(node.args[0], ast.Name):
                    arg_name = node.args[0].id
                    if arg_name in ("path", "track", "cur", "comb", "subset", "perm"):
                        result["warnings"].append(
                            f"⚠️ 第 {node.lineno} 行：检测到 `.append({arg_name})` 直接传入可变列表引用！在回溯算法中后续 `pop()` 会清空已收集答案，务必改为 `.append({arg_name}[:])` 或 `list({arg_name})`。"
                        )
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Mult):
            if isinstance(node.left, ast.List) and len(node.left.elts) == 1:
                inner = node.left.elts[0]
                if isinstance(inner, ast.BinOp) and isinstance(inner.op, ast.Mult) and isinstance(inner.left, ast.List):
                    result["warnings"].append(
                        f"⚠️ 第 {node.lineno} 行：检测到 `[[...]*n]*m` 二维数组浅拷贝陷阱！修改其中一行会导致所有行同步被改，请改用列表推导式 `[[0] * n for _ in range(m)]`。"
                    )
        lineno = getattr(node, "lineno", None)
        if lineno:
            hints = result["lineHints"].setdefault(str(lineno), [])
            if isinstance(node, ast.ListComp):
                hints.append("列表推导式（List Comprehension）：在 C 层循环构建新列表，比显式 `for + append` 更快更简洁。")
            elif isinstance(node, ast.DictComp):
                hints.append("字典推导式：快速构建键值映射哈希表（如 `{val: idx for idx, val in enumerate(nums)}`）。")
            elif isinstance(node, ast.Nonlocal):
                hints.append(f"`nonlocal {', '.join(node.names)}`：声明修改外层闭包函数中的变量（常用于在 DFS 内部更新外部全局最优解 `ans`）。")
            elif isinstance(node, ast.Slice):
                if node.lower is None and node.upper is None and node.step is None:
                    hints.append("`[:]` 全切片浅拷贝：生成独立副本，防止后续原地修改污染结果。")
                elif isinstance(node.step, ast.UnaryOp) and isinstance(node.step.op, ast.USub):
                    hints.append("`[::-1]` 逆序切片：快速生成反转后的序列或字符串。")
            elif isinstance(node, ast.BinOp) and isinstance(node.op, ast.FloorDiv):
                hints.append("`//` 向下整除运算符：Python 中 `/` 会产生浮点数，求下标 `mid` 或进制拆位必须用 `//`。")
            elif isinstance(node, ast.BinOp) and isinstance(node.op, ast.BitXor):
                hints.append("`^` 按位异或运算符：满足交换律且 `x ^ x == 0`、`0 ^ x == x`，常用于成对抵消问题。")
        for child in ast.iter_child_nodes(node):
            walk(child, loop_depth, current_func)

    walk(tree)
    for k in result["lineHints"]:
        seen = []
        for item in result["lineHints"][k]:
            if item not in seen:
                seen.append(item)
        result["lineHints"][k] = seen
    return result


def run_python_sandbox(code: str, stdin_data: str = "", timeout_sec: float = 3.0):
    start_t = time.perf_counter()
    with tempfile.NamedTemporaryFile("w", suffix=".py", encoding="utf-8", delete=False) as tf:
        prelude = (
            "from typing import List, Optional, Dict, Tuple, Set\n"
            "import collections, heapq, bisect, math, functools, itertools\n"
            "from collections import defaultdict, Counter, deque\n"
            "from math import inf\n\n"
        )
        tf.write(prelude + code)
        temp_path = tf.name
    try:
        env = os.environ.copy()
        env["PYTHONIOENCODING"] = "utf-8"
        proc = subprocess.run(
            [sys.executable, temp_path], input=stdin_data, capture_output=True, text=True,
            encoding="utf-8", errors="replace", timeout=timeout_sec, env=env,
        )
        elapsed_ms = round((time.perf_counter() - start_t) * 1000, 1)
        stderr_clean = proc.stderr
        if stderr_clean:
            stderr_clean = re.sub(r"line (\d+)", lambda m: f"line {max(1, int(m.group(1)) - 5)}", stderr_clean)
        return {
            "ok": proc.returncode == 0,
            "returncode": proc.returncode,
            "stdout": proc.stdout[:10000],
            "stderr": stderr_clean[:6000],
            "elapsedMs": elapsed_ms,
        }
    except subprocess.TimeoutExpired:
        return {
            "ok": False, "returncode": -1, "stdout": "",
            "stderr": f"⏱️ 执行超时（超过 {timeout_sec} 秒）！请检查是否存在死循环。",
            "elapsedMs": round(timeout_sec * 1000, 1),
        }
    except Exception as e:
        return {"ok": False, "returncode": -2, "stdout": "", "stderr": f"运行异常：{e}", "elapsedMs": 0}
    finally:
        try:
            os.remove(temp_path)
        except OSError:
            pass


# ---------------------------------------------------------------------------
# HTTP 处理
# ---------------------------------------------------------------------------
class PlatformHandler(BaseHTTPRequestHandler):
    server_version = "AlgoForgeServer/2.0"

    def log_message(self, fmt, *args):
        if "/api/" in self.path:
            sys.stdout.write(f"[API] {self.command} {self.path}\n")

    # ---- 基础响应 ----
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Sync-Token")

    def _send_json(self, data, status=200):
        raw = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self._cors()
        self.end_headers()
        self.wfile.write(raw)

    def _read_json_body(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > 8 * 1024 * 1024:
            return {}
        raw = self.rfile.read(length).decode("utf-8", errors="replace")
        try:
            return json.loads(raw)
        except Exception:
            return {}

    def _is_loopback(self):
        # cloudflared 隧道会把公网请求从 127.0.0.1 转发进来，若只看对端 IP 会把公网访客误判为本机，
        # 从而绕过口令直接读走全部学习数据。带这些头部的一律视为外部请求。
        for h in ("CF-Connecting-IP", "CF-Ray", "X-Forwarded-For", "X-Real-IP"):
            if self.headers.get(h):
                return False
        return self.client_address[0] in ("127.0.0.1", "::1")

    def _authorized(self):
        if self._is_loopback():
            return True
        return hmac.compare_digest(self.headers.get("X-Sync-Token", ""), get_token())

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    # ---- GET ----
    def do_GET(self):
        parsed = urlparse(self.path)
        route = parsed.path
        port = self.server.server_address[1]

        if route == "/api/device-info":
            ips = get_lan_ips()
            urls = [f"http://{ip}:{port}" for ip in ips]
            info = {
                "ok": True,
                "hostname": socket.gethostname(),
                "platform": sys.platform,
                "pythonVersion": sys.version.split()[0],
                "port": port,
                "lanIps": ips,
                "lanUrls": urls,
                "primaryUrl": urls[0] if urls else f"http://127.0.0.1:{port}",
                "serverTime": int(time.time() * 1000),
                "tokenRequired": True,
                "publicUrl": TUNNEL.get("url"),
                "tunnel": tunnel_status(),
            }
            if self._is_loopback():
                info["token"] = get_token()
            return self._send_json(info)

        if route == "/api/sync":
            if not self._authorized():
                return self._send_json({"ok": False, "error": "访问口令错误", "needToken": True}, 401)
            state, ts, updated_at = load_sync_state()
            return self._send_json({
                "ok": True, "state": state, "ts": ts,
                "updatedAt": updated_at, "serverTime": int(time.time() * 1000),
            })

        if route == "/api/state":
            if not self._authorized():
                return self._send_json({"ok": False, "error": "访问口令错误", "needToken": True}, 401)
            state, ts, updated_at = load_sync_state()
            if state is None:
                with DB_LOCK:
                    conn = sqlite3.connect(str(DB_PATH))
                    try:
                        row = conn.execute("SELECT value, updated_at FROM app_state WHERE key='user_store'").fetchone()
                    finally:
                        conn.close()
                if row:
                    try:
                        return self._send_json({"ok": True, "state": json.loads(row[0]), "updatedAt": row[1]})
                    except Exception:
                        pass
            return self._send_json({"ok": True, "state": state, "updatedAt": updated_at})

        if route == "/api/tunnel/status":
            return self._send_json({"ok": True, **tunnel_status(), "serverTime": int(time.time() * 1000)})

        if route == "/api/download-offline":
            try:
                import base64
                svg_b64 = "data:image/svg+xml;base64," + base64.b64encode((WEB_DIR / "icons" / "icon.svg").read_bytes()).decode("ascii")
                css_text = (WEB_DIR / "css" / "styles.css").read_text(encoding="utf-8")
                js_order = [
                    "data-problems.js",
                    "data-judge.js",
                    "data-schedule-guide.js",
                    "utils-qr-highlight.js",
                    "code-analyzer.js",
                    "app.js",
                ]
                combined_js = "\n\n".join(
                    (WEB_DIR / "js" / fn).read_text(encoding="utf-8").replace("</script>", "<\\/script>")
                    for fn in js_order if (WEB_DIR / "js" / fn).is_file()
                )
                html = (WEB_DIR / "index.html").read_text(encoding="utf-8")
                html = html.replace("./icons/icon.svg", svg_b64)
                html = html.replace('<link rel="manifest" href="./manifest.webmanifest" />', "")
                html = html.replace('<link rel="stylesheet" href="./css/styles.css" />', f"<style>\n{css_text}\n</style>")
                html = re.sub(
                    r'(?:\s*<script src="\./js/[^"]+"></script>)+',
                    lambda _m: f"\n  <script>\n{combined_js}\n  </script>",
                    html,
                    count=1,
                )
                raw = html.encode("utf-8")
                fname = "AlgoForge_Hot100_Mobile.html"
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Disposition", f'attachment; filename="{fname}"')
                self.send_header("Content-Length", str(len(raw)))
                self._cors()
                self.end_headers()
                self.wfile.write(raw)
                return
            except Exception as e:
                return self._send_json({"ok": False, "error": str(e)}, 500)

        if route == "/api/judge/meta":
            try:
                from judge.engine import get_db
                db = get_db()
                return self._send_json({"ok": True, "count": len(db), "problems": sorted(int(k) for k in db)})
            except Exception as e:
                return self._send_json({"ok": False, "error": str(e)}, 500)

        # 静态资源
        rel = route.lstrip("/")
        if not rel:
            rel = "index.html"
        target = (WEB_DIR / rel).resolve()
        if not str(target).startswith(str(WEB_DIR.resolve())) or not target.is_file():
            target = WEB_DIR / "index.html"
            if not target.is_file():
                self.send_error(404, "File not found")
                return

        ctype, _ = mimetypes.guess_type(str(target))
        if not ctype:
            ctype = "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "application/json", "application/manifest+json"):
            ctype += "; charset=utf-8"

        data = target.read_bytes()
        # 仅对「本机直连」注入访问口令；局域网/公网访客必须用带 ?token= 的链接打开，
        # 否则任何人拿到公网地址都能从 HTML 里读到口令。
        if target.name == "index.html" and self._is_loopback():
            token = get_token()
            inject = f'<script>window.ALGOFORGE_TOKEN={json.dumps(token)};</script>'.encode("utf-8")
            data = data.replace(b"</head>", inject + b"\n</head>", 1)
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Service-Worker-Allowed", "/")
        self.send_header("Cache-Control", "no-cache")
        self._cors()
        self.end_headers()
        self.wfile.write(data)

    # ---- POST ----
    def do_POST(self):
        parsed = urlparse(self.path)
        route = parsed.path

        if route == "/api/judge":
            if not self._authorized():
                return self._send_json({"ok": False, "status": "CE", "compileError": "访问口令不正确", "cases": []}, 401)
            body = self._read_json_body()
            try:
                from judge.engine import judge
                res = judge(
                    int(body.get("problemId") or 0),
                    str(body.get("language") or "python"),
                    str(body.get("code") or ""),
                    str(body.get("mode") or "submit"),
                )
                return self._send_json(res)
            except Exception as e:
                return self._send_json({
                    "ok": False, "status": "CE", "passed": 0, "total": 0,
                    "cases": [], "compileError": f"判题服务异常：{e}", "elapsedMs": 0,
                }, 500)

        if route == "/api/sync":
            if not self._authorized():
                return self._send_json({"ok": False, "error": "token"}, 401)
            body = self._read_json_body()
            remote_state = body.get("state")
            remote_ts = body.get("ts") or {}
            if not isinstance(remote_state, dict):
                return self._send_json({"ok": False, "error": "Invalid state"}, 400)
            local_state, local_ts, _ = load_sync_state()
            if local_state is None:
                merged, mts = remote_state, remote_ts
            else:
                merged, mts = merge_state(local_state, remote_state, local_ts, remote_ts)
            now = int(time.time() * 1000)
            save_sync_state(merged, mts, now)
            return self._send_json({
                "ok": True, "state": merged, "ts": mts,
                "updatedAt": now, "serverTime": now,
                "deviceId": str(body.get("deviceId") or ""),
            })

        if route == "/api/state":
            if not self._authorized():
                return self._send_json({"ok": False, "error": "访问口令错误", "needToken": True}, 401)
            body = self._read_json_body()
            state_obj = body.get("state")
            if not isinstance(state_obj, dict):
                return self._send_json({"ok": False, "error": "Invalid state payload"}, 400)
            updated_at = int(body.get("updatedAt") or int(time.time() * 1000))
            local_state, local_ts, _ = load_sync_state()
            if local_state is None:
                merged, mts = state_obj, {}
            else:
                merged, mts = merge_state(local_state, state_obj, local_ts, local_ts)
            save_sync_state(merged, mts, updated_at)
            return self._send_json({"ok": True, "state": merged, "ts": mts, "updatedAt": updated_at})

        if route == "/api/run-python":
            if not self._authorized():
                return self._send_json({"ok": False, "stderr": "访问口令不正确"}, 401)
            body = self._read_json_body()
            code = str(body.get("code") or "")
            stdin_data = str(body.get("stdin") or "")
            if not code.strip():
                return self._send_json({"ok": False, "stderr": "代码为空，请先输入 Python 代码。"})
            return self._send_json(run_python_sandbox(code, stdin_data, timeout_sec=3.0))

        if route == "/api/analyze-code":
            body = self._read_json_body()
            code = str(body.get("code") or "")
            lang = str(body.get("language") or "auto")
            ast_info = analyze_python_ast(code) if lang in ("python", "py", "auto") else None
            return self._send_json({"ok": True, "pythonAst": ast_info})

        if route == "/api/tunnel/start":
            if not self._is_loopback() and not self._authorized():
                return self._send_json({"ok": False, "error": "token"}, 401)
            return self._send_json({"ok": True, **start_tunnel(self.server.server_address[1])})

        if route == "/api/tunnel/stop":
            stop_tunnel()
            return self._send_json({"ok": True, **tunnel_status()})

        return self._send_json({"ok": False, "error": "Unknown API endpoint"}, 404)


# ---------------------------------------------------------------------------
# 启动
# ---------------------------------------------------------------------------
def launch_desktop_app_window(url: str):
    edge_paths = [
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        os.path.expandvars(r"%LocalAppData%\Microsoft\Edge\Application\msedge.exe"),
    ]
    chrome_paths = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        os.path.expandvars(r"%LocalAppData%\Google\Chrome\Application\chrome.exe"),
    ]
    for browser_exe in edge_paths + chrome_paths:
        if os.path.isfile(browser_exe):
            try:
                subprocess.Popen([browser_exe, f"--app={url}", "--window-size=1440,920"])
                return True
            except Exception:
                pass
    webbrowser.open(url)
    return False


def main():
    init_db()
    try:
        from judge.engine import reset_tmp
        reset_tmp()
    except Exception:
        pass
    token = get_token()
    mode, port, no_open = "web", DEFAULT_PORT, False
    for arg in sys.argv[1:]:
        if arg == "--app":
            mode = "app"
        elif arg == "--no-open":
            no_open = True
        elif arg.startswith("--port="):
            try:
                port = int(arg.split("=", 1)[1])
            except ValueError:
                pass

    actual_port = find_free_port(port)
    server = ThreadingHTTPServer(("0.0.0.0", actual_port), PlatformHandler)
    local_url = f"http://127.0.0.1:{actual_port}"
    lan_ips = get_lan_ips()

    print("=" * 72)
    print("  🚀 AlgoForge · 力扣 Hot 100 & 华为实习冲刺教学平台 已启动！")
    print("=" * 72)
    print(f"  💻 Windows 电脑本机访问 : {local_url}")
    if lan_ips:
        for ip in lan_ips:
            print(f"  📱 手机/平板局域网访问  : http://{ip}:{actual_port}")
    print(f"  🔑 跨设备访问口令        : {token}")
    print("  ☁️  公网同步：页面右上角「手机App」→「开启公网同步」")
    print("=" * 72)
    print("  按 Ctrl + C 可停止服务（所有打卡/判题记录实时保存在 data/platform.db）\n")

    if not no_open:
        def opener():
            time.sleep(0.4)
            if mode == "app":
                launch_desktop_app_window(local_url)
            else:
                webbrowser.open(local_url)
        threading.Thread(target=opener, daemon=True).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        stop_tunnel()
        print("\n服务已安全停止，再见！祝早日拿下华为实习 Offer！")
        server.server_close()


if __name__ == "__main__":
    main()
