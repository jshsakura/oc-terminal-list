// iTerminaLlist Service Worker — 모바일 콜드 로드 최소화.
// 정적 자원(app shell, hashed assets, 폰트)만 캐싱.
// API/WS/auth는 절대 캐시하지 않는다 (network-only).
//
// 캐시 정책:
//   - navigate(HTML)         → network-first, 폴백 캐시→ /index.html
//   - /assets/* (hashed)     → stale-while-revalidate (immutable 안전)
//   - /fonts/*, /favicon.svg → cache-first
//   - 그 외 same-origin GET  → stale-while-revalidate
//   - /api/* /ws/* cross-origin, non-GET → 통과(네트워크만)
//
// 버전이 바뀌면 activate 단계에서 구 캐시를 모두 지우고 skipWaiting+claim 한다.
//
// CACHE_VERSION 은 손으로 관리하지 않는다 — 빌드 때 vite.config.js 의 stampServiceWorker
// 플러그인이 assets/ 파일명 해시로 덮어쓴다. 아래 "dev" 는 개발 서버용 자리표시자다.
// (손으로 두면 배포해도 이 파일 바이트가 그대로라 브라우저가 SW 업데이트를 감지하지 못하고,
//  옛 캐시가 영원히 남아 지워진 청크를 물고 있다가 페이지가 스스로 리로드된다.)

const CACHE_VERSION = "dev";
const CACHE_NAME = `iterminallist-shell-${CACHE_VERSION}`;
const PRECACHE = ["/", "/index.html", "/favicon.svg"];

const NEVER_CACHE = (url) => {
  const p = url.pathname;
  // API, WebSocket, 인증 경로는 절대 캐시하지 않는다.
  if (p.startsWith("/api/") || p.startsWith("/ws/")) return true;
  if (p.startsWith("/auth") || p === "/login") return true;
  return false;
};

self.addEventListener("install", (event) => {
  // 실패해도 치명적이지 않게 — thenable 안에서만 스킵.
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(CACHE_NAME);
        await cache.addAll(PRECACHE).catch(() => {});
      } catch (_) {}
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // 이전 버전 캐시 전부 삭제 (CACHE_NAME 외).
      try {
        const keys = await caches.keys();
        await Promise.all(
          keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
        );
      } catch (_) {}
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // non-GET은 그냥 통과

  let url;
  try {
    url = new URL(req.url);
  } catch (_) {
    return;
  }
  if (url.origin !== self.location.origin) return; // cross-origin 통과
  if (NEVER_CACHE(url)) return; // API/WS/auth 통과

  // 1) HTML navigation — network-first (업데이트 즉시 반영)
  if (req.mode === "navigate") {
    event.respondWith(networkFirstHTML(req));
    return;
  }

  const p = url.pathname;

  // 2) hashed assets — stale-while-revalidate (immutable 안전)
  if (p.startsWith("/assets/")) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  // 3) 폰트 / favicon — cache-first
  if (p.startsWith("/fonts/") || p === "/favicon.svg") {
    event.respondWith(cacheFirst(req));
    return;
  }

  // 4) 그 외 same-origin GET — stale-while-revalidate
  event.respondWith(staleWhileRevalidate(req));
});

async function networkFirstHTML(req) {
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) {
      try {
        const cache = await caches.open(CACHE_NAME);
        cache.put("/", fresh.clone()).catch(() => {});
        cache.put("/index.html", fresh.clone()).catch(() => {});
      } catch (_) {}
    }
    return fresh;
  } catch (_) {
    let cached = await caches.match(req, { ignoreSearch: true });
    if (cached) return cached;
    cached = await caches.match("/");
    if (cached) return cached;
    cached = await caches.match("/index.html");
    if (cached) return cached;
    return Response.error();
  }
}

async function cacheFirst(req) {
  try {
    const cached = await caches.match(req);
    if (cached) return cached;
  } catch (_) {}
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok && fresh.type === "basic") {
      try {
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, fresh.clone()).catch(() => {});
      } catch (_) {}
    }
    return fresh;
  } catch (_) {
    return Response.error();
  }
}

async function staleWhileRevalidate(req) {
  let cached;
  try {
    cached = await caches.match(req);
  } catch (_) {}
  const network = fetch(req)
    .then((fresh) => {
      if (fresh && fresh.ok && fresh.type === "basic") {
        try {
          caches.open(CACHE_NAME).then((cache) =>
            cache.put(req, fresh.clone()).catch(() => {})
          );
        } catch (_) {}
      }
      return fresh;
    })
    .catch(() => null);

  if (cached) {
    // 백그라운드 revalidate는 계속 진행; 우선 캐시 반환.
    eventFallbackRevalidate(network);
    return cached;
  }
  const fresh = await network;
  if (fresh) return fresh;
  return Response.error();
}

// SWR에서 캐시 히트 시 network promise는 본문을 소비하지 않고 두면
// 브라우저가 가비지로 처리하도록 둔다 (여기선 put 에서 clone 소비됨).
function eventFallbackRevalidate(_networkPromise) {
  // no-op: put 단계에서 이미 revalidate 됨.
}

// ─────────────────────────────────────────────────────────────
// 웹 푸시 — 에이전트가 한 턴을 끝냈을 때 기기로 알린다.
//
// 서버는 "보낼지"만 정하고 "보여줄지"는 여기서 정한다. 서버는 사용자가 지금 어느
// pane 을 보고 있는지 알 수 없기 때문이다. 이미 그 화면을 보고 있는데 폰이 울리면
// 그건 소음이고, 사용자는 알림을 꺼버린다.
// ─────────────────────────────────────────────────────────────

/** 포커스된 창이 하나라도 열려 있으면 사용자는 지금 앱을 보고 있는 것이다. */
