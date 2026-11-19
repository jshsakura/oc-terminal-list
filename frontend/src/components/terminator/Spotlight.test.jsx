import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import Spotlight from './Spotlight';

const point = (id) => act(() => { window.dispatchEvent(new CustomEvent('iterm:spotlight', { detail: { id } })); });

describe('Spotlight', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('rings the target and tells where it is', () => {
    const target = document.createElement('button');
    target.setAttribute('data-guide', 'settings');
    target.getBoundingClientRect = () => ({ left: 100, top: 10, right: 130, bottom: 40, width: 30, height: 30 });
    document.body.appendChild(target);
    const { container } = render(<Spotlight language="ko" />);
    point('settings');
    const ring = container.querySelector('[data-spotlight-ring]');
    expect(ring).toHaveStyle({ left: '96px', top: '6px' });
    expect(screen.getByText('설정은 여기 있습니다')).toBeInTheDocument();
  });

  it('says so when the button is not on screen', () => {
    render(<Spotlight language="ko" />);
    point('pane-more');
    expect(screen.getByRole('status')).toHaveTextContent('화면에 없습니다');
  });

  it('goes away on the next click', () => {
    const target = document.createElement('button');
    target.setAttribute('data-guide', 'settings');
    target.getBoundingClientRect = () => ({ left: 0, top: 0, right: 10, bottom: 10, width: 10, height: 10 });
    document.body.appendChild(target);
    const { container } = render(<Spotlight />);
    point('settings');
    fireEvent.pointerDown(document.body);
    expect(container.querySelector('[data-spotlight-ring]')).toBeNull();
  });
});
