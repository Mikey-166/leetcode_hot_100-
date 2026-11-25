// AlgoForge · 默认 6 周（42 天）科学冲刺打卡计划 & 华为实习通关全攻略结构化数据
// 严格对齐《大三备战华为实习：算法突围与面试通关全攻略》与《LeetCode 热题 100 分类精讲手册》

window.ALGO_SCHEDULE_GUIDE = {
  // 默认每日时间块作息表（用户可在界面自由增删改时间与事项）
  defaultDailyRoutine: [
    {
      id: "rt-1",
      time: "19:00 - 19:20",
      title: "温故知新：1-3-7 周期错题重刷",
      desc: "快速回顾昨日、3天前、7天前未独立 AC 的标黄错题，闭眼过一遍破题套路。",
      tag: "复盘",
      durationMin: 20
    },
    {
      id: "rt-2",
      time: "19:20 - 20:50",
      title: "算法主线：攻克今日 3～4 道 Hot 100",
      desc: "严守「15 分钟止损法则」：思考 15 分钟无果立刻看一句话破题，理解后关掉题解独立用 Python 默写到 AC，再对照 C++/Java/C 实现。",
      tag: "核心刷题",
      durationMin: 90
    },
    {
      id: "rt-3",
      time: "20:50 - 21:35",
      title: "机考 / 面试支线任务（45 分钟）",
      desc: "练习牛客 ACM 标准输入输出模板、复习四大件高频八股，或用 STAR 法则打磨简历项目逐字稿。",
      tag: "面试支线",
      durationMin: 45
    },
    {
      id: "rt-4",
      time: "21:35 - 21:55",
      title: "费曼总结 & 每日打卡归档",
      desc: "用一句话向自己讲清今日专题核心模板，标记需二刷的题目并完成今日打卡。",
      tag: "打卡总结",
      durationMin: 20
    }
  ],

  // 6 周阶段总览里程碑
  weekMilestones: [
    {
      week: 1,
      title: "第 1 周 · 数组与字符串核心基石",
      subtitle: "哈希(3) + 双指针(4) + 滑窗(2) + 子串(3) + 普通数组(5) + 矩阵(4) = 21 题",
      milestone: "攻克数组与字符串核心套路，稳拿华为机考第 1 题（100 分）及第 2 题基础分",
      sideGoal: "熟记 Python 标准库容器 API（Counter/defaultdict/deque/heapq）；梳理简历初稿"
    },
    {
      week: 2,
      title: "第 2 周 · 单调栈、TopK、二分与网格图论",
      subtitle: "栈与单调栈(5) + 堆(3) + 贪心(4) + 二分查找(6) + 图论(4) = 22 题",
      milestone: "掌握机考 200～300 分档拉开差距利器：单调栈、括号解码、红蓝二分与多源 BFS/拓扑排序",
      sideGoal: "复习计算机网络核心高频八股；熟练默写 ACM 模式多行/矩阵输入输出模板"
    },
    {
      week: 3,
      title: "第 3 周 · 二叉树分治递归与回溯搜索",
      subtitle: "二叉树(15) + 回溯(8) = 23 题",
      milestone: "彻底打通树形后序分治汇报与回溯决策树剪枝思维，通杀机考搜索题与一面树形手撕",
      sideGoal: "复习操作系统（进程线程/虚拟内存/epoll）与数据结构高频八股"
    },
    {
      week: 4,
      title: "第 4 周 · 动态规划全家族与高阶技巧",
      subtitle: "一维DP(10) + 多维DP(5) + 技巧(5) = 20 题",
      milestone: "吃透 0-1 背包、完全背包、线性子序列 DP 与双序列编辑距离模板，攻克机考压轴题",
      sideGoal: "复习 Python/C++/Java 语言特性与 MySQL 索引事务；按 STAR 法则打磨第 1 个核心项目"
    },
    {
      week: 5,
      title: "第 5 周 · 链表手撕王牌专项 & ACM 真题提速",
      subtitle: "链表(14 题手撕重中之重) + Hot 100 错题二刷 + 牛客华为机试真题",
      milestone: "虚拟头节点、快慢指针、K 个一组翻转、LRU 缓存练到 15 分钟零 Bug；适应机考长题干",
      sideGoal: "完成 15～20 道 ACM 模式长题干输入输出限时训练"
    },
    {
      week: 6,
      title: "第 6 周 · 全真模拟机考 & 手撕 Top 20 闭眼默写",
      subtitle: "3 套 120 分钟模拟机考卷 + Top 20 母题闭眼默写 + 2 次全真开口模拟面试",
      milestone: "机考稳定冲击 300+ 分（总分 600），手撕前主动沟通边界与复杂度，从容斩获华为 Offer",
      sideGoal: "打磨第 2 个简历项目难点与百倍并发扩展方案；跟进 HR 锁定机考排期"
    }
  ],

  // 42 天详细可执行课表（problemIds 对应 Hot 100 序号 1 ~ 100，完整覆盖全部 100 题）
  defaultDays: [
    // ===== 第 1 周（共 21 题） =====
    {
      day: 1, week: 1, title: "哈希表：空间换时间与特征归一化",
      problemIds: [1, 2, 3],
      sideTask: "熟记 Python dict / defaultdict / Counter 常用方法，对比 C++ unordered_map 与 Java HashMap",
      customTodos: ["看懂『最长连续序列』为何必须遍历 set 去重且只从 x-1 不在集合的起点枚举"]
    },
    {
      day: 2, week: 1, title: "双指针：快慢原地修改与相向收缩去重",
      problemIds: [4, 5, 6, 7],
      sideTask: "梳理个人简历初稿框架（教育背景 + 专业技能 + 2 个候选核心项目）",
      customTodos: ["重点手写默写 [15] 三数之和的三重去重逻辑与 [42] 接雨水前后缀极值双指针"]
    },
    {
      day: 3, week: 1, title: "滑动窗口与前缀和哈希（上）",
      problemIds: [8, 9, 10],
      sideTask: "背熟不定长滑动窗口『右扩进窗 → 非法左缩出窗 → 合法更新答案』三步口诀",
      customTodos: ["区分何时用滑窗（正数/单调性）、何时必须用前缀和+哈希（含负数如 560 题，牢记 mp={0:1}）"]
    },
    {
      day: 4, week: 1, title: "单调队列滑窗、最小覆盖子串与区间贪心",
      problemIds: [11, 12, 13, 14],
      sideTask: "练习 Python collections.deque 双端队列 popleft/pop O(1) 操作",
      customTodos: ["独立默写 [239] 单调递减队列存下标模板与 [56] 合并区间左端点排序模板"]
    },
    {
      day: 5, week: 1, title: "普通数组进阶：三次反转、前后缀积与原地哈希",
      problemIds: [15, 16, 17],
      sideTask: "总结 Python 切片赋值 nums[:] 与原地 reverse(l, r) 空间复杂度差异",
      customTodos: ["注意 [41] 缺失的第一个正数交换条件 nums[nums[i]-1] != nums[i] 防止重复值死循环"]
    },
    {
      day: 6, week: 1, title: "二维矩阵模拟：边界收缩与坐标变换",
      problemIds: [18, 19, 20, 21],
      sideTask: "完善简历技能栏描述（突出熟悉的数据结构、算法能力与主力工程语言）",
      customTodos: ["全文背诵 [54] 螺旋矩阵四边界收缩即检写法，零特判不重不漏"]
    },
    {
      day: 7, week: 1, title: "第 1 周周日复盘 & 1-3-7 错题清零日",
      problemIds: [6, 7, 8, 10, 12],
      sideTask: "不看任何提示，限时 60 分钟闭眼重写本周标黄错题及上述 5 道高频母题",
      customTodos: ["复盘第 1 周 21 道题掌握度，将未达标的题目加入下周晨间复习"]
    },

    // ===== 第 2 周（共 22 题） =====
    {
      day: 8, week: 2, title: "栈与嵌套表达式解析（华为机考头号母题）",
      problemIds: [69, 70, 71],
      sideTask: "学习并实操 Python / C++ / Java ACM 模式标准输入输出模板（逐行 EOF 读取）",
      customTodos: ["重点把 [394] 字符串解码练到肌肉记忆！注意多位数倍数 multi = multi*10 + int(c)"]
    },
    {
      day: 9, week: 2, title: "单调栈双雄与快速选择 TopK",
      problemIds: [72, 73, 74],
      sideTask: "计算机网络八股：OSI/TCP 五层模型、TCP 三次握手与四次挥手（TIME_WAIT 作用）",
      customTodos: ["掌握 [84] 柱状图最大矩形首尾加哨兵 0 技巧；掌握 [215] 三路快速选择应对全重复用例"]
    },
    {
      day: 10, week: 2, title: "大小根堆/对顶堆与贪心入门",
      problemIds: [75, 76, 77, 78],
      sideTask: "练习 Python heapq 小根堆与存入相反数 -x 模拟大根堆技巧",
      customTodos: ["手写一遍 [295] 数据流的中位数对顶堆两步过筛平衡法"]
    },
    {
      day: 11, week: 2, title: "区间最少跳跃贪心与闭区间二分模板",
      problemIds: [79, 80, 63, 64],
      sideTask: "计算机网络八股：TCP 可靠传输、流量控制与拥塞控制四阶段",
      customTodos: ["背熟闭区间 lower_bound 万能二分模板；注意 [45] 跳跃游戏 II 只遍历到 n-2"]
    },
    {
      day: 12, week: 2, title: "二分进阶：左右边界、旋转数组与正序中位数",
      problemIds: [65, 66, 67, 68],
      sideTask: "计算机网络八股：HTTP vs HTTPS（TLS 握手过程）、输入 URL 到页面渲染全流程",
      customTodos: ["攻克手撕高频 [33] 搜索旋转排序数组，想清为何 [153] 找最小值要与右端点比较"]
    },
    {
      day: 13, week: 2, title: "图论四大金刚：网格 DFS、多源 BFS、拓扑排序与 Trie",
      problemIds: [51, 52, 53, 54],
      sideTask: "练习 ACM 模式矩阵 n×m 读取并构建邻接表与入度数组",
      customTodos: ["牢记 BFS 入队瞬间立刻改状态防重复入队爆内存；掌握 Kahn 入度拓扑排序判环"]
    },
    {
      day: 14, week: 2, title: "第 2 周周日复盘 & ACM 输入输出实操自测",
      problemIds: [71, 72, 66, 52, 53],
      sideTask: "在平台『华为攻略 → ACM 模板舱』独立手敲一遍 Python 与 C++/Java 多行矩阵读取代码",
      customTodos: ["清理本周所有 1-3-7 到期错题，自测计网八股核心问答"]
    },

    // ===== 第 3 周（共 23 题） =====
    {
      day: 15, week: 3, title: "二叉树递归基石与后序拐点直径",
      problemIds: [36, 37, 38, 39, 40],
      sideTask: "操作系统八股：进程与线程的区别、进程间通信（IPC）五种方式",
      customTodos: ["掌握 [94] 显式栈模拟中序迭代；深刻区分 [543] 直径中『拐弯更新全局答案』与『单侧向上汇报』"]
    },
    {
      day: 16, week: 3, title: "BFS 层序遍历与二叉搜索树（BST）单调性",
      problemIds: [41, 42, 43, 44],
      sideTask: "操作系统八股：虚拟内存、分页机制、页面置换算法（LRU 手撕关联）",
      customTodos: ["注意 [98] 验证 BST 绝不能只比父子，必须传开区间 (low, high) 或校验中序严格递增"]
    },
    {
      day: 17, week: 3, title: "二叉树视图、原地展开与前中序还原树",
      problemIds: [45, 46, 47],
      sideTask: "操作系统八股：死锁四个必要条件与预防、用户态与内核态切换",
      customTodos: ["掌握 [105] 预处理中序下标哈希表 O(1) 切分左右子树区间长度"]
    },
    {
      day: 18, week: 3, title: "二叉树手撕王牌：路径前缀和、LCA 与最大路径和",
      problemIds: [48, 49, 50],
      sideTask: "操作系统八股：I/O 多路复用（select / poll / epoll 水平触发 LT 与边缘触发 ET）",
      customTodos: ["背熟 8 行神级代码 [236] 最近公共祖先；注意 [437] 离开节点时 cnt[cur_sum] -= 1 恢复现场"]
    },
    {
      day: 19, week: 3, title: "回溯决策树（上）：排列、子集与可重选组合",
      problemIds: [55, 56, 57, 58],
      sideTask: "数据结构八股：哈希冲突解决机制（拉链法 vs 开放寻址）、红黑树 vs B+ 树区别",
      customTodos: ["区分排列型（used 数组）与子集组合型（start 下标）；牢记 Python path[:] 切片拷贝"]
    },
    {
      day: 20, week: 3, title: "回溯决策树（下）：括号剪枝、网格回溯与 N 皇后",
      problemIds: [59, 60, 61, 62],
      sideTask: "总结『岛屿数量（淹没不复原）』与『单词搜索（退回必复原现场）』的本质区别",
      customTodos: ["记住 [51] N 皇后主对角线 r-c 定值、副对角线 r+c 定值的 O(1) 判冲技巧"]
    },
    {
      day: 21, week: 3, title: "第 3 周周日复盘 & 树与回溯专题通关检阅",
      problemIds: [41, 43, 49, 50, 58],
      sideTask: "开口口述操作系统 epoll 原理与 B+ 树为什么适合数据库索引（计时 10 分钟）",
      customTodos: ["重做第 3 周全部标黄错题，确保递归终止条件与回溯恢复现场零失误"]
    },

    // ===== 第 4 周（共 20 题） =====
    {
      day: 22, week: 4, title: "一维动态规划入门与完全平方数",
      problemIds: [81, 82, 83, 84],
      sideTask: "数据库八股：MySQL 索引失效常见场景、最左前缀原则、覆盖索引与回表",
      customTodos: ["从爬楼梯和打家劫舍体会滚动变量空间压缩 O(n) -> O(1)"]
    },
    {
      day: 23, week: 4, title: "背包问题双子星：完全背包与 0-1 背包空间压缩",
      problemIds: [85, 86, 89],
      sideTask: "数据库八股：事务 ACID 特性、四大隔离级别与 MVCC 原理简述",
      customTodos: ["对比背诵：[322] 完全背包内层正序遍历容量 vs [416] 0-1 背包内层倒序遍历容量！"]
    },
    {
      day: 24, week: 4, title: "子序列进阶 DP：贪心二分 LIS、正负乘积与有效括号",
      problemIds: [87, 88, 90],
      sideTask: "主力语言八股：Python（GIL 全局解释器锁、深浅拷贝、装饰器与生成器）及 C++/Java 对比",
      customTodos: ["掌握 [300] O(n log n) 贪心+二分维护 tails 数组；掌握 [152] 同时维护最大与最小乘积"]
    },
    {
      day: 25, week: 4, title: "多维动态规划（上）：网格路径与中心扩展回文串",
      problemIds: [91, 92, 93],
      sideTask: "按 STAR 法则撰写简历第 1 个核心项目逐字稿（架构分工 + 核心代码模块）",
      customTodos: ["手撕必考 [5] 最长回文子串：同时枚举奇数单中心 expand(i,i) 与偶数双中心 expand(i,i+1)"]
    },
    {
      day: 26, week: 4, title: "双序列巅峰 DP（LCS & 编辑距离）与位运算投票技巧",
      problemIds: [94, 95, 96, 97],
      sideTask: "完善第 1 个核心项目的『最棘手 Bug/性能瓶颈定位与量化提升指标』话术",
      customTodos: ["重点对比 [1143] LCS（空串边界全0）与 [72] 编辑距离（dp[i][0]=i, dp[0][j]=j）初始化差异！"]
    },
    {
      day: 27, week: 4, title: "原地划分与构造巧题：荷兰国旗、下一个排列与判环找重",
      problemIds: [98, 99, 100],
      sideTask: "思考第 1 个项目追问：『若并发量扩大 100 倍或数据量暴增，哪里先崩？如何改造？』",
      customTodos: ["注意 [75] 颜色分类遇 2 交换后 i 原地不动；掌握 [31] 下一个排列三步走推理"]
    },
    {
      day: 28, week: 4, title: "第 4 周周日复盘 & 动态规划全模板默写",
      problemIds: [85, 87, 89, 93, 95],
      sideTask: "脱稿把第 1 个项目 STAR 三连问大声讲一遍并录音自查流畅度",
      customTodos: ["清理前四周累计错题，准备第 5 周进入面试手撕最高频的链表大决战！"]
    },

    // ===== 第 5 周（链表 14 题 + Hot 100 错题二刷 + ACM 真题） =====
    {
      day: 29, week: 5, title: "链表手撕（一）：浪漫相遇、原地反转、回文与判环",
      problemIds: [22, 23, 24, 25],
      sideTask: "ACM 模式限时练（第 1 组 4 题）：练习长题干阅读提取输入输出格式",
      customTodos: ["[206] 反转链表迭代与递归双写法 3 分钟内零 Bug 秒写！"]
    },
    {
      day: 30, week: 5, title: "链表手撕（二）：入环口推导、合并有序、竖式相加与倒数删除",
      problemIds: [26, 27, 28, 29],
      sideTask: "ACM 模式限时练（第 2 组 4 题）：重点练习字符串切分、正则与排序去重模拟",
      customTodos: ["准备面试口述 [142] 环形链表 II 的 a = c + (k-1)(b+c) 数学推导；[19] 必建 dummy 节点"]
    },
    {
      day: 31, week: 5, title: "链表手撕（三）：两两交换、K 个一组翻转王牌与随机链表",
      problemIds: [30, 31, 32],
      sideTask: "ACM 模式限时练（第 3 组 4 题）：重点练习哈希统计与队列/滑动窗口模拟",
      customTodos: ["攻克大厂手撕天花板 [25] K 个一组翻转链表，背熟 p0.next.next=cur; p0.next=pre 黄金缝合！"]
    },
    {
      day: 32, week: 5, title: "链表手撕（四）：链表归并排序、K 路归并与 LRU 缓存设计",
      problemIds: [33, 34, 35],
      sideTask: "ACM 模式限时练（第 4 组 4 题）：重点练习网格 BFS 迷宫寻路与连通块",
      customTodos: ["全栈手撕王牌 [146] LRU 缓存（哈希表 + 伪头伪尾双向链表）控制在 12 分钟内独立默写通过！"]
    },
    {
      day: 33, week: 5, title: "Hot 100 全题库祝捷收官！开启第一、二梯队错题二刷",
      problemIds: [3, 6, 10, 14, 71, 73],
      sideTask: "完成最后一组 4 道牛客华为机试真题，累计达成 16～20 道 ACM 实战目标",
      customTodos: ["重点针对曾经超过 15 分钟未做出的第一、二梯队题目脱离题解二刷"]
    },
    {
      day: 34, week: 5, title: "Hot 100 第三、四梯队错题二刷（树/图/DP/链表）",
      problemIds: [31, 35, 48, 50, 62, 68],
      sideTask: "按 STAR 法则撰写简历第 2 个核心项目逐字稿（架构 + 难点排查 + 扩展性）",
      customTodos: ["针对 Hard 级别手撕压轴题训练『先口述暴力思路 → 优化思路 → 确认边界 → 写代码』流程"]
    },
    {
      day: 35, week: 5, title: "第 5 周周日复盘 & 联系华为 HR 确认机考排期",
      problemIds: [23, 26, 31, 33, 35],
      sideTask: "礼貌联系华为 HR 了解日常/暑期实习批次时间线，锁定正式机考时间窗口",
      customTodos: ["检查全部 100 道题打卡覆盖率达到 100%！"]
    },

    // ===== 第 6 周（全真模拟机考 + Top 20 闭眼默写 + 模拟面试） =====
    {
      day: 36, week: 6, title: "全真模拟机考卷一（120 分钟限时）+ Top 20 默写(1)",
      problemIds: [8, 6, 23, 31, 35],
      sideTask: "限时 120 分钟完成第 1 套全真机考组卷（100分字符串 + 200分滑窗/栈 + 300分网格BFS，按通过率抢分）",
      customTodos: ["闭眼白板默写 Top 20 清单第 1～4 组（无重复最长子串、三数之和、反转链表、K个一组、LRU）"]
    },
    {
      day: 37, week: 6, title: "Top 20 闭眼默写(2) + 第 2 个项目难点话术定稿",
      problemIds: [74, 14, 71, 72],
      sideTask: "打磨第 2 个项目 STAR 逐字稿，准备『自我介绍（2 分钟精炼版）』",
      customTodos: ["15 分钟限时白板默写：数组第K大、合并区间、字符串解码、每日温度"]
    },
    {
      day: 38, week: 6, title: "全真模拟机考卷二（120 分钟限时）+ Top 20 默写(3)",
      problemIds: [51, 52, 53, 41, 49],
      sideTask: "限时 120 分钟完成第 2 套模拟机考卷（练习第 3 题想不出 DP 时用 DFS 回溯剪枝保底拿 40%+ 用例分！）",
      customTodos: ["闭眼白板默写：岛屿数量、腐烂的橘子、课程表、层序遍历、最近公共祖先"]
    },
    {
      day: 39, week: 6, title: "Top 20 闭眼默写(4) + 华为综合测评（性格测试）避坑演练",
      problemIds: [66, 55, 58, 93],
      sideTask: "熟读华为性格测试通关原则：前后高度一致、积极阳光、皮实抗压、开放合作、拒绝极端消极选项",
      customTodos: ["闭眼白板默写：搜索旋转排序数组、全排列、组合总和、最长回文子串"]
    },
    {
      day: 40, week: 6, title: "全真模拟机考卷三（冲刺 300+ 分）+ Top 20 默写收官",
      problemIds: [85, 94, 10, 7],
      sideTask: "完成第 1 次 45 分钟自我开口模拟面试（前 25 分钟抽答八股与项目，后 20 分钟边讲思路边手撕）",
      customTodos: ["闭眼白板默写：零钱兑换、最长公共子序列、和为K的子数组、接雨水（Top 20 全部通关！）"]
    },
    {
      day: 41, week: 6, title: "第 2 次全流程模拟面试 & 错题本终极清零",
      problemIds: [31, 35, 71, 95],
      sideTask: "完成第 2 次开口模拟面试：手撕写完后主动口头走查样例并清晰报出时间/空间复杂度",
      customTodos: ["清空错题本最后残余标黄题，调整最佳作息状态"]
    },
    {
      day: 42, week: 6, title: "终极保温 & 决胜华为机考与技术面！",
      problemIds: [1, 8, 23, 51],
      sideTask: "考前检查 IDE / 浏览器摄像头麦克风、ACM 输入输出头文件模板，自信迎战！",
      customTodos: ["回顾 6 周成长轨迹，保持手感，静待华为实习 Offer！🎉"]
    }
  ],

  // 华为面试考前 48 小时“闭眼默写 Top 20”急救清单（对应 Hot 100 序号 1~100）
  top20MustWrite: [
    { group: 1, ids: [8], reason: "不定长滑动窗口代表" },
    { group: 2, ids: [6], reason: "排序 + 相向双指针去重代表" },
    { group: 3, ids: [23, 31], reason: "链表指针基本功天花板" },
    { group: 4, ids: [35], reason: "工程数据结构设计题 No.1（哈希+双向链表）" },
    { group: 5, ids: [74], reason: "三路快排划分 QuickSelect / 堆代表" },
    { group: 6, ids: [14], reason: "区间排序贪心合并代表" },
    { group: 7, ids: [71], reason: "栈解析嵌套表达式代表，机考与手撕通杀" },
    { group: 8, ids: [72], reason: "单调栈找右侧最近更大值模板代表" },
    { group: 9, ids: [51, 52], reason: "网格 DFS 沉岛与多源 BFS 扩散代表" },
    { group: 10, ids: [53], reason: "入度拓扑排序判环代表" },
    { group: 11, ids: [41, 49], reason: "二叉树 BFS 层序与后序分治汇报代表" },
    { group: 12, ids: [66], reason: "二段性二分查找代表" },
    { group: 13, ids: [55, 58], reason: "回溯排列（used）与组合（start剪枝）双模板" },
    { group: 14, ids: [93], reason: "中心扩展法求回文代表" },
    { group: 15, ids: [85, 94], reason: "完全背包 DP 与双序列 DP 代表" },
    { group: 16, ids: [10], reason: "前缀和 + 哈希表（含负数子数组）代表" },
    { group: 17, ids: [7], reason: "前后缀极值相向双指针代表" }
  ],

  // ACM 模式四语言（Python / C++ / Java / C）标准输入输出实战模板库
  acmTemplates: {
    python: {
      name: "Python 3（机考首选 · 代码量最少）",
      tips: "机考强烈推荐！split() 天然处理任意空白符，大整数不溢出；若考深层 DFS 树图递归，开头务必加 sys.setrecursionlimit(200000) 防栈溢出！",
      code: `# Python 3 华为机考 ACM 模式全场景输入输出模板
import sys
from collections import defaultdict, Counter, deque
import heapq

# 网格/图论深搜必加，防止超过默认 1000 层递归报错 RecursionError
sys.setrecursionlimit(200000)

def solve_eof_lines():
    """场景1：不确定行数，逐行读取直到 EOF（最常见于字符串/数组模拟题）"""
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        # 若以空格分隔整数：
        nums = list(map(int, line.split()))
        # 若以逗号分隔整数：nums = list(map(int, line.split(',')))
        print(sum(nums))

def solve_matrix_fast():
    """场景2：已知第一行 n, m，接下来 n 行是矩阵（大数据量一次性读入最快）"""
    data = sys.stdin.read().split()
    if not data:
        return
    it = iter(data)
    n, m = int(next(it)), int(next(it))
    grid = [[int(next(it)) for _ in range(m)] for _ in range(n)]
    # 示例输出：按空格拼接一行输出
    print(" ".join(map(str, grid[0])))

if __name__ == "__main__":
    solve_eof_lines()`
    },
    cpp: {
      name: "C++17（ICT/终端/软开主力 · 运行极快）",
      tips: "务必开启 ios::sync_with_stdio(false); cin.tie(nullptr); 防大数据超时！注意 cin >> n 后若紧跟 getline 读整行，必须先 cin.ignore() 吞掉残留换行符！",
      code: `// C++17 华为机考 ACM 模式全场景输入输出模板
#include <iostream>
#include <vector>
#include <string>
#include <sstream>
#include <algorithm>
#include <unordered_map>
#include <queue>
using namespace std;

int main() {
    // 加速标准输入输出流，大数据量防 TLE 必备
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    // 场景1：已知长度 n 的多组输入
    int n;
    while (cin >> n) {
        vector<int> nums(n);
        for (int i = 0; i < n; ++i) cin >> nums[i];
        // 坑点：如果下面紧接着要用 getline(cin, line)，必须先加 cin.ignore();
        long long sum = 0; // 防 int 溢出好习惯
        for (int x : nums) sum += x;
        cout << sum << "\\n"; // 用 '\\n' 替代 endl 避免频繁刷新缓冲区超时
    }

    // 场景2：未知长度，读取一整行以逗号或空格分隔的数字
    string line;
    while (getline(cin, line)) {
        if (line.empty()) continue;
        stringstream ss(line);
        string token;
        vector<int> arr;
        // 逗号分隔填 ','，空格分隔填 ' '
        while (getline(ss, token, ',')) {
            if (!token.empty()) arr.push_back(stoi(token));
        }
    }
    return 0;
}`
    },
    java: {
      name: "Java（后端主力 · 类名固定为 Main）",
      tips: "牛客/华为机考类名通常必须命名为 Main 且不要带 package 声明！输入超过 10^5 个数时，务必用 BufferedReader + StringTokenizer 替代 Scanner 防超时！",
      code: `// Java 华为机考 ACM 模式全场景输入输出模板（注意类名必须为 Main）
import java.util.*;
import java.io.*;

public class Main {
    public static void main(String[] args) throws IOException {
        // 大数据量推荐 BufferedReader 替代 Scanner
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        PrintWriter out = new PrintWriter(new BufferedWriter(new OutputStreamWriter(System.out)));

        String line;
        while ((line = br.readLine()) != null) {
            line = line.trim();
            if (line.isEmpty()) continue;
            // 按一个或多个空白符切分（若逗号分隔改为 line.split(",")）
            String[] parts = line.split("\\\\s+");
            long sum = 0;
            for (String p : parts) {
                sum += Long.parseLong(p);
            }
            out.println(sum);
        }
        out.flush();
    }
}`
    },
    c: {
      name: "C 语言（嵌入式/底层开发 · 极致内存控制）",
      tips: "使用 fgets + strtok 解析未知个数的一行整数最稳妥；排序直接调用 <stdlib.h> 的 qsort，注意比较函数不要直接写成 a - b 防极端负数溢出！",
      code: `// C 语言 华为机考 ACM 模式常用输入输出与 qsort 模板
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// 安全的升序比较函数（避免 *(int*)a - *(int*)b 整数溢出）
int cmp_int(const void *a, const void *b) {
    int va = *(const int *)a;
    int vb = *(const int *)b;
    return (va > vb) - (va < vb);
}

int main(void) {
    // 场景1：读取未知长度的一行空格/逗号分隔整数
    char buf[65536];
    while (fgets(buf, sizeof(buf), stdin) != NULL) {
        int arr[10005], cnt = 0;
        // 同时支持空格、逗号、回车换行作为分隔符
        char *tok = strtok(buf, " ,\\r\\n\\t");
        while (tok != NULL) {
            arr[cnt++] = atoi(tok);
            tok = strtok(NULL, " ,\\r\\n\\t");
        }
        if (cnt == 0) continue;
        qsort(arr, cnt, sizeof(int), cmp_int);
        printf("%d\\n", arr[0]);
    }
    return 0;
}`
    }
  },

  // 华为实习全流程关卡与策略数据
  recruitmentStages: [
    {
      step: 1,
      name: "HR 建联与意向摸底",
      badge: "积极信号",
      summary: "收到业务电话说明院校/专业已入部门人才池（寒假日常实习或春招暑期实习提前锁人）。",
      tips: "主动询问 HR：『是近期日常实习还是明年春招暑期实习？大概何时安排机考？』争取留出 3～4 周集中刷题窗口再发起正式机考。"
    },
    {
      step: 2,
      name: "线上机考（ACM 模式 · 600 分制）",
      badge: "核心生死关",
      summary: "120～150 分钟共 3 题（100分 + 200分 + 300分），合格线 150 分，建议冲击 300+ 分提升捞人与定级优势。",
      tips: "【按通过率给分】：过多少比例用例拿多少分！第 3 题想不出 DP 最优解时，写 DFS 暴力搜索或特判拿 40% 用例也能稳赚 120 分！偏爱字符串解析、模拟、滑窗单调栈、网格 BFS/DFS，几乎不直接考链表指针。"
    },
    {
      step: 3,
      name: "综合测评（性格测试）",
      badge: "隐形一票否决",
      summary: "机考通过后发放链接，一旦判定『前后作答矛盾』或『抗压/协作风险高』会直接触发淘汰甚至半年冻结期。",
      tips: "严守一致性（同类题换问法重复出现）；展现积极阳光、皮实抗压、开放合作、以客户和目标为中心；切忌选孤僻、极端或消极抱怨选项。"
    },
    {
      step: 4,
      name: "技术一面 & 二面（八股 + 项目 + 手撕）",
      badge: "实力决胜关",
      summary: "每轮 45～60 分钟：前 30 分钟聊四大件基础与简历项目深挖，后 15～25 分钟屏幕共享手撕代码（多出自 Hot 100 原题或微调，链表与二叉树极高频！）。",
      tips: "手撕标准动作：① 动笔前确认边界条件与数据规模 → ② 1 分钟先讲暴力思路再讲优化核心思路 → ③ 命名规范编码 → ④ 写完主动走查样例并报出时间/空间复杂度。"
    },
    {
      step: 5,
      name: "主管面（综合潜力与匹配度）",
      badge: "终面定音",
      summary: "考察学习敏捷度、抗压韧性、团队融入度、职业规划及到岗实习时长保障。",
      tips: "准备好用 STAR 讲清自己攻克复杂难题的真实经历，表达对部门业务方向的认同与稳定实习时间。"
    }
  ],

  // 四大件与语言高频八股自测清单（可勾选掌握进度）
  csFundamentals: [
    {
      category: "操作系统",
      items: [
        "进程与线程的本质区别、各自资源开销及 5 种进程间通信（IPC）方式",
        "虚拟内存的作用、页表寻址与缺页中断、LRU 页面置换算法（联动第 146 题手撕）",
        "死锁产生的四个必要条件，以及如何预防、避免与解除死锁",
        "用户态与内核态的区别，什么情况下会发生态切换（系统调用/异常/外设中断）",
        "I/O 多路复用：select、poll、epoll 的底层数据结构差异及 LT/ET 触发模式"
      ]
    },
    {
      category: "计算机网络",
      items: [
        "OSI 七层 / TCP-IP 五层模型各层职责与核心协议",
        "TCP 三次握手与四次挥手全状态机（为什么不能两次握手？TIME_WAIT 2MSL 的两大作用）",
        "TCP 如何保证可靠传输（序列号/确认应答/超时重传/滑动窗口/流量控制/拥塞控制四算法）",
        "HTTP 常见状态码、HTTP/1.1 vs HTTP/2 vs HTTP/3，以及 HTTPS（TLS 混合加密握手全过程）",
        "从浏览器地址栏输入 URL 到页面渲染出来的完整网络与渲染链路"
      ]
    },
    {
      category: "数据库与数据结构",
      items: [
        "数组、链表、哈希表底层原理及哈希冲突解决机制（拉链法 vs 开放定址法）",
        "二叉搜索树、AVL 树、红黑树与 B+ 树的核心区别（为什么 MySQL 索引用 B+ 树不用红黑树？）",
        "MySQL 聚簇索引与非聚簇索引、回表查询、覆盖索引及常见索引失效场景",
        "数据库事务 ACID 四大特性、并发脏读/不可重复读/幻读及四大隔离级别与 MVCC"
      ]
    },
    {
      category: "主力语言特性（Python / C++ / Java）",
      items: [
        "Python：GIL 全局解释器锁对多线程的影响（IO密集 vs CPU密集）、深拷贝与浅拷贝、装饰器与生成器 yield",
        "Python：list / dict / set 底层实现与时间复杂度、垃圾回收机制（引用计数 + 标记清除 + 分代回收）",
        "C++：指针与引用区别、虚函数表 vtable 与多态原理、RAII 与智能指针（unique_ptr/shared_ptr/weak_ptr）、内存五区",
        "Java：HashMap 底层扩容与红黑树转换、JVM 内存区域与垃圾回收算法、synchronized vs ReentrantLock 与线程池核心参数"
      ]
    }
  ],

  // 简历项目 STAR 打磨默认模板
  defaultStarProjects: [
    {
      id: "proj-1",
      name: "核心项目一（示例：分布式任务调度系统 / 专业课硬核大作业）",
      arch: "【架构与分工】简述整体数据流向（前端/客户端 → 网关/服务层 → 存储/算法引擎），明确指出哪 2～3 个核心模块是由你独立设计与编码实现的：",
      trouble: "【最棘手 Bug 或性能瓶颈】当时遇到了什么具体问题（如高并发锁竞争、内存泄漏、慢查询超时）？如何用日志/火焰图定位？对比了哪些方案？最终指标提升了多少（如耗时从 850ms 降至 65ms）？",
      scale: "【百倍扩展思考】如果并发量扩大 100 倍或数据量增长到亿级，当前架构哪里会最先成为瓶颈（单点数据库/内存队列/同步阻塞）？如何引入缓存分片、消息队列削峰或读写分离改进？"
    },
    {
      id: "proj-2",
      name: "核心项目二（示例：实验室科研课题 / 模型推理加速或编译器实验）",
      arch: "【架构与分工】项目解决的核心痛点是什么？你的核心算法实现或系统工程贡献占比：",
      trouble: "【难点与攻关】遇到过最难调通的边界 Case 或精度/性能折中问题是什么？你是如何一步步实验排查解决的？",
      scale: "【复盘与演进】如果重新设计这个项目，或者将其部署到华为终端/云端真实生产环境，还需要在容灾、监控或资源受限优化上做哪些升级？"
    }
  ]
};
