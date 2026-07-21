import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { homeTilde, stripHostPathPrefix } from './cwdPath';
import { readPanelState, DEFAULT_PANEL_WIDTH, MIN_PANEL_WIDTH, MAX_PANEL_WIDTH } from './panelState';
import CwdBreadcrumb from './CwdBreadcrumb';
import ThemeSettings from './ThemeSettings';
import { buildThemeUI } from '../../styles/themeUI';
import themes from '../../styles/themes';

// TerminalHeader 에서 갈라져 나온 조각들. 본체 테스트(TerminalHeader.test.jsx)는
// 이 컴포넌트들의 내부까지는 안 들어가므로, 여기서 직접 렌더해 둔다 —
// import 가 하나 끊겨도 렌더 시점에야 ReferenceError 로 터지기 때문이다.

describe('homeTilde', () => {
  it('리눅스/맥 홈을 ~ 로 접는다', () => {
    expect(homeTilde('/home/ubuntu/app')).toBe('~/app');
    expect(homeTilde('/Users/jay/app')).toBe('~/app');
  });

  it('홈이 아니면 그대로 둔다', () => {
    expect(homeTilde('/var/log')).toBe('/var/log');
    expect(homeTilde('/homeless/x')).toBe('/homeless/x');   // 접두사만 같은 경로
  });

  it('빈 값에 터지지 않는다', () => {
    expect(homeTilde('')).toBe('');
    expect(homeTilde(null)).toBe(null);
  });
});

describe('stripHostPathPrefix', () => {
  it('user@host:/path 에서 경로만 남긴다', () => {
    expect(stripHostPathPrefix('ubuntu@a1-ubuntu:/home/ubuntu/app')).toBe('/home/ubuntu/app');
    expect(stripHostPathPrefix('a1-ubuntu:~/app')).toBe('~/app');
  });

  it('이미 경로면 건드리지 않는다', () => {
    expect(stripHostPathPrefix('/home/ubuntu')).toBe('/home/ubuntu');
    expect(stripHostPathPrefix('~/app')).toBe('~/app');
  });

  it('null/undefined 는 빈 문자열로 떨어진다', () => {
    expect(stripHostPathPrefix(null)).toBe('');
    expect(stripHostPathPrefix(undefined)).toBe('');
    expect(stripHostPathPrefix('')).toBe('');
  });

  it('문자열이 아닌 truthy 값은 그대로 통과한다 (현재 동작 고정)', () => {
    // 가드가 `return path || ''` 라 non-string truthy 는 원본이 나온다.
    // 실제로는 항상 문자열/null 만 들어오므로 문제가 된 적은 없다 — 다만
    // 리팩토링 중 동작을 바꾸지 않기 위해 있는 그대로 박아둔다.
    expect(stripHostPathPrefix(123)).toBe(123);
  });
});

describe('readPanelState', () => {
  beforeEach(() => localStorage.clear());

  it('저장된 게 없으면 기본값', () => {
    expect(readPanelState('k')).toEqual({ activePanel: null, panelWidth: DEFAULT_PANEL_WIDTH });
  });

  it('알 수 없는 패널 id 는 버린다', () => {
    localStorage.setItem('k', JSON.stringify({ activePanel: 'bogus', panelWidth: 300 }));
    expect(readPanelState('k').activePanel).toBe(null);
  });

  it('폭을 허용 범위로 클램프한다', () => {
    localStorage.setItem('k', JSON.stringify({ activePanel: 'files', panelWidth: 9999 }));
    expect(readPanelState('k').panelWidth).toBe(MAX_PANEL_WIDTH);
    localStorage.setItem('k', JSON.stringify({ activePanel: 'files', panelWidth: 1 }));
    expect(readPanelState('k').panelWidth).toBe(MIN_PANEL_WIDTH);
  });

  it('깨진 JSON 이면 기본값으로 살아남는다', () => {
    localStorage.setItem('k', '{not json');
    expect(readPanelState('k')).toEqual({ activePanel: null, panelWidth: DEFAULT_PANEL_WIDTH });
  });
});

describe('렌더 스모크 — import 끊김 감지', () => {
  const ui = buildThemeUI(themes.catppuccin);

  it('CwdBreadcrumb 가 로컬 pane 경로를 그린다', () => {
    render(<CwdBreadcrumb
      paneInfo={{ tabType: 'local', cwd: '/home/ubuntu/app/project' }}
      loading={false} disabled={false} ui={ui} t={(k) => k}
    />);
    expect(screen.getByText(/project/)).toBeTruthy();
  });

  it('CwdBreadcrumb 가 로딩 중에도 터지지 않는다', () => {
    const { container } = render(<CwdBreadcrumb
      paneInfo={null} loading disabled={false} ui={ui} t={(k) => k}
    />);
    expect(container.firstChild).toBeTruthy();
  });

  it('ThemeSettings 가 그려진다', () => {
    const { container } = render(<ThemeSettings
      paneThemeId={null} globalThemeId="catppuccin"
      onPaneThemeChange={vi.fn()} t={(k) => k}
    />);
    expect(container.firstChild).toBeTruthy();
  });
});
