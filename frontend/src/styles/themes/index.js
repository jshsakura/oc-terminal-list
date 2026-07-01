/**
 * 터미널 테마 인덱스 — commonUI + 60개 테마 정의를 모아 themes 맵을 구성한다.
 * 공개 API(default themes, themeNames, defaultTheme, 개별 테마 named export)는
 * 분리 전 themes.js 와 100% 동일하게 유지한다.
 */
import * as partA from './themesPartA';
import * as partB from './themesPartB';
import * as partC from './themesPartC';
import * as partD from './themesPartD';

export * from './commonUI';
export * from './themesPartA';
export * from './themesPartB';
export * from './themesPartC';
export * from './themesPartD';

const {
  paperColorTheme, rosePineDawnTheme, vscodeLightTheme, tokyoNightDayTheme, flexokiLightTheme, everforestLightTheme, 
  zenburnTheme, pandaTheme, cyberdreamTheme, tenderTheme, sakuraDarkTheme, sepiaTheme, 
  springDayTheme, lavenderTheme, noctisLuxTheme, blossomTheme, abyssalEmberTheme, blueprintPaperTheme, 
  solarizedLightTheme, catppuccinLatteTheme, githubLightTheme, catppuccinMacchiatoTheme, catppuccinFrappeTheme, palenightTheme, 
  kanagawaTheme, moonflyTheme, horizonTheme, oneLightTheme, ayuLightTheme, materialDarkTheme, 
  icebergTheme, vscodeDarkTheme, tomorrowNightTheme, nightflyTheme, halcyonTheme, tokyoNightStormTheme, 
  rosePineMoonTheme, ayuDarkTheme, snazzyTheme, andromedaTheme, defaultThemeObj, catppuccinTheme, 
  tokyoNightTheme, oneDarkTheme, nightOwlTheme, ayuMirageTheme, monokaiProTheme, synthwave84Theme, 
  shadesOfPurpleTheme, cobalt2Theme, monokaiTheme, draculaTheme, oceanicNextTheme, gruvboxDarkTheme, 
  everforestTheme, solarizedDarkTheme, nordTheme, githubDarkTheme, rosePineTheme, gruvboxLightTheme, 
  
  espressoTheme, bloodMoonTheme, matrixTheme, deepSeaTheme, amethystTheme, carbonTheme,
} = { ...partA, ...partB, ...partC, ...partD };

export const themes = {
  // ── Dark ────────────────────────────────────────────────────────────
  default:            defaultThemeObj,
  // 차갑고 어두운 계열
  catppuccin:         catppuccinTheme,
  catppuccinMacchiato: catppuccinMacchiatoTheme,
  tokyoNight:         tokyoNightTheme,
  nord:               nordTheme,
  cobalt2:            cobalt2Theme,
  ayuDark:            ayuDarkTheme,
  // 보라/핑크 계열
  dracula:            draculaTheme,
  rosePine:           rosePineTheme,
  shadesOfPurple:     shadesOfPurpleTheme,
  synthwave84:        synthwave84Theme,
  sakuraDark:         sakuraDarkTheme,
  // 따뜻한/뉴트럴 계열
  gruvboxDark:        gruvboxDarkTheme,
  monokai:            monokaiTheme,
  monokaiPro:         monokaiProTheme,
  ayuMirage:          ayuMirageTheme,
  tender:             tenderTheme,
  zenburn:            zenburnTheme,
  // 그린/네이처 계열
  everforest:         everforestTheme,
  kanagawa:           kanagawaTheme,
  panda:              pandaTheme,
  // 중간 다크 (회색/청색 계열)
  oneDark:            oneDarkTheme,
  nightOwl:           nightOwlTheme,
  vscodeDark:         vscodeDarkTheme,
  tomorrowNight:      tomorrowNightTheme,
  solarizedDark:      solarizedDarkTheme,
  oceanicNext:        oceanicNextTheme,
  githubDark:         githubDarkTheme,
  horizon:            horizonTheme,
  andromeda:          andromedaTheme,
  // 네온/사이버 계열
  cyberdream:         cyberdreamTheme,
  abyssalEmber:       abyssalEmberTheme,
  // 색다른 다크 (part D)
  espresso:           espressoTheme,
  bloodMoon:          bloodMoonTheme,
  matrix:             matrixTheme,
  deepSea:            deepSeaTheme,
  amethyst:           amethystTheme,
  carbon:             carbonTheme,
  // ── Light ───────────────────────────────────────────────────────────
  // 흰/크림 계열
  catppuccinLatte:    catppuccinLatteTheme,
  solarizedLight:     solarizedLightTheme,
  flexokiLight:       flexokiLightTheme,
  // 따뜻한 계열
  gruvboxLight:       gruvboxLightTheme,
  ayuLight:           ayuLightTheme,
  rosePineDawn:       rosePineDawnTheme,
  sepia:              sepiaTheme,
  noctisLux:          noctisLuxTheme,
  // 색감 강한 계열
  lavender:           lavenderTheme,
  blossom:            blossomTheme,
  blueprintPaper:     blueprintPaperTheme,
  springDay:          springDayTheme,
  tokyoNightDay:      tokyoNightDayTheme,
  everforestLight:    everforestLightTheme,
};

export const themeNames = Object.keys(themes);
export const defaultTheme = 'default';
export default themes;
