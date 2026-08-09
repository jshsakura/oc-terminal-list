# SNES Last Mile — 성능 조사 보고서

**대상:** 게임앤워치(STM32H7B0, Cortex-M7 @ 340MHz) SNES 에뮬레이터
**현황:** 53fps / 목표 60fps (오디오 DMA 상한 60.15fps), 남은 거리 ~12~14%
**방법:** 코드 수정 없음, 조사만. 출처 명시, 추측 금지.

---

## SWD PC 샘플링 분포 (SMW 스크롤 장면)

| 함수 | 점유율 | 비고 |
|------|--------|------|
| `snes_thumb2_step` | 17.0% | 손코딩 Thumb-2 65816 네이티브 엔진 (ITCM) |
| `app_main_snes` | 13.0% | 인라인 스케줄러 + 디스패치 루프 |
| `ppu_runLine` | 11.8% | PPU 스캔라인 렌더 |
| `snes_cpuRead` | 10.5% | 메모리 버스 읽기 |
| `cpu_runOpcode` | 10.0% | 65816 오퍼레이터 디스패치 |
| `PpuDrawBackground_4bpp` | 4.0% | BG 4bpp 타일 그리기 |
| `dsp_cycle` | 7.3% | S-DSP 오디오 |
| `apu_cycle` | 3.5% | SPC700 |

---

## 질문 1: `snes_cpuRead` 10.5% 를 줄인 공개 구현이 있는가?

### 결론: 있다 — snes9x 의 페이지 테이블 디스패치

snes9x 는 모든 메모리 읽기를 **인라인 페이지 테이블 디스패치**로 처리한다. 함수 호출이 아닌 헤더 인라인 함수로, 포인터 테이블 한 번 참조 + 직접 역참조로 끝난다.

#### 핵심 구조

