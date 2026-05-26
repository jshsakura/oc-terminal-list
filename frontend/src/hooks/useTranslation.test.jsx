import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import useTranslation from './useTranslation';

describe('useTranslation', () => {
  it('uses the explicit fallback for missing keys', () => {
    const { result } = renderHook(() => useTranslation('ko'));
    expect(result.current.t('definitelyMissingKey', '대체 문구')).toBe('대체 문구');
  });

  it('falls back to the default locale before returning the key', () => {
    const { result } = renderHook(() => useTranslation('missing-locale'));
    expect(result.current.t('restartShell')).toBe('Restart shell');
  });

  it('returns the key only when no translation or fallback exists', () => {
    const { result } = renderHook(() => useTranslation('ko'));
    expect(result.current.t('definitelyMissingKey')).toBe('definitelyMissingKey');
  });
});
