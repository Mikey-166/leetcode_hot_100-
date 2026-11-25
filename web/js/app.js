// AlgoForge · 主应用控制器
// 完整集成：1. 可编辑6周打卡日程 & 1-3-7错题复习  2. Hot 100 全100题×4语言(Python/C++/Java/C)精讲与白板默写
//          3. 代码片段智能逐行解析舱 + Python沙箱 + AI追问  4. 华为机考ACM模板/算分器/八股/STAR项目  5. Windows & 小米澎湃OS跨端同步

(function () {
  const STORAGE_KEY = "algoforge_user_store_v1";
  const SYNC_CFG_KEY = "algoforge_sync_cfg_v2";
  const DB = window.ALGO_PROBLEM_DB || { topics: [], problems: [] };
  const JUDGE_DB = window.ALGO_JUDGE_DB || {};
  const GUIDE = window.ALGO_SCHEDULE_GUIDE;
  const UTILS = window.ALGO_UTILS;
  const ANALYZER = window.ALGO_CODE_ANALYZER;

  const PROBLEM_MAP = new Map();
  DB.problems.forEach((p) => PROBLEM_MAP.set(p.id, p));
  const TOPIC_MAP = new Map();
  DB.topics.forEach((t) => TOPIC_MAP.set(t.id, t));

  function todayIsoStr() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function addDaysStr(baseIso, offsetDays) {
    const parts = (baseIso || todayIsoStr()).split("-").map(Number);
    const dt = new Date(parts[0], (parts[1] || 1) - 1, parts[2] || 1);
    dt.setDate(dt.getDate() + offsetDays);
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const day = String(dt.getDate()).padStart(2, "0");
    const wk = ["日", "一", "二", "三", "四", "五", "六"][dt.getDay()];
    return {
      iso: `${dt.getFullYear()}-${m}-${day}`,
      short: `${m}/${day} 周${wk}`
    };
  }

  // 构建初始用户状态（带默认 6 周计划、Python 主力语言偏好）
  function createDefaultStore() {
    return {
      version: 1,
      updatedAt: Date.now(),
      theme: "dark",
      primaryLang: "python",
      spoilerMode: false, // 15分钟防剧透渐进模式
      startDate: todayIsoStr(),
      selectedWeek: 1,
      selectedDay: 1,
      // 每日固定时间段作息表（用户可自由增删改）
      dailyRoutine: JSON.parse(JSON.stringify(GUIDE.defaultDailyRoutine)),
      // 42天每日计划（用户可自由改标题、增删题目、顺延题目、加子任务、打卡）
      days: GUIDE.defaultDays.map((d) => ({
        day: d.day,
        week: d.week,
        title: d.title,
        problemIds: [...d.problemIds],
        sideTask: d.sideTask,
        sideDone: false,
        todos: (d.customTodos || []).map((txt, idx) => ({ id: `td-${d.day}-${idx}`, text: txt, done: false })),
        checkedIn: false,
        checkedAt: null,
        note: ""
      })),
      // 题目状态: { [id]: { status: 'none'|'done'|'review', starred: bool, note: '', reviewMarkedDate: 'YYYY-MM-DD' } }
      problemRecords: {},
      // 判题记录: { [id]: { status, passed, total, ms, lang, at, attempts } }
      judgeRecords: {},
      // 记录级同步时间戳（仅本地与同步接口使用，不展示给用户）
      syncTs: { meta: Date.now(), days: {}, problems: {}, cs: {}, judge: {}, starProjects: 0 },
      // 八股勾选记录: { "操作系统::0": true }
      csChecked: {},
      // STAR 简历项目话术
      starProjects: JSON.parse(JSON.stringify(GUIDE.defaultStarProjects)),
      // AI 接口可选配置
      aiConfig: {
        apiUrl: "https://api.deepseek.com/v1",
        apiKey: "",
        model: "deepseek-chat"
      }
    };
  }

  let store = loadLocalStore();
  let serverOnline = false;
  let deferredPwaPrompt = null;
  let syncCfg = loadSyncCfg();
  let lastSnap = null;
  let syncDebounce = null;
  let syncTimer = null;
  let syncInFlight = false;
  let syncDirty = false;
  let lastServerAt = 0;
  let lastSyncOkAt = 0;

  // UI 瞬态状态
  const ui = {
    view: "schedule", // schedule | problems | analyzer | huawei
    // 题库页状态
    selectedProblemId: 1,
    activeCodeLang: store.primaryLang || "python",
    mobileShowDetail: false,
    filterSearch: "",
    filterTopic: "all",
    filterDiff: "all",
    filterTag: "all",
    filterStatus: "all",
    revealStepsForId: null, // 防剧透模式下已展开的题目ID
    whiteboardOpen: false,
    whiteboardCodes: {}, // 按语言分别保存白板代码草稿 {python, cpp, java, c}
    whiteboardCode: null, // 兼容旧字段，实际不再使用
    whiteboardShowAns: false,
    whiteboardRunRes: null,
    judgeRes: null,
    judgeCaseIdx: 0,
    judgeLoading: false,
    judgeMode: "submit",
    topicIntroOpen: false,
    // 代码解析舱状态
    snippetCode: ANALYZER.DEMO_SNIPPETS[0].code,
    snippetLang: "auto",
    snippetProblemId: "11",
    snippetResult: null,
    snippetStdin: "",
    snippetRunRes: null,
    aiQuestion: "",
    aiAnswer: "",
    aiLoading: false,
    // 华为宝典子页签: stages | acm | top20 | cs_star
    huaweiTab: "stages",
    acmLang: "python",
    examRate1: 100,
    examRate2: 80,
    examRate3: 45,
    // 15分钟番茄钟
    pomoSeconds: 15 * 60,
    pomoRunning: false,
    pomoTimer: null
  };

  function loadLocalStore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const def = createDefaultStore();
        return Object.assign(def, parsed);
      }
    } catch (_e) {}
    return createDefaultStore();
  }

  // =====================================================================
  // 同步层：记录级时间戳 + 局域网 / 公网自动切换
  // =====================================================================
  function loadSyncCfg() {
    let cfg = {};
    try {
      cfg = JSON.parse(localStorage.getItem(SYNC_CFG_KEY) || "{}") || {};
    } catch (_e) {}
    if (!cfg.deviceId) cfg.deviceId = "dev-" + Math.random().toString(36).slice(2, 8);
    if (window.ALGOFORGE_TOKEN) cfg.token = window.ALGOFORGE_TOKEN;
    try {
      const u = new URL(location.href);
      const t = u.searchParams.get("token");
      if (t) cfg.token = t;
      if (u.searchParams.get("server")) cfg.serverUrl = u.searchParams.get("server");
    } catch (_e) {}
    try { localStorage.setItem(SYNC_CFG_KEY, JSON.stringify(cfg)); } catch (_e) {}
    return cfg;
  }

  function saveSyncCfg() {
    try { localStorage.setItem(SYNC_CFG_KEY, JSON.stringify(syncCfg)); } catch (_e) {}
  }

  function tsNow() {
    return Date.now() + (syncCfg.offset || 0);
  }

  function apiBase() {
    return (syncCfg.serverUrl || "").replace(/\/+$/, "");
  }

  function apiHeaders(extra) {
    const h = Object.assign({}, extra || {});
    if (syncCfg.token) h["X-Sync-Token"] = syncCfg.token;
    return h;
  }

  async function apiFetch(path, opts = {}, timeout = 9000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      return await fetch(apiBase() + path, Object.assign({}, opts, {
        signal: ctrl.signal,
        headers: apiHeaders(opts.headers)
      }));
    } finally {
      clearTimeout(timer);
    }
  }

  function initSyncTs() {
    if (!store.judgeRecords || typeof store.judgeRecords !== "object") store.judgeRecords = {};
    if (!store.syncTs || typeof store.syncTs !== "object") {
      store.syncTs = { meta: 0, days: {}, problems: {}, cs: {}, judge: {}, starProjects: 0 };
    }
    ["days", "problems", "cs", "judge"].forEach((k) => {
      if (!store.syncTs[k] || typeof store.syncTs[k] !== "object") store.syncTs[k] = {};
    });
  }

  function captureSyncable(s) {
    return JSON.parse(JSON.stringify({
      days: s.days || [],
      problemRecords: s.problemRecords || {},
      csChecked: s.csChecked || {},
      judgeRecords: s.judgeRecords || {},
      starProjects: s.starProjects || [],
      meta: {
        version: s.version,
        theme: s.theme,
        primaryLang: s.primaryLang,
        spoilerMode: s.spoilerMode,
        startDate: s.startDate,
        selectedWeek: s.selectedWeek,
        selectedDay: s.selectedDay,
        dailyRoutine: s.dailyRoutine,
        aiConfig: s.aiConfig
      }
    }));
  }

  function bumpSyncTs(prev, next) {
    const t = tsNow();
    const ts = next.syncTs;
    const changed = (a, b) => JSON.stringify(a) !== JSON.stringify(b);

    (next.days || []).forEach((nd) => {
      const pd = (prev.days || []).find((d) => d.day === nd.day);
      if (!pd || changed(pd, nd)) ts.days[nd.day] = t;
    });

    const ids = new Set([...Object.keys(prev.problemRecords || {}), ...Object.keys(next.problemRecords || {})]);
    ids.forEach((id) => {
      const a = (prev.problemRecords || {})[id];
      const b = (next.problemRecords || {})[id];
      if (!a || !b || changed(a, b)) ts.problems[id] = t;
    });

    const csKeys = new Set([...Object.keys(prev.csChecked || {}), ...Object.keys(next.csChecked || {})]);
    csKeys.forEach((k) => {
      const a = (prev.csChecked || {})[k];
      const b = (next.csChecked || {})[k];
      if (a !== b) ts.cs[k] = t;
    });

    const jids = new Set([...Object.keys(prev.judgeRecords || {}), ...Object.keys(next.judgeRecords || {})]);
    jids.forEach((id) => {
      const a = (prev.judgeRecords || {})[id];
      const b = (next.judgeRecords || {})[id];
      if (!a || !b || changed(a, b)) ts.judge[id] = t;
    });

    if (changed(prev.starProjects, next.starProjects)) ts.starProjects = t;
    if (changed(prev.meta, next.meta)) ts.meta = t;
  }

  function saveStore(skipRemote = false) {
    initSyncTs();
    if (lastSnap) bumpSyncTs(lastSnap, store);
    store.updatedAt = Date.now();
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); } catch (_e) {}
    lastSnap = captureSyncable(store);
    updateTopBadges();
    if (!skipRemote) {
      syncDirty = true;
      clearTimeout(syncDebounce);
      syncDebounce = setTimeout(() => pushStateToServer(), 450);
    }
  }

  function setSyncStatus(online, text) {
    const dot = document.getElementById("syncDot");
    const txt = document.getElementById("syncText");
    if (dot) dot.classList.toggle("offline", !online);
    if (txt) txt.textContent = text;
  }

  function applyMergedState(state, ts, serverTime) {
    if (!state) return;
    const active = document.activeElement;
    const typing = active && (active.tagName === "TEXTAREA" || active.tagName === "INPUT");
    store = Object.assign(createDefaultStore(), state);
    if (ts) store.syncTs = ts;
    initSyncTs();
    if (serverTime) syncCfg.offset = serverTime - Date.now();
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); } catch (_e) {}
    lastSnap = captureSyncable(store);
    applyTheme();
    updateTopBadges();
    if (!typing) renderCurrentView();
    else setTimeout(() => renderCurrentView(), 900);
  }

  async function detectServer() {
    const bases = [];
    if (apiBase()) bases.push(apiBase());
    if (location.protocol.startsWith("http")) bases.push("");
    if (syncCfg.lastLan && !bases.includes(syncCfg.lastLan)) bases.push(syncCfg.lastLan);

    for (const b of bases) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 2500);
        const r = await fetch(b + "/api/device-info", { signal: ctrl.signal, headers: apiHeaders() });
        clearTimeout(timer);
        if (r.status === 401) { syncCfg.needToken = true; continue; }
        if (!r.ok) continue;
        const info = await r.json();
        if (b !== apiBase()) { syncCfg.serverUrl = b; }
        if (info.token && !syncCfg.token) syncCfg.token = info.token;
        if (info.publicUrl) syncCfg.publicUrl = info.publicUrl;
        if (info.lanUrls && info.lanUrls[0]) syncCfg.lastLan = info.lanUrls[0];
        syncCfg.needToken = false;
        saveSyncCfg();
        serverOnline = true;
        return true;
      } catch (_e) {}
    }
    serverOnline = false;
    return false;
  }

  async function pushStateToServer() {
    if (syncInFlight) { syncDirty = true; return; }
    if (!(await detectServer())) {
      setSyncStatus(false, syncCfg.needToken ? "需要访问口令（点此设置）" : (apiBase() ? "无法连接同步服务器（已本地保存）" : "离线模式（数据已本地保存）"));
      return;
    }
    syncInFlight = true;
    const rev = store.updatedAt;
    try {
      const resp = await apiFetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: store, ts: store.syncTs, deviceId: syncCfg.deviceId, clientTime: Date.now() })
      }, 15000);
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      const data = await resp.json();
      if (data.serverTime) syncCfg.offset = data.serverTime - Date.now();
      lastServerAt = data.updatedAt || 0;
      lastSyncOkAt = Date.now();
      syncCfg.lastSyncAt = lastSyncOkAt;
      saveSyncCfg();
      if (store.updatedAt === rev) {
        applyMergedState(data.state, data.ts, data.serverTime);
        store.updatedAt = Date.now();
        syncDirty = false;
      } else {
        syncDirty = true;
      }
      setSyncStatus(true, "已同步 " + new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }));
    } catch (_e) {
      serverOnline = false;
      setSyncStatus(false, "连接中断（数据已本地保存）");
    } finally {
      syncInFlight = false;
      if (syncDirty) setTimeout(pushStateToServer, 900);
    }
  }

  async function pullStateFromServer() {
    if (syncInFlight || syncDirty) return;
    if (!(await detectServer())) {
      setSyncStatus(false, syncCfg.needToken ? "需要访问口令（点此设置）" : (apiBase() ? "无法连接同步服务器" : "离线模式（数据已本地保存）"));
      return;
    }
    syncInFlight = true;
    try {
      const resp = await apiFetch("/api/sync", {}, 8000);
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      const data = await resp.json();
      if (data.state && (data.updatedAt || 0) > lastServerAt) {
        lastServerAt = data.updatedAt || 0;
        applyMergedState(data.state, data.ts, data.serverTime);
        store.updatedAt = Date.now();
      }
      lastSyncOkAt = Date.now();
      setSyncStatus(true, "已同步 " + new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }));
    } catch (_e) {
      serverOnline = false;
      setSyncStatus(false, "连接中断（数据已本地保存）");
    } finally {
      syncInFlight = false;
    }
  }

  async function syncNow(showMsg = false) {
    await pushStateToServer();
    if (showMsg) {
      showToast(serverOnline ? "🔄 已与服务器双向同步" : "⚠️ 当前无法连接服务器，数据已保存在本机");
    }
  }

  function startSyncLoop() {
    clearInterval(syncTimer);
    syncTimer = setInterval(() => {
      if (document.visibilityState === "visible") pullStateFromServer();
    }, 6000);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") pullStateFromServer();
    });
    window.addEventListener("focus", () => pullStateFromServer());
    window.addEventListener("online", () => syncNow());
  }

  // 兼容旧入口
  async function pullAndSyncWithServer() {
    initSyncTs();
    lastSnap = captureSyncable(store);
    await syncNow();
    startSyncLoop();
  }

  function showToast(msg) {
    const el = document.getElementById("toastMsg");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => el.classList.remove("show"), 2400);
  }

  function applyTheme() {
    document.documentElement.setAttribute("data-theme", store.theme || "dark");
    const meta = document.getElementById("metaThemeColor");
    if (meta) meta.setAttribute("content", store.theme === "light" ? "#f3f6fb" : "#0b1120");
  }

  function getProbRecord(pid) {
    if (!store.problemRecords[pid]) {
      store.problemRecords[pid] = { status: "none", starred: false, note: "", reviewMarkedDate: null };
    }
    return store.problemRecords[pid];
  }

  function getStats() {
    let solved = 0;
    let reviewList = [];
    const todayStr = todayIsoStr();
    DB.problems.forEach((p) => {
      const rec = store.problemRecords[p.id];
      if (rec) {
        if (rec.status === "done") solved++;
        if (rec.status === "review") {
          // 计算距离标记错题过了几天（支持 1-3-7 周期高亮）
          let diffDays = 0;
          if (rec.reviewMarkedDate) {
            diffDays = Math.round((new Date(todayStr) - new Date(rec.reviewMarkedDate)) / 86400000);
          }
          const isCycleDue = [0, 1, 3, 7, 14].includes(diffDays) || diffDays >= 1;
          reviewList.push({ problem: p, diffDays, isCycleDue });
        }
      }
    });
    const checkedDays = store.days.filter((d) => d.checkedIn).length;
    return { solved, checkedDays, reviewList };
  }

  function updateTopBadges() {
    const { solved, checkedDays } = getStats();
    const bDays = document.getElementById("navBadgeDays");
    const bProbs = document.getElementById("navBadgeProbs");
    if (bDays) bDays.textContent = `${checkedDays}/42`;
    if (bProbs) bProbs.textContent = `${solved}/100`;
  }

  // 简易 Markdown 行内格式转换（加粗、行内代码）
  function formatInlineMd(text) {
    return UTILS.escapeHtml(text)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, '<code style="background:var(--bg-code);padding:1px 6px;border-radius:5px;font-family:var(--font-mono);color:var(--accent);font-size:0.92em;">$1</code>');
  }

  function formatBlockMd(md) {
    if (!md) return "";
    // 处理 ```python ... ``` 代码块
    const parts = md.split(/```(\w*)\n([\s\S]*?)```/g);
    let html = "";
    for (let i = 0; i < parts.length; i++) {
      if (i % 3 === 0) {
        const lines = parts[i].trim().split("\n").filter(Boolean);
        html += lines.map((l) => `<div style="margin-bottom:5px;">${formatInlineMd(l)}</div>`).join("");
      } else if (i % 3 === 1) {
        const lang = parts[i] || "python";
        const code = parts[i + 1] || "";
        html += `<div class="code-viewer" style="margin:8px 0;">${UTILS.highlightCode(code.trimEnd(), lang, true)}</div>`;
        i++;
      }
    }
    return html;
  }

  // ================= 视图切换 =================
  function switchView(viewName) {
    ui.view = viewName;
    document.querySelectorAll("#desktopNav .nav-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.view === viewName);
    });
    document.querySelectorAll("#mobileNav .m-tab").forEach((b) => {
      b.classList.toggle("active", b.dataset.view === viewName);
    });
    const titleMap = {
      schedule: "📅 6周冲刺日程计划表 & 每日打卡",
      problems: "📚 力扣 Hot 100 全题库 · 四语言精讲与手撕",
      analyzer: "🔬 不懂代码片段智能逐行解析舱",
      huawei: "🎯 华为实习机考 ACM 模板 & 面试通关宝典"
    };
    document.getElementById("topbarTitle").textContent = titleMap[viewName] || "AlgoForge";
    renderCurrentView();
  }

  function openProblemDetail(problemId) {
    ui.selectedProblemId = Number(problemId);
    ui.mobileShowDetail = true;
    ui.whiteboardOpen = false;
    ui.whiteboardShowAns = false;
    ui.whiteboardRunRes = null;
    switchView("problems");
  }

  function sendCodeToAnalyzer(code, lang, problemId) {
    ui.snippetCode = code;
    ui.snippetLang = lang || "auto";
    ui.snippetProblemId = problemId ? String(problemId) : "";
    ui.snippetResult = null;
    ui.snippetRunRes = null;
    switchView("analyzer");
    runSnippetAnalysis();
  }

  function renderCurrentView() {
    const container = document.getElementById("viewContainer");
    if (ui.view === "schedule") renderScheduleView(container);
    else if (ui.view === "problems") renderProblemsView(container);
    else if (ui.view === "analyzer") renderAnalyzerView(container);
    else if (ui.view === "huawei") renderHuaweiView(container);
  }

  // =====================================================================
  // 视图 1：日程时间计划表 & 每日打卡（支持自由编辑日程与每日作息时间块）
  // =====================================================================
  function renderScheduleView(container) {
    const { solved, checkedDays, reviewList } = getStats();
    const curDayObj = store.days.find((d) => d.day === store.selectedDay) || store.days[0];
    const curDateInfo = addDaysStr(store.startDate, curDayObj.day - 1);
    const weekMeta = GUIDE.weekMilestones.find((w) => w.week === store.selectedWeek) || GUIDE.weekMilestones[0];
    const weekDays = store.days.filter((d) => d.week === store.selectedWeek);

    const daySolvedCount = curDayObj.problemIds.filter((pid) => getProbRecord(pid).status === "done").length;

    container.innerHTML = `
      <!-- 顶部统计卡片 -->
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-label">Hot 100 攻克总进度</div>
          <div class="stat-value">${solved} <span style="font-size:14px;color:var(--text-sec);font-weight:500;">/ 100 题</span></div>
          <div class="progress-bar"><div class="progress-fill" style="width:${solved}%"></div></div>
        </div>
        <div class="stat-card">
          <div class="stat-label">6 周计划打卡天数</div>
          <div class="stat-value" style="color:var(--success);">${checkedDays} <span style="font-size:14px;color:var(--text-sec);font-weight:500;">/ 42 天</span></div>
          <div class="stat-sub">每天投入 2.5～3 小时稳步跃迁</div>
        </div>
        <div class="stat-card" style="cursor:pointer;" id="cardJumpReview">
          <div class="stat-label">🔄 1-3-7 周期错题本</div>
          <div class="stat-value" style="color:var(--warning);">${reviewList.length} <span style="font-size:14px;color:var(--text-sec);font-weight:500;">道待重刷</span></div>
          <div class="stat-sub">${reviewList.length ? "点击立即筛选错题重做 →" : "暂无积压错题，继续保持！"}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">计划启动日期（自由调整）</div>
          <input type="date" class="input-control" id="inpStartDate" value="${store.startDate}" style="margin-top:4px;padding:5px 9px;font-family:var(--font-mono);" />
          <div class="stat-sub">修改后 42 天日历自动顺延重算</div>
        </div>
      </div>

      ${reviewList.length > 0 ? `
        <div class="insight-box pitfall" style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:18px;">
          <div>
            <strong>🔔 1-3-7 间隔重复提醒：</strong>您有 <strong>${reviewList.length}</strong> 道标黄错题待独立默写清零：
            ${reviewList.slice(0, 4).map((r) => `<a href="javascript:void(0)" class="rev-quick-link" data-pid="${r.problem.id}" style="margin-left:8px;text-decoration:underline;">[${r.problem.lcId}] ${UTILS.escapeHtml(r.problem.title)}</a>`).join("")}
          </div>
          <button class="btn btn-sm" id="btnViewAllReview">进入错题专场</button>
        </div>
      ` : ""}

      <div class="schedule-layout">
        <!-- 左栏：6周课表矩阵 + 每日固定时间段作息表 -->
        <div style="display:flex;flex-direction:column;gap:16px;">
          <div class="card">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px;">
              <h3 style="font-size:16px;">🗓️ 6 周冲刺课表（点击任意一天查看/打卡）</h3>
              <button class="btn btn-sm" id="btnResetSchedule" title="恢复默认42天课表">↺ 恢复默认计划</button>
            </div>

            <div class="week-tabs">
              ${GUIDE.weekMilestones.map((w) => `
                <button class="week-tab ${w.week === store.selectedWeek ? "active" : ""}" data-week="${w.week}">
                  第 ${w.week} 周
                </button>
              `).join("")}
            </div>

            <div style="background:var(--bg-elevated);padding:11px 13px;border-radius:var(--radius-md);margin-bottom:12px;font-size:13px;">
              <div style="font-weight:700;color:var(--primary);margin-bottom:2px;">${UTILS.escapeHtml(weekMeta.title)}</div>
              <div style="color:var(--text-sec);">${UTILS.escapeHtml(weekMeta.subtitle)}</div>
              <div style="margin-top:4px;font-size:12px;color:var(--success);">🎯 阶段里程碑：${UTILS.escapeHtml(weekMeta.milestone)}</div>
            </div>

            <div class="days-grid">
              ${weekDays.map((d) => {
                const dDate = addDaysStr(store.startDate, d.day - 1);
                const doneCnt = d.problemIds.filter((pid) => getProbRecord(pid).status === "done").length;
                return `
                  <div class="day-cell ${d.day === store.selectedDay ? "selected" : ""} ${d.checkedIn ? "checked-in" : ""}" data-day="${d.day}">
                    <div class="day-num">
                      <span>D${d.day}</span>
                      <span>${d.checkedIn ? "✅" : ""}</span>
                    </div>
                    <div class="day-date">${dDate.short.split(" ")[0]}</div>
                    <div class="day-mini-prog">${doneCnt}/${d.problemIds.length}题</div>
                  </div>
                `;
              }).join("")}
            </div>
          </div>

          <!-- 每日作息时间段计划表 -->
          <div class="card">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
              <div>
                <h3 style="font-size:15.5px;">⏰ 每日黄金学习时间段安排表</h3>
                <div style="font-size:12px;color:var(--text-sec);">已为您预设晚间 2.5～3 小时冲刺节奏，可根据课表随时调整</div>
              </div>
              <button class="btn btn-sm" id="btnEditRoutine">✏️ 自定义时间表</button>
            </div>
            <div class="routine-list">
              ${store.dailyRoutine.map((rt) => `
                <div class="routine-item">
                  <span class="routine-time">${UTILS.escapeHtml(rt.time)}</span>
                  <div style="flex:1;min-width:0;">
                    <div style="font-weight:600;font-size:13.5px;">${UTILS.escapeHtml(rt.title)}</div>
                    <div style="font-size:12.5px;color:var(--text-sec);margin-top:2px;">${UTILS.escapeHtml(rt.desc)}</div>
                  </div>
                </div>
              `).join("")}
            </div>
          </div>
        </div>

        <!-- 右栏：当前选中 Day 详情与打卡操作面板 -->
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;border-bottom:1px solid var(--border);padding-bottom:14px;margin-bottom:14px;">
            <div>
              <div style="font-size:12.5px;color:var(--primary);font-weight:700;">
                第 ${curDayObj.week} 周 · Day ${curDayObj.day}（${curDateInfo.short}）
              </div>
              <h2 style="font-size:18px;margin-top:3px;">${UTILS.escapeHtml(curDayObj.title)}</h2>
            </div>
            <button class="btn btn-sm" id="btnCustomizeDay">⚙️ 调整当日计划</button>
          </div>

          <!-- 1. 算法主线题目列表 -->
          <div style="margin-bottom:16px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
              <span style="font-weight:700;font-size:14px;">💻 算法主线任务（已完成 ${daySolvedCount} / ${curDayObj.problemIds.length} 题）</span>
              <button class="btn btn-sm btn-ghost" id="btnAddProbToDay">+ 添加题目</button>
            </div>
            ${curDayObj.problemIds.length === 0 ? `<div style="color:var(--text-muted);font-size:13px;padding:10px;">今日暂无绑定题目，可点击右上角添加。</div>` : ""}
            ${curDayObj.problemIds.map((pid) => {
              const p = PROBLEM_MAP.get(pid);
              if (!p) return "";
              const rec = getProbRecord(pid);
              const isDone = rec.status === "done";
              const isRev = rec.status === "review";
              const diffCls = p.difficulty === "Easy" ? "badge-easy" : p.difficulty === "Hard" ? "badge-hard" : "badge-medium";
              return `
                <div class="task-row">
                  <input type="checkbox" class="task-check chk-prob-done" data-pid="${pid}" ${isDone ? "checked" : ""} title="勾选标记为已独立 AC" />
                  <div class="task-title-link ${isDone ? "done" : ""}" data-open-pid="${pid}">
                    <span style="font-family:var(--font-mono);color:var(--text-sec);font-size:12px;">#${String(p.id).padStart(3, "0")} [${p.lcId}]</span>
                    ${UTILS.escapeHtml(p.title)}
                    <span class="badge ${diffCls}" style="margin-left:4px;">${p.difficulty}</span>
                    ${isRev ? `<span class="badge badge-medium">⚠️待重刷</span>` : ""}
                  </div>
                  <button class="btn btn-sm" data-mark-rev="${pid}" title="15分钟没做出来？标黄加入1-3-7错题本">${isRev ? "取消标黄" : "⚠️标错题"}</button>
                  ${curDayObj.day < 42 && !isDone ? `<button class="btn btn-sm btn-ghost" data-postpone-pid="${pid}" title="今天做不完？顺延到明天">顺延→</button>` : ""}
                </div>
              `;
            }).join("")}
          </div>

          <!-- 2. 机考/面试支线任务 -->
          <div style="margin-bottom:16px;">
            <div style="font-weight:700;font-size:14px;margin-bottom:8px;">🎯 机考 / 面试支线任务（45 分钟）</div>
            <div class="task-row">
              <input type="checkbox" class="task-check" id="chkSideTask" ${curDayObj.sideDone ? "checked" : ""} />
              <div class="task-title-link ${curDayObj.sideDone ? "done" : ""}" id="lblSideTask" style="cursor:default;">
                ${UTILS.escapeHtml(curDayObj.sideTask)}
              </div>
            </div>
          </div>

          <!-- 3. 自定义子任务与重点提醒 -->
          <div style="margin-bottom:16px;">
            <div style="font-weight:700;font-size:14px;margin-bottom:8px;">📌 今日重点提醒 & 个人待办</div>
            ${curDayObj.todos.map((td, idx) => `
              <div class="task-row">
                <input type="checkbox" class="task-check chk-day-todo" data-idx="${idx}" ${td.done ? "checked" : ""} />
                <div class="task-title-link ${td.done ? "done" : ""}" style="cursor:default;">${UTILS.escapeHtml(td.text)}</div>
                <button class="btn btn-sm btn-ghost btn-del-todo" data-idx="${idx}" title="删除此待办">✕</button>
              </div>
            `).join("")}
            <div style="display:flex;gap:8px;margin-top:8px;">
              <input type="text" class="input-control" id="inpNewTodo" placeholder="输入自定义学习任务（如：刷2道牛客字符串真题），按回车添加..." />
              <button class="btn" id="btnAddTodo">添加</button>
            </div>
          </div>

          <!-- 4. 费曼复盘与打卡按钮 -->
          <div style="margin-bottom:16px;">
            <div style="font-weight:700;font-size:14px;margin-bottom:6px;">📝 费曼一句话复盘笔记（自动保存）</div>
            <textarea class="textarea-control" rows="2" id="txtDayNote" placeholder="用自己的话记录今天学到的核心算法套路或踩坑心得...">${UTILS.escapeHtml(curDayObj.note || "")}</textarea>
          </div>

          <button class="btn ${curDayObj.checkedIn ? "btn-success" : "btn-primary"}" style="width:100%;padding:12px;font-size:15px;font-weight:700;" id="btnToggleCheckIn">
            ${curDayObj.checkedIn
              ? `✅ 已完成 Day ${curDayObj.day} 打卡（点击可取消）`
              : `🎉 完成今日学习任务 · 立即打卡 Day ${curDayObj.day}`}
          </button>
        </div>
      </div>
    `;

    // 事件绑定
    document.getElementById("inpStartDate").addEventListener("change", (e) => {
      if (e.target.value) {
        store.startDate = e.target.value;
        saveStore();
        renderScheduleView(container);
        showToast("已更新计划启动日期，42天课表日期已自动重算！");
      }
    });

    const jumpRev = () => {
      ui.filterStatus = "review";
      ui.filterTopic = "all";
      ui.filterDiff = "all";
      ui.filterTag = "all";
      ui.mobileShowDetail = false;
      switchView("problems");
    };
    document.getElementById("cardJumpReview").addEventListener("click", jumpRev);
    const btnAllRev = document.getElementById("btnViewAllReview");
    if (btnAllRev) btnAllRev.addEventListener("click", jumpRev);

    container.querySelectorAll(".rev-quick-link").forEach((a) => {
      a.addEventListener("click", (e) => {
        e.stopPropagation();
        openProblemDetail(a.dataset.pid);
      });
    });

    container.querySelectorAll(".week-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        store.selectedWeek = Number(btn.dataset.week);
        const firstDayOfWeek = (store.selectedWeek - 1) * 7 + 1;
        if (Math.ceil(store.selectedDay / 7) !== store.selectedWeek) {
          store.selectedDay = firstDayOfWeek;
        }
        saveStore();
        renderScheduleView(container);
      });
    });

    container.querySelectorAll(".day-cell").forEach((cell) => {
      cell.addEventListener("click", () => {
        store.selectedDay = Number(cell.dataset.day);
        saveStore();
        renderScheduleView(container);
      });
    });

    container.querySelectorAll(".chk-prob-done").forEach((chk) => {
      chk.addEventListener("change", () => {
        const pid = Number(chk.dataset.pid);
        const rec = getProbRecord(pid);
        rec.status = chk.checked ? "done" : "none";
        saveStore();
        renderScheduleView(container);
      });
    });

    container.querySelectorAll("[data-open-pid]").forEach((el) => {
      el.addEventListener("click", () => openProblemDetail(el.dataset.openPid));
    });

    container.querySelectorAll("[data-mark-rev]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const pid = Number(btn.dataset.markRev);
        const rec = getProbRecord(pid);
        if (rec.status === "review") {
          rec.status = "none";
          showToast("已移出错题本");
        } else {
          rec.status = "review";
          rec.reviewMarkedDate = todayIsoStr();
          showToast("⚠️ 已加入 1-3-7 周期错题本！");
        }
        saveStore();
        renderScheduleView(container);
      });
    });

    container.querySelectorAll("[data-postpone-pid]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const pid = Number(btn.dataset.postponePid);
        const nextDayObj = store.days.find((d) => d.day === curDayObj.day + 1);
        if (nextDayObj) {
          curDayObj.problemIds = curDayObj.problemIds.filter((id) => id !== pid);
          if (!nextDayObj.problemIds.includes(pid)) nextDayObj.problemIds.unshift(pid);
          saveStore();
          renderScheduleView(container);
          showToast(`已将该题顺延至 Day ${nextDayObj.day}！`);
        }
      });
    });

    document.getElementById("chkSideTask").addEventListener("change", (e) => {
      curDayObj.sideDone = e.target.checked;
      saveStore();
      renderScheduleView(container);
    });

    container.querySelectorAll(".chk-day-todo").forEach((chk) => {
      chk.addEventListener("change", () => {
        const idx = Number(chk.dataset.idx);
        if (curDayObj.todos[idx]) {
          curDayObj.todos[idx].done = chk.checked;
          saveStore();
          renderScheduleView(container);
        }
      });
    });

    container.querySelectorAll(".btn-del-todo").forEach((btn) => {
      btn.addEventListener("click", () => {
        curDayObj.todos.splice(Number(btn.dataset.idx), 1);
        saveStore();
        renderScheduleView(container);
      });
    });

    const addTodoFn = () => {
      const inp = document.getElementById("inpNewTodo");
      const val = inp.value.trim();
      if (!val) return;
      curDayObj.todos.push({ id: `td-${Date.now()}`, text: val, done: false });
      inp.value = "";
      saveStore();
      renderScheduleView(container);
    };
    document.getElementById("btnAddTodo").addEventListener("click", addTodoFn);
    document.getElementById("inpNewTodo").addEventListener("keydown", (e) => {
      if (e.key === "Enter") addTodoFn();
    });

    document.getElementById("txtDayNote").addEventListener("input", (e) => {
      curDayObj.note = e.target.value;
      saveStore();
    });

    document.getElementById("btnToggleCheckIn").addEventListener("click", () => {
      curDayObj.checkedIn = !curDayObj.checkedIn;
      curDayObj.checkedAt = curDayObj.checkedIn ? Date.now() : null;
      saveStore();
      renderScheduleView(container);
      showToast(curDayObj.checkedIn ? `🎉 太棒了！Day ${curDayObj.day} 打卡成功！` : "已取消当日打卡状态");
    });

    document.getElementById("btnEditRoutine").addEventListener("click", openRoutineEditorModal);
    document.getElementById("btnCustomizeDay").addEventListener("click", () => openDayEditorModal(curDayObj));
    document.getElementById("btnAddProbToDay").addEventListener("click", () => openAddProblemToDayModal(curDayObj));
    document.getElementById("btnResetSchedule").addEventListener("click", () => {
      if (confirm("确定要将 42 天课程安排恢复为默认设置吗？（您的题目掌握记录与个人笔记不会丢失）")) {
        const fresh = createDefaultStore();
        store.days = fresh.days;
        store.dailyRoutine = fresh.dailyRoutine;
        saveStore();
        renderScheduleView(container);
        showToast("已恢复默认 6 周课程表");
      }
    });
  }

  // 弹窗：编辑每日固定时间块作息表
  function openRoutineEditorModal() {
    const mask = document.getElementById("modalMask");
    const box = document.getElementById("modalBox");

    function renderModalInner() {
      box.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
          <h3 style="font-size:17px;">⏰ 自定义每日学习时间表</h3>
          <button class="btn btn-sm btn-ghost" id="btnCloseModal">✕</button>
        </div>
        <div style="font-size:13px;color:var(--text-sec);margin-bottom:12px;">
          您可以自由修改每个时间段的起止时间、任务名称与说明，定制最适合您大三课表的节奏：
        </div>
        <div id="rtEditList" style="display:flex;flex-direction:column;gap:10px;margin-bottom:14px;">
          ${store.dailyRoutine.map((r, i) => `
            <div style="background:var(--bg-elevated);padding:11px;border-radius:var(--radius-md);border:1px solid var(--border);">
              <div style="display:flex;gap:8px;margin-bottom:7px;">
                <input class="input-control rt-inp-time" data-i="${i}" style="width:145px;font-family:var(--font-mono);" value="${UTILS.escapeHtml(r.time)}" placeholder="如 19:00 - 20:30" />
                <input class="input-control rt-inp-title" data-i="${i}" style="flex:1;" value="${UTILS.escapeHtml(r.title)}" placeholder="环节标题" />
                <button class="btn btn-sm btn-ghost rt-btn-del" data-i="${i}">🗑️</button>
              </div>
              <input class="input-control rt-inp-desc" data-i="${i}" value="${UTILS.escapeHtml(r.desc)}" placeholder="具体执行要求说明" />
            </div>
          `).join("")}
        </div>
        <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;">
          <div style="display:flex;gap:8px;">
            <button class="btn btn-sm" id="btnAddRtRow">+ 新增时间段</button>
            <button class="btn btn-sm btn-ghost" id="btnResetRt">恢复默认作息</button>
          </div>
          <button class="btn btn-primary" id="btnSaveRt">保存时间表</button>
        </div>
      `;

      box.querySelector("#btnCloseModal").onclick = closeModal;
      box.querySelectorAll(".rt-btn-del").forEach((b) => {
        b.onclick = () => {
          syncInputsToDraft();
          store.dailyRoutine.splice(Number(b.dataset.i), 1);
          renderModalInner();
        };
      });
      box.querySelector("#btnAddRtRow").onclick = () => {
        syncInputsToDraft();
        store.dailyRoutine.push({
          id: `rt-${Date.now()}`,
          time: "22:00 - 22:30",
          title: "睡前记忆巩固",
          desc: "浏览错题一句话破题，不写代码纯过脑",
          tag: "自定义"
        });
        renderModalInner();
      };
      box.querySelector("#btnResetRt").onclick = () => {
        store.dailyRoutine = JSON.parse(JSON.stringify(GUIDE.defaultDailyRoutine));
        renderModalInner();
      };
      box.querySelector("#btnSaveRt").onclick = () => {
        syncInputsToDraft();
        saveStore();
        closeModal();
        renderCurrentView();
        showToast("每日学习作息表已保存！");
      };
    }

    function syncInputsToDraft() {
      box.querySelectorAll(".rt-inp-time").forEach((el) => {
        store.dailyRoutine[Number(el.dataset.i)].time = el.value.trim();
      });
      box.querySelectorAll(".rt-inp-title").forEach((el) => {
        store.dailyRoutine[Number(el.dataset.i)].title = el.value.trim();
      });
      box.querySelectorAll(".rt-inp-desc").forEach((el) => {
        store.dailyRoutine[Number(el.dataset.i)].desc = el.value.trim();
      });
    }

    renderModalInner();
    mask.classList.add("open");
  }

  // 弹窗：编辑某天的主题、支线与移除题目
  function openDayEditorModal(dayObj) {
    const mask = document.getElementById("modalMask");
    const box = document.getElementById("modalBox");

    function renderInner() {
      box.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
          <h3 style="font-size:17px;">⚙️ 调整 Day ${dayObj.day} 学习计划</h3>
          <button class="btn btn-sm btn-ghost" id="btnCloseModal">✕</button>
        </div>
        <div style="display:flex;flex-direction:column;gap:12px;">
          <div>
            <label style="font-size:12.5px;color:var(--text-sec);">当日计划主题</label>
            <input class="input-control" id="edtDayTitle" value="${UTILS.escapeHtml(dayObj.title)}" style="margin-top:4px;" />
          </div>
          <div>
            <label style="font-size:12.5px;color:var(--text-sec);">当日机考 / 面试支线任务</label>
            <textarea class="textarea-control" rows="2" id="edtDaySide" style="margin-top:4px;">${UTILS.escapeHtml(dayObj.sideTask)}</textarea>
          </div>
          <div>
            <label style="font-size:12.5px;color:var(--text-sec);">当日绑定的 Hot 100 题目（点击 ✕ 可从当日移除）</label>
            <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;">
              ${dayObj.problemIds.map((pid) => {
                const p = PROBLEM_MAP.get(pid);
                return p ? `<span class="badge badge-top20" style="padding:5px 9px;font-size:12.5px;">[${p.lcId}] ${UTILS.escapeHtml(p.title)} <b style="cursor:pointer;margin-left:5px;" data-rm-pid="${pid}">✕</b></span>` : "";
              }).join("") || '<span style="color:var(--text-muted);font-size:13px;">暂无题目</span>'}
            </div>
          </div>
          <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:6px;">
            <button class="btn" id="btnCancelDayEdt">取消</button>
            <button class="btn btn-primary" id="btnSaveDayEdt">保存修改</button>
          </div>
        </div>
      `;
      box.querySelector("#btnCloseModal").onclick = closeModal;
      box.querySelector("#btnCancelDayEdt").onclick = closeModal;
      box.querySelectorAll("[data-rm-pid]").forEach((x) => {
        x.onclick = () => {
          dayObj.title = box.querySelector("#edtDayTitle").value;
          dayObj.sideTask = box.querySelector("#edtDaySide").value;
          const rmId = Number(x.dataset.rmPid);
          dayObj.problemIds = dayObj.problemIds.filter((id) => id !== rmId);
          renderInner();
        };
      });
      box.querySelector("#btnSaveDayEdt").onclick = () => {
        dayObj.title = box.querySelector("#edtDayTitle").value.trim() || dayObj.title;
        dayObj.sideTask = box.querySelector("#edtDaySide").value.trim();
        saveStore();
        closeModal();
        renderCurrentView();
        showToast(`Day ${dayObj.day} 计划已更新`);
      };
    }

    renderInner();
    mask.classList.add("open");
  }

  function openAddProblemToDayModal(dayObj) {
    const mask = document.getElementById("modalMask");
    const box = document.getElementById("modalBox");
    box.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <h3 style="font-size:17px;">➕ 向 Day ${dayObj.day} 添加题目</h3>
        <button class="btn btn-sm btn-ghost" id="btnCloseModal">✕</button>
      </div>
      <select class="select-control" id="selAddProb" size="10" style="height:260px;margin-bottom:14px;">
        ${DB.problems.map((p) => `<option value="${p.id}">#${String(p.id).padStart(3, "0")} [${p.lcId}] ${UTILS.escapeHtml(p.title)} (${p.topicName} · ${p.difficulty})</option>`).join("")}
      </select>
      <div style="display:flex;justify-content:flex-end;gap:8px;">
        <button class="btn btn-primary" id="btnConfirmAddProb">添加到 Day ${dayObj.day}</button>
      </div>
    `;
    box.querySelector("#btnCloseModal").onclick = closeModal;
    box.querySelector("#btnConfirmAddProb").onclick = () => {
      const pid = Number(box.querySelector("#selAddProb").value);
      if (pid && !dayObj.problemIds.includes(pid)) {
        dayObj.problemIds.push(pid);
        saveStore();
        renderCurrentView();
        showToast("已添加到当日题单！");
      }
      closeModal();
    };
    mask.classList.add("open");
  }

  function closeModal() {
    document.getElementById("modalMask").classList.remove("open");
  }

  // =====================================================================
  // 视图 2：Hot 100 全 100 题 × 四语言（Python/C++/Java/C）精讲与白板默写
  // =====================================================================
  // =====================================================================
  // LeetCode 式判题结果渲染
  // =====================================================================
  const JUDGE_STATUS_META = {
    AC: { label: "✅ 通过全部用例", cls: "ac" },
    WA: { label: "❌ 解答错误", cls: "wa" },
    TLE: { label: "⏱️ 超出时间限制", cls: "tle" },
    RE: { label: "💥 运行时错误", cls: "re" },
    CE: { label: "🛠️ 编译 / 语法错误", cls: "ce" },
    OFFLINE: { label: "📴 判题服务未连接", cls: "off" }
  };

  function fmtJudgeValue(v) {
    if (v === undefined) return "undefined";
    const s = JSON.stringify(v);
    return s === undefined ? String(v) : s;
  }

  function renderJudgeResult(res, jd) {
    const meta = JUDGE_STATUS_META[res.status] || JUDGE_STATUS_META.WA;
    const cases = res.cases || [];
    const total = res.total || cases.length;
    const passed = res.passed || 0;

    if (res.status === "OFFLINE") {
      return `
        <div class="judge-result off">
          <div class="judge-result-head">
            <strong>${meta.label}</strong>
            <span class="judge-score">判题需要连接电脑端服务</span>
          </div>
          <div class="judge-empty">
            当前处于纯离线模式，浏览器无法在本机编译运行代码。请回到电脑端打开平台（会自动开启判题服务），
            或在下方「同步设置」中填写电脑的局域网地址 / 公网同步地址。
          </div>
        </div>`;
    }

    const idx = Math.min(Math.max(ui.judgeCaseIdx || 0, 0), Math.max(0, cases.length - 1));
    const c = cases[idx];
    const checkLabels = (jd && jd.checks || []).map((ch) => `参数 ${ch.arg} 的最终状态`);

    let detail = "";
    if (c) {
      const inputHtml = jd && jd.mode === "design"
        ? `<div class="judge-kv"><span>操作序列</span><pre>${UTILS.escapeHtml(fmtJudgeValue(jd.ops))}</pre></div>
           <div class="judge-kv"><span>参数</span><pre>${UTILS.escapeHtml(fmtJudgeValue(c.input))}</pre></div>`
        : `<div class="judge-kv"><span>输入</span><pre>${UTILS.escapeHtml(fmtJudgeValue(c.input))}</pre></div>`;

      let expectHtml = "";
      if (jd && jd.cmp === "bst") {
        expectHtml = `<div class="judge-kv"><span>期望</span><pre>构造一棵平衡 BST，中序遍历 = ${UTILS.escapeHtml(fmtJudgeValue(c.expected))}</pre></div>`;
      } else {
        expectHtml = `<div class="judge-kv"><span>期望输出</span><pre>${UTILS.escapeHtml(fmtJudgeValue(c.expected))}</pre></div>`;
      }
      const expArgs = (c.expectedArgs || []).map((v, i) =>
        `<div class="judge-kv"><span>期望 · ${checkLabels[i] || "参数 " + i}</span><pre>${UTILS.escapeHtml(fmtJudgeValue(v))}</pre></div>`
      ).join("");
      const actArgs = (c.actualArgs || []).map((v, i) =>
        `<div class="judge-kv"><span>实际 · ${checkLabels[i] || "参数 " + i}</span><pre>${UTILS.escapeHtml(fmtJudgeValue(v))}</pre></div>`
      ).join("");

      detail = `
        <div class="judge-case-detail">
          <div class="judge-detail-title">
            <span class="judge-chip ${c.status.toLowerCase()}">用例 ${idx + 1} · ${c.status}</span>
            <span class="judge-ms">${c.ms != null ? c.ms + " ms" : ""} ${c.sample ? "· 样例" : "· 隐藏用例"}</span>
          </div>
          ${inputHtml}
          ${expectHtml}
          ${expArgs}
          <div class="judge-kv"><span>实际输出</span><pre class="${c.status === "AC" ? "" : "bad"}">${UTILS.escapeHtml(fmtJudgeValue(c.actual))}</pre></div>
          ${actArgs}
          ${c.stdout ? `<div class="judge-kv"><span>你的 print 输出</span><pre>${UTILS.escapeHtml(c.stdout)}</pre></div>` : ""}
          ${c.error ? `<div class="judge-kv"><span>错误信息</span><pre class="bad">${UTILS.escapeHtml(c.error)}</pre></div>` : ""}
        </div>`;
    }

    const compile = res.compileError
      ? `<div class="judge-compile"><div class="judge-compile-title">编译 / 语法错误</div><pre>${UTILS.escapeHtml(res.compileError)}</pre></div>`
      : "";

    return `
      <div class="judge-result ${meta.cls}">
        <div class="judge-result-head">
          <strong>${meta.label}</strong>
          <span class="judge-score">通过 ${passed}/${total}${res.elapsedMs ? " · 总耗时 " + Math.round(res.elapsedMs) + " ms" : ""}</span>
        </div>
        ${total ? `<div class="judge-chips">${cases.map((x, i) =>
          `<button class="judge-chip ${x.status.toLowerCase()} ${i === idx ? "active" : ""}" data-judge-case="${i}">
             ${x.status === "AC" ? "✓" : x.status === "WA" ? "✕" : x.status === "TLE" ? "⏱" : "!"} 用例 ${i + 1}
           </button>`).join("")}</div>` : ""}
        ${compile}
        ${detail}
      </div>`;
  }

  function renderProblemsView(container) {
    const filtered = DB.problems.filter((p) => {
      if (ui.filterTopic !== "all" && String(p.topicId) !== ui.filterTopic) return false;
      if (ui.filterDiff !== "all" && p.difficulty !== ui.filterDiff) return false;
      if (ui.filterTag === "exam" && !p.isExamHot) return false;
      if (ui.filterTag === "hand" && !p.isInterviewHot) return false;
      if (ui.filterTag === "top20" && !p.isTop20) return false;
      const rec = getProbRecord(p.id);
      if (ui.filterStatus === "done" && rec.status !== "done") return false;
      if (ui.filterStatus === "review" && rec.status !== "review") return false;
      if (ui.filterStatus === "todo" && rec.status !== "none") return false;
      if (ui.filterStatus === "star" && !rec.starred) return false;
      if (ui.filterSearch.trim()) {
        const q = ui.filterSearch.trim().toLowerCase();
        const hay = `${p.id} ${p.lcId} ${p.title} ${p.topicName} ${p.slug}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const curProb = PROBLEM_MAP.get(ui.selectedProblemId) || filtered[0] || DB.problems[0];
    const curTopic = TOPIC_MAP.get(curProb.topicId);
    const curRec = getProbRecord(curProb.id);
    const curLang = ui.activeCodeLang || "python";
    const curCode = (curProb.codes && curProb.codes[curLang]) || "";
    const curLangNote = (curProb.langNotes && curProb.langNotes[curLang]) || "";
    const isSpoilerHidden = store.spoilerMode && ui.revealStepsForId !== curProb.id;
    const jd = JUDGE_DB[curProb.id] || null;
    const judgeRec = (store.judgeRecords || {})[curProb.id];
    const wbTpl = jd && jd.templates ? (jd.templates[curLang] || "") : "";
    const wbDraft = (ui.whiteboardCodes || {})[curLang];
    const wbCode = wbDraft === undefined || wbDraft === null ? wbTpl : wbDraft;
    const judgeTotal = jd ? (jd.cases || []).length : 0;

    const diffBadgeCls =
      curProb.difficulty === "Easy" ? "badge-easy" : curProb.difficulty === "Hard" ? "badge-hard" : "badge-medium";

    container.innerHTML = `
      <div class="problems-workbench ${ui.mobileShowDetail ? "mobile-show-detail" : ""}">
        <!-- 左侧 100 题导航与多维筛选抽屉 -->
        <div class="prob-list-panel">
          <div class="prob-filters">
            <input type="search" class="input-control" id="inpProbSearch" placeholder="🔍 搜题号(如 146/25) 或题名/拼音..." value="${UTILS.escapeHtml(ui.filterSearch)}" />
            <div class="filter-row">
              <select class="select-control" id="selFilterTopic">
                <option value="all">全部 17 大专题 (100)</option>
                ${DB.topics.map((t) => `<option value="${t.id}" ${String(t.id) === ui.filterTopic ? "selected" : ""}>${t.cnNum}、${UTILS.escapeHtml(t.name)} (${t.count})</option>`).join("")}
              </select>
              <select class="select-control" id="selFilterTag">
                <option value="all" ${ui.filterTag === "all" ? "selected" : ""}>华为考情：全部</option>
                <option value="exam" ${ui.filterTag === "exam" ? "selected" : ""}>🔥 华为机考高频</option>
                <option value="hand" ${ui.filterTag === "hand" ? "selected" : ""}>✍️ 技术面手撕必考</option>
                <option value="top20" ${ui.filterTag === "top20" ? "selected" : ""}>🏆 考前Top20急救</option>
              </select>
            </div>
            <div class="filter-row">
              <select class="select-control" id="selFilterDiff">
                <option value="all" ${ui.filterDiff === "all" ? "selected" : ""}>全部难度</option>
                <option value="Easy" ${ui.filterDiff === "Easy" ? "selected" : ""}>Easy 简单</option>
                <option value="Medium" ${ui.filterDiff === "Medium" ? "selected" : ""}>Medium 中等</option>
                <option value="Hard" ${ui.filterDiff === "Hard" ? "selected" : ""}>Hard 困难</option>
              </select>
              <select class="select-control" id="selFilterStatus">
                <option value="all" ${ui.filterStatus === "all" ? "selected" : ""}>状态：全部 (${filtered.length})</option>
                <option value="todo" ${ui.filterStatus === "todo" ? "selected" : ""}>⭕ 未开始</option>
                <option value="done" ${ui.filterStatus === "done" ? "selected" : ""}>✅ 已掌握 AC</option>
                <option value="review" ${ui.filterStatus === "review" ? "selected" : ""}>⚠️ 错题待重刷</option>
                <option value="star" ${ui.filterStatus === "star" ? "selected" : ""}>⭐ 重点收藏</option>
              </select>
            </div>
          </div>

          <div class="prob-items-scroll" id="probListScroll">
            ${filtered.length === 0 ? `<div style="padding:24px;text-align:center;color:var(--text-muted);">未找到匹配的题目，可重置筛选条件</div>` : ""}
            ${filtered.map((p) => {
              const r = getProbRecord(p.id);
              const dCls = p.difficulty === "Easy" ? "badge-easy" : p.difficulty === "Hard" ? "badge-hard" : "badge-medium";
              const statusIcon = r.status === "done" ? "✅" : r.status === "review" ? "⚠️" : "•";
              return `
                <div class="prob-item ${p.id === curProb.id ? "active" : ""}" data-select-pid="${p.id}">
                  <div class="prob-item-top">
                    <div class="prob-item-title">
                      <span style="margin-right:4px;">${statusIcon}</span>
                      <span style="color:var(--text-muted);font-family:var(--font-mono);font-size:12px;">${String(p.id).padStart(3, "0")}.</span>
                      [${p.lcId}] ${UTILS.escapeHtml(p.title)}
                    </div>
                    <span class="badge ${dCls}">${p.difficulty[0]}</span>
                  </div>
                  <div style="display:flex;justify-content:space-between;font-size:11.5px;color:var(--text-muted);">
                    <span>${UTILS.escapeHtml(p.topicName)}</span>
                    <span>${p.isTop20 ? "🏆Top20 " : ""}${p.isExamHot ? "🔥机考 " : ""}${p.isInterviewHot ? "✍️手撕" : ""} ${r.starred ? "⭐" : ""}</span>
                  </div>
                </div>
              `;
            }).join("")}
          </div>
        </div>

        <!-- 右侧沉浸式题目精讲与多语言代码面板 -->
        <div class="prob-detail-panel" id="probDetailPanel">
          <button class="btn btn-sm mobile-back-btn" id="btnBackToProbList">← 返回题目列表 (${filtered.length}题)</button>

          <div class="detail-header">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
              <span class="badge ${diffBadgeCls}">${curProb.difficulty}</span>
              <span class="badge" style="background:var(--bg-elevated);">专题${curTopic ? curTopic.cnNum : ""} · ${UTILS.escapeHtml(curProb.topicName)}</span>
              ${curProb.huaweiTag ? `<span class="badge badge-exam">${UTILS.escapeHtml(curProb.huaweiTag)}</span>` : ""}
              ${curProb.isTop20 ? `<span class="badge badge-top20">🏆 考前48h必背Top20</span>` : ""}
              <a href="${curProb.leetcodeUrl}" target="_blank" rel="noopener" class="btn btn-sm" style="margin-left:auto;">🔗 去力扣刷原题 ↗</a>
            </div>

            <div class="detail-title-row">
              <h1 class="detail-h1">#${String(curProb.id).padStart(3, "0")} [${curProb.lcId}] ${UTILS.escapeHtml(curProb.title)}</h1>
              <div style="display:flex;gap:7px;flex-wrap:wrap;">
                <button class="btn btn-sm ${curRec.status === "done" ? "btn-success" : ""}" id="btnDetailDone">
                  ${curRec.status === "done" ? "✅ 已掌握 AC" : "⭕ 标记已掌握"}
                </button>
                <button class="btn btn-sm" id="btnDetailReview" style="${curRec.status === "review" ? "border-color:var(--warning);color:var(--warning);" : ""}">
                  ${curRec.status === "review" ? "⚠️ 已在错题本" : "⚠️ 标为错题"}
                </button>
                <button class="btn btn-sm" id="btnDetailStar">${curRec.starred ? "⭐ 已收藏" : "☆ 收藏"}</button>
              </div>
            </div>

            <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:12px;">
              <button class="btn btn-sm" id="btnToggleTopicTpl">
                ${ui.topicIntroOpen ? "🔼 收起本专题核心模板" : `📘 查看『${UTILS.escapeHtml(curProb.topicName)}』专题核心破题模板`}
              </button>
              <button class="btn btn-sm" id="btnToggleSpoiler">
                ${store.spoilerMode ? "🙈 15分钟渐进防剧透：已开启" : "📖 渐进防剧透模式：关闭"}
              </button>
              <button class="btn btn-sm ${ui.whiteboardOpen ? "btn-primary" : ""}" id="btnToggleWhiteboard">
                ✍️ ${ui.whiteboardOpen ? "退出白板默写" : "15分钟白板手撕默写"}
              </button>
            </div>
          </div>

          ${ui.topicIntroOpen && curTopic && curTopic.introMarkdown ? `
            <div class="insight-box topic-tpl">
              <div style="font-weight:700;margin-bottom:6px;color:var(--accent);">
                🧭 专题${curTopic.cnNum}【${UTILS.escapeHtml(curTopic.fullName)}】机考 ${curTopic.examStars} | 手撕 ${curTopic.interviewStars}
              </div>
              <div style="font-size:13.5px;">${formatBlockMd(curTopic.introMarkdown)}</div>
            </div>
          ` : ""}

          <!-- 一句话破题（任何模式下可见，契合文档 15 分钟先看一句话破题法则！） -->
          <div class="insight-box">
            <div style="font-size:12px;font-weight:700;color:var(--primary);margin-bottom:3px;">💡 一句话破题（卡壳 15 分钟先看这里！）</div>
            <div style="font-size:14.5px;">${formatInlineMd(curProb.oneLiner)}</div>
          </div>

          <!-- 白板手撕默写练习面板 · LeetCode 式判题 -->
          ${ui.whiteboardOpen ? `
            <div class="card judge-workbench">
              <div class="judge-head">
                <div>
                  <strong>✍️ 手撕白板 · LeetCode 式判题</strong>
                  <div class="judge-sub">
                    当前语言：<b>${ANALYZER.LANG_LABELS[curLang]}</b>
                    ${jd ? ` · 共 ${judgeTotal} 个用例（${(jd.cases || []).filter(c => c.sample).length} 个公开样例）` : " · 本题暂无判题数据"}
                    ${judgeRec ? ` · 历史 <b>${judgeRec.attempts || 0}</b> 次提交${judgeRec.status === "AC" ? " · 最佳 " + Math.round(judgeRec.ms || 0) + "ms" : ""}` : ""}
                  </div>
                </div>
                <div class="judge-actions">
                  <button class="btn btn-sm" id="btnWbRunSamples" ${jd ? "" : "disabled"}>▶ 运行样例</button>
                  <button class="btn btn-primary btn-sm" id="btnWbSubmit" ${jd ? "" : "disabled"}>✅ 提交判题</button>
                  <button class="btn btn-sm" id="btnWbTemplate">📄 插入模板</button>
                  <button class="btn btn-sm" id="btnWbShowAns">${ui.whiteboardShowAns ? "🙈 隐藏标准代码" : "👀 对照标准代码"}</button>
                </div>
              </div>
              <textarea class="code-editor-area" id="txtWhiteboard" spellcheck="false" placeholder="在此独立默写 [${curProb.lcId}] ${curProb.title} 的 ${ANALYZER.LANG_LABELS[curLang]} 实现...">${UTILS.escapeHtml(wbCode)}</textarea>
              <div class="judge-hint">
                💡 判题会在电脑端真实编译运行你的代码，逐个用例比对输出；提交通过后自动标记为「已掌握 AC」。
                Python / C++ / Java / C 均支持，代码可直接粘贴力扣官方写法。
              </div>
              ${ui.judgeLoading ? `<div class="judge-loading"><span class="spinner"></span> 正在${ui.judgeMode === "run" ? "运行样例" : "编译并判题"}，请稍候…</div>` : ""}
              ${ui.judgeRes ? renderJudgeResult(ui.judgeRes, jd) : ""}
            </div>
          ` : ""}

          ${isSpoilerHidden && (!ui.whiteboardOpen || !ui.whiteboardShowAns) ? `
            <div class="card" style="text-align:center;padding:28px 16px;border-style:dashed;">
              <div style="font-size:15px;font-weight:600;margin-bottom:8px;">🙈 当前处于「15 分钟防剧透渐进训练模式」</div>
              <div style="font-size:13px;color:var(--text-sec);margin-bottom:14px;">请先根据上方『一句话破题』尝试自己构思或白板默写，需要时再展开关键步骤与四语言代码。</div>
              <button class="btn btn-primary" id="btnRevealStepsNow">🔓 展开本题关键步骤 & 四语言完整解析</button>
            </div>
          ` : `
            <!-- 关键步骤 + 复杂度 + 避坑指南 -->
            <div style="margin-bottom:16px;">
              <h3 style="font-size:15.5px;margin-bottom:8px;">🪜 关键步骤拆解</h3>
              <div class="steps-list">
                ${curProb.steps.map((s) => `<div class="step-line">${formatInlineMd(s)}</div>`).join("")}
              </div>
              <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px;">
                <div class="insight-box" style="margin-bottom:0;border-left-color:var(--success);background:var(--success-soft);">
                  <div style="font-size:12px;font-weight:700;color:var(--success);">⚡ 最优复杂度</div>
                  <div style="font-size:13.5px;margin-top:2px;">${formatInlineMd(curProb.complexity)}</div>
                </div>
                <div class="insight-box pitfall" style="margin-bottom:0;">
                  <div style="font-size:12px;font-weight:700;color:var(--warning);">⚠️ 机考 / 手撕易错坑点</div>
                  <div style="font-size:13.5px;margin-top:2px;">${formatInlineMd(curProb.pitfall)}</div>
                </div>
              </div>
            </div>

            <!-- 多语言（Python主力 / C++ / Java / C）完整代码与语言专属解析 -->
            <div class="lang-tabs-bar">
              <div class="lang-tabs">
                <button class="lang-tab ${curLang === "python" ? "active" : ""}" data-lang="python">🐍 Python 3 (主力)</button>
                <button class="lang-tab ${curLang === "cpp" ? "active" : ""}" data-lang="cpp">⚡ C++</button>
                <button class="lang-tab ${curLang === "java" ? "active" : ""}" data-lang="java">☕ Java</button>
                <button class="lang-tab ${curLang === "c" ? "active" : ""}" data-lang="c">🔧 C 语言</button>
              </div>
              <div style="display:flex;gap:7px;">
                <button class="btn btn-sm" id="btnCopyCurCode">📋 复制代码</button>
                <button class="btn btn-primary btn-sm" id="btnExplainSelection" title="鼠标划选几行不懂的代码（或不选直接解析整段），一键进入解析舱逐行拆解！">
                  🔬 解析选中片段 / 整段代码
                </button>
              </div>
            </div>

            <div class="lang-note-banner">
              <strong style="color:var(--primary);">🎯 ${ANALYZER.LANG_LABELS[curLang]} 专属语法与实现要点：</strong>
              <span style="margin-left:4px;">${formatInlineMd(curLangNote)}</span>
            </div>

            <div style="font-size:12px;color:var(--text-muted);margin-bottom:6px;">
              💡 小技巧：在下方代码中直接<strong>用鼠标涂黑选中任意看不懂的几行</strong>，再点右上角「🔬 解析选中片段」即可针对性逐行精讲！
            </div>

            <div class="code-viewer" id="problemCodeViewer">
              ${UTILS.highlightCode(curCode, curLang, true)}
            </div>
          `}

          <!-- 个人题目笔记与上下题翻页 -->
          <div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--border);">
            <div style="font-weight:700;font-size:14px;margin-bottom:6px;">📝 我的本题刷题笔记（自动跨端保存）</div>
            <textarea class="textarea-control" rows="2" id="txtProbNote" placeholder="记下自己这道题卡住的地方、二刷心得或变形考法...">${UTILS.escapeHtml(curRec.note || "")}</textarea>

            <div style="display:flex;justify-content:space-between;margin-top:16px;">
              <button class="btn" id="btnPrevProb" ${curProb.id <= 1 ? "disabled" : ""}>← 上一题 (#${String(Math.max(1, curProb.id - 1)).padStart(3, "0")})</button>
              <button class="btn" id="btnNextProb" ${curProb.id >= 100 ? "disabled" : ""}>下一题 (#${String(Math.min(100, curProb.id + 1)).padStart(3, "0")}) →</button>
            </div>
          </div>
        </div>
      </div>
    `;

    // 绑定筛选与搜索
    const searchEl = document.getElementById("inpProbSearch");
    searchEl.addEventListener("input", (e) => {
      ui.filterSearch = e.target.value;
      renderProblemsView(container);
      const newSearch = document.getElementById("inpProbSearch");
      newSearch.focus();
      newSearch.setSelectionRange(ui.filterSearch.length, ui.filterSearch.length);
    });

    document.getElementById("selFilterTopic").addEventListener("change", (e) => {
      ui.filterTopic = e.target.value;
      renderProblemsView(container);
    });
    document.getElementById("selFilterTag").addEventListener("change", (e) => {
      ui.filterTag = e.target.value;
      renderProblemsView(container);
    });
    document.getElementById("selFilterDiff").addEventListener("change", (e) => {
      ui.filterDiff = e.target.value;
      renderProblemsView(container);
    });
    document.getElementById("selFilterStatus").addEventListener("change", (e) => {
      ui.filterStatus = e.target.value;
      renderProblemsView(container);
    });

    container.querySelectorAll("[data-select-pid]").forEach((item) => {
      item.addEventListener("click", () => {
        ui.selectedProblemId = Number(item.dataset.selectPid);
        ui.mobileShowDetail = true;
        ui.whiteboardOpen = false;
        ui.whiteboardRunRes = null;
        renderProblemsView(container);
      });
    });

    document.getElementById("btnBackToProbList").addEventListener("click", () => {
      ui.mobileShowDetail = false;
      renderProblemsView(container);
    });

    document.getElementById("btnDetailDone").addEventListener("click", () => {
      curRec.status = curRec.status === "done" ? "none" : "done";
      saveStore();
      renderProblemsView(container);
      if (curRec.status === "done") showToast(`✅ 恭喜拿下 [${curProb.lcId}] ${curProb.title}！`);
    });

    document.getElementById("btnDetailReview").addEventListener("click", () => {
      if (curRec.status === "review") {
        curRec.status = "none";
        showToast("已移出错题本");
      } else {
        curRec.status = "review";
        curRec.reviewMarkedDate = todayIsoStr();
        showToast("⚠️ 已加入 1-3-7 周期错题本！");
      }
      saveStore();
      renderProblemsView(container);
    });

    document.getElementById("btnDetailStar").addEventListener("click", () => {
      curRec.starred = !curRec.starred;
      saveStore();
      renderProblemsView(container);
    });

    document.getElementById("btnToggleTopicTpl").addEventListener("click", () => {
      ui.topicIntroOpen = !ui.topicIntroOpen;
      renderProblemsView(container);
    });

    document.getElementById("btnToggleSpoiler").addEventListener("click", () => {
      store.spoilerMode = !store.spoilerMode;
      ui.revealStepsForId = null;
      saveStore();
      renderProblemsView(container);
      showToast(store.spoilerMode ? "已开启 15 分钟防剧透渐进训练模式" : "已切换为全展开精读模式");
    });

    const btnReveal = document.getElementById("btnRevealStepsNow");
    if (btnReveal) {
      btnReveal.addEventListener("click", () => {
        ui.revealStepsForId = curProb.id;
        renderProblemsView(container);
      });
    }

    document.getElementById("btnToggleWhiteboard").addEventListener("click", () => {
      ui.whiteboardOpen = !ui.whiteboardOpen;
      ui.whiteboardShowAns = false;
      renderProblemsView(container);
    });

    const txtWb = document.getElementById("txtWhiteboard");
    if (txtWb) {
      txtWb.addEventListener("input", (e) => {
        ui.whiteboardCodes[curLang] = e.target.value;
      });
      // Tab 键插入 4 空格，避免跳出编辑器
      txtWb.addEventListener("keydown", (e) => {
        if (e.key === "Tab") {
          e.preventDefault();
          const el = e.target;
          const s = el.selectionStart;
          const en = el.selectionEnd;
          el.value = el.value.slice(0, s) + "    " + el.value.slice(en);
          el.selectionStart = el.selectionEnd = s + 4;
          ui.whiteboardCodes[curLang] = el.value;
        }
      });
    }

    const btnWbAns = document.getElementById("btnWbShowAns");
    if (btnWbAns) {
      btnWbAns.addEventListener("click", () => {
        ui.whiteboardShowAns = !ui.whiteboardShowAns;
        if (ui.whiteboardShowAns) ui.revealStepsForId = curProb.id;
        renderProblemsView(container);
      });
    }

    const btnWbTpl = document.getElementById("btnWbTemplate");
    if (btnWbTpl) {
      btnWbTpl.addEventListener("click", () => {
        ui.whiteboardCodes[curLang] = wbTpl;
        ui.whiteboardShowAns = false;
        renderProblemsView(container);
        showToast(`📄 已插入 ${ANALYZER.LANG_LABELS[curLang]} 判题模板（含函数签名 / 类型 / 返回）`);
      });
    }

    // 判题用例切换 chip
    container.querySelectorAll("[data-judge-case]").forEach((chip) => {
      chip.addEventListener("click", () => {
        ui.judgeCaseIdx = Number(chip.dataset.judgeCase) || 0;
        renderProblemsView(container);
      });
    });

    // LeetCode 式判题核心：run = 仅公开样例，submit = 全部用例
    async function judgeSubmit(mode) {
      if (!jd || ui.judgeLoading) return;
      const code = ui.whiteboardCodes[curLang] === undefined ? wbTpl : ui.whiteboardCodes[curLang];
      if (!code || !code.trim()) {
        showToast("请先写入代码，或点击「📄 插入模板」拿到函数签名");
        return;
      }
      ui.judgeLoading = true;
      ui.judgeMode = mode;
      ui.judgeRes = null;
      ui.judgeCaseIdx = 0;
      renderProblemsView(container);

      let res = null;
      let netErr = null;
      try {
        const resp = await apiFetch("/api/judge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            problemId: curProb.id,
            language: curLang,
            code: code,
            mode: mode
          })
        }, 90000);
        if (!resp.ok) {
          let msg = `HTTP ${resp.status}`;
          try {
            const j = await resp.json();
            if (j && (j.error || j.compileError)) msg = j.error || j.compileError;
          } catch (_e) {}
          throw new Error(msg);
        }
        res = await resp.json();
      } catch (err) {
        netErr = err;
      }

      ui.judgeLoading = false;

      if (!res) {
        const aborted = netErr && (netErr.name === "AbortError" || /abort/i.test(String(netErr.message)));
        ui.judgeRes = {
          status: "OFFLINE",
          total: (jd.cases || []).length,
          passed: 0,
          cases: [],
          error: aborted
            ? "判题请求超时（90s）。若是 C++ / Java 首次编译较慢，请重试一次。"
            : `无法连接判题服务（${apiBase() || "当前地址"}）。请确认电脑端「启动平台」正在运行，且手机与电脑在同一 Wi-Fi 或已在同步设置中填入公网地址。错误：${netErr ? netErr.message : "未知"}`
        };
        renderProblemsView(container);
        if (aborted) showToast("⏱️ 判题超时，请重试");
        else showToast("📴 未连接判题服务，请检查电脑端是否启动");
        return;
      }

      // 回写练习记录（用于顶部统计、错题本与多设备同步）
      const prev = (store.judgeRecords || {})[curProb.id] || { attempts: 0, status: "none", ms: 0 };
      const rec = Object.assign({ attempts: 0, status: "none", ms: 0 }, prev);
      rec.attempts = (prev.attempts || 0) + 1;
      rec.lastStatus = res.status;
      rec.lastLang = curLang;
      rec.lastAt = Date.now();
      if (res.status === "AC") {
        const ms = Math.round(res.elapsedMs || 0);
        rec.status = "AC";
        rec.ms = rec.ms ? Math.min(rec.ms, ms) : ms;
        rec.firstAcAt = prev.firstAcAt || Date.now();
      } else if (rec.status !== "AC") {
        rec.status = res.status;
      }
      if (!store.judgeRecords) store.judgeRecords = {};
      store.judgeRecords[curProb.id] = rec;

      if (res.status === "AC") {
        curRec.status = "done";
        curRec.solvedAt = curRec.solvedAt || todayIsoStr();
      }
      saveStore();
      ui.judgeRes = res;
      ui.judgeCaseIdx = 0;
      renderProblemsView(container);

      const meta = JUDGE_STATUS_META[res.status] || JUDGE_STATUS_META.WA;
      if (res.status === "AC") {
        showToast(`🎉 ${mode === "run" ? "样例" : "全部用例"}通过！${passedText(res)} 已标记为「已掌握 AC」`);
      } else if (res.status === "CE") {
        showToast("🛠️ 编译失败，请看结果区的编译错误信息");
      } else {
        showToast(`${meta.label}（${passedText(res)}）`);
      }
    }

    function passedText(res) {
      return `通过 ${res.passed || 0}/${res.total || 0}`;
    }

    const btnWbRun = document.getElementById("btnWbRunSamples");
    if (btnWbRun) {
      btnWbRun.addEventListener("click", () => judgeSubmit("run"));
    }
    const btnWbSubmit = document.getElementById("btnWbSubmit");
    if (btnWbSubmit) {
      btnWbSubmit.addEventListener("click", () => judgeSubmit("submit"));
    }

    container.querySelectorAll(".lang-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        ui.activeCodeLang = tab.dataset.lang;
        renderProblemsView(container);
      });
    });

    const btnCopy = document.getElementById("btnCopyCurCode");
    if (btnCopy) {
      btnCopy.addEventListener("click", () => {
        navigator.clipboard.writeText(curCode).then(() => showToast(`📋 已复制 ${ANALYZER.LANG_LABELS[curLang]} 代码！`));
      });
    }

    const btnExpSel = document.getElementById("btnExplainSelection");
    if (btnExpSel) {
      btnExpSel.addEventListener("click", () => {
        let selText = "";
        const sel = window.getSelection();
        const viewer = document.getElementById("problemCodeViewer");
        if (sel && sel.toString().trim() && viewer && viewer.contains(sel.anchorNode)) {
          // 过滤掉复制进来的纯数字行号列
          selText = sel
            .toString()
            .split("\n")
            .map((l) => l.replace(/^\s*\d+\s?/, ""))
            .join("\n")
            .trim();
        }
        sendCodeToAnalyzer(selText || curCode, curLang, curProb.id);
      });
    }

    document.getElementById("txtProbNote").addEventListener("input", (e) => {
      curRec.note = e.target.value;
      saveStore();
    });

    document.getElementById("btnPrevProb").addEventListener("click", () => {
      if (curProb.id > 1) {
        ui.selectedProblemId = curProb.id - 1;
        renderProblemsView(container);
      }
    });
    document.getElementById("btnNextProb").addEventListener("click", () => {
      if (curProb.id < 100) {
        ui.selectedProblemId = curProb.id + 1;
        renderProblemsView(container);
      }
    });
  }

  // =====================================================================
  // 视图 3：不懂的代码片段输入 & 智能解析舱（支持四语言 + 沙箱运行 + AI追问）
  // =====================================================================
  async function runSnippetAnalysis() {
    const pCtx = ui.snippetProblemId ? PROBLEM_MAP.get(Number(ui.snippetProblemId)) : null;
    ui.snippetResult = await ANALYZER.analyzeSnippet(ui.snippetCode, ui.snippetLang, pCtx);
    if (ui.view === "analyzer") {
      renderAnalyzerView(document.getElementById("viewContainer"));
    }
  }

  function renderAnalyzerView(container) {
    if (!ui.snippetResult && ui.snippetCode.trim()) {
      ANALYZER.analyzeSnippet(ui.snippetCode, ui.snippetLang, ui.snippetProblemId ? PROBLEM_MAP.get(Number(ui.snippetProblemId)) : null)
        .then((res) => {
          ui.snippetResult = res;
          if (ui.view === "analyzer") renderAnalyzerView(container);
        });
    }

    const r = ui.snippetResult;

    container.innerHTML = `
      <div class="card" style="margin-bottom:16px;padding:14px 18px;">
        <div style="font-size:13px;color:var(--text-sec);margin-bottom:8px;">
          ✨ <strong>一键体验难点片段解析</strong>（也可直接在下方粘贴您刷题时遇到的任意 Python / C++ / Java / C 不懂代码）：
        </div>
        <div style="display:flex;gap:7px;flex-wrap:wrap;">
          ${ANALYZER.DEMO_SNIPPETS.map((dm, idx) => `
            <button class="btn btn-sm demo-snip-btn" data-idx="${idx}">${UTILS.escapeHtml(dm.title)}</button>
          `).join("")}
        </div>
      </div>

      <div class="analyzer-grid">
        <!-- 左栏：代码片段输入与运行/追问 -->
        <div style="display:flex;flex-direction:column;gap:16px;">
          <div class="card">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
              <h3 style="font-size:16px;">📥 输入不懂的代码片段</h3>
              <div style="display:flex;gap:7px;">
                <select class="select-control" id="selSnipLang" style="width:140px;padding:5px 8px;">
                  <option value="auto" ${ui.snippetLang === "auto" ? "selected" : ""}>自动识别语言</option>
                  <option value="python" ${ui.snippetLang === "python" ? "selected" : ""}>🐍 Python 3</option>
                  <option value="cpp" ${ui.snippetLang === "cpp" ? "selected" : ""}>⚡ C++</option>
                  <option value="java" ${ui.snippetLang === "java" ? "selected" : ""}>☕ Java</option>
                  <option value="c" ${ui.snippetLang === "c" ? "selected" : ""}>🔧 C 语言</option>
                </select>
                <select class="select-control" id="selSnipProb" style="width:170px;padding:5px 8px;">
                  <option value="">关联题目（可选）</option>
                  ${DB.problems.map((p) => `<option value="${p.id}" ${String(p.id) === String(ui.snippetProblemId) ? "selected" : ""}>[${p.lcId}] ${UTILS.escapeHtml(p.title)}</option>`).join("")}
                </select>
              </div>
            </div>

            <textarea class="code-editor-area" id="txtSnippetInput" spellcheck="false" placeholder="在此粘贴任意看不懂的几行代码或完整函数（支持 Python / C++ / Java / C）...">${UTILS.escapeHtml(ui.snippetCode)}</textarea>

            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">
              <button class="btn btn-primary" id="btnDoAnalyze" style="flex:1;">🔬 立即逐行深度解析</button>
              <button class="btn" id="btnRunPySnippet" title="本地执行 Python 代码片段">▶️ 运行 Python 测试</button>
              <button class="btn btn-ghost" id="btnClearSnippet">清空</button>
            </div>

            <details style="margin-top:10px;">
              <summary style="font-size:12.5px;color:var(--text-sec);cursor:pointer;">⌨️ 可选：填写 ACM 模式标准输入数据 (stdin)</summary>
              <textarea class="textarea-control" rows="2" id="txtSnippetStdin" style="margin-top:6px;font-family:var(--font-mono);font-size:12.5px;" placeholder="测试 sys.stdin / input() 时在此输入样例数据...">${UTILS.escapeHtml(ui.snippetStdin)}</textarea>
            </details>

            ${ui.snippetRunRes ? `
              <div style="margin-top:10px;padding:10px 12px;border-radius:var(--radius-sm);background:var(--bg-code);font-family:var(--font-mono);font-size:12.5px;">
                <div style="color:${ui.snippetRunRes.ok ? "var(--success)" : "var(--danger)"};font-weight:700;margin-bottom:4px;">
                  ${ui.snippetRunRes.ok ? `✅ Python 沙箱输出 (${ui.snippetRunRes.elapsedMs} ms)` : "❌ 运行异常"}
                </div>
                ${ui.snippetRunRes.stdout ? `<pre style="white-space:pre-wrap;">${UTILS.escapeHtml(ui.snippetRunRes.stdout)}</pre>` : `<div style="color:var(--text-muted);">(无标准输出，可加 print(...) 查看变量值)</div>`}
                ${ui.snippetRunRes.stderr ? `<pre style="white-space:pre-wrap;color:var(--danger);margin-top:4px;">${UTILS.escapeHtml(ui.snippetRunRes.stderr)}</pre>` : ""}
              </div>
            ` : ""}
          </div>

          <!-- 可选 AI 大模型自由追问模块 -->
          <div class="card">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
              <h3 style="font-size:15px;">🤖 针对这段代码继续深度追问（AI 导师增强）</h3>
              <button class="btn btn-sm" id="btnConfigAi">⚙️ 配置大模型接口</button>
            </div>
            <div style="font-size:12px;color:var(--text-sec);margin-bottom:8px;">
              右侧内置引擎无需联网即可秒级逐行拆解；若想追问细节（如“把这段 C++ 翻译成 Python 并用例子走查”），可连接 DeepSeek / Qwen / 智谱免费 GLM / 本地 Ollama：
            </div>
            <div style="display:flex;gap:8px;">
              <input class="input-control" id="inpAiQuestion" value="${UTILS.escapeHtml(ui.aiQuestion)}" placeholder="例如：为什么第 4 行 while 循环里要用 <= 而不是 < ？举例走一遍！" />
              <button class="btn btn-primary" id="btnAskAi" ${ui.aiLoading ? "disabled" : ""}>${ui.aiLoading ? "思考中..." : "提问"}</button>
            </div>
            ${ui.aiAnswer ? `
              <div style="margin-top:12px;padding:13px;border-radius:var(--radius-md);background:var(--bg-elevated);font-size:13.5px;line-height:1.7;">
                ${formatBlockMd(ui.aiAnswer)}
              </div>
            ` : ""}
          </div>
        </div>

        <!-- 右栏：多语言结构化智能解析报告 -->
        <div class="card">
          ${!r ? `
            <div style="padding:48px 20px;text-align:center;color:var(--text-muted);">
              请在左侧输入或选择任意代码片段，点击「🔬 立即逐行深度解析」即可查看算法模型识别、避坑体检与逐行显微镜讲解。
            </div>
          ` : `
            <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;padding-bottom:12px;border-bottom:1px solid var(--border);margin-bottom:14px;">
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                <span class="badge badge-top20" style="font-size:13px;padding:4px 10px;">识别语言：${UTILS.escapeHtml(r.langLabel)}</span>
                ${r.pythonAst && r.pythonAst.astValid ? `<span class="badge badge-easy">✓ Python AST 语法树校验通过</span>` : ""}
                ${r.problemContext ? `<a href="javascript:void(0)" id="lnkJumpCtxProb" class="badge badge-hand">关联题目：[${r.problemContext.lcId}] ${UTILS.escapeHtml(r.problemContext.title)} ↗</a>` : ""}
              </div>
            </div>

            <!-- 算法模型雷达 -->
            <div style="margin-bottom:14px;">
              <div style="font-weight:700;font-size:14px;margin-bottom:8px;">🧭 识别到的核心算法套路与设计意图</div>
              ${r.matchedPatterns.map((mp) => `
                <div class="insight-box" style="margin-bottom:8px;">
                  <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
                    <strong>${UTILS.escapeHtml(mp.name)}</strong>
                    <span class="badge badge-top20">${UTILS.escapeHtml(mp.badge)}</span>
                  </div>
                  <div style="font-size:13.5px;">${UTILS.escapeHtml(mp.desc)}</div>
                </div>
              `).join("")}
            </div>

            <!-- 复杂度评估 -->
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;">
              <div style="background:var(--bg-elevated);padding:10px 12px;border-radius:var(--radius-sm);">
                <div style="font-size:11.5px;color:var(--text-sec);">⏱️ 预估时间复杂度</div>
                <div style="font-weight:600;font-size:13px;margin-top:2px;">${UTILS.escapeHtml(r.timeEst)}</div>
              </div>
              <div style="background:var(--bg-elevated);padding:10px 12px;border-radius:var(--radius-sm);">
                <div style="font-size:11.5px;color:var(--text-sec);">💾 预估空间复杂度</div>
                <div style="font-weight:600;font-size:13px;margin-top:2px;">${UTILS.escapeHtml(r.spaceEst)}</div>
              </div>
            </div>

            <!-- 潜在易错点与 Bug 警告 -->
            ${r.warnings && r.warnings.length > 0 ? `
              <div class="insight-box pitfall" style="margin-bottom:14px;">
                <div style="font-weight:700;font-size:13.5px;margin-bottom:4px;">🛡️ 代码体检与防坑预警</div>
                ${r.warnings.map((w) => `<div style="font-size:13px;margin-top:4px;">${formatInlineMd(w)}</div>`).join("")}
              </div>
            ` : ""}

            <!-- 逐行显微镜拆解 -->
            <div>
              <div style="font-weight:700;font-size:14px;margin-bottom:6px;">🔬 逐行语法糖 & 算法意图显微镜拆解</div>
              <div class="line-explain-card">
                ${r.lineAnalysis.filter((item) => item.raw.trim() !== "").map((item) => `
                  <div class="lexp-row">
                    <div class="lexp-code">
                      <span style="color:var(--text-muted);user-select:none;min-width:22px;text-align:right;">${item.lineNo}</span>
                      <span>${UTILS.highlightCode(item.raw, r.lang, false)}</span>
                    </div>
                    <div class="lexp-note ${item.explanation && item.explanation.type === "structure" ? "muted" : ""}">
                      ${item.explanation ? formatInlineMd(item.explanation.text) : ""}
                    </div>
                  </div>
                `).join("")}
              </div>
            </div>
          `}
        </div>
      </div>
    `;

    // 绑定示例片段按钮
    container.querySelectorAll(".demo-snip-btn").forEach((b) => {
      b.addEventListener("click", () => {
        const dm = ANALYZER.DEMO_SNIPPETS[Number(b.dataset.idx)];
        ui.snippetCode = dm.code;
        ui.snippetLang = dm.lang;
        ui.snippetProblemId = String(dm.problemId || "");
        ui.snippetRunRes = null;
        runSnippetAnalysis();
      });
    });

    document.getElementById("selSnipLang").addEventListener("change", (e) => {
      ui.snippetLang = e.target.value;
      runSnippetAnalysis();
    });
    document.getElementById("selSnipProb").addEventListener("change", (e) => {
      ui.snippetProblemId = e.target.value;
      runSnippetAnalysis();
    });
    document.getElementById("txtSnippetInput").addEventListener("input", (e) => {
      ui.snippetCode = e.target.value;
    });
    document.getElementById("txtSnippetStdin").addEventListener("input", (e) => {
      ui.snippetStdin = e.target.value;
    });

    document.getElementById("btnDoAnalyze").addEventListener("click", () => runSnippetAnalysis());
    document.getElementById("btnClearSnippet").addEventListener("click", () => {
      ui.snippetCode = "";
      ui.snippetResult = null;
      ui.snippetRunRes = null;
      renderAnalyzerView(container);
    });

    document.getElementById("btnRunPySnippet").addEventListener("click", async () => {
      const detected = ui.snippetLang === "auto" ? ANALYZER.detectLanguage(ui.snippetCode) : ui.snippetLang;
      if (detected !== "python") {
        showToast("提示：本地即时运行沙箱当前支持 Python 3，C++/Java/C 请使用逐行解析功能");
        return;
      }
      try {
        const resp = await fetch("/api/run-python", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: ui.snippetCode, stdin: ui.snippetStdin })
        });
        ui.snippetRunRes = await resp.json();
      } catch (_e) {
        ui.snippetRunRes = { ok: false, stderr: "离线模式下无法调用电脑 Python 进程，请在 Windows 端启动服务后使用。" };
      }
      renderAnalyzerView(container);
    });

    const lnkProb = document.getElementById("lnkJumpCtxProb");
    if (lnkProb && r && r.problemContext) {
      lnkProb.addEventListener("click", () => openProblemDetail(r.problemContext.id));
    }

    document.getElementById("btnConfigAi").addEventListener("click", openAiConfigModal);
    document.getElementById("inpAiQuestion").addEventListener("input", (e) => {
      ui.aiQuestion = e.target.value;
    });
    document.getElementById("btnAskAi").addEventListener("click", async () => {
      if (!store.aiConfig.apiKey && !store.aiConfig.apiUrl.includes("localhost") && !store.aiConfig.apiUrl.includes("127.0.0.1")) {
        openAiConfigModal();
        showToast("请先填入大模型 API Key（或连接本地 Ollama）");
        return;
      }
      ui.aiLoading = true;
      renderAnalyzerView(container);
      try {
        const pCtx = ui.snippetProblemId ? PROBLEM_MAP.get(Number(ui.snippetProblemId)) : null;
        ui.aiAnswer = await ANALYZER.askAiAboutCode({
          apiUrl: store.aiConfig.apiUrl,
          apiKey: store.aiConfig.apiKey,
          model: store.aiConfig.model,
          code: ui.snippetCode,
          lang: (r && r.lang) || "python",
          question: ui.aiQuestion,
          problemTitle: pCtx ? `[${pCtx.lcId}] ${pCtx.title}` : ""
        });
      } catch (err) {
        ui.aiAnswer = `⚠️ 调用失败：${err.message}`;
      } finally {
        ui.aiLoading = false;
        renderAnalyzerView(container);
      }
    });
  }

  function openAiConfigModal() {
    const mask = document.getElementById("modalMask");
    const box = document.getElementById("modalBox");
    box.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
        <h3 style="font-size:17px;">🤖 配置 AI 大模型追问接口（OpenAI 兼容格式）</h3>
        <button class="btn btn-sm btn-ghost" id="btnCloseModal">✕</button>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">
        <button class="btn btn-sm preset-ai" data-url="https://api.deepseek.com/v1" data-model="deepseek-chat">DeepSeek</button>
        <button class="btn btn-sm preset-ai" data-url="https://open.bigmodel.cn/api/paas/v4" data-model="glm-4-flash">智谱 GLM-4-Flash (免费额度)</button>
        <button class="btn btn-sm preset-ai" data-url="https://dashscope.aliyuncs.com/compatible-mode/v1" data-model="qwen-plus">阿里云通义千问</button>
        <button class="btn btn-sm preset-ai" data-url="https://api.siliconflow.cn/v1" data-model="Qwen/Qwen2.5-Coder-7B-Instruct">硅基流动免费 Coder</button>
        <button class="btn btn-sm preset-ai" data-url="http://localhost:11434/v1" data-model="qwen2.5-coder:7b">本地 Ollama (免Key)</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px;">
        <div>
          <label style="font-size:12.5px;color:var(--text-sec);">API Base URL</label>
          <input class="input-control" id="cfgAiUrl" value="${UTILS.escapeHtml(store.aiConfig.apiUrl)}" />
        </div>
        <div>
          <label style="font-size:12.5px;color:var(--text-sec);">模型名称 (Model)</label>
          <input class="input-control" id="cfgAiModel" value="${UTILS.escapeHtml(store.aiConfig.model)}" />
        </div>
        <div>
          <label style="font-size:12.5px;color:var(--text-sec);">API Key（仅保存在您本机，绝不上传第三方）</label>
          <input type="password" class="input-control" id="cfgAiKey" value="${UTILS.escapeHtml(store.aiConfig.apiKey)}" placeholder="sk-..." />
        </div>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:6px;">
          <button class="btn btn-primary" id="btnSaveAiCfg">保存配置</button>
        </div>
      </div>
    `;
    box.querySelector("#btnCloseModal").onclick = closeModal;
    box.querySelectorAll(".preset-ai").forEach((b) => {
      b.onclick = () => {
        box.querySelector("#cfgAiUrl").value = b.dataset.url;
        box.querySelector("#cfgAiModel").value = b.dataset.model;
      };
    });
    box.querySelector("#btnSaveAiCfg").onclick = () => {
      store.aiConfig.apiUrl = box.querySelector("#cfgAiUrl").value.trim();
      store.aiConfig.model = box.querySelector("#cfgAiModel").value.trim();
      store.aiConfig.apiKey = box.querySelector("#cfgAiKey").value.trim();
      saveStore();
      closeModal();
      showToast("AI 接口配置已保存！");
    };
    mask.classList.add("open");
  }

  // =====================================================================
  // 视图 4：华为实习通关宝典 & ACM 四语言模板 & Top 20 & 八股/STAR项目
  // =====================================================================
  function renderHuaweiView(container) {
    const score = Math.round(100 * (ui.examRate1 / 100) + 200 * (ui.examRate2 / 100) + 300 * (ui.examRate3 / 100));
    const scoreLevel =
      score >= 350 ? "🏆 高分优先锁档（极高概率被目标部门秒捞！）"
      : score >= 300 ? "✅ 理想安全线（面试印象与转正定级占优）"
      : score >= 150 ? "⚠️ 刚过常规合格线（建议第3题用暴力DFS再抢点用例分！）"
      : "❌ 未达 150 分合格线";

    const acmCur = GUIDE.acmTemplates[ui.acmLang] || GUIDE.acmTemplates.python;

    container.innerHTML = `
      <div class="week-tabs" style="margin-bottom:16px;">
        <button class="week-tab ${ui.huaweiTab === "stages" ? "active" : ""}" data-htab="stages">🗺️ 招聘全流程 & 机考抢分模拟器</button>
        <button class="week-tab ${ui.huaweiTab === "acm" ? "active" : ""}" data-htab="acm">⌨️ ACM 四语言输入输出模板舱</button>
        <button class="week-tab ${ui.huaweiTab === "top20" ? "active" : ""}" data-htab="top20">🏆 考前48h闭眼默写 Top 20</button>
        <button class="week-tab ${ui.huaweiTab === "cs_star" ? "active" : ""}" data-htab="cs_star">🧠 四大件八股 & 简历 STAR 打磨器</button>
      </div>

      ${ui.huaweiTab === "stages" ? `
        <div class="schedule-layout">
          <div class="card">
            <h3 style="font-size:16.5px;margin-bottom:12px;">🚀 华为研发实习五大核心关卡闯关指南</h3>
            <div style="display:flex;flex-direction:column;gap:12px;">
              ${GUIDE.recruitmentStages.map((st) => `
                <div style="padding:13px;border-radius:var(--radius-md);background:var(--bg-elevated);border:1px solid var(--border);">
                  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;">
                    <strong>第 ${st.step} 关 · ${UTILS.escapeHtml(st.name)}</strong>
                    <span class="badge badge-exam">${UTILS.escapeHtml(st.badge)}</span>
                  </div>
                  <div style="font-size:13.5px;margin-bottom:6px;">${UTILS.escapeHtml(st.summary)}</div>
                  <div style="font-size:12.5px;color:var(--accent);">💡 破局秘籍：${UTILS.escapeHtml(st.tips)}</div>
                </div>
              `).join("")}
            </div>
          </div>

          <div style="display:flex;flex-direction:column;gap:16px;">
            <div class="card">
              <h3 style="font-size:16.5px;margin-bottom:6px;">🧮 华为机考（600分制）按用例通过率抢分模拟器</h3>
              <div style="font-size:13px;color:var(--text-sec);margin-bottom:14px;">
                华为机考<strong>过多少比例测试用例就给多少分</strong>！拖动滑块制定你的考场时间与保底策略：
              </div>

              <div style="display:flex;flex-direction:column;gap:12px;">
                <div>
                  <div style="display:flex;justify-content:space-between;font-size:13px;">
                    <span>第 1 题（100分 · 字符串/数组模拟）</span>
                    <strong>通过率 ${ui.examRate1}% → ${Math.round(ui.examRate1)} 分</strong>
                  </div>
                  <input type="range" min="0" max="100" step="5" value="${ui.examRate1}" id="rngEx1" style="width:100%;margin-top:4px;" />
                </div>
                <div>
                  <div style="display:flex;justify-content:space-between;font-size:13px;">
                    <span>第 2 题（200分 · 滑窗/单调栈/贪心）</span>
                    <strong>通过率 ${ui.examRate2}% → ${Math.round(2 * ui.examRate2)} 分</strong>
                  </div>
                  <input type="range" min="0" max="100" step="5" value="${ui.examRate2}" id="rngEx2" style="width:100%;margin-top:4px;" />
                </div>
                <div>
                  <div style="display:flex;justify-content:space-between;font-size:13px;">
                    <span>第 3 题（300分 · 网格BFS/DFS/背包DP）</span>
                    <strong>通过率 ${ui.examRate3}% → ${Math.round(3 * ui.examRate3)} 分</strong>
                  </div>
                  <input type="range" min="0" max="100" step="5" value="${ui.examRate3}" id="rngEx3" style="width:100%;margin-top:4px;" />
                </div>
              </div>

              <div style="margin-top:16px;padding:14px;border-radius:var(--radius-md);background:var(--primary-soft);text-align:center;">
                <div style="font-size:28px;font-weight:800;font-family:var(--font-mono);color:var(--primary);">${score} / 600 分</div>
                <div style="font-size:13.5px;margin-top:4px;font-weight:600;">${scoreLevel}</div>
              </div>
            </div>

            <div class="card">
              <h3 style="font-size:16px;margin-bottom:8px;">⚖️ 线上机考 vs 技术面手撕 关键差异提醒</h3>
              <div style="font-size:13.5px;display:flex;flex-direction:column;gap:8px;color:var(--text-sec);">
                <div>• <strong>线上机考（牛客 ACM 模式）</strong>：必须自己写主函数读 <code>sys.stdin</code> 并 <code>print</code> 输出！几乎不直接考链表指针，极度偏爱<strong>长题干阅读理解 + 字符串处理 + 网格 BFS/DFS 搜索</strong>。</div>
                <div>• <strong>一面 & 二面手撕（屏幕共享）</strong>：绝大多数出自本平台 <strong>Hot 100 原题</strong>，其中<strong>链表（反转/K个一组/LRU）和二叉树（层序/LCA/直径）</strong>是最高频必考题！写前务必先和面试官确认边界并口述思路！</div>
              </div>
            </div>
          </div>
        </div>
      ` : ""}

      ${ui.huaweiTab === "acm" ? `
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:12px;">
            <div class="lang-tabs">
              <button class="lang-tab ${ui.acmLang === "python" ? "active" : ""}" data-acmlang="python">🐍 Python 3 (机考首选)</button>
              <button class="lang-tab ${ui.acmLang === "cpp" ? "active" : ""}" data-acmlang="cpp">⚡ C++17</button>
              <button class="lang-tab ${ui.acmLang === "java" ? "active" : ""}" data-acmlang="java">☕ Java (Main类)</button>
              <button class="lang-tab ${ui.acmLang === "c" ? "active" : ""}" data-acmlang="c">🔧 C 语言</button>
            </div>
            <div style="display:flex;gap:8px;">
              <button class="btn btn-sm" id="btnCopyAcm">📋 复制此模板</button>
              <button class="btn btn-primary btn-sm" id="btnTestAcmInAnalyzer">🔬 送入代码解析舱 / 沙箱实操</button>
            </div>
          </div>
          <div class="insight-box">
            <strong>${UTILS.escapeHtml(acmCur.name)}：</strong> ${UTILS.escapeHtml(acmCur.tips)}
          </div>
          <div class="code-viewer">${UTILS.highlightCode(acmCur.code, ui.acmLang, true)}</div>
        </div>
      ` : ""}

      ${ui.huaweiTab === "top20" ? `
        <div class="card">
          <h3 style="font-size:17px;margin-bottom:6px;">🏆 华为技术面考前 48 小时「闭眼默写 Top 20」急救清单</h3>
          <div style="font-size:13.5px;color:var(--text-sec);margin-bottom:14px;">
            若 HR 通知后天就要参加一面/二面，请优先将以下面试官最爱抽考的母题在白板模式下默写到 15 分钟零 Bug：
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(310px,1fr));gap:10px;">
            ${GUIDE.top20MustWrite.map((g) => `
              <div style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:var(--radius-md);padding:12px;">
                <div style="font-size:12px;color:var(--primary);font-weight:700;margin-bottom:6px;">第 ${g.group} 组 · ${UTILS.escapeHtml(g.reason)}</div>
                ${g.ids.map((pid) => {
                  const p = PROBLEM_MAP.get(pid);
                  const r = getProbRecord(pid);
                  return p ? `
                    <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-top:1px solid var(--border);">
                      <span style="font-weight:600;font-size:13.5px;">${r.status === "done" ? "✅" : "⭕"} [${p.lcId}] ${UTILS.escapeHtml(p.title)}</span>
                      <button class="btn btn-sm btn-primary" data-jump-wb="${pid}">去默写 →</button>
                    </div>
                  ` : "";
                }).join("")}
              </div>
            `).join("")}
          </div>
        </div>
      ` : ""}

      ${ui.huaweiTab === "cs_star" ? `
        <div class="schedule-layout">
          <div class="card">
            <h3 style="font-size:16.5px;margin-bottom:10px;">🧠 技术面 40% 权重：四大件与语言高频八股自测表</h3>
            ${GUIDE.csFundamentals.map((cat) => `
              <div style="margin-bottom:14px;">
                <div style="font-weight:700;color:var(--primary);margin-bottom:6px;">📘 ${UTILS.escapeHtml(cat.category)}</div>
                ${cat.items.map((item, idx) => {
                  const key = `${cat.category}::${idx}`;
                  const checked = !!store.csChecked[key];
                  return `
                    <div class="task-row">
                      <input type="checkbox" class="task-check chk-cs-item" data-cskey="${UTILS.escapeHtml(key)}" ${checked ? "checked" : ""} />
                      <div style="font-size:13px;${checked ? "text-decoration:line-through;color:var(--text-muted);" : ""}">${UTILS.escapeHtml(item)}</div>
                    </div>
                  `;
                }).join("")}
              </div>
            `).join("")}
          </div>

          <div class="card">
            <h3 style="font-size:16.5px;margin-bottom:6px;">🌟 技术面 40% 权重：简历核心项目 STAR 三连问打磨器</h3>
            <div style="font-size:12.5px;color:var(--text-sec);margin-bottom:12px;">
              大三无实习经历完全正常！精选 2 个高质量科研课题或硬核专业课大作业，提前写好以下必考三追问逐字稿（自动保存，面试前手机端随时温习）：
            </div>
            ${store.starProjects.map((pj, idx) => `
              <div style="background:var(--bg-elevated);padding:13px;border-radius:var(--radius-md);border:1px solid var(--border);margin-bottom:14px;">
                <input class="input-control star-inp-name" data-idx="${idx}" style="font-weight:700;margin-bottom:8px;" value="${UTILS.escapeHtml(pj.name)}" />
                <textarea class="textarea-control star-inp-arch" data-idx="${idx}" rows="3" style="margin-bottom:8px;font-size:13px;">${UTILS.escapeHtml(pj.arch)}</textarea>
                <textarea class="textarea-control star-inp-trouble" data-idx="${idx}" rows="3" style="margin-bottom:8px;font-size:13px;">${UTILS.escapeHtml(pj.trouble)}</textarea>
                <textarea class="textarea-control star-inp-scale" data-idx="${idx}" rows="3" style="font-size:13px;">${UTILS.escapeHtml(pj.scale)}</textarea>
              </div>
            `).join("")}
          </div>
        </div>
      ` : ""}
    `;

    container.querySelectorAll("[data-htab]").forEach((b) => {
      b.addEventListener("click", () => {
        ui.huaweiTab = b.dataset.htab;
        renderHuaweiView(container);
      });
    });

    ["rngEx1", "rngEx2", "rngEx3"].forEach((id, i) => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener("input", (e) => {
          ui[`examRate${i + 1}`] = Number(e.target.value);
          renderHuaweiView(container);
        });
      }
    });

    container.querySelectorAll("[data-acmlang]").forEach((b) => {
      b.addEventListener("click", () => {
        ui.acmLang = b.dataset.acmlang;
        renderHuaweiView(container);
      });
    });

    const btnCopyAcm = document.getElementById("btnCopyAcm");
    if (btnCopyAcm) {
      btnCopyAcm.addEventListener("click", () => {
        navigator.clipboard.writeText(acmCur.code).then(() => showToast("📋 已复制 ACM 标准输入输出模板！"));
      });
    }
    const btnTestAcm = document.getElementById("btnTestAcmInAnalyzer");
    if (btnTestAcm) {
      btnTestAcm.addEventListener("click", () => {
        ui.snippetStdin = "10 20 30\n5 15 25\n";
        sendCodeToAnalyzer(acmCur.code, ui.acmLang, null);
      });
    }

    container.querySelectorAll("[data-jump-wb]").forEach((b) => {
      b.addEventListener("click", () => {
        ui.selectedProblemId = Number(b.dataset.jumpWb);
        ui.mobileShowDetail = true;
        ui.whiteboardOpen = true;
        ui.whiteboardShowAns = false;
        ui.whiteboardCodes = {};
        ui.judgeRes = null;
        switchView("problems");
      });
    });

    container.querySelectorAll(".chk-cs-item").forEach((chk) => {
      chk.addEventListener("change", () => {
        store.csChecked[chk.dataset.cskey] = chk.checked;
        saveStore();
        renderHuaweiView(container);
      });
    });

    container.querySelectorAll(".star-inp-name").forEach((el) => {
      el.addEventListener("input", () => { store.starProjects[Number(el.dataset.idx)].name = el.value; saveStore(); });
    });
    container.querySelectorAll(".star-inp-arch").forEach((el) => {
      el.addEventListener("input", () => { store.starProjects[Number(el.dataset.idx)].arch = el.value; saveStore(); });
    });
    container.querySelectorAll(".star-inp-trouble").forEach((el) => {
      el.addEventListener("input", () => { store.starProjects[Number(el.dataset.idx)].trouble = el.value; saveStore(); });
    });
    container.querySelectorAll(".star-inp-scale").forEach((el) => {
      el.addEventListener("input", () => { store.starProjects[Number(el.dataset.idx)].scale = el.value; saveStore(); });
    });
  }

  // =====================================================================
  // 弹窗：多设备同步设置（局域网自动发现 / 公网隧道 / 访问口令）
  // =====================================================================
  async function openSyncSettingsModal() {
    const mask = document.getElementById("modalMask");
    const box = document.getElementById("modalBox");

    let devInfo = {};
    try {
      const r = await fetch("/api/device-info");
      if (r.ok) devInfo = await r.json();
    } catch (_e) {}

    const lanUrls = devInfo.lanUrls || [];
    const publicUrl = (devInfo.tunnel && devInfo.tunnel.url) || devInfo.publicUrl || syncCfg.publicUrl || "";
    const rows = [];

    if (lanUrls.length) {
      rows.push(`<div class="sync-label">同一 Wi-Fi 下可用的电脑地址（点一下填入）</div>
        <div class="sync-chips">${lanUrls.map((u) =>
          `<button class="sync-chip" data-fill="${UTILS.escapeHtml(u)}">${UTILS.escapeHtml(u)}</button>`).join("")}</div>`);
    }
    if (publicUrl) {
      rows.push(`<div class="sync-label">公网同步地址（异地 / 4G 也可用）</div>
        <div class="sync-chips"><button class="sync-chip" data-fill="${UTILS.escapeHtml(publicUrl)}">${UTILS.escapeHtml(publicUrl)}</button></div>`);
    }

    box.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
        <h3 style="font-size:18px;">📡 多设备同步设置</h3>
        <button class="btn btn-sm btn-ghost" id="btnCloseModal">✕</button>
      </div>

      <div class="insight-box" style="margin-bottom:14px;">
        <div style="font-size:13px;line-height:1.7;">
          手机与电脑连同一个 Wi-Fi 时，会自动发现并双向同步打卡 / 刷题 / 判题记录；
          出门用 4G 时填下面的公网地址即可继续同步。所有数据同时保存在本机，断网也能刷题。
        </div>
      </div>

      ${rows.join("")}

      <div class="sync-label">同步服务器地址（留空 = 使用当前页面地址 / 自动发现）</div>
      <input class="input-control" id="inpSyncServer" placeholder="http://192.168.1.8:8000 或 https://xxx.trycloudflare.com" value="${UTILS.escapeHtml(syncCfg.serverUrl || "")}" />

      <div class="sync-label">访问口令（电脑端首次启动自动生成，手机端填一次即可）</div>
      <input class="input-control" id="inpSyncToken" placeholder="8 位访问口令" value="${UTILS.escapeHtml(syncCfg.token || "")}" />

      <div class="sync-row">
        <button class="btn btn-sm" id="btnSyncAutoDetect">🔍 自动检测电脑</button>
        <button class="btn btn-sm" id="btnSyncTunnel">🌐 ${publicUrl ? "重启公网隧道" : "开启公网隧道"}</button>
        <button class="btn btn-sm" id="btnSyncCopyUrl">📋 复制手机访问链接</button>
      </div>
      <div id="syncTunnelMsg" class="sync-msg">${publicUrl ? "公网隧道已就绪：" + UTILS.escapeHtml(publicUrl) : "公网隧道未开启（仅在电脑端可用）"}</div>

      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;flex-wrap:wrap;">
        <button class="btn" id="btnSyncNowBtn">🔄 立即同步</button>
        <button class="btn btn-primary" id="btnSyncSave">💾 保存并同步</button>
      </div>
    `;
    mask.classList.add("open");

    box.querySelector("#btnCloseModal").onclick = closeModal;
    mask.onclick = (e) => { if (e.target === mask) closeModal(); };

    box.querySelectorAll("[data-fill]").forEach((b) => {
      b.onclick = () => {
        box.querySelector("#inpSyncServer").value = b.dataset.fill;
      };
    });

    box.querySelector("#btnSyncAutoDetect").onclick = async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = "⏳ 检测中…";
      const ok = await detectServer();
      btn.disabled = false;
      btn.textContent = "🔍 自动检测电脑";
      if (ok) {
        box.querySelector("#inpSyncServer").value = apiBase();
        box.querySelector("#inpSyncToken").value = syncCfg.token || "";
        showToast("✅ 已发现电脑端同步服务");
      } else {
        showToast("⚠️ 未发现同步服务，请确认电脑端已启动平台且在同一 Wi-Fi");
      }
    };

    box.querySelector("#btnSyncTunnel").onclick = async (e) => {
      const btn = e.currentTarget;
      const msg = box.querySelector("#syncTunnelMsg");
      btn.disabled = true;
      btn.textContent = "⏳ 正在建立隧道…";
      msg.textContent = "正在启动 cloudflared 公网隧道（约需 10-30 秒）…";
      let url = "";
      let err = "";
      try {
        const r = await fetch("/api/tunnel/start", { method: "POST" });
        const d = await r.json();
        if (d && d.url) {
          url = d.url;
        } else if (d && d.error) {
          err = d.error;
        }
        // 隧道是异步建立的，轮询等它拿到 trycloudflare 地址
        for (let i = 0; !url && !err && i < 20; i++) {
          await new Promise((res) => setTimeout(res, 2000));
          try {
            const sr = await fetch("/api/tunnel/status");
            const s = await sr.json();
            if (s.url) url = s.url;
            else if (s.error || (!s.running && i > 2)) err = s.error || "隧道进程已退出";
          } catch (_e2) {}
        }
      } catch (_e) {
        err = "当前不是电脑端服务，或 cloudflared 未安装";
      }

      if (url) {
        box.querySelector("#inpSyncServer").value = url;
        syncCfg.publicUrl = url;
        msg.innerHTML = `公网隧道已就绪：<b>${UTILS.escapeHtml(url)}</b>（已自动填入上方地址，点「保存并同步」生效）`;
        showToast("🌐 公网隧道已开启");
      } else {
        msg.textContent = (err || "隧道启动失败") + " —— 局域网同步仍然可用；也可直接手动填写电脑内网地址。";
        showToast("⚠️ 公网隧道未能建立，可稍后重试");
      }
      btn.disabled = false;
      btn.textContent = "🌐 重启公网隧道";
    };

    box.querySelector("#btnSyncCopyUrl").onclick = () => {
      const u = box.querySelector("#inpSyncServer").value.trim() || location.origin;
      const tk = box.querySelector("#inpSyncToken").value.trim();
      const link = u.replace(/\/+$/, "") + "/?token=" + encodeURIComponent(tk);
      navigator.clipboard.writeText(link).then(() => showToast("📋 已复制，发到手机浏览器打开即可"));
    };

    box.querySelector("#btnSyncNowBtn").onclick = async () => {
      syncCfg.serverUrl = box.querySelector("#inpSyncServer").value.trim().replace(/\/+$/, "");
      syncCfg.token = box.querySelector("#inpSyncToken").value.trim();
      saveSyncCfg();
      await syncNow(true);
      closeModal();
    };

    box.querySelector("#btnSyncSave").onclick = async () => {
      syncCfg.serverUrl = box.querySelector("#inpSyncServer").value.trim().replace(/\/+$/, "");
      syncCfg.token = box.querySelector("#inpSyncToken").value.trim();
      saveSyncCfg();
      closeModal();
      await syncNow(true);
    };
  }

  // =====================================================================
  // 弹窗：手机端下载与安装中心（支持苹果 iOS & 安卓 Android）
  // =====================================================================
  async function openMobileConnectModal() {
    const mask = document.getElementById("modalMask");
    const box = document.getElementById("modalBox");

    const ua = navigator.userAgent || "";
    const isIOS = /iPhone|iPad|iPod/i.test(ua);
    const isAndroid = /Android/i.test(ua);
    const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
    let activeOsTab = isIOS ? "ios" : "android";

    let devInfo = { primaryUrl: window.location.origin, publicUrl: null, token: "" };
    try {
      const resp = await fetch("/api/device-info");
      if (resp.ok) devInfo = await resp.json();
    } catch (_e) {}

    const baseUrl = devInfo.publicUrl || devInfo.primaryUrl || window.location.origin;
    const tk = devInfo.token || syncCfg.token || "";
    const shareUrl = baseUrl.replace(/\/+$/, "") + "/" + (tk ? "?token=" + encodeURIComponent(tk) : "");

    function renderDownloadModal() {
      box.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
          <h3 style="font-size:18px;">📲 手机端下载与安装（iOS / Android）</h3>
          <button class="btn btn-sm btn-ghost" id="btnCloseModal">✕</button>
        </div>

        ${isStandalone ? `
          <div class="insight-box" style="margin-bottom:12px;border-left-color:var(--success);background:var(--success-soft);">
            ✅ <strong>当前已以独立 App 全屏模式运行！</strong>全部 100 题四语言解析已缓存，离线也能流畅使用。
          </div>
        ` : ""}

        <div class="lang-tabs" style="margin-bottom:14px;display:flex;width:100%;">
          <button class="lang-tab ${activeOsTab === "android" ? "active" : ""}" data-ostab="android" style="flex:1;">
            🤖 安卓 Android ${isAndroid ? "(当前设备)" : ""}
          </button>
          <button class="lang-tab ${activeOsTab === "ios" ? "active" : ""}" data-ostab="ios" style="flex:1;">
            🍎 苹果 iOS ${isIOS ? "(当前设备)" : ""}
          </button>
        </div>

        ${activeOsTab === "android" ? `
          <div style="background:var(--bg-elevated);padding:16px;border-radius:var(--radius-lg);margin-bottom:14px;border:1px solid var(--border);">
            <div style="font-weight:700;font-size:15px;color:var(--primary);margin-bottom:8px;">🤖 Android 手机安装（支持小米澎湃 / 鸿蒙 / OPPO / vivo / 三星等）</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
              <button class="btn btn-primary" id="btnTriggerAndroidInstall" style="flex:1;min-width:170px;">
                ${deferredPwaPrompt ? "⬇️ 一键安装安卓 App 到桌面" : "📲 添加安卓全屏 App 到桌面"}
              </button>
              <a class="btn" href="/api/download-offline?os=android" download="AlgoForge_Hot100_Android.html" id="btnDlAndroidOffline" style="flex:1;min-width:170px;text-align:center;">
                📦 下载安卓离线单文件版 (.html)
              </a>
            </div>
            <ol style="padding-left:18px;font-size:13px;color:var(--text-sec);line-height:1.75;">
              <li><strong>方式一（在线全屏 App，支持多端同步）</strong>：在安卓手机浏览器（Edge / Chrome / 系统自带浏览器）打开本网页，点击上方按钮或浏览器菜单中的 <strong>「安装应用 / 添加到主屏幕」</strong>，桌面即生成独立图标，无地址栏全屏运行且自动离线缓存；</li>
              <li><strong>方式二（纯离线单文件版）</strong>：点击上方 <strong>「下载安卓离线单文件版」</strong>，将得到的单个 HTML 文件保存到手机，断网也能直接打开查看全部 100 题四语言解析与打卡。</li>
            </ol>
          </div>
        ` : `
          <div style="background:var(--bg-elevated);padding:16px;border-radius:var(--radius-lg);margin-bottom:14px;border:1px solid var(--border);">
            <div style="font-weight:700;font-size:15px;color:var(--primary);margin-bottom:8px;">🍎 苹果 iOS 安装（iPhone / iPad · Safari 原生全屏 App）</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
              <button class="btn btn-primary" id="btnCopyIosLink" style="flex:1;min-width:170px;">
                🔗 复制本页链接（去 Safari 打开）
              </button>
              <a class="btn" href="/api/download-offline?os=ios" download="AlgoForge_Hot100_iOS.html" id="btnDlIosOffline" style="flex:1;min-width:170px;text-align:center;">
                📦 下载 iOS 离线单文件版 (.html)
              </a>
            </div>
            <ol style="padding-left:18px;font-size:13px;color:var(--text-sec);line-height:1.8;">
              <li>使用 iPhone / iPad 自带的 <strong>Safari 浏览器</strong> 打开本网页（微信内请先点右上角选择「在默认浏览器中打开」）；</li>
              <li>点击 Safari 底部中间的 <strong>「分享 ⬆️」</strong> 按钮；</li>
              <li>向下滑动菜单，点击 <strong>「添加到主屏幕 ➕」</strong> → 右上角点击 <strong>「添加」</strong>，即可在苹果桌面生成独立 App 图标，全屏沉浸刷题且支持离线使用！</li>
            </ol>
          </div>
        `}

        <div style="background:var(--bg-code);padding:10px 12px;border-radius:var(--radius-md);margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
          <div style="font-size:12px;color:var(--text-sec);min-width:0;flex:1;word-break:break-all;">
            <span>手机端访问地址：</span>
            <code style="color:var(--text-main);font-family:var(--font-mono);">${UTILS.escapeHtml(shareUrl)}</code>
          </div>
          <button class="btn btn-sm" id="btnCopyShareUrl">复制链接</button>
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;padding-top:10px;border-top:1px solid var(--border);">
          <span style="font-size:12.5px;color:var(--text-sec);">学习进度备份与迁移：</span>
          <div style="display:flex;gap:8px;">
            <button class="btn btn-sm" id="btnExportJson">📤 导出打卡备份</button>
            <label class="btn btn-sm" style="cursor:pointer;">
              📥 导入恢复备份
              <input type="file" accept=".json" id="inpImportJson" style="display:none;" />
            </label>
          </div>
        </div>
      `;

      box.querySelector("#btnCloseModal").onclick = closeModal;
      box.querySelectorAll("[data-ostab]").forEach((btn) => {
        btn.onclick = () => {
          activeOsTab = btn.dataset.ostab;
          renderDownloadModal();
        };
      });

      const btnAndInstall = box.querySelector("#btnTriggerAndroidInstall");
      if (btnAndInstall) {
        btnAndInstall.onclick = async () => {
          if (deferredPwaPrompt) {
            deferredPwaPrompt.prompt();
            await deferredPwaPrompt.userChoice;
            deferredPwaPrompt = null;
            const topBtn = document.getElementById("btnInstallPwa");
            if (topBtn) topBtn.style.display = "none";
            renderDownloadModal();
          } else {
            showToast("请点击当前浏览器菜单中的「添加到主屏幕 / 安装应用」即可完成安装！");
          }
        };
      }

      const copyUrlFn = () => {
        navigator.clipboard.writeText(shareUrl).then(() => showToast("📋 已复制手机端访问链接（已自动携带同步口令）！"));
      };
      const btnIosCopy = box.querySelector("#btnCopyIosLink");
      if (btnIosCopy) btnIosCopy.onclick = copyUrlFn;
      box.querySelector("#btnCopyShareUrl").onclick = copyUrlFn;

      box.querySelector("#btnExportJson").onclick = exportProgressJson;
      box.querySelector("#inpImportJson").onchange = importProgressJson;
    }

    renderDownloadModal();
    mask.classList.add("open");
  }

  function exportProgressJson() {
    const blob = new Blob([JSON.stringify(store, null, 2)], { type: "application/json;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `AlgoForge_学习打卡备份_${todayIsoStr()}.json`;
    a.click();
    showToast("📤 学习与打卡备份已导出！");
  }

  function importProgressJson(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = JSON.parse(reader.result);
        if (!imported || !Array.isArray(imported.days)) throw new Error("格式无效");
        store = Object.assign(createDefaultStore(), imported);
        saveStore();
        applyTheme();
        closeModal();
        renderCurrentView();
        showToast("📥 打卡进度与个人计划恢复成功！");
      } catch (err) {
        alert("备份文件解析失败：" + err.message);
      }
    };
    reader.readAsText(file, "utf-8");
  }

  // =====================================================================
  // 15 分钟止损番茄钟逻辑
  // =====================================================================
  function updatePomoUi() {
    const m = String(Math.floor(ui.pomoSeconds / 60)).padStart(2, "0");
    const s = String(ui.pomoSeconds % 60).padStart(2, "0");
    const disp = document.getElementById("pomoDisplay");
    const st = document.getElementById("pomoStatusText");
    const btn = document.getElementById("btnPomoToggle");
    if (!disp) return;
    disp.textContent = `${m}:${s}`;
    disp.classList.toggle("urgent", ui.pomoSeconds <= 180);
    st.textContent = ui.pomoRunning ? "专注思考中" : ui.pomoSeconds === 0 ? "时间到！" : "待命";
    btn.textContent = ui.pomoRunning ? "暂停" : "开始计时";
  }

  function initGlobalEvents() {
    // 导航切换
    document.querySelectorAll("#desktopNav .nav-btn, #mobileNav .m-tab").forEach((btn) => {
      btn.addEventListener("click", () => switchView(btn.dataset.view));
    });

    // 主题切换
    const toggleTheme = () => {
      store.theme = store.theme === "dark" ? "light" : "dark";
      applyTheme();
      saveStore();
    };
    document.getElementById("btnThemeSide").addEventListener("click", toggleTheme);
    document.getElementById("btnThemeTop").addEventListener("click", toggleTheme);

    // 跨端连接与备份弹窗
    document.getElementById("btnMobileConnect").addEventListener("click", openMobileConnectModal);
    document.getElementById("btnSyncSettings").addEventListener("click", openSyncSettingsModal);
    const syncPill = document.getElementById("syncStatusPill");
    if (syncPill) syncPill.addEventListener("click", openSyncSettingsModal);
    document.getElementById("btnBackupSide").addEventListener("click", openMobileConnectModal);
    document.getElementById("modalMask").addEventListener("click", (e) => {
      if (e.target.id === "modalMask") closeModal();
    });

    // 番茄钟
    document.getElementById("btnPomoToggle").addEventListener("click", () => {
      if (ui.pomoRunning) {
        clearInterval(ui.pomoTimer);
        ui.pomoRunning = false;
      } else {
        if (ui.pomoSeconds <= 0) ui.pomoSeconds = 15 * 60;
        ui.pomoRunning = true;
        ui.pomoTimer = setInterval(() => {
          ui.pomoSeconds--;
          if (ui.pomoSeconds <= 0) {
            ui.pomoSeconds = 0;
            ui.pomoRunning = false;
            clearInterval(ui.pomoTimer);
            showToast("⏰ 15 分钟到！若仍无思路，请立刻查看『一句话破题』并标记错题！");
          }
          updatePomoUi();
        }, 1000);
      }
      updatePomoUi();
    });

    document.getElementById("btnPomoReset").addEventListener("click", () => {
      clearInterval(ui.pomoTimer);
      ui.pomoRunning = false;
      ui.pomoSeconds = 15 * 60;
      updatePomoUi();
    });

    // PWA 安装提示支持（Windows Edge/Chrome & 小米澎湃浏览器/Chrome）
    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      deferredPwaPrompt = e;
      const installBtn = document.getElementById("btnInstallPwa");
      installBtn.style.display = "inline-flex";
      installBtn.onclick = async () => {
        if (!deferredPwaPrompt) return;
        deferredPwaPrompt.prompt();
        await deferredPwaPrompt.userChoice;
        deferredPwaPrompt = null;
        installBtn.style.display = "none";
      };
    });

    // 注册 Service Worker 离线支持
    if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    }
  }

  // 启动入口
  applyTheme();
  initGlobalEvents();
  updateTopBadges();
  updatePomoUi();

  // 深链支持：?view=problems&pid=23&wb=1&lang=cpp
  // 方便把某道题直接发给同学，也便于自动化测试
  let startView = "schedule";
  try {
    const q = new URLSearchParams(location.search);
    const pid = Number(q.get("pid") || 0);
    if (pid) {
      ui.selectedProblemId = pid;
      ui.mobileShowDetail = true;
    }
    if (q.get("wb") === "1") ui.whiteboardOpen = true;
    const lg = q.get("lang");
    if (lg && ANALYZER.LANG_LABELS[lg]) ui.activeCodeLang = lg;
    const v = q.get("view");
    if (v && ["schedule", "problems", "analyzer", "huawei"].includes(v)) startView = v;
    else if (pid) startView = "problems";
  } catch (_e) {}

  switchView(startView);
  pullAndSyncWithServer();
})();
