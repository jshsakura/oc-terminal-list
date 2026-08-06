import { describe, it, expect } from 'vitest';
import { formatMoney, describeMoney, resolveCurrency } from './money';

// Cost is computed in USD; a Korean screen wants 원. The trap is showing a
// converted number when there is no rate — that is silently wrong, not merely ugly.

describe('resolveCurrency', () => {
  it('auto follows the language', () => {
    expect(resolveCurrency('auto', 'ko')).toBe('KRW');
    expect(resolveCurrency('auto', 'en')).toBe('USD');
    expect(resolveCurrency(undefined, 'ko-KR')).toBe('KRW');
  });

  it('an explicit choice beats the language', () => {
    expect(resolveCurrency('usd', 'ko')).toBe('USD');
    expect(resolveCurrency('krw', 'en')).toBe('KRW');
  });
});

describe('formatMoney — USD', () => {
  it('abbreviates thousands and drops noise digits', () => {
    expect(formatMoney(46005.12, { currency: 'USD' })).toBe('$46.0k');
    expect(formatMoney(75, { currency: 'USD' })).toBe('$75');
    expect(formatMoney(1.234, { currency: 'USD' })).toBe('$1.23');
  });

  it('never shows a bare $0.00 for a tiny non-zero cost', () => {
    expect(formatMoney(0.001, { currency: 'USD' })).toBe('<$0.01');
    expect(formatMoney(0, { currency: 'USD' })).toBe('$0.00');
  });
});

describe('formatMoney — KRW', () => {
  const fx = { KRW: 1400 };

  it('speaks in 만 / 억, the units Korean actually uses', () => {
    expect(formatMoney(46005, { currency: 'KRW', fx })).toBe('6,441만원');  // 64.4M won
    expect(formatMoney(400000, { currency: 'KRW', fx })).toBe('5.6억원');   // 560M won
    expect(formatMoney(100, { currency: 'KRW', fx })).toBe('14만원');
    expect(formatMoney(1, { currency: 'KRW', fx })).toBe('1,400원');
  });

  it('falls back to USD when there is no rate — a wrong number is worse than a dollar sign', () => {
    expect(formatMoney(75, { currency: 'KRW', fx: null })).toBe('$75');
    expect(formatMoney(75, { currency: 'KRW', fx: {} })).toBe('$75');
    expect(formatMoney(75, { currency: 'KRW', fx: { KRW: 0 } })).toBe('$75');
  });

  it('clamps junk input to zero', () => {
    expect(formatMoney(undefined, { currency: 'KRW', fx })).toBe('0원');
    expect(formatMoney(-5, { currency: 'USD' })).toBe('$0.00');
  });
});

describe('describeMoney — the tooltip carries the exact figure and the rate', () => {
  it('shows both currencies and the rate used', () => {
    const text = describeMoney(46005.12, { currency: 'KRW', fx: { KRW: 1423.6 } });
    expect(text).toContain('$46005.12');
    expect(text).toContain('원');
    expect(text).toContain('1 USD');
  });

  it('is just the exact dollar figure in USD mode', () => {
    expect(describeMoney(46005.12, { currency: 'USD' })).toBe('$46005.12');
  });
});
