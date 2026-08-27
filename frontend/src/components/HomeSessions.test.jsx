import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import HomeSessions from './HomeSessions';

describe('HomeSessions', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    localStorage.setItem('auth_token', 'token');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('keeps a resumable placeholder card visible while sessions are loading', async () => {
    /* 자리를 비워두면 카드가 나중에 툭 떨어져 "방금 생긴 것" 처럼 보인다. 문구가 아니라
       **자리(aria-busy)** 를 확인한다 — 스피너에서 스켈레톤으로 바뀌어도 계약은 같다. */
    const { container } = render(
      <HomeSessions
        hosts={[{ id: 'h1', name: 'prod', use_remote_tmux: true }]}
      />
    );

    await waitFor(() => {
      expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
    });
  });
});


/* ⚠️ 실측 사고. 붙어 있는 세션을 "이어할 수 있는" 으로 내밀면 사용자는 그걸 지우려 하고,
   지워지지 않는다 — 붙어 있는 쪽이 끊긴 것을 보고 곧바로 다시 만든다(재접속이 create=1).
   화면에서는 "지워도 새로고침하면 다시 뜬다" 로 보인다. */
describe('이어할 수 있는 세션 — 쓰는 중인 것은 빼고', () => {
  const src = readFileSync(resolve(__dirname, 'HomeSessions.jsx'), 'utf8');

  test('붙어 있는 세션은 목록에서 빠진다', () => {
    const at = src.indexOf('const resumable = entry.sessions.filter(');
    const block = src.slice(at, at + 260);
    expect(block).toMatch(/!s\.attached/);
  });

  test('구획 표시 여부도 같은 기준을 쓴다 — 안 그러면 빈 구획이 남는다', () => {
    const at = src.indexOf('const hasAnyResumable');
    const block = src.slice(at, at + 320);
    expect(block).toMatch(/!s\.attached/);
  });
});


/* ⚠️ 실측 사고 — 이 저장소가 같은 자리에서 여러 번 밟은 것의 재발.
   로컬 탭 `Proxmox 이관` 의 3번 pane 이 rpi5 세션이었는데, 점유 판정이 **탭 단위**라
   (`tab.type !== 'host'` 면 즉시 return) 그 pane 이 통째로 빠졌다. 쓰고 있는 세션이
   "이어할 수 있는 세션" 에 떴고, 사용자가 종료하자 같이 죽었다. */
describe('섞인 탭 — 로컬 탭 안의 원격 pane 도 점유다', () => {
  const stubFetch = (sessions) => vi.fn(() => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ items: [{ id: 'h1', sessions }] }),
  }));

  const HOSTS = [{ id: 'h1', name: 'rpi5', use_remote_tmux: true, remote_tmux_session: 'mobile' }];

  /* ⚠️ 둘을 **한 번에** 렌더한다. "안 보인다" 만 단독으로 단언하면 fetch 가 끝나기
     전(아무것도 없는 t=0)에 즉시 통과해 버려서, 버그를 되돌려 넣어도 초록으로 남는다 —
     실제로 그렇게 헛통과하는 것을 확인했다. 안 가려질 쪽을 **먼저 기다려** 목록이 다
     그려진 시점을 잡고, 그 뒤에 가려질 쪽의 부재를 본다. */
  it('로컬 탭이 들고 있는 원격 세션만 가려진다', async () => {
    vi.stubGlobal('fetch', stubFetch([
      { name: 'mobile-6c3ea', attached: false, created: 1 },
      { name: 'mobile-orphan', attached: false, created: 2 },
    ]));
    render(
      <HomeSessions
        hosts={HOSTS}
        tabs={[{
          id: 't1', name: 'Proxmox 이관', type: 'local',
          panes: [{ id: 'p1' }, { id: 'p3', hostId: 'h1', tmuxSessionName: 'mobile-6c3ea' }],
        }]}
      />
    );
    // 목록이 그려진 것을 먼저 확정한다.
    await waitFor(() => expect(screen.getByText('mobile-orphan')).toBeInTheDocument());
    // 쓰고 있는 것은 그 안에 없어야 한다.
    expect(screen.queryByText('mobile-6c3ea')).not.toBeInTheDocument();
  });
});
