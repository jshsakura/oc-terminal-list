import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GUIDE_TARGETS, guideCaption, findGuideElement } from './guideTargets';

// Tests run from frontend/.
const GUIDE_MD = resolve(process.cwd(), '../backend/cli/terminator/guide.md');

describe('guideTargets', () => {
  it('lists exactly the ids Terminator reads in guide.md', () => {
    const section = readFileSync(GUIDE_MD, 'utf8').split('## 화면 안내 대상')[1] || '';
    const fromGuide = [...section.matchAll(/`([a-z0-9][a-z0-9-]*)`/g)].map((m) => m[1]).sort();
    expect(Object.keys(GUIDE_TARGETS).sort()).toEqual(fromGuide);
  });

  it('captions fall back to English and refuse unknown ids', () => {
    expect(guideCaption('settings', 'ko')).toMatch(/설정/);
    expect(guideCaption('settings', 'ja')).toBe(GUIDE_TARGETS.settings.en);
    expect(guideCaption('<img>')).toBeNull();
  });

  it('finds only a visible element and never builds a selector from an unknown id', () => {
    document.body.innerHTML = '<button data-guide="settings" id="hidden"></button><button data-guide="settings" id="shown"></button>';
    document.getElementById('hidden').getBoundingClientRect = () => ({ width: 0, height: 0 });
    document.getElementById('shown').getBoundingClientRect = () => ({ width: 20, height: 20 });
    expect(findGuideElement('settings').id).toBe('shown');
    expect(findGuideElement('"] , *, ["')).toBeNull();
  });

  it('skips a button that sits in a hidden tab, even though it keeps its size', () => {
    document.body.innerHTML = `
      <div style="visibility:hidden"><button data-guide="pane-split" id="hidden-tab"></button></div>
      <button data-guide="pane-split" id="visible-tab"></button>`;
    const sized = () => ({ width: 20, height: 20, top: 0, left: 0, right: 20, bottom: 20 });
    document.querySelectorAll('button').forEach((b) => { b.getBoundingClientRect = sized; });
    expect(findGuideElement('pane-split').id).toBe('visible-tab');
  });
});