출처: [libretro/snes9x — getset.h (commit 6d1d0ab)](https://github.com/libretro/snes9x/blob/6d1d0ab121875d10622ef599e4e3425308f6cf88/getset.h), [memmap.h (동일 커밋)](https://github.com/libretro/snes9x/blob/6d1d0ab121875d10622ef599e4e3425308f6cf88/memmap.h)

```c
// memmap.h — 페이지 테이블 정의
struct CMemory {
    uint8 *Map[MEMMAP_NUM_BLOCKS];        // 읽기 디스패치 테이블
    uint8 *WriteMap[MEMMAP_NUM_BLOCKS];    // 쓰기 디스패치 테이블
    uint8  BlockIsRAM[MEMMAP_NUM_BLOCKS]; // RAM 영역 판정 (속도 가산용)
    uint8  BlockIsROM[MEMMAP_NUM_BLOCKS]; // ROM 영역 판정
    // 열거형 센티넬: MAP_CPU, MAP_PPU, MAP_DSP, MAP_NONE, ..., MAP_LAST
};

// getset.h — 인라인 읽기 (모든 오퍼레이터 핸들러에 인라인 전개됨)
inline uint8 S9xGetByte(uint32 Address) {
    int block = (Address & 0xffffff) >> MEMMAP_SHIFT;
    uint8 *GetAddress = Memory.Map[block];

    // 고속 경로: 직접 메모리 (ROM/WRAM/SRAM) — 분기 없음, 함수 호출 없음
    if (GetAddress >= (uint8 *)CMemory::MAP_LAST) {
        return *(GetAddress + (Address & 0xffff));
    }

    // 저속 경로: MMIO — 센티넬 switch
    switch ((pint)GetAddress) {
        case CMemory::MAP_CPU: return S9xGetCPU(Address & 0xffff);
        case CMemory::MAP_PPU: return S9xGetPPU(Address & 0xffff);
        case CMemory::MAP_DSP: return S9xGetDSP(Address & 0xffff);
        // ...
        default: return OpenBus;
    }
}
```

**작동 원리:**
- `MEMMAP_SHIFT` 만큼 우측 시프트 → 블록 인덱스 (통상 32KB~64KB 블록, ~256~512 엔트리)
- `Map[block]` 은 **실제 메모리 포인터** (ROM/WRAM/SRAM → 직접 역참조) 또는 **센티널 값** (MAP_CPU/MAP_PPU 등 → 핸들러 호출)
- ROM/WRAM/SRAM 읽기 = **포인터 1회 로드 + 역참조 1회**, 분기/호출 없음
- MMIO 읽기만 switch-case 핸들러 호출

#### 우리 구조와의 차이

| | 우리 구조 | snes9x |
|---|---|---|
| ROM 읽기 | 인라인 페이지 캐시 (8KB tag) | 인라인 페이지 테이블 직접 역참조 |
| WRAM 읽기 | 함수 호출 (`snes_cpuRead` → 분기) | 인라인 직접 역참조 (Map[] 포인터) |
| SRAM 읽기 | 함수 호출 | 인라인 직접 역참조 |
| MMIO 읽기 | 함수 호출 + 내부 분기 | 인라인 + switch (동일 구조) |
| 디스패치 위치 | C 함수 1개 | 헤더 인라인 (모든 opcode 핸들러에 전개) |

우리는 ROM 만 인라인이고 나머지는 전부 함수 호출이다. snes9x 는 **모든 직접 메모리(ROM+WRAM+SRAM)가 같은 1줄 패스트 경로**를 탄다.

#### 예상 회수율

- `snes_cpuRead` 10.5% 중 함수 호출 오버헤드(BL + 스택 + RET + 분기 예측 실패) 추정 ~30~40% = 3~4%
- 페이지 테이블 참조로 if-chain → 단일 인덱싱으로 교체: 추가 ~1%
- **총 예상 회수: 3~5%** (단, Thumb-2 어셈블리 엔진에 인라인 전개할 경우)

#### 실현 가능성 — 제약 검토

1. **WRAM 인라인 경로는 이미 +1.6% 순손실로 기각됨.** 이 기법과의 차이: WRAM 인라인 테스트는 WRAM 만 별도 코드를 추가한 반면, 페이지 테이블은 **모든 메모리 타입을 하나의 제네릭 디스패치로 통합**. 코드 크기 증가가 더 작을 수 있음. 하지만 동일한 icache 압력 위험이 있으므로 **반드시 측정이 필요**. 회수율이 손실을 넘는지는 기기 A/B 벤치마크로만 판단 가능.
2. **RAM 비용:** 페이지 테이블 자체는 작음. `Map[256~512]` × 4바이트 = 1~2KB. `BlockIsRAM/BlockIsROM` 포함 ~3~5KB. 724KB 예산에서 수용 가능.
3. **구조 변화:** Thumb-2 어셈블리 CPU 엔진의 모든 메모리 읽기 지점을 페이지 테이블 디스패치로 교체해야 함. 작업량 중간.

#### 임베디드 포트 사례

- **PocketSNES / snes9x2002** ([libretro/snes9x2002](https://github.com/libretro/snes9x2002)): "Heavily optimized for ARM". snes9x 베이스이므로 동일한 페이지 테이블 구조 사용.
- **snes9x 3DS** ([44670/snes9x_3ds](https://github.com/44670/snes9x_3ds)): ARM Cortex-A9 포트. 동일 페이지 테이블 베이스.
- **DrPocketSNES** ([Apaczer/DrPocketSNES](https://github.com/Apaczer/DrPocketSNES)): ARMv5 (MiyooCFW) 포트. snes9x 파생.
- **ARMSNES** ([RetroPie/ARMSNES-libretro](https://github.com/RetroPie/ARMSNES-libretro)): PocketSNES 포크. 동일 구조.

모든 ARM 임베디드 SNES 포트가 snes9x 계열의 페이지 테이블 구조를 공유한다. 이 구조를 **변경한** 포트는 발견되지 않았다.

---

## 질문 2: PPU 라인 렌더 15.8% (ppu_runLine 11.8% + PpuDrawBackground_4bpp 4.0%) 를 낮춘 사례

### 결론: snes9x 의 타일 캐시(dirty-bit) 기법이 스크롤에 유효하나, RAM 예산에서 불가능. 함수 포인터 렌더러 분리는 부분 참고 가능.

#### 2-A. snes9x 타일 캐시 (스크롤 생존)

출처: [ppu.h (commit 2ac236ba)](https://github.com/libretro/snes9x/blob/2ac236ba106d508b65d399f722b5fc29dceea4fe/ppu.h), [gfx.h (동일)](https://github.com/libretro/snes9x/blob/2ac236ba106d508b65d399f722b5fc29dceea4fe/gfx.h), [gfx.cpp (commit 4973d62)](https://github.com/libretro/snes9x/blob/4973d625ba51919726becc48d0cae86ed1f9a478/gfx.cpp)

snes9x 는 **라인이 아닌 타일 단위**로 캐시한다. 핵심 차이:

| | 우리 라인 캐시 | snes9x 타일 캐시 |
|---|---|---|
| 캐시 키 | 화면 Y 좌표 | VRAM 타일 주소 |
| 스크롤 시 | 전부 미스 (화면 위치 변화) | **히트 유지** (타일 데이터 자체는 불변) |
| 무효화 시점 | 매 프레임 | VRAM 쓰기 시만 (`REGISTER_2118/2119`) |

코드 구조 (ppu.h):
```c
// VRAM 쓸 때마다 해당 타일의 dirty bit를 true로
IPPU.TileCached[TILE_4BIT][address >> 5] = FALSE;
IPPU.TileCached[TILE_2BIT][address >> 4] = FALSE;
// 렌더 시 dirty bit가 true면 재디코딩, false면 캐시된 타일 사용
```

**스크롤 중에는 타일 맵 어드레스(어느 타일을 읽을지)만 바뀌고, 타일 픽셀 데이터 자체는 안 바뀌므로 캐시가 생존한다.**

#### RAM 비용 (불가 판정 근거)

- SNES VRAM 64KB, 4bpp 8×8 타입당 32바이트 → 최대 2048개 4bpp 타일
- 디코딩된 타일: 8×8픽셀 × 2바터(RGB565) = 128바이트/타일
- BG 1개당: 2048 × 128 = **256KB**
- Mode 1 (BG 2개 4bpp): **512KB**
- dirty bit 배열: ~8KB
- **총 ~520KB** → 724KB 예산(94~99.8% 사용, 잔여 ~0.1~46KB)에서 **절대 불가**

부분 캐시(단일 BG, 256타일만) = 32KB. 잔여 RAM이 30KB 이상일 때만 가능하나, 그 회수율은 타일 히트율에 따라 1~3%에 그칠 가능성이 높다.

#### 2-B. snes9x 함수 포인터 렌더러 (참고 가능)

출처: [gfx.h (commit 2ac236ba)](https://github.com/libretro/snes9x/blob/2ac236ba106d508b65d399f722b5fc29dceea4fe/gfx.h)

```c
struct SGFX {
    void (*DrawTileMath)(uint32, uint32, uint32, uint32);
    void (*DrawTileNomath)(uint32, uint32, uint32, uint32);
    void (*DrawClippedTileMath)(...);
    void (*DrawClippedTileNomath)(...);
    void (*DrawMosaicPixelMath)(...);
    // ...
};
```

`S9xSelectTileRenderers(PPU.BGMode, sub, isOBJ)` 가 BG 모드/색연산 유무/스프라이트 여부에 따라 최적의 렌더러 함수 포인터를 **라인 렌더 시작 전 1회만** 선택. 이후 라인 내에서는 함수 포인터 직접 호출 (인다이렉션 1회, 조건 분기 없음).

**우리에 대한 시사점:** 현재 `ppu_runLine` 이 if/switch 분기를 매 라인마다 반복한다면, 함수 포인터 테이블을 프레임/모드 변경 시 1회 설정하는 것으로 분기 예측 실패를 줄일 수 있다. RAM 비용 거의 없음. **회수율: 0.5~1.5%** (분기 예측 실패 감소분).

#### 2-C. snes9x2010 NEON 타일 렌더러

출처: [libretro/snes9x2010 README](https://github.com/libretro/snes9x2010)

> "hand-tuned SSE2 (x86) and NEON (ARM) paths with a portable scalar fallback"
> "SSE2/NEON accelerated colour math and tile plotting"

snes9x2010 (구 snes9x-next)은 타일 디코딩과 색연산(color math)에 ARM NEON SIMD 를 사용한다. Cortex-M7 은 **NEON이 없다** (FPv5-D16 하드플로트만). 이 기법은 Cortex-A 전용이며 우리 하드웨어에 직접 적용 불가.

참고: Cortex-M7 의 SIMD 는 **DSP 확장(SIMD within register)**만 있고, NEON(128비트 SIMD)은 없다. 타일 디코딩에 DSP 확장을 쓰는 공개 구현은 발견되지 않았다.

#### 2-D. 스프라이트 우선순위 사전계산

출처: [gfx.h (commit 2ac236ba)](https://github.com/libretro/snes9x/blob/2ac236ba106d508b65d399f722b5fc29dceea4fe/gfx.h)

```c
struct {
    uint8 RTOFlags;
    int16 Tiles;
    struct { int8 Sprite; uint8 Line; } OBJ[128];
} OBJLines[SNES_HEIGHT_EXTENDED];
```

snes9x 는 라인 렌더 전에 `GFX.OBJLines[Y]` 에 각 라인별 가시 스프라이트와 우선순위를 사전계산한다. 라인 렌더 시에는 정렬 없이 순회만. RAM: `224라인 × 128 × 2바이트 = ~57KB` (snes9x 기준). 우리 RAM 예산에서는 스프라이트 수가 적은 장면(SMW 스크롤)에서 회수율이 낮을 것으로 예상.

---

## 질문 3: 놓친 축이 있는가? + STM32H7 60fps 선례

### 결론: SNES 에뮬레이터로 60fps 를 달성한 G&W 사례는 없다. 커뮤니티는 에뮬레이터가 아닌 **정적 재컴파일(static recompilation)** 을 쓴다.

#### 3-A. G&W SNES 커뮤니티 현황

출처:
- [kbeckmann/game-and-watch-retro-go](https://github.com/kbeckmann/game-and-watch-retro-go) — G&W 에뮬레이터 콜렉션 (NES/GB/SMS/PCE 등)
- [sylverb/game-and-watch-retro-go](https://github.com/sylverb/game-and-watch-retro-go) — 활성 포크, SMW 지원 추가
- [marian-m12l/game-and-watch-smw](https://github.com/marian-m12l/game-and-watch-smw) — **SMW 정적 재컴파일 포트**
- [BrianPugh/game-and-watch-patch](https://github.com/BrianPugh/game-and-watch-patch) — G&W CFW
- [sylverb/retro-go-stm32](https://github.com/sylverb/retro-go-stm32) — STM32 에뮬레이션 베이스

**핵심 발견:** G&W (STM32H7B0) 에서 SNES 게임을 돌리는 방법은 두 가지가 있으며, **둘 다 범용 SNES 에뮬레이터가 아니다**:

1. **`marian-m12l/game-and-watch-smw`** — SMW 를 역공학한 C 소스([snesrev/smw](https://github.com/snesrev/smw))를 G&W 에 직접 포팅. SNES 에뮬레이터가 아닌 **게임 자체의 네이티브 재컴파일**. 설정:
   - `LIMIT_30FPS` — **기본값 활성 (30fps)**. 비활성화 시 "unsteady framerate and stuttering" (즉 60fps 불안정)
   - `OVERCLOCK=2` — 최대 오버클럭 (340MHz)
   - **SMW 하나만 동작** (게임 특화)

2. **`sp00nznet/snesrecomp`** ([링크](https://github.com/sp00nznet/snesrecomp)) — LakeSnes 를 "하드웨어 백엔드"로만 쓰고, 게임의 65816 코드를 네이티브 C 로 정적 재컴파일. `bus_read8(bank, addr)` / `bus_write8` 인터페이스로 PPU/APU/DMA 호출. SMK(Super Mario Kart) 등 개별 게임에 적용.

**의미:** 340MHz Cortex-M7 에서 SNES 를 범용 에뮬레이터로 60fps 로 돌린 공개 사례가 없다. G&W 커뮤니티가 선택한 길은 **에뮬레이터 성능을 끌어올리는 것이 아니라 에뮬레이션 자체를 우회**하는 것이다.

#### 3-B. `game-and-watch-retro-go` 가 SNES 에뮬레이터를 포함하지 않는 이유

`game-and-watch-retro-go` 는 NES, GB/GBC, SMS, GG, PCE, ColecoVision, MSX, Atari 7800, Amstrad CPC, Watara Supervision, Tamagotchi P1 등 다수의 에뮬레이터를 포함하지만, **SNES 는 목록에 없다**. SMW 와 Zelda ALttP 만 개별 정적 재컴파일 포트로 지원된다. 이는 STM32H7B0 에서 범용 SNES 에뮬레이션이 실용적이지 않다는 커뮤니티의 암묵적 합의로 읽힌다.

NES 에서도 fceumm 포트가 "65~85% CPU 사용률" (FDS는 95%)이고, `LIMIT_30FPS` 가 있는 것으로 보아, **STM32H7B0 는 SNES 급 콘솔의 범용 에뮬레이션에 근본적으로 마진이 부족한 하드웨어**이다.

#### 3-C. 놓친 축 검토 — 닫힌 목록 대비

사용자가 제시한 닫힌 목록(1~9)을 기준으로, **출처가 확인된 미확인 축**을 나열한다:

| 후보 | 출처 | 우리 제약에서 실현 가능성 | 예상 회수 |
|------|------|--------------------------|----------|
| snes9x 페이지 테이블 디스패치 (Q1) | getset.h 6d1d0ab | icache 압력 위험 (WRAM 인라인 실패 선례). **측정 필요**, 구조적으로는 우월 | 3~5% |
| 함수 포인터 렌더러 분리 (Q2-B) | gfx.h 2ac236ba | RAM 비용 거의 0. 모드별 분기를 함수 포인터 1회 설정으로 교체 | 0.5~1.5% |
| 타일 캐시 dirty bit (Q2-A) | ppu.h 2ac236ba | RAM ~520KB 필요 → **불가**. 부분(단일 BG 32KB)은 잔여 RAM 의존 | 0~3% (조건부) |
| NEON SIMD 타일 디코딩 | snes9x2010 README | Cortex-M7 은 NEON 미탑재. DSP 확장(SWAR) 시도 사례 없음 → **불가** | 해당 없음 |
| 정적 재컴파일 (게임 특화) | marian-m12l/gnw-smw, sp00nznet/snesrecomp | SMW 한정이면 현재 접근과 다른 패러다임. **범용 에뮬레이터 목표와 상충** | 60fps 달성 (SMW 한정) |

#### 3-D. DMA2D / Chrom-ART 활용

STM32H7 의 DMA2D(2D 그래픽 가속기)는 색상 포맷 변환과 영역 복사를 하드웨어로 수행한다. SNES PPU 렌더 최종 단계(프레임버퍼 → 디스플레이)의 픽셀 포맷 변환이나 더블버퍼링 복사에 DMA2D 를 쓸 수 있다.

**단,** 이것은 PPU 렌더 자체(ppu_runLine + PpuDrawBackground_4bpp)의 비용을 줄이지 않는다. 최종 블리트 단계만 오프로드하므로, PPU 렌더가 15.8% 인 우리 프로파일에서 직접적 회수는 작다. 출처: SNES 에뮬레이터에서 DMA2D 사용 사례는 **발견되지 않았다**.

---

## 요약

| 질문 | 답 | 가장 유망한 기법 | 예상 회수 | 판정 |
|------|-----|-----------------|-----------|------|
| cpuRead 10.5% 감소 | 있다 | snes9x 페이지 테이블 디스패치 | 3~5% | **측정 필요** (icache 위험) |
| PPU 15.8% 감소 | 제약상 제한적 | 함수 포인터 렌더러 분리 | 0.5~1.5% | **저비용 시도 가능** |
| 놓친 축 / 60fps 선례 | **선례 없음** | 정적 재컴파일 (패러다임 전환) | — | **범용 에뮬 목표와 상충** |

### 종합 판정

1. **범용 SNES 에뮬레이터로 STM32H7B0 에서 60fps 를 달성한 공개 사례가 없다.** G&W 커뮤니티는 정적 재컴파일로 우회했다. 53fps → 60fps 의 마지막 12~14% 는 이 하드웨어에서 SNES 에뮬레이션의 근본적 한계에 가깝다.

2. **개별 기법의 회수 합산:** 페이지 테이블(3~5%) + 함수 포인터(0.5~1.5%) = 최대 ~6.5%. 12~14% 갭의 절반. 나머지는 cpu_runOpcode(10%), app_main_snes(13%), snes_thumb2_step(17%) 영역에서 찾아야 하며, 이 영역들은 이미 닫힌 목록(Thumb-2 재작성, ITCM 이동, 스핀스킵, Q24 스케줄러)으로 대부분 소진되었다.

3. **가장 정직한 답:** 조사 범위에서 추가로 회수 가능한 것은 **최대 ~6.5%p** 이며, 그 중 페이지 테이블 디스패치는 WRAM 인라인 실패 선례가 있어 icache 측정 없이는 확언할 수 없다. 함수 포인터 분리는 저비용/저회수라 시도할 가치가 있다. 60fps 달성은 이 하드웨어에서 범용 에뮬레이터 기반으로는 입증된 사례가 없다.

---

## 출처 목록

| # | 출처 | URL | 참조 위치 |
|---|------|-----|----------|
| 1 | snes9x getset.h | https://github.com/libretro/snes9x/blob/6d1d0ab121875d10622ef599e4e3425308f6cf88/getset.h | Q1 |
| 2 | snes9x memmap.h | https://github.com/libretro/snes9x/blob/6d1d0ab121875d10622ef599e4e3425308f6cf88/memmap.h | Q1 |
| 3 | snes9x ppu.h | https://github.com/libretro/snes9x/blob/2ac236ba106d508b65d399f722b5fc29dceea4fe/ppu.h | Q2 |
| 4 | snes9x gfx.h | https://github.com/libretro/snes9x/blob/2ac236ba106d508b65d399f722b5fc29dceea4fe/gfx.h | Q2 |
| 5 | snes9x gfx.cpp | https://github.com/libretro/snes9x/blob/4973d625ba51919726becc48d0cae86ed1f9a478/gfx.cpp | Q2 |
| 6 | snes9x2010 README | https://github.com/libretro/snes9x2010 | Q2-C |
| 7 | snes9x2002 (PocketSNES) | https://github.com/libretro/snes9x2002 | Q1 임베디드 |
| 8 | ARMSNES-libretro | https://github.com/RetroPie/ARMSNES-libretro | Q1 임베디드 |
| 9 | DrPocketSNES | https://github.com/Apaczer/DrPocketSNES | Q1 임베디드 |
| 10 | game-and-watch-retro-go (kbeckmann) | https://github.com/kbeckmann/game-and-watch-retro-go | Q3 |
| 11 | game-and-watch-retro-go (sylverb) | https://github.com/sylverb/game-and-watch-retro-go | Q3 |
| 12 | game-and-watch-smw (정적 재컴파일) | https://github.com/marian-m12l/game-and-watch-smw | Q3 |
| 13 | snesrecomp (정적 재컴파일 프레임워크) | https://github.com/sp00nznet/snesrecomp | Q3 |
| 14 | game-and-watch-patch (CFW) | https://github.com/BrianPugh/game-and-watch-patch | Q3 |
| 15 | retro-go-stm32 (베이스) | https://github.com/sylverb/retro-go-stm32 | Q3 |
| 16 | LakeSnes | https://github.com/angelo-wf/LakeSnes | Q1, Q3 |
| 17 | snesrev/smw (SMW 역공학 소스) | https://github.com/snesrev/smw (snesrecomp 레퍼런스 경유) | Q3 |
