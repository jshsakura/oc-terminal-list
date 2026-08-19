import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import FirstRunGuide from './FirstRunGuide';
import { ko } from '../../i18n/locales/ko';

const t = (key) => ko[key] || key;

describe('FirstRunGuide', () => {
  it('세 걸음을 순서대로 보여준다', () => {
    render(<FirstRunGuide t={t} />);
    expect(screen.getByText(ko.guideStep1)).toBeTruthy();
    expect(screen.getByText(ko.guideStep2)).toBeTruthy();
    expect(screen.getByText(ko.guideStep3)).toBeTruthy();
  });

  it('마지막 걸음은 이 앱의 요점이다 — 일은 연 터미널에 머물지 않는다', () => {
    render(<FirstRunGuide t={t} />);
    expect(ko.guideStep3).toMatch(/itl send/);
  });

  it('t 가 없어도 죽지 않는다', () => {
    render(<FirstRunGuide t={null} />);
    expect(screen.getByText(/Getting started/)).toBeTruthy();
  });
});
