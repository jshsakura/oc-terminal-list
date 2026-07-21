"""시스템 리소스 모니터 — CPU/메모리/디스크/네트워크 + 상위 프로세스.

/proc 를 직접 읽는다(psutil 미의존). 전수 스캔이 비싸서 내부에 짧은 TTL 캐시를 둔다.
main.py 에서 분리 — 라우트가 아니라 순수 수집기라 독립 모듈이 맞다.
"""
from __future__ import annotations

import logging
import os
import time

from _deps import WORKSPACE_ROOT

logger = logging.getLogger(__name__)


class SystemMonitor:
    # /proc 전수 스캔은 매번 비싸므로(800+ PID × 5파일 read) get_stats() 사이에 캐시.
    # CPU% 델타 계산에는 충분한 간격이 필요하므로 너무 짧으면 의미 없음 — 1.5s 가 절충.
    PROC_SCAN_CACHE_TTL = 1.5
    # RSS 가 이보다 작으면 잡벌레로 보고 cmdline/status/stat 읽기 전 컷.
    PROC_RSS_MIN_BYTES = 4 * 1024 * 1024  # 4 MB

    def __init__(self):
        self.last_cpu_time = 0
        self.last_idle_time = 0
        self.last_update = 0
        self.cached_cpu_percent = 0.0
        self.last_net_time = 0.0
        self.last_net_rx = 0
        self.last_net_tx = 0
        self.cached_net_rx_rate = 0.0
        self.cached_net_tx_rate = 0.0
        # pid → utime+stime ticks. get_stats() 호출 간 델타로 process CPU% 계산.
        self.last_proc_cpu: dict = {}
        self.last_proc_total_ticks = 0
        # process 스캔 캐시 — 짧은 시간 안에 여러 번 호출돼도 한 번만 한다.
        self.cached_top_processes: list = []
        self.last_proc_scan = 0.0
        # /proc/stat baseline priming — 첫 get_stats() 호출에서 cached_cpu_percent 가 0.0
        # 으로 보이지 않게, 모듈 import 시점에 한 번 sample 을 찍어 last_cpu_time/idle 을
        # 채워둔다. 첫 API 호출은 보통 import 후 수 초 이상 뒤이므로 그 사이 diff 로
        # 의미있는 값이 계산된다. Info 패널 "CPU 항상 바닥" 증상 방어.
        self._prime_cpu_sample()
        # 프로세스 CPU% baseline 도 동일하게 prime — 첫 scan 의 prev_ticks 가 self == current
        # 이라 모든 process cpu_percent 가 0 으로 떨어지는 문제를 import-time 한 번에 해결.
        self._prime_proc_cpu_sample()

    def _prime_cpu_sample(self):
        try:
            if not os.path.exists("/proc/stat"):
                return
            with open("/proc/stat") as f:
                parts = f.readline().split()
            if len(parts) >= 5:
                user = int(parts[1])
                nice = int(parts[2])
                system = int(parts[3])
                idle = int(parts[4])
                iowait = int(parts[5]) if len(parts) > 5 else 0
                irq = int(parts[6]) if len(parts) > 6 else 0
                softirq = int(parts[7]) if len(parts) > 7 else 0
                self.last_cpu_time = user + nice + system + idle + iowait + irq + softirq
                self.last_idle_time = idle
                self.last_update = time.time()
        except (OSError, ValueError):
            pass

    def _prime_proc_cpu_sample(self):
        """모든 pid 의 utime+stime 을 한 번 읽어 last_proc_cpu / last_proc_total_ticks 를 채운다.

        첫 _scan_top_processes() 호출에서 prev_ticks 가 self == current 로 떨어져 cpu_percent
        가 전부 0 으로 보이는 문제 방지. import 시점 한 번이라 비용은 OK (수백 pid × 1 file).
        """
        try:
            # /proc/stat 총 ticks baseline
            with open("/proc/stat") as f:
                parts = f.readline().split()
            if len(parts) >= 8:
                self.last_proc_total_ticks = sum(int(x) for x in parts[1:8])
        except (OSError, ValueError):
            pass
        try:
            for entry in os.scandir("/proc"):
                if not entry.name.isdigit():
                    continue
                pid = int(entry.name)
                try:
                    with open(os.path.join(entry.path, "stat")) as f:
                        raw = f.read()
                    rparen = raw.rfind(")")
                    if rparen == -1:
                        continue
                    tail = raw[rparen + 2:].split()
                    if len(tail) >= 13:
                        self.last_proc_cpu[pid] = int(tail[11]) + int(tail[12])
                except (OSError, ValueError):
                    continue
        except OSError:
            pass

    def get_stats(self):
        # 백워드 호환 — 기존 'cpu/ram/disk' 퍼센트는 그대로 두고 절대값/load/uptime 을 추가.
        stats: dict = {"cpu": 0.0, "ram": 0.0, "disk": 0.0}
        try:
            if os.path.exists("/proc/meminfo"):
                meminfo = {}
                with open("/proc/meminfo") as f:
                    for line in f:
                        parts = line.split()
                        if len(parts) >= 2:
                            meminfo[parts[0].rstrip(":")] = int(parts[1])
                total = meminfo.get("MemTotal", 0)
                available = meminfo.get("MemAvailable", 0)
                if total > 0:
                    mem_free = meminfo.get("MemFree", 0)
                    buffers = meminfo.get("Buffers", 0)
                    cached = max(0, meminfo.get("Cached", 0) + meminfo.get("SReclaimable", 0) - meminfo.get("Shmem", 0))
                    swap_total = meminfo.get("SwapTotal", 0)
                    swap_free = meminfo.get("SwapFree", 0)
                    swap_used = max(0, swap_total - swap_free)
                    stats["ram"] = round((total - available) / total * 100, 1)
                    stats["mem_total"] = total * 1024            # bytes
                    stats["mem_used"] = (total - available) * 1024
                    stats["mem_available"] = available * 1024
                    stats["mem_free"] = mem_free * 1024
                    stats["mem_buffers"] = buffers * 1024
                    stats["mem_cache"] = cached * 1024
                    stats["swap_total"] = swap_total * 1024
                    stats["swap_used"] = swap_used * 1024
                    stats["swap_free"] = swap_free * 1024
                    stats["swap"] = round(swap_used / swap_total * 100, 1) if swap_total > 0 else 0.0

            try:
                usage = os.statvfs(WORKSPACE_ROOT)
                d_total = usage.f_blocks * usage.f_frsize
                d_free = usage.f_bfree * usage.f_frsize
                if d_total > 0:
                    stats["disk"] = round((d_total - d_free) / d_total * 100, 1)
                    stats["disk_total"] = d_total
                    stats["disk_used"] = d_total - d_free
                    stats["disk_free"] = d_free
                    stats["disk_path"] = str(WORKSPACE_ROOT)
            except Exception:
                pass

            now = time.time()
            if os.path.exists("/proc/stat") and now - self.last_update > 1.0:
                with open("/proc/stat") as f:
                    parts = f.readline().split()
                if len(parts) >= 5:
                    user = int(parts[1])
                    nice = int(parts[2])
                    system = int(parts[3])
                    idle = int(parts[4])
                    iowait = int(parts[5]) if len(parts) > 5 else 0
                    irq = int(parts[6]) if len(parts) > 6 else 0
                    softirq = int(parts[7]) if len(parts) > 7 else 0
                    total_cpu = user + nice + system + idle + iowait + irq + softirq
                    if self.last_cpu_time > 0:
                        diff_total = total_cpu - self.last_cpu_time
                        diff_idle = idle - self.last_idle_time
                        if diff_total > 0:
                            self.cached_cpu_percent = round((1 - diff_idle / diff_total) * 100, 1)
                    self.last_cpu_time = total_cpu
                    self.last_idle_time = idle
                    self.last_update = now

            stats["cpu"] = self.cached_cpu_percent

            # 부가 정보 — UI 패널이 풍부하게 보여줄 수 있게.
            try:
                stats["cpu_count"] = os.cpu_count() or 1
            except Exception:
                pass

            try:
                with open("/proc/cpuinfo") as f:
                    for line in f:
                        if line.startswith("model name"):
                            stats["cpu_model"] = line.split(":", 1)[1].strip()
                            break
            except Exception:
                pass

            try:
                net_rx = net_tx = 0
                interfaces = []
                with open("/proc/net/dev") as f:
                    for line in f.readlines()[2:]:
                        if ":" not in line:
                            continue
                        name, data = line.split(":", 1)
                        iface = name.strip()
                        if iface == "lo":
                            continue
                        fields = data.split()
                        if len(fields) < 16:
                            continue
                        rx = int(fields[0])
                        tx = int(fields[8])
                        if rx == 0 and tx == 0:
                            continue
                        net_rx += rx
                        net_tx += tx
                        interfaces.append({"name": iface, "rx_bytes": rx, "tx_bytes": tx})
                elapsed = now - self.last_net_time if self.last_net_time else 0
                if elapsed >= 0.5 and self.last_net_time:
                    self.cached_net_rx_rate = max(0.0, (net_rx - self.last_net_rx) / elapsed)
                    self.cached_net_tx_rate = max(0.0, (net_tx - self.last_net_tx) / elapsed)
                if elapsed >= 0.5 or not self.last_net_time:
                    self.last_net_time = now
                    self.last_net_rx = net_rx
                    self.last_net_tx = net_tx
                stats["net_rx_bytes"] = net_rx
                stats["net_tx_bytes"] = net_tx
                stats["net_rx_rate"] = round(self.cached_net_rx_rate, 1)
                stats["net_tx_rate"] = round(self.cached_net_tx_rate, 1)
                stats["net_interfaces"] = sorted(interfaces, key=lambda item: item["rx_bytes"] + item["tx_bytes"], reverse=True)[:4]
            except Exception:
                pass

            # process 스캔은 비용이 크므로 캐시. TTL 안에서는 직전 결과 재사용.
            if now - self.last_proc_scan >= self.PROC_SCAN_CACHE_TTL:
                try:
                    self.cached_top_processes = self._scan_top_processes()
                    self.last_proc_scan = now
                except Exception as e:
                    logger.debug("process scan failed: %s", e)
            stats["top_processes"] = self.cached_top_processes

            try:
                # /proc/loadavg → "1m 5m 15m running/total lastpid"
                with open("/proc/loadavg") as f:
                    la = f.read().split()[:3]
                stats["load_avg"] = [float(x) for x in la]
            except Exception:
                pass

            try:
                with open("/proc/uptime") as f:
                    stats["uptime"] = float(f.read().split()[0])
            except Exception:
                pass

            try:
                with open("/proc/sys/kernel/hostname") as f:
                    stats["hostname"] = f.read().strip()
            except Exception:
                pass
        except Exception as e:
            logger.error("system stats error: %s", e)
        return stats

    def _scan_top_processes(self) -> list:
        """/proc 전수 스캔 — RSS 컷오프로 잡벌레 제거 후 상위 10개만 디테일 수집.

        호출자(get_stats)가 캐시한다. CPU% 는 마지막 스캔 이후 누적 ticks 델타로 계산.
        """
        page_size = os.sysconf("SC_PAGE_SIZE")
        cpu_count = os.cpu_count() or 1
        rss_min = self.PROC_RSS_MIN_BYTES

        # /proc/stat 총 jiffies 델타 (CPU% denominator)
        total_ticks_now = 0
        try:
            with open("/proc/stat") as f:
                parts = f.readline().split()
            if len(parts) >= 8:
                total_ticks_now = sum(int(x) for x in parts[1:8])
        except Exception:
            pass
        total_delta = max(0, total_ticks_now - (self.last_proc_total_ticks or total_ticks_now))
        self.last_proc_total_ticks = total_ticks_now

        # Phase 1: 가벼운 statm 만 읽어 RSS 컷오프 통과한 후보만 추림.
        candidates: list[tuple[int, str, int]] = []
        try:
            for entry in os.scandir("/proc"):
                if not entry.name.isdigit():
                    continue
                pid = int(entry.name)
                try:
                    with open(os.path.join(entry.path, "statm")) as f:
                        statm = f.read().split()
                    rss = int(statm[1]) * page_size if len(statm) > 1 else 0
                    if rss < rss_min:
                        continue
                    candidates.append((pid, entry.path, rss))
                except Exception:
                    continue
        except Exception:
            return self.cached_top_processes

        # RSS 기준 정렬 후 상위 N×3 만 디테일 수집(클립 후에도 충분한 여유).
        candidates.sort(key=lambda item: item[2], reverse=True)
        candidates = candidates[:30]

        llm_markers = (
            "ollama", "llama", "llamacpp", "vllm", "transformers",
            "torch", "cuda", "codex", "openai", "anthropic",
        )
        me_uid = os.getuid()
        try:
            import pwd as _pwd
        except ImportError:
            _pwd = None

        processes: list[dict] = []
        next_proc_cpu: dict = {}
        for pid, proc_dir, rss in candidates:
            try:
                with open(os.path.join(proc_dir, "comm")) as f:
                    name = f.read().strip()
                cmd = ""
                try:
                    with open(os.path.join(proc_dir, "cmdline"), "rb") as f:
                        cmd = f.read().replace(b"\x00", b" ").decode("utf-8", "ignore").strip()
                except Exception:
                    pass
                uid = None
                try:
                    with open(os.path.join(proc_dir, "status")) as f:
                        for line in f:
                            if line.startswith("Uid:"):
                                uid = int(line.split()[1])
                                break
                except Exception:
                    pass
                # /proc/<pid>/stat 의 utime(14) + stime(15). comm 에 공백/괄호 안전하게 ')' 기준 분할.
                proc_ticks = 0
                try:
                    with open(os.path.join(proc_dir, "stat")) as f:
                        raw = f.read()
                    rparen = raw.rfind(")")
                    if rparen != -1:
                        tail = raw[rparen + 2:].split()
                        if len(tail) >= 13:
                            proc_ticks = int(tail[11]) + int(tail[12])
                except Exception:
                    pass
                prev_ticks = self.last_proc_cpu.get(pid, proc_ticks)
                next_proc_cpu[pid] = proc_ticks
                cpu_percent = 0.0
                if total_delta > 0 and proc_ticks >= prev_ticks:
                    cpu_percent = round((proc_ticks - prev_ticks) / total_delta * 100 * cpu_count, 1)
                label = cmd or name
                lower_label = label.lower()
                owner_name = ""
                if uid is not None:
                    if _pwd is not None:
                        try:
                            owner_name = _pwd.getpwuid(uid).pw_name
                        except KeyError:
                            owner_name = str(uid)
                    else:
                        owner_name = str(uid)
                processes.append({
                    "pid": pid,
                    "name": name,
                    "cmd": label[:180],
                    "rss_bytes": rss,
                    "cpu_percent": cpu_percent,
                    "uid": uid,
                    "user": owner_name,
                    "is_mine": uid == me_uid if uid is not None else False,
                    "llm_like": any(marker in lower_label for marker in llm_markers),
                })
            except Exception:
                continue

        self.last_proc_cpu = next_proc_cpu
        processes.sort(key=lambda item: item["rss_bytes"], reverse=True)
        return processes[:10]


system_monitor = SystemMonitor()
