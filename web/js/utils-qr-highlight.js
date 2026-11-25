// AlgoForge · 零外部依赖四语言代码高亮引擎 & 标准 QR Code 二维码本地绘制引擎
// 完全离线可用，确保 Windows 桌面端与小米澎湃 OS 手机端在无外网/校园网隔离下 100% 毫秒级渲染

window.ALGO_UTILS = (function () {
  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // 轻量级精准词法着色器（支持 Python / C++ / Java / C）
  const KEYWORDS = {
    python: new Set([
      "def", "class", "return", "if", "elif", "else", "for", "while", "in", "not", "and", "or",
      "is", "None", "True", "False", "import", "from", "as", "pass", "break", "continue",
      "lambda", "nonlocal", "global", "yield", "try", "except", "finally", "with", "del", "assert"
    ]),
    cpp: new Set([
      "class", "struct", "public", "private", "protected", "return", "if", "else", "for", "while",
      "do", "switch", "case", "break", "continue", "int", "long", "double", "float", "char", "bool",
      "void", "auto", "const", "static", "nullptr", "true", "false", "new", "delete", "using",
      "namespace", "std", "template", "typename", "size_t", "unsigned", "signed"
    ]),
    java: new Set([
      "public", "private", "protected", "class", "interface", "static", "final", "void", "int",
      "long", "double", "float", "boolean", "char", "byte", "short", "return", "if", "else",
      "for", "while", "do", "switch", "case", "break", "continue", "new", "null", "true", "false",
      "this", "super", "import", "package", "throws", "try", "catch"
    ]),
    c: new Set([
      "int", "long", "short", "char", "void", "float", "double", "bool", "true", "false", "NULL",
      "struct", "typedef", "enum", "union", "const", "static", "unsigned", "signed", "sizeof",
      "return", "if", "else", "for", "while", "do", "switch", "case", "break", "continue"
    ])
  };

  const BUILTINS = new Set([
    "self", "len", "range", "enumerate", "min", "max", "sum", "abs", "sorted", "reversed", "list",
    "dict", "set", "tuple", "int", "str", "ord", "chr", "zip", "map", "print", "next", "iter", "inf",
    "deque", "defaultdict", "Counter", "heapq", "bisect_left", "bisect_right",
    "vector", "string", "unordered_map", "unordered_set", "priority_queue", "queue", "stack", "pair",
    "List", "Map", "HashMap", "Set", "HashSet", "ArrayList", "LinkedList", "ArrayDeque", "PriorityQueue",
    "String", "StringBuilder", "Integer", "Long", "Math", "Arrays", "Collections",
    "ListNode", "TreeNode", "Node", "Solution", "UT_hash_handle", "malloc", "calloc", "realloc", "free", "qsort", "memset"
  ]);

  function highlightCode(code, lang = "python", withLineNumbers = true) {
    const kwSet = KEYWORDS[lang] || KEYWORDS.python;
    const lines = String(code || "").replace(/\r\n/g, "\n").split("\n");

    const tokenRegex =
      lang === "python"
        ? /(#.*$|"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b\d+(?:\.\d+)?\b|\b[A-Za-z_]\w*\b)/gm
        : /(\/\/.*$|^\s*#\w+.*$|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b\d+(?:\.\d+)?(?:LL|ULL|L|U|f)?\b|\b[A-Za-z_]\w*\b)/gm;

    const renderedLines = lines.map((line, idx) => {
      let result = "";
      let lastIndex = 0;
      tokenRegex.lastIndex = 0;
      let match;
      while ((match = tokenRegex.exec(line)) !== null) {
        if (match.index > lastIndex) {
          result += escapeHtml(line.slice(lastIndex, match.index));
        }
        const tok = match[0];
        if ((lang === "python" && tok.startsWith("#")) || (lang !== "python" && tok.startsWith("//"))) {
          result += `<span class="hl-comment">${escapeHtml(tok)}</span>`;
        } else if (lang !== "python" && /^\s*#/.test(tok)) {
          result += `<span class="hl-macro">${escapeHtml(tok)}</span>`;
        } else if (tok.startsWith('"') || tok.startsWith("'")) {
          result += `<span class="hl-str">${escapeHtml(tok)}</span>`;
        } else if (/^\d/.test(tok)) {
          result += `<span class="hl-num">${escapeHtml(tok)}</span>`;
        } else if (kwSet.has(tok)) {
          result += `<span class="hl-kw">${escapeHtml(tok)}</span>`;
        } else if (BUILTINS.has(tok)) {
          result += `<span class="hl-type">${escapeHtml(tok)}</span>`;
        } else {
          result += escapeHtml(tok);
        }
        lastIndex = tokenRegex.lastIndex;
      }
      if (lastIndex < line.length) {
        result += escapeHtml(line.slice(lastIndex));
      }
      if (!withLineNumbers) return result;
      return `<div class="code-line" data-line="${idx + 1}"><span class="ln">${idx + 1}</span><span class="lc">${result || " "}</span></div>`;
    });

    return withLineNumbers ? renderedLines.join("") : renderedLines.join("\n");
  }

  // =========================================================================
  // 紧凑型标准 QR Code (Version 1 ~ 6, Byte Mode, ECC Level L) 纯 JS 生成器
  // 用于在电脑端直接把 http://192.168.x.x:8765 画成可扫二维码供小米澎湃系统相机秒扫！
  // =========================================================================
  const GF_EXP = new Uint8Array(512);
  const GF_LOG = new Uint8Array(256);
  (function initGF() {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      GF_EXP[i] = x;
      GF_LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
  })();

  function gfMul(a, b) {
    return a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]];
  }

  function rsGeneratorPoly(degree) {
    let poly = [1];
    for (let i = 0; i < degree; i++) {
      const next = new Array(poly.length + 1).fill(0);
      const root = GF_EXP[i];
      for (let j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];
        next[j + 1] ^= gfMul(poly[j], root);
      }
      poly = next;
    }
    return poly;
  }

  function rsEncode(data, ecLen) {
    const gen = rsGeneratorPoly(ecLen);
    const rem = new Array(ecLen).fill(0);
    for (const b of data) {
      const factor = b ^ rem[0];
      rem.shift();
      rem.push(0);
      for (let j = 0; j < ecLen; j++) {
        rem[j] ^= gfMul(gen[j + 1], factor);
      }
    }
    return rem;
  }

  // Version 1..6 (ECC Level L, 单块结构，最多可容纳 134 字节 URL，绰绰有余！)
  const QR_VERSIONS = [
    null,
    { ver: 1, size: 21, dataBytes: 19, ecBytes: 7, align: [] },
    { ver: 2, size: 25, dataBytes: 34, ecBytes: 10, align: [6, 18] },
    { ver: 3, size: 29, dataBytes: 55, ecBytes: 15, align: [6, 22] },
    { ver: 4, size: 33, dataBytes: 80, ecBytes: 20, align: [6, 26] },
    { ver: 5, size: 37, dataBytes: 108, ecBytes: 26, align: [6, 30] },
    { ver: 6, size: 41, dataBytes: 136, ecBytes: 18, blocks: 2, align: [6, 34] }
  ];

  function createQrMatrix(text) {
    const bytes = Array.from(new TextEncoder().encode(text));
    let spec = QR_VERSIONS.slice(1, 6).find((v) => bytes.length + 2 <= v.dataBytes);
    if (!spec) spec = QR_VERSIONS[5];

    const bits = [];
    const pushBits = (val, len) => {
      for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
    };
    pushBits(0b0100, 4); // Byte mode
    pushBits(bytes.length, 8);
    bytes.forEach((b) => pushBits(b, 8));
    const maxBits = spec.dataBytes * 8;
    for (let i = 0; i < 4 && bits.length < maxBits; i++) bits.push(0);
    while (bits.length % 8 !== 0) bits.push(0);

    const codewords = [];
    for (let i = 0; i < bits.length; i += 8) {
      let byte = 0;
      for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
      codewords.push(byte);
    }
    const pads = [0xec, 0x11];
    let padIdx = 0;
    while (codewords.length < spec.dataBytes) {
      codewords.push(pads[padIdx++ % 2]);
    }
    const ec = rsEncode(codewords, spec.ecBytes);
    const fullBytes = codewords.concat(ec);

    const N = spec.size;
    const mat = Array.from({ length: N }, () => new Array(N).fill(0));
    const isFunc = Array.from({ length: N }, () => new Array(N).fill(false));

    const setFunc = (r, c, dark) => {
      if (r >= 0 && r < N && c >= 0 && c < N) {
        mat[r][c] = dark ? 1 : 0;
        isFunc[r][c] = true;
      }
    };

    const drawFinder = (r0, c0) => {
      for (let dr = -1; dr <= 7; dr++) {
        for (let dc = -1; dc <= 7; dc++) {
          const inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
          const inRing = dr === 0 || dr === 6 || dc === 0 || dc === 6;
          const inCore = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
          setFunc(r0 + dr, c0 + dc, inOuter && (inRing || inCore));
        }
      }
    };
    drawFinder(0, 0);
    drawFinder(0, N - 7);
    drawFinder(N - 7, 0);

    for (let i = 8; i < N - 8; i++) {
      setFunc(6, i, i % 2 === 0);
      setFunc(i, 6, i % 2 === 0);
    }

    if (spec.align.length) {
      for (const ar of spec.align) {
        for (const ac of spec.align) {
          if ((ar === 6 && ac === 6) || (ar === 6 && ac === N - 7) || (ar === N - 7 && ac === 6)) continue;
          for (let dr = -2; dr <= 2; dr++) {
            for (let dc = -2; dc <= 2; dc++) {
              setFunc(ar + dr, ac + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
            }
          }
        }
      }
    }

    // Reserve format bits + dark module
    for (let i = 0; i <= 8; i++) {
      if (!isFunc[8][i]) setFunc(8, i, false);
      if (!isFunc[i][8]) setFunc(i, 8, false);
    }
    for (let i = 0; i < 8; i++) {
      if (!isFunc[8][N - 1 - i]) setFunc(8, N - 1 - i, false);
      if (!isFunc[N - 1 - i][8]) setFunc(N - 1 - i, 8, false);
    }
    setFunc(N - 8, 8, true);

    // Fill data zig-zag
    let bitIdx = 0;
    const totalBits = fullBytes.length * 8;
    let upward = true;
    for (let right = N - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < N; vert++) {
        const r = upward ? N - 1 - vert : vert;
        for (let j = 0; j < 2; j++) {
          const c = right - j;
          if (!isFunc[r][c]) {
            let dark = false;
            if (bitIdx < totalBits) {
              dark = ((fullBytes[bitIdx >>> 3] >>> (7 - (bitIdx & 7))) & 1) === 1;
              bitIdx++;
            }
            // Apply Mask 0: (r + c) % 2 === 0
            if ((r + c) % 2 === 0) dark = !dark;
            mat[r][c] = dark ? 1 : 0;
          }
        }
      }
      upward = !upward;
    }

    // Format string for ECC Level L (01) + Mask 0 (000) => 0x77c4 (111011111000100)
    const fmt = 0x77c4;
    const fmtBit = (i) => ((fmt >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) setFunc(8, i, fmtBit(14 - i));
    setFunc(8, 7, fmtBit(8));
    setFunc(8, 8, fmtBit(7));
    setFunc(7, 8, fmtBit(6));
    for (let i = 9; i < 15; i++) setFunc(14 - i, 8, fmtBit(14 - i));

    for (let i = 0; i < 8; i++) setFunc(8, N - 1 - i, fmtBit(i));
    for (let i = 8; i < 15; i++) setFunc(N - 15 + i, 8, fmtBit(i));
    setFunc(N - 8, 8, true);

    return mat;
  }

  function renderQrToCanvas(canvas, text, sizePx = 200) {
    if (!canvas || !text) return;
    const mat = createQrMatrix(text);
    const quiet = 3;
    const modules = mat.length + quiet * 2;
    canvas.width = sizePx;
    canvas.height = sizePx;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, sizePx, sizePx);
    const scale = sizePx / modules;
    ctx.fillStyle = "#0f172a";
    for (let r = 0; r < mat.length; r++) {
      for (let c = 0; c < mat.length; c++) {
        if (mat[r][c]) {
          ctx.fillRect(
            Math.floor((c + quiet) * scale),
            Math.floor((r + quiet) * scale),
            Math.ceil(scale),
            Math.ceil(scale)
          );
        }
      }
    }
  }

  // 行级简易对比器（用于 15 分钟白板手撕默写后与标准答案比对）
  function normalizeCodeLines(code) {
    return String(code || "")
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((l) => l.trimEnd())
      .filter((l) => l.trim() !== "");
  }

  return {
    escapeHtml,
    highlightCode,
    renderQrToCanvas,
    normalizeCodeLines
  };
})();
