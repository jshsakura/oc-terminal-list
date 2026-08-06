/**
 * Cost display — the number is computed in USD, but a Korean screen wants 원.
 *
 * Two rules:
 *
 * 1. **Auto follows the language.** Korean → KRW. Someone reading a Korean UI
 *    reading "$46.0k" has to do the conversion in their head every time.
 * 2. **Round to how people say it.** 300만원, not ₩3,000,000 — and $46.0k, not
 *    $46,001.37. This is a list-price estimate; digits past the first two are
 *    noise pretending to be precision.
 *
 * The rate comes from the server (`summary.fx`), fetched once a day. No rate →
 * fall back to USD rather than showing a number that is silently wrong.
 */

export const CURRENCY_AUTO = 'auto';

/** 'auto' | 'usd' | 'krw' → the code to actually render in. */
export const resolveCurrency = (setting, language) => {
  const choice = String(setting || CURRENCY_AUTO).toLowerCase();
  if (choice === 'usd') return 'USD';
  if (choice === 'krw') return 'KRW';
  return String(language || '').toLowerCase().startsWith('ko') ? 'KRW' : 'USD';
};

const formatUsd = (v) => {
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}k`;
  if (v >= 10) return `$${v.toFixed(0)}`;
  if (v > 0 && v < 0.01) return '<$0.01';
  return `$${v.toFixed(2)}`;
};

/* 억 / 만 are the units Korean actually speaks in. 46,000,000원 reads as a wall of
   zeros; 4,600만원 reads as a number. */
const formatKrw = (won) => {
  if (won >= 1e8) return `${(won / 1e8).toFixed(won >= 1e9 ? 0 : 1)}억원`;
  if (won >= 1e4) return `${Math.round(won / 1e4).toLocaleString()}만원`;
  if (won > 0 && won < 100) return '100원 미만';
  return `${Math.round(won).toLocaleString()}원`;
};

/**
 * @param {number} usd            amount in USD
 * @param {object} opts
 * @param {string} opts.currency  resolved code ('USD' | 'KRW')
 * @param {object} opts.fx        rates from the server, e.g. { KRW: 1423.6 }
 */
export const formatMoney = (usd, { currency = 'USD', fx = null } = {}) => {
  const value = Math.max(0, Number(usd) || 0);
  const rate = currency !== 'USD' ? Number(fx?.[currency]) : null;
  // No rate today (offline deployment, first run) → USD, never a wrong number.
  if (currency === 'KRW' && rate > 0) return formatKrw(value * rate);
  return formatUsd(value);
};

/** Long form for tooltips — the exact figure, with the rate that produced it. */
export const describeMoney = (usd, { currency = 'USD', fx = null } = {}) => {
  const value = Math.max(0, Number(usd) || 0);
  const exact = `$${value.toFixed(2)}`;
  const rate = currency !== 'USD' ? Number(fx?.[currency]) : null;
  if (currency === 'KRW' && rate > 0) {
    return `${exact} · ${Math.round(value * rate).toLocaleString()}원 (1 USD = ${Math.round(rate).toLocaleString()}원)`;
  }
  return exact;
};

/**
 * Token counts in the units the reader speaks.
 *
 * "7.8B" is not a Korean number — 78억 is. Same rule as the currency: round to
 * how people say it, because the digits past the first two are noise on an
 * estimate anyway.
 */
export const formatCount = (n, locale) => {
  const v = Math.max(0, Number(n) || 0);
  const korean = String(locale || '').toLowerCase().startsWith('ko');
  if (!korean) {
    if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
    if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
    if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
    return `${Math.round(v)}`;
  }
  if (v >= 1e8) return `${(v / 1e8).toFixed(v >= 1e9 ? 0 : 1)}억`;
  if (v >= 1e4) return `${Math.round(v / 1e4).toLocaleString()}만`;
  return `${Math.round(v).toLocaleString()}`;
};
