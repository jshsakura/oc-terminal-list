/** Info 패널 수치 표기 — 바이트/전송률/가동시간. 순수 함수. */

const formatBytes = (n) => {
  if (n == null || isNaN(n)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = Number(n);
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
};

const formatRate = (n) => `${formatBytes(n)}/s`;

const formatUptime = (s, t) => {
  if (s == null) return '—';
  const sec = Math.floor(s);
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const label = (key, fallback) => {
    const value = t?.(key);
    return value && value !== key ? value : fallback;
  };
  const day = label('uptimeDayUnit', 'd');
  const hour = label('uptimeHourUnit', 'h');
  const minute = label('uptimeMinuteUnit', 'm');
  if (d > 0) return `${d}${day} ${h}${hour}`;
  if (h > 0) return `${h}${hour} ${m}${minute}`;
  return `${m}${minute}`;
};

export { formatBytes, formatRate, formatUptime };
