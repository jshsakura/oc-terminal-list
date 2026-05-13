import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import SkeletonRow, { SkeletonBlock } from './common/SkeletonRow';

describe('SkeletonRow', () => {
  it('renders a single skeleton bar with aria-busy', () => {
    const { container } = render(<SkeletonRow />);
    const el = container.firstChild;
    expect(el).toHaveAttribute('aria-busy', 'true');
    expect(el).toHaveAttribute('aria-hidden', 'true');
  });

  it('applies default width and height', () => {
    const { container } = render(<SkeletonRow />);
    const el = container.firstChild;
    expect(el).toHaveStyle({ width: '60%', height: '12px' });
  });

  it('accepts custom width, height, and borderRadius', () => {
    const { container } = render(
      <SkeletonRow width="80%" height="16px" borderRadius="4px" />
    );
    const el = container.firstChild;
    expect(el).toHaveStyle({ width: '80%', height: '16px', borderRadius: '4px' });
  });

  it('uses pulse animation', () => {
    const { container } = render(<SkeletonRow />);
    const el = container.firstChild;
    expect(el.style.animation).toContain('skel-pulse');
  });

  it('merges custom style prop', () => {
    const { container } = render(
      <SkeletonRow style={{ marginLeft: 'auto' }} />
    );
    const el = container.firstChild;
    expect(el).toHaveStyle({ marginLeft: 'auto' });
  });
});

describe('SkeletonBlock', () => {
  it('renders the requested number of rows', () => {
    const { container } = render(<SkeletonBlock rows={4} />);
    const block = container.firstChild;
    expect(block.children.length).toBe(4);
  });

  it('sets aria-busy on the container', () => {
    const { container } = render(<SkeletonBlock rows={3} />);
    expect(container.firstChild).toHaveAttribute('aria-busy', 'true');
  });

  it('applies custom gap and style', () => {
    const { container } = render(
      <SkeletonBlock rows={2} gap="10px" style={{ padding: '8px' }} />
    );
    const block = container.firstChild;
    expect(block).toHaveStyle({ gap: '10px', padding: '8px' });
  });

  it('uses provided widths array when given', () => {
    const { container } = render(
      <SkeletonBlock rows={3} widths={['40%', '60%', '80%']} />
    );
    const rows = container.firstChild.children;
    expect(rows[0]).toHaveStyle({ width: '40%' });
    expect(rows[1]).toHaveStyle({ width: '60%' });
    expect(rows[2]).toHaveStyle({ width: '80%' });
  });
});
