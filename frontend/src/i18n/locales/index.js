/**
 * 다국어 지원 (i18n) — 언어별 파일 barrel
 */
import { en } from './en';
import { ko } from './ko';

export const locales = { en, ko };

export const defaultLocale = 'en';

export default locales;
