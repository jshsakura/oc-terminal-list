/**
 * useTranslation 훅
 * 다국어 지원
 */
import { useMemo } from 'react';
import { locales, defaultLocale } from '../i18n/locales';

export const useTranslation = (language) => {
  const t = useMemo(() => {
    const currentLocale = locales[language] || locales[defaultLocale];

    return (key, fallback = key) => {
      return currentLocale[key] || fallback;
    };
  }, [language]);

  return { t };
};

export default useTranslation;
