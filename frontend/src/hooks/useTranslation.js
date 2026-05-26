/**
 * useTranslation 훅
 * 다국어 지원
 */
import { useMemo } from 'react';
import { locales, defaultLocale } from '../i18n/locales';

export const useTranslation = (language) => {
  const t = useMemo(() => {
    const currentLocale = locales[language] || locales[defaultLocale];
    const fallbackLocale = locales[defaultLocale] || {};

    return (key, fallback) => {
      if (Object.prototype.hasOwnProperty.call(currentLocale, key)) return currentLocale[key];
      if (fallback !== undefined) return fallback;
      if (Object.prototype.hasOwnProperty.call(fallbackLocale, key)) return fallbackLocale[key];
      return key;
    };
  }, [language]);

  return { t };
};

export default useTranslation;
