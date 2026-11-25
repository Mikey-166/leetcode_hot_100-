// AlgoForge PWA Service Worker - 全量离线缓存，保障小米澎湃系统手机断网也能流畅刷完全部 100 题与打卡
const CACHE_NAME = "algoforge-hot100-v2";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./css/styles.css",
  "./js/data-problems.js",
  "./js/data-schedule-guide.js",
  "./js/data-judge.js",
  "./js/utils-qr-highlight.js",
  "./js/code-analyzer.js",
  "./js/app.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // API 请求走网络优先，失败交由前端优雅降级
  if (url.pathname.startsWith("/api/")) {
    return;
  }
  // 静态资源采用 Network-First 回退 Cache，保证电脑更新题库时同步生效，手机离线时秒读缓存
  event.respondWith(
    fetch(event.request)
      .then((resp) => {
        if (resp && resp.status === 200 && event.request.method === "GET") {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((c) => c.put(event.request, copy));
        }
        return resp;
      })
      .catch(() => caches.match(event.request).then((r) => r || caches.match("./index.html")))
  );
});
