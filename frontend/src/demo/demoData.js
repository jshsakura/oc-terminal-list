/**
 * Live-demo fixtures — 100% synthetic. No real hostnames, IPs, usernames, or
 * output captured from any real machine. Safe to publish on a public static
 * site (GitHub Pages) alongside the real repo.
 *
 * Shape mirrors the real app's tab/host model (utils/tabModel.js) closely
 * enough that TabBar/Tab render exactly as they do in production — this
 * demo is a faithful preview, not a mockup drawn from scratch.
 */

export const DEMO_HOSTS = [
  { id: 'demo-web', name: 'web-app-01', icon: 'Server', color_index: 4 },
  { id: 'demo-db', name: 'cache-redis-01', icon: 'Database', color_index: 2 },
  { id: 'demo-edge', name: 'edge-node-pi', icon: 'Cpu', color_index: 36 },
];

export const DEMO_TABS = [
  {
    id: 'tab-local', type: 'local', name: 'workspace',
    icon: 'TerminalSquare', color_index: 24, scriptId: 'local',
  },
  {
    id: 'tab-web', type: 'host', hostId: 'demo-web', name: 'web-app-01',
    icon: 'Server', color_index: 4, scriptId: 'web',
  },
  {
    id: 'tab-db', type: 'host', hostId: 'demo-db', name: 'cache-redis-01',
    icon: 'Database', color_index: 2, scriptId: 'db',
  },
  {
    // 두 호스트를 오가는 탭 — 오늘 추가된 "혼합 호스트 아이콘 스택" 기능을 데모에서도 보여준다.
    id: 'tab-mixed', type: 'host', hostId: 'demo-edge', name: 'edge-node-pi',
    icon: 'Cpu', color_index: 36, scriptId: 'mixed',
    secondaryIdentities: [
      { kind: 'host', name: 'web-app-01', icon: 'Server', colorIndex: 4 },
    ],
  },
];

// 각 커맨드: 프롬프트에 타이핑 재생 후 output 라인을 순차 출력.
// ANSI 색코드는 xterm 이 그대로 렌더 — 실제 셸 출력과 동일한 느낌.
export const DEMO_SCRIPTS = {
  local: {
    prompt: '\x1b[1;32mdemo@workspace\x1b[0m:\x1b[1;34m~/app\x1b[0m$ ',
    commands: [
      {
        cmd: 'git status',
        output: [
          'On branch main',
          "Your branch is up to date with 'origin/main'.",
          '',
          'nothing to commit, working tree clean',
        ],
      },
      {
        cmd: 'npm test',
        output: [
          '\x1b[42m\x1b[30m PASS \x1b[0m src/utils/tabModel.test.js',
          '\x1b[42m\x1b[30m PASS \x1b[0m src/components/TabBar.test.jsx',
          '',
          'Test Suites: 2 passed, 2 total',
          'Tests:       17 passed, 17 total',
          '\x1b[1;32mAll tests passed\x1b[0m',
        ],
      },
      {
        cmd: 'npm run build',
        output: [
          'vite v6 building for production...',
          '\x1b[32m✓\x1b[0m 412 modules transformed.',
          'dist/assets/index-DhY2kQ.js   391.05 kB │ gzip: 118.42 kB',
          '\x1b[1;32m✓ built in 2.14s\x1b[0m',
        ],
      },
    ],
  },
  web: {
    prompt: '\x1b[1;32mdemo@web-app-01\x1b[0m:\x1b[1;34m~\x1b[0m$ ',
    commands: [
      {
        cmd: 'git pull',
        output: ['Already up to date.'],
      },
      {
        cmd: 'docker ps',
        output: [
          'CONTAINER ID   IMAGE                     STATUS         PORTS                    NAMES',
          'a1b2c3d4e5f6   ghcr.io/demo/web:latest   Up 3 hours     0.0.0.0:8080->8080/tcp   web-app-01',
          'f6e5d4c3b2a1   redis:alpine              Up 3 hours     6379/tcp                 cache-redis-01',
        ],
      },
      {
        cmd: './deploy.sh',
        output: [
          '\x1b[36m[deploy]\x1b[0m Building frontend...',
          '\x1b[36m[deploy]\x1b[0m Restarting service...',
          '\x1b[1;32m[deploy] done — service active\x1b[0m',
        ],
      },
    ],
  },
  db: {
    prompt: '\x1b[1;32mdemo@cache-redis-01\x1b[0m:\x1b[1;34m~\x1b[0m$ ',
    commands: [
      {
        cmd: 'redis-cli info clients',
        output: ['connected_clients:3', 'blocked_clients:0'],
      },
      {
        cmd: 'redis-cli monitor',
        output: [
          '1783219500.123421 [0 127.0.0.1:52344] "GET" "session:8f2a1"',
          '1783219500.456210 [0 127.0.0.1:52344] "SET" "session:8f2a1" "..."',
          '1783219501.001233 [0 127.0.0.1:52346] "TTL" "session:8f2a1"',
          '\x1b[90m^C\x1b[0m',
        ],
      },
      {
        cmd: 'uptime',
        output: [' 14:32:07 up 21 days,  4:12,  1 user,  load average: 0.08, 0.05, 0.01'],
      },
    ],
  },
  mixed: {
    prompt: '\x1b[1;32mdemo@edge-node-pi\x1b[0m:\x1b[1;34m~\x1b[0m$ ',
    commands: [
      {
        cmd: 'uname -a',
        output: ['Linux edge-node-pi 6.6.31-v8+ #1 SMP PREEMPT aarch64 GNU/Linux'],
      },
      {
        cmd: 'vcgencmd measure_temp',
        output: ["temp=48.3'C"],
      },
      {
        cmd: 'tmux ls',
        output: ['main: 1 windows (created Sun Jul  5 09:12:00 2026)'],
      },
    ],
  },
};
