// AlgoForge · 多语言（Python / C++ / Java / C）代码片段智能解析引擎
// 双核架构：1. 零配置离线静态语法+算法模式逐行显微镜（联动本地 Python AST 后端）  2. 可选接入 AI 大模型流式深度追问

window.ALGO_CODE_ANALYZER = (function () {
  // 1. 语言自动识别器
  function detectLanguage(code) {
    const s = code || "";
    if (/#include\s*<(iostream|vector|unordered_map|unordered_set|queue|stack|algorithm|sstream|bits\/stdc\+\+\.h)>/.test(s) ||
        /\b(class\s+Solution\s*\{[\s\S]*public:|vector\s*<|unordered_map\s*<|cout\s*<<|cin\s*>>|nullptr|auto\s+\w+\s*:)/.test(s) ||
        /\bstd::/.test(s)) {
      return "cpp";
    }
    if (/\b(public\s+class\s+|List<\w+>|Map<|HashMap<|ArrayList<|ArrayDeque<|PriorityQueue<|System\.out\.|StringBuilder|\.charAt\(|\.length\(\))/.test(s) ||
        /\bnew\s+(int|ListNode|TreeNode|HashMap|ArrayList)\b/.test(s)) {
      return "java";
    }
    if (/#include\s*<(stdio\.h|stdlib\.h|string\.h|stdbool\.h|limits\.h|uthash\.h)>/.test(s) ||
        /\b(malloc\s*\(|calloc\s*\(|realloc\s*\(|free\s*\(|sizeof\s*\(|qsort\s*\(|int\*\s*returnSize|struct\s+(ListNode|TreeNode)\s*\*)/.test(s)) {
      return "c";
    }
    if (/\b(def\s+\w+\s*\(|self\b|elif\b|None\b|True\b|False\b|enumerate\s*\(|range\s*\(|defaultdict|deque\s*\(|heapq\.|bisect_left|nonlocal\b)/.test(s) ||
        /:\s*(\n|#|$)/.test(s)) {
      return "python";
    }
    // 兜底区分 C 系大括号语法与 Python
    if (/[{};]/.test(s) && /->/.test(s)) return "cpp";
    if (/[{};]/.test(s)) return "java";
    return "python";
  }

  const LANG_LABELS = {
    python: "Python 3（主力语言）",
    cpp: "C++ (STL)",
    java: "Java",
    c: "C 语言（指针/底层）"
  };

  // 2. 30+ 高频算法套路模式雷达库
  const ALGO_PATTERNS = [
    {
      name: "不定长滑动窗口（Sliding Window）",
      badge: "双指针/滑窗",
      test: (c) => /\b(left|l)\b[\s\S]*\bfor\b[\s\S]*\b(right|r)\b[\s\S]*\bwhile\b[\s\S]*(\b(left|l)\s*\+=\s*1|\+\+\s*(left|l)|(left|l)\s*\+\+)/.test(c),
      desc: "外层右指针主动向右扩窗纳入新元素，内层 while 循环在窗口不合法（或已满足覆盖条件求最短）时不断右移左指针缩窗回滚状态，每个元素最多进出窗口各一次，将 O(n²) 暴力枚举降为 O(n) 线性时间。"
    },
    {
      name: "单调栈 / 单调双端队列（Monotonic Stack / Deque）",
      badge: "栈与队列核心",
      test: (c) => /\bwhile\b[^\n]*(st|stack|dq|deque)[^\n]*(nums|heights|temperatures|\[)[^\n]*[\s\S]*(pop|popBack|pollLast|pop_back)/.test(c),
      desc: "入栈/入队前通过 while 循环不断弹出破坏单调性的栈顶/队尾元素。用于 O(n) 寻找每个元素『左/右边第一个更大或更小元素』（如每日温度、柱状图最大矩形、滑动窗口最大值）。栈中通常存储下标而非数值以便计算区间宽度！"
    },
    {
      name: "链表原地反转（In-place Linked List Reversal）",
      badge: "手撕链表核心",
      test: (c) => /(nxt|next|temp|tmp)\s*=\s*\w+(\.next|->next)[\s\S]*(\.next|->next)\s*=\s*(pre|prev)/.test(c),
      desc: "经典四行掉头操作：① 先用临时变量 nxt 保存 cur.next 防止断链丢失后续节点；② 将 cur.next 反向指向前驱 pre；③ pre 前移到 cur；④ cur 前移到 nxt。"
    },
    {
      name: "链表快慢指针（Floyd 龟兔赛跑 / 找中点）",
      badge: "链表双指针",
      test: (c) => /\bslow\b[\s\S]*\bfast\b[\s\S]*(\.next\.next|->next->next)/.test(c),
      desc: "慢指针每次走 1 步，快指针每次走 2 步。若链表无环，fast 到尾时 slow 恰好停在中点（常用于回文链表、归并排序链表）；若有环，fast 必在环内套圈追上 slow（判环与寻找入环口）。"
    },
    {
      name: "虚拟头节点哨兵技巧（Dummy Node）",
      badge: "防空指针利器",
      test: (c) => /\bdummy\b/.test(c),
      desc: "在原链表 head 前人为挂载一个伪头节点 dummy，最后返回 dummy.next。当原头节点可能被删除、交换或从零开始拼接新链表时，可彻底省去对 head 为空的繁琐特判！"
    },
    {
      name: "二分查找区间收缩（Binary Search）",
      badge: "O(log n) 折半",
      test: (c) => /\bwhile\s*\(?\s*(left|l|low)\s*<=?\s*(right|r|high)[\s\S]*\bmid\b/.test(c),
      desc: "利用数组的有序性或二段性，每次取中点 mid 判定后直接排除一半无效区间。重点关注循环条件是闭区间 (left <= right) 还是半开区间 (left < right)，以及 mid 更新时 +1/-1 防止死循环。"
    },
    {
      name: "回溯决策树：做选择 → 递归 → 撤销恢复现场",
      badge: "DFS 回溯剪枝",
      test: (c) => /(path|track|comb|board)[\s\S]*(append|push_back|\.add\(|=\s*['"]#['"])[\s\S]*(dfs|backtrack)\s*\([\s\S]*(pop\(|pop_back|\.remove\()/.test(c),
      desc: "在决策树上深度优先枚举：进入分支前先修改状态（如 path.append），递归探索子树返回后，必须严格反向撤销修改（如 path.pop / used[i]=False / 网格字符还原），确保不影响兄弟分支！"
    },
    {
      name: "动态规划：0-1 背包倒序空间压缩",
      badge: "背包 DP",
      test: (c) => /\bdp\s*\[[\s\S]*(range\s*\([^,]+,[^,]+,\s*-1\)|--\s*j|j\s*--)/.test(c),
      desc: "外层枚举物品，内层【倒序】枚举容量 j。倒序的精髓在于计算本轮 dp[j] 时，引用的 dp[j - x] 仍是上一轮尚未放入当前物品的旧值，从而保证每个物品最多只被选取 1 次！"
    },
    {
      name: "动态规划：完全背包 / 线性状态转移",
      badge: "动态规划 DP",
      test: (c) => /\bdp\s*\[[^\]]+\]\s*=\s*(min|max|Math\.min|Math\.max|fmin|fmax)?[\s\S]*\bdp\s*\[/.test(c),
      desc: "将原问题拆解为重叠子问题，用 dp 数组记忆最优子结构状态，通过状态转移方程自底向上递推（若物品可无限重复选如零钱兑换，内层容量采用正序遍历）。"
    },
    {
      name: "前缀和 + 哈希表频次统计",
      badge: "子数组求和神器",
      test: (c) => /(pre|prefix|cur_sum|sum)[\s\S]*-\s*(k|target|targetSum)/.test(c),
      desc: "利用子段和公式 sum(j..i) = pre[i] - pre[j-1] == k，转化为在哈希表中 O(1) 查询历史前缀和等于 pre - k 出现的次数。初始化 mp[0] = 1 用于兜底从下标 0 开始恰好达标的区间。"
    },
    {
      name: "网格 DFS / 多源 BFS 连通扩散",
      badge: "华为机考压轴最爱",
      test: (c) => /(dirs|DIRS|dx|dy|\(\s*-1\s*,\s*0\s*\)|\{\s*-1\s*,\s*0\s*\})/.test(c) || /\bgrid\s*\[/.test(c) && /\b(dfs|deque|queue)\b/i.test(c),
      desc: "利用上下左右四方向偏移数组遍历二维矩阵。核心铁律：入队或进入递归时立刻修改状态标记为已访问，防止同一格子被周围多个邻居重复加入队列导致内存/时间爆炸！"
    },
    {
      name: "入度拓扑排序（Kahn 算法判环）",
      badge: "图论依赖调度",
      test: (c) => /\b(indeg|inDegree|in_degree)\b/i.test(c),
      desc: "统计所有节点入度，先将入度为 0（无前置依赖）的节点入队；每次弹出节点将其邻居入度减 1，减至 0 则继续入队。最终若出队总数等于总节点数则无环可完成调度。"
    },
    {
      name: "优先队列 / 大小根堆维护极值（Heap / TopK）",
      badge: "堆结构",
      test: (c) => /\b(heapq|heappush|heappop|priority_queue|PriorityQueue)\b/.test(c),
      desc: "利用二叉堆 O(log k) 插入与弹出堆顶的性质，动态维护前 K 大元素（用容量为 K 的小根堆淘汰更小值）、合并 K 个有序链表或用对顶堆动态维护中位数。"
    },
    {
      name: "树形后序分治汇报（Tree Post-order Divide & Conquer）",
      badge: "二叉树手撕核心",
      test: (c) => /(\.left|->left)[\s\S]*(\.right|->right)[\s\S]*\breturn\b/.test(c),
      desc: "先递归获取左子树和右子树汇报的信息（如高度、节点指针、单链最大贡献），在当前拐点处综合左右结果更新全局答案，再向父节点返回当前子树的单侧最优值。"
    },
    {
      name: "位运算异或抵消 / 摩尔投票",
      badge: "O(1) 空间技巧",
      test: (c) => /(\^=|votes\s*\+=|votes\s*-=)/.test(c),
      desc: "利用按位异或 a ^ a = 0 成对抵消找出唯一落单数字，或利用摩尔投票『众数与非众数一换一对冲』在 O(1) 额外空间内找出出现超过半数的元素。"
    }
  ];

  // 3. 逐行微观语法与算法意图解析规则（覆盖 Python / C++ / Java / C）
  function explainSingleLine(line, lang, lineNum, astHints) {
    const t = line.trim();
    if (!t) return null;
    // 纯注释行
    if (t.startsWith("#") && !t.startsWith("#include") && !t.startsWith("#define")) {
      return { type: "comment", text: `代码注释说明：${t.replace(/^#+\s*/, "")}` };
    }
    if (t.startsWith("//") || t.startsWith("/*") || t.startsWith("*")) {
      return { type: "comment", text: `代码注释说明：${t.replace(/^(\/\/+|\/\*+|\*+\/?)\s*/, "")}` };
    }
    // 纯右大括号
    if (/^[}\];]+$/.test(t)) {
      return { type: "structure", text: "结束当前代码块 / 循环或函数作用域。" };
    }

    const notes = [];

    // ===== 头文件与导入 =====
    if (/^#include\s*<(.+)>/.test(t)) {
      const hdr = RegExp.$1;
      const hdrMap = {
        "iostream": "引入 C++ 标准输入输出流（cin / cout）",
        "vector": "引入 C++ 动态数组容器 std::vector",
        "string": "引入字符串类与文本操作支持",
        "sstream": "引入字符串流 stringstream（ACM 模式按空格/逗号切分整行神器）",
        "unordered_map": "引入底层基于哈希表的键值对映射（平均 O(1) 查找）",
        "unordered_set": "引入哈希集合（O(1) 判重与查找）",
        "queue": "引入队列 queue 与优先队列（堆）priority_queue",
        "stack": "引入后进先出栈容器 std::stack",
        "algorithm": "引入 sort / max / min / reverse / lower_bound 等标准算法",
        "stdio.h": "引入 C 标准输入输出库（printf / scanf / fgets）",
        "stdlib.h": "引入 C 动态内存管理（malloc / calloc / free）与快速排序 qsort",
        "string.h": "引入 C 内存与字符串函数（memset / memcpy / strlen / strtok）",
        "stdbool.h": "引入 C99 布尔类型 bool / true / false",
        "limits.h": "引入整型极值常量 INT_MAX / INT_MIN"
      };
      notes.push(hdrMap[hdr] || `引入系统标准头文件 <${hdr}>。`);
    }
    if (/^(from\s+\S+\s+import\s+.+|import\s+.+)/.test(t)) {
      if (/defaultdict/.test(t)) notes.push("`defaultdict`：键不存在时自动初始化默认值（如空列表 `list` 或 `0`），省去繁琐判空。");
      if (/Counter/.test(t)) notes.push("`Counter`：Python 频次统计哈希表神器，一键统计可迭代对象中各元素出现次数。");
      if (/deque/.test(t)) notes.push("`deque`：双端队列，支持队首 `popleft()` 与队尾 `append()` 均为严格 O(1)（普通 list.pop(0) 是 O(n)！）。");
      if (/heapq/.test(t)) notes.push("`heapq`：Python 标准小根堆模块（若需大根堆，存入元素相反数 `-x` 即可）。");
      if (/bisect/.test(t)) notes.push("`bisect`：内置二分查找库，`bisect_left` 等同于 C++ 的 `lower_bound`（找第一个 >= target 的位置）。");
      if (notes.length === 0) notes.push("导入所需模块或类型注解。");
    }

    // ===== 类与函数定义 =====
    if (/^class\s+(\w+)/.test(t)) {
      notes.push(`定义类 \`${RegExp.$1}\`（力扣核心代码模式的标准解题入口封装类）。`);
    }
    if (/^def\s+(\w+)\s*\(([^)]*)\)/.test(t)) {
      const fn = RegExp.$1, args = RegExp.$2;
      if (fn === "__init__") {
        notes.push("Python 构造函数 `__init__`：初始化实例成员变量与底层数据结构。");
      } else {
        notes.push(`定义函数 \`${fn}(${args.replace(/self,?\s*/, "")})\`：声明输入参数与处理逻辑入口。`);
      }
    }
    if (lang !== "python" && /\b(int|void|bool|boolean|double|long|String|string|vector<[^>]+>|List<[^>]+>|ListNode\s*\*|TreeNode\s*\*)\s+(\w+)\s*\(([^)]*)\)\s*\{?$/.test(t) && !/\b(if|while|for|return)\b/.test(t)) {
      notes.push(`定义方法/函数 \`${RegExp.$2}\`，返回类型为 \`${RegExp.$1}\`（${/returnSize/.test(t) ? "C 语言接口中 `*returnSize` 用于向调用方回传动态返回数组的长度" : "接收题目给定输入参数"}）。`);
    }

    // ===== Python 特色高频语法糖 =====
    if (/enumerate\s*\(([^)]+)\)/.test(t)) {
      notes.push(`\`enumerate(${RegExp.$1})\`：同时遍历元素的**下标索引**与**元素值**，避免手写 \`range(len(...))\` 再按下标取值。`);
    }
    if (/range\s*\(([^,]+),\s*([^,]+),\s*-1\)/.test(t)) {
      notes.push(`\`range(${RegExp.$1}, ${RegExp.$2}, -1)\`：**倒序循环**，从 \`${RegExp.$1}\` 递减走到 \`${RegExp.$2} + 1\`（注意右开区间不含终点 \`${RegExp.$2}\`！）。`);
    } else if (/range\s*\(([^)]+)\)/.test(t)) {
      notes.push(`\`range(${RegExp.$1})\`：生成整数序列进行循环迭代（左闭右开区间）。`);
    }
    if (/\.get\s*\(([^,]+),\s*([^)]+)\)/.test(t)) {
      notes.push(`字典安全查询 \`.get(${RegExp.$1}, ${RegExp.$2})\`：若键存在则返回对应值，不存在时返回默认值 \`${RegExp.$2}\` 而不抛 KeyError。`);
    }
    if (/getOrDefault\s*\(([^,]+),\s*([^)]+)\)/.test(t)) {
      notes.push(`Java \`getOrDefault(${RegExp.$1}, ${RegExp.$2})\`：安全读取哈希表键值，未命中时返回默认值 \`${RegExp.$2}\`。`);
    }
    if (/computeIfAbsent/.test(t)) {
      notes.push("Java `computeIfAbsent`：若键不存在则自动创建新集合放入 Map 并返回，一行搞定分组归类！");
    }
    if (/\.sort\s*\(|sorted\s*\(|\bsort\s*\(|Arrays\.sort|Collections\.sort|qsort\s*\(/.test(t)) {
      notes.push("对数据进行排序（通常时间开销 O(n log n)），为后续双指针收缩、相邻去重或贪心区间合并创造单调有序前提。");
    }
    if (/lambda\s+/.test(t)) {
      notes.push("使用 `lambda` 匿名函数自定义排序关键字（如 `key=lambda x: x[0]` 表示按每个子区间的左端点升序排）。");
    }
    if (/float\s*\(\s*['"]-?inf['"]\s*\)|\binf\b|INT_MAX|INT_MIN|Integer\.MAX_VALUE|Integer\.MIN_VALUE|LLONG_MAX/.test(t)) {
      notes.push("设置正/负无穷大极值哨兵，确保后续首次求 `min` 或 `max` 时一定能被真实数据正确更新（尤其防范全负数数组坑点！）。");
    }

    // ===== C / C++ / Java 特色指针与内存操作 =====
    if (/\bmalloc\s*\(|\bcalloc\s*\(|\brealloc\s*\(/.test(t)) {
      notes.push("C 语言堆内存动态分配：`malloc` 分配未初始化字节块，`calloc` 分配并自动清零为 0（适合建哈希桶或 DP 数组），函数返回后生命周期依然保留。");
    }
    if (/\bmemset\s*\(/.test(t)) {
      notes.push("C/C++ `memset` 按字节快速初始化内存块（注意：初始化 int 数组只建议填 `0` 或 `-1`/`0x3f`，填 `1` 会变成 `0x01010101` 而非数字 1！）。");
    }
    if (/ios::sync_with_stdio\s*\(\s*false\s*\)|cin\.tie\s*\(\s*nullptr\s*\)/.test(t)) {
      notes.push("解除 C++ `cin/cout` 与 C `stdio` 的同步绑定，大幅提速标准流读写，防止华为机考大数据量输入超时（TLE）。");
    }
    if (/->/.test(t) && lang !== "java") {
      notes.push("`->` 结构体指针成员访问运算符（等价于 `(*ptr).member`），通过节点地址读写其 `val` / `next` / `left` / `right` 字段。");
    }

    // ===== 常见算法核心语句识别 =====
    if (/\bmid\s*=\s*(.+)/.test(t)) {
      const expr = RegExp.$1;
      if (/\+\s*\(.*-.*\)/.test(expr) || />>\s*1|\b>>>\s*1/.test(expr)) {
        notes.push("防溢出求二分中点 `left + (right - left) / 2`：避免在 C++/Java/C 中 `left + right` 超过 32 位 `int` 上限变成负数！");
      } else {
        notes.push("计算当前搜索区间的正中间下标 `mid`，用于折半判定。");
      }
    }
    if (/(left|l)\s*<\s*(right|r)/.test(t) && /\bwhile\b/.test(t)) {
      notes.push("相向双指针 / 半开二分循环条件：当左右指针尚未相遇交错时持续推进。");
    } else if (/(left|l)\s*<=\s*(right|r)/.test(t) && /\bwhile\b/.test(t)) {
      notes.push("闭区间 `[left, right]` 循环条件：当 `left == right` 时区间仍剩 1 个元素待检，退出时必有 `left == right + 1`。");
    }
    if (/nums\[i\]\s*==\s*nums\[i\s*-\s*1\]|nums\[L\]\s*==\s*nums\[L\s*-\s*1\]|nums\[left\]\s*==\s*nums\[left\s*-\s*1\]/.test(t)) {
      notes.push("🔥 **有序数组相邻去重核心逻辑**：当前元素与前一个元素相同时直接跳过，彻底杜绝枚举出重复的组合或三元组！");
    }
    if (/p0\.next\.next\s*=\s*cur|p0->next->next\s*=\s*cur/.test(t)) {
      notes.push("🔥 **局部翻转链表黄金缝合步骤**：`p0.next` 原本是本组翻转前的头（翻转后变成了本组新尾），让它的 `next` 接上下一组的头 `cur`！");
    }
    if (/\bdp\s*\[/.test(t) && /=/.test(t) && !notes.some(n => n.includes("初始化"))) {
      notes.push("执行动态规划状态转移：由已经算出的更小子问题状态递推更新当前规模的最优解。");
    }
    if (/^\s*return\b/.test(t)) {
      notes.push(`向调用者/上层递归返回计算结果 \`${t.replace(/^return\s*/, "").replace(/;$/, "")}\`。`);
    } else if (/^\s*if\b|^\s*elif\b|^\s*else\s+if\b/.test(t)) {
      notes.push("条件分支判断（检查递归终止边界、剪枝条件或状态合法性）。");
    } else if (/^\s*while\b/.test(t) && notes.length === 0) {
      notes.push("当满足持续条件时循环推进状态（如收缩滑动窗口、弹栈或遍历链表直到空指针）。");
    } else if (/^\s*for\b/.test(t) && notes.length === 0) {
      notes.push("循环遍历序列、区间下标或候选分支。");
    }

    // 合并来自本地 Python AST 的行级语法补充
    if (astHints && astHints.length) {
      astHints.forEach((h) => {
        if (!notes.includes(h)) notes.push(h);
      });
    }

    if (notes.length === 0) {
      if (/(\+=|-=|\*=|\/\/=|\/=|\^=|\|=|&=)/.test(t)) {
        notes.push("原地复合更新状态变量 / 累加器或移动指针位置。");
      } else if (/=/.test(t)) {
        notes.push("初始化或更新局部变量 / 数据结构引用。");
      } else {
        notes.push("调用辅助函数或操作容器状态。");
      }
    }

    return { type: "code", text: notes.join(" ") };
  }

  // 4. 潜在易错点与复杂度静态扫描
  function scanPitfallsAndComplexity(code, lang, pythonAst) {
    const warnings = [];
    if (pythonAst && Array.isArray(pythonAst.warnings)) {
      warnings.push(...pythonAst.warnings);
    }
    if (pythonAst && pythonAst.syntaxError) {
      warnings.push(`💡 提示（片段模式）：${pythonAst.syntaxError}（若您仅截取了函数中间几行，属正常现象，不影响逐行语义拆解）。`);
    }

    // Python 专属坑点扫描
    if (lang === "python") {
      if (/\bmid\s*=\s*\([^)]+\)\s*\/\s*2(?!\/)/.test(code)) {
        warnings.push("⚠️ 检测到 Python 中使用单斜杠 `/ 2` 计算 `mid`！Python 3 中 `/` 返回浮点数 `float`，用作数组下标会直接报 `TypeError`，请务必改为整除 `// 2`！");
      }
      if (/\.pop\s*\(\s*0\s*\)/.test(code)) {
        warnings.push("💡 性能建议：Python 普通列表 `list.pop(0)` 需要将后面所有元素整体前移，时间复杂度为 `O(n)`！在 BFS 或滑动窗口中请改用 `collections.deque` 的 `popleft()`（`O(1)`）。");
      }
      if (/\bdef\s+dfs\b|\bdef\s+backtrack\b/.test(code) && /sys\.stdin/.test(code) && !/setrecursionlimit/.test(code)) {
        warnings.push("💡 华为机考提醒：ACM 模式下若用 Python 写深层网格/图 DFS，默认递归栈上限仅 1000 层，建议开头加上 `sys.setrecursionlimit(200000)` 防止 `RecursionError`。");
      }
    }

    // C++ / Java / C 专属坑点扫描
    if (lang === "cpp" || lang === "java" || lang === "c") {
      if (/\(\s*(left|l|low)\s*\+\s*(right|r|high)\s*\)\s*\/\s*2/.test(code)) {
        warnings.push("⚠️ 整型溢出风险：在 C++/Java/C 中 `(left + right) / 2` 当左右边界接近 `10^9` 时相加会溢出为负数！标准手撕写法应为 `left + (right - left) / 2`。");
      }
    }
    if (lang === "c") {
      if (/return\s+\*\(int\s*\*\)a\s*-\s*\*\(int\s*\*\)b/.test(code)) {
        warnings.push("⚠️ C 语言 `qsort` 比较函数隐患：若数组中包含 `INT_MIN`（如 `-2147483648`），直接做减法 `*a - *b` 会发生有符号整数溢出导致排序错乱！安全写法：`return (*a > *b) - (*a < *b);`。");
      }
    }

    // 复杂度智能估算
    let timeEst = "O(n)（单趟或常数次线性扫描）";
    let spaceEst = "O(1)（常数额外辅助变量）";

    const lines = code.split("\n");
    let loopCount = 0;
    for (const ln of lines) {
      if (/^\s*(for|while)\b/.test(ln)) loopCount++;
    }
    const hasSort = /\.sort\b|sorted\s*\(|\bsort\s*\(|Arrays\.sort|qsort\b/.test(code);
    const hasBinary = /\bmid\b[\s\S]*(left|right|low|high)/.test(code);
    const hasHeap = /heapq|priority_queue|PriorityQueue/.test(code);
    const hasBacktrack = /backtrack|path\.pop|pop_back/.test(code) && /\bfor\b/.test(code);

    if (hasBacktrack) {
      timeEst = "指数级 / 阶乘级（如 O(n·2ⁿ) 或 O(n·n!)，取决于回溯决策树状态数与剪枝力度）";
      spaceEst = "O(n)（递归调用栈深度与当前路径开销）";
    } else if (hasBinary && loopCount === 1) {
      timeEst = "O(log n)（每次折半缩小搜索空间）";
    } else if (hasHeap) {
      timeEst = "O(n log k) 或 O(n log n)（每次堆调整开销为对数级）";
      spaceEst = "O(k) 或 O(n)（堆容器存储开销）";
    } else if (hasSort && loopCount <= 2) {
      timeEst = loopCount >= 2 && /left\s*<\s*right/.test(code)
        ? "O(n²)（排序 O(n log n) + 外层枚举配合内层双指针 O(n²)）"
        : "O(n log n)（主要瓶颈在于排序）";
    } else if ((pythonAst && pythonAst.maxLoopDepth >= 2) || loopCount >= 2) {
      if (/\bwhile\b[\s\S]*(left\s*\+=|st\.pop|dq\.pop)/.test(code)) {
        timeEst = "均摊 O(n)（虽有内层 while，但指针单向不回退 / 每个元素最多进出栈队一次！）";
      } else {
        timeEst = "O(n²) 或 O(m × n)（双重嵌套循环遍历网格/双序列）";
      }
    }

    if (/unordered_map|unordered_set|HashMap|HashSet|dict\(|set\(|defaultdict|Counter|\bdp\b|deque|stack/.test(code)) {
      spaceEst = "O(n)（使用了哈希表 / DP 数组 / 栈队等辅助容器）";
    }

    return { warnings, timeEst, spaceEst };
  }

  // 主入口：完整解析任意代码片段
  async function analyzeSnippet(code, preferredLang = "auto", problemContext = null) {
    const cleanCode = (code || "").replace(/\r\n/g, "\n");
    if (!cleanCode.trim()) {
      return null;
    }
    const lang = preferredLang === "auto" ? detectLanguage(cleanCode) : preferredLang;

    // 尝试调用本地后端获取精确 Python AST 分析（离线或手机无后端时优雅降级）
    let pythonAst = null;
    if (lang === "python") {
      try {
        const resp = await fetch("/api/analyze-code", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: cleanCode, language: "python" })
        });
        if (resp.ok) {
          const data = await resp.json();
          if (data && data.pythonAst) pythonAst = data.pythonAst;
        }
      } catch (_e) {
        // 离线环境下直接使用纯前端引擎，完全无感
      }
    }

    // 匹配算法模式
    const matchedPatterns = ALGO_PATTERNS.filter((p) => p.test(cleanCode));
    if (matchedPatterns.length === 0) {
      matchedPatterns.push({
        name: "通用过程与状态模拟逻辑",
        badge: "基础逻辑块",
        desc: "该片段主要执行变量状态更新、条件判断或线性容器操作，建议重点关注边界条件（空输入、单元素、极值）与下标越界控制。"
      });
    }

    // 逐行解析
    const rawLines = cleanCode.split("\n");
    const lineAnalysis = [];
    rawLines.forEach((ln, idx) => {
      const lineNo = idx + 1;
      const astHints = pythonAst && pythonAst.lineHints ? pythonAst.lineHints[String(lineNo)] : null;
      const exp = explainSingleLine(ln, lang, lineNo, astHints);
      lineAnalysis.push({
        lineNo,
        raw: ln,
        explanation: exp
      });
    });

    const { warnings, timeEst, spaceEst } = scanPitfallsAndComplexity(cleanCode, lang, pythonAst);

    return {
      lang,
      langLabel: LANG_LABELS[lang] || lang,
      problemContext,
      matchedPatterns,
      lineAnalysis,
      warnings,
      timeEst,
      spaceEst,
      pythonAst
    };
  }

  // 可选：调用 OpenAI 兼容大模型进行自由问答与深度追问
  async function askAiAboutCode({ apiUrl, apiKey, model, code, lang, question, problemTitle }) {
    const endpoint = (apiUrl || "https://api.deepseek.com/v1").replace(/\/+$/, "") + "/chat/completions";
    const sysPrompt =
      "你是一位顶尖的华为算法面试官兼耐心学长。学生的主力语言是 Python，同时想对照学习 C++、Java、C。" +
      "请针对学生粘贴的代码片段和问题，用清晰易懂的简体中文深入浅出地解答：讲清算法直觉、语法细节、用一个小例子走查变量变化，并指出面试/机考易错点。";
    const userContent =
      (problemTitle ? `【关联力扣题目】：${problemTitle}\n` : "") +
      `【代码语言】：${lang}\n【代码片段】：\n\`\`\`${lang}\n${code}\n\`\`\`\n\n` +
      `【我的问题】：${question || "请帮我逐行深入讲解这段代码为什么这样写，并用一个简短测试例子演示关键变量的变化过程。"}`;

    const headers = { "Content-Type": "application/json" };
    if (apiKey && apiKey.trim()) {
      headers["Authorization"] = `Bearer ${apiKey.trim()}`;
    }

    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: model || "deepseek-chat",
        messages: [
          { role: "system", content: sysPrompt },
          { role: "user", content: userContent }
        ],
        temperature: 0.3
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`接口返回 ${res.status}：${errText.slice(0, 180)}`);
    }
    const json = await res.json();
    return (json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content) || "未返回有效内容";
  }

  // 内置 6 段经典“最容易卡壳看不懂”的代码片段示例，方便一键体验
  const DEMO_SNIPPETS = [
    {
      title: "Python · 单调双端队列求滑窗最大值 (#239)",
      lang: "python",
      problemId: 11,
      code: `dq = deque()  # 存下标而非数值！
res = []
for i, x in enumerate(nums):
    while dq and nums[dq[-1]] <= x:
        dq.pop()
    dq.append(i)
    if dq[0] <= i - k:
        dq.popleft()
    if i >= k - 1:
        res.append(nums[dq[0]])`
    },
    {
      title: "Python · K 个一组翻转链表黄金缝合 (#25)",
      lang: "python",
      problemId: 31,
      code: `while n >= k:
    n -= k
    pre, cur = None, p0.next
    for _ in range(k):
        nxt = cur.next
        cur.next = pre
        pre, cur = cur, nxt
    nxt_p0 = p0.next
    p0.next.next = cur
    p0.next = pre
    p0 = nxt_p0`
    },
    {
      title: "Python · 0-1背包倒序状态压缩 (#416)",
      lang: "python",
      problemId: 89,
      code: `target = sum(nums) // 2
dp = [True] + [False] * target
for x in nums:
    for j in range(target, x - 1, -1):
        dp[j] = dp[j] or dp[j - x]
return dp[target]`
    },
    {
      title: "C++ · 柱状图最大矩形哨兵单调栈 (#84)",
      lang: "cpp",
      problemId: 73,
      code: `heights.insert(heights.begin(), 0);
heights.push_back(0);
stack<int> st;
int ans = 0;
for (int i = 0; i < (int)heights.size(); ++i) {
    while (!st.empty() && heights[i] < heights[st.top()]) {
        int h = heights[st.top()];
        st.pop();
        int w = i - st.top() - 1;
        ans = max(ans, h * w);
    }
    st.push(i);
}`
    },
    {
      title: "Java · 前缀和 + HashMap 求和为 K 子数组 (#560)",
      lang: "java",
      problemId: 10,
      code: `Map<Integer, Integer> mp = new HashMap<>();
mp.put(0, 1);
int pre = 0, ans = 0;
for (int x : nums) {
    pre += x;
    ans += mp.getOrDefault(pre - k, 0);
    mp.put(pre, mp.getOrDefault(pre, 0) + 1);
}
return ans;`
    },
    {
      title: "C 语言 · 原地哈希座位归位找缺失正数 (#41)",
      lang: "c",
      problemId: 17,
      code: `for (int i = 0; i < numsSize; ++i) {
    while (nums[i] >= 1 && nums[i] <= numsSize && nums[nums[i] - 1] != nums[i]) {
        int targetIdx = nums[i] - 1;
        int tmp = nums[i];
        nums[i] = nums[targetIdx];
        nums[targetIdx] = tmp;
    }
}`
    }
  ];

  return {
    detectLanguage,
    analyzeSnippet,
    askAiAboutCode,
    DEMO_SNIPPETS,
    LANG_LABELS
  };
})();
