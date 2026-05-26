import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearCommandsFor,
  fetchPage,
  pushCommand,
  pushLocalCommand,
  removeCommand,
} from './commandHistory';

describe('commandHistory local fallback', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('keeps only the five newest local commands', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('offline'));
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(2000)
      .mockReturnValueOnce(3000)
      .mockReturnValueOnce(4000)
      .mockReturnValueOnce(5000)
      .mockReturnValueOnce(6000);

    for (let i = 1; i <= 6; i += 1) {
      pushLocalCommand('term-a', `echo command-${i}`);
    }

    const page = await fetchPage('term-a');
    expect(page.hasMore).toBe(false);
    expect(page.items.map((item) => item.text)).toEqual([
      'echo command-6',
      'echo command-5',
      'echo command-4',
      'echo command-3',
      'echo command-2',
    ]);
  });

  it('stores long commands locally without posting oversized server history', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('offline'));
    vi.spyOn(Date, 'now').mockReturnValue(1234);
    const longCommand = `node -e "${'x'.repeat(700)}"`;

    pushCommand('term-b', longCommand);

    expect(global.fetch).not.toHaveBeenCalled();
    const page = await fetchPage('term-b');
    expect(page.items).toHaveLength(1);
    expect(page.items[0].text).toBe(longCommand);
  });

  it('strips bracketed paste wrappers before saving local recovery entries', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('offline'));
    vi.spyOn(Date, 'now').mockReturnValue(1000);

    pushLocalCommand('term-c', '\x1b[200~python manage.py publish --dry-run\x1b[201~');

    const page = await fetchPage('term-c');
    expect(page.items[0].text).toBe('python manage.py publish --dry-run');
  });

  it('merges local first-page entries with server history and deduplicates by text', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(2000);
    pushLocalCommand('term-d', 'npm run deploy');
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          { text: 'pnpm test', ts: 3000 },
          { text: 'npm run deploy', ts: 1000 },
        ],
        hasMore: false,
      }),
    });

    const page = await fetchPage('term-d');
    expect(page.items.map((item) => [item.text, item.ts])).toEqual([
      ['pnpm test', 3000],
      ['npm run deploy', 2000],
    ]);
  });

  it('removes and clears local recovery entries with the existing mutation APIs', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [], hasMore: false }) });
    vi.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(2000);
    pushLocalCommand('term-e', 'first local command');
    pushLocalCommand('term-e', 'second local command');

    await removeCommand('term-e', 'second local command');
    let page = await fetchPage('term-e');
    expect(page.items.map((item) => item.text)).toEqual(['first local command']);

    await clearCommandsFor('term-e');
    page = await fetchPage('term-e');
    expect(page.items).toEqual([]);
  });
});
