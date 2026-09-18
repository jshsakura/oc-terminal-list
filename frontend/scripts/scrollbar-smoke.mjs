// Real xterm + browser geometry: drag, resize and mobile hit testing.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundle = await build({
  stdin: { contents: `
    import React, {useEffect, useRef, useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import createXtermInstance from './src/components/terminal/createXtermInstance';
    import ensureStyles from './src/components/terminal/xtermGlobalCss';
    import TerminalScrollbar from './src/components/terminal/TerminalScrollbar';
    import HistoryPanel from './src/components/commandinput/HistoryPanel';
    import {pushLocalCommand} from './src/utils/commandHistory';
    function App() {
      const container = useRef(); const xtermRef = useRef(); const fitNowRef = useRef();
      const [ready, setReady] = useState(false); const [enabled, setEnabled] = useState(true);
      const [showInput, setShowInput] = useState(true);
      const [historyOpen, setHistoryOpen] = useState(false);
      useEffect(() => {
        ensureStyles();
        const {term, fitAddon} = createXtermInstance({container: container.current,
          settings: {fontSize: 13, smoothScroll: false, predictiveEcho: false},
          theme: {background:'#111', foreground:'#eee'}});
        window.term = xtermRef.current = term;
        window.saveHistory = text => pushLocalCommand('test', text);
        window.fetch = async (url, options = {}) => {
          if (!url.startsWith('/api/command-history')) throw new Error('Unexpected request');
          return {ok:true,json:async()=>({items:[],hasMore:false})};
        };
        fitNowRef.current = () => fitAddon.fit();
        window.chunks = []; term.onData(data => window.chunks.push(data));
        setReady(true);
        term.write(['A', 'B', 'C'].map(letter => '\\x1b[48;2;60;64;72m› 질문 '+letter+'\\x1b[0m\\r\\n\\r\\n' + Array.from({length:70}, (_,i) => 'Answer '+letter+' '+i+'\\r\\n').join('')).join('') + '› ');
        return () => term.dispose();
      }, []);
      return <><button id="toggle" onClick={() => setEnabled(v => !v)}>Toggle</button>
        <button id="toggle-input" onClick={() => setShowInput(v => !v)}>Input preview</button>
        <button id="history" onClick={() => setHistoryOpen(v => !v)}>Recent commands</button>
        <div id="pane" style={{position:'relative',width:'100%',height:360}}>
          <div ref={container} style={{width:'100%',height:'100%'}} />
          <div id="mobile-overlay" style={{position:'absolute',inset:0,zIndex:4,pointerEvents:'none'}} />
          <TerminalScrollbar xtermRef={xtermRef} fitNowRef={fitNowRef} sessionId="test" historyKey="test"
            enabled={enabled} showInputOnScroll={showInput} active ready={ready}
            tmuxBacked={false}
            theme={{background:'#111',foreground:'#eee'}}
            t={k=>({terminalContextInput:'현재 구간의 질문',terminalInputExpand:'펼치기',terminalInputCollapse:'접기'}[k]||k)} />
        </div>
        {historyOpen && <HistoryPanel terminalKey="test" onPick={text=>{window.pickedCommand=text;}} />}
        </>;
    }
    createRoot(document.getElementById('root')).render(<App/>);
  `, resolveDir: root, loader: 'jsx' }, bundle: true, write: false, format: 'iife', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
});
for (const engine of [chromium, webkit]) {
  const browser = await engine.launch({headless:true});
  try {
    const page = await browser.newPage({viewport:{width:900,height:500}});
    const errors = [];
    page.on('pageerror', e => { errors.push(e.message); console.error(e.message); });
    await page.route('http://terminal-preview.test/', route => route.fulfill({contentType:'text/html',
      body:'<style>body{margin:0}.xterm{width:100%!important;height:100%!important;overflow:hidden!important}.xterm-scrollable-element{height:100%!important}</style><div id="root"></div>'}));
    await page.goto('http://terminal-preview.test/');
    await page.addStyleTag({path:path.join(root,'node_modules/@xterm/xterm/css/xterm.css')});
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    const bar = page.getByRole('scrollbar');
    await page.waitForFunction(() => window.term?.buffer.active.baseY > 100);
    await bar.waitFor();
    assert.ok(await bar.evaluate((element) => element.getBoundingClientRect().width >= 24),
      'Scrollbar exposes a mobile-sized pointer target');
    const box = await bar.boundingBox();
    await page.mouse.move(box.x + box.width/2, box.y + box.height - 10);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width/2, box.y + 10, {steps:10});
    await page.mouse.up();
    assert.ok(await page.evaluate(() => window.term.buffer.active.viewportY < 20), 'Drag reaches history');
    await bar.focus();
    await page.keyboard.press('End');
    assert.equal(await page.evaluate(() => window.term.buffer.active.viewportY), await page.evaluate(() => window.term.buffer.active.baseY));
    const narrow = await page.evaluate(() => window.term.cols);
    await page.locator('#toggle').click();
    assert.equal(await bar.count(),0);
    assert.ok(await page.evaluate(() => window.term.cols) > narrow, 'Hiding restores text width');
    await page.locator('#toggle').click();
    assert.equal(await page.evaluate(() => window.term.cols), narrow);
    await page.setViewportSize({width:390,height:500});
    await page.evaluate(() => {
      document.querySelector('#mobile-overlay').style.pointerEvents = 'auto';
      window.dispatchEvent(new Event('resize'));
    });
    const mobile = await bar.boundingBox();
    assert.equal(await page.evaluate(({x,y}) => document.elementFromPoint(x,y).getAttribute('role'),
      {x:mobile.x+8,y:mobile.y+50}), 'scrollbar', 'Mobile overlay does not block scrollbar');
    assert.deepEqual(await page.evaluate(() => window.chunks), [], 'Scrolling never types into the shell');
    const preview = page.getByRole('region', {name:'현재 구간의 질문'});
    assert.equal(await preview.count(), 0, 'Hidden at the bottom');
    const goToAnswer = async (letter) => {
      await page.evaluate(letter => {
        const buffer = window.term.buffer.active;
        for (let i = 0; i < buffer.length; i++) {
          if (buffer.getLine(i)?.translateToString(true).startsWith('Answer '+letter+' 10')) {
            window.term.scrollToLine(i); return;
          }
        }
        throw new Error('Missing answer '+letter);
      }, letter);
      await preview.waitFor();
      await page.waitForFunction(letter => document.querySelector('[role="region"]')?.textContent.includes('질문 '+letter), letter);
      assert.ok((await preview.innerText()).includes('질문 '+letter));
    };
    for (const letter of ['A','B','C','A']) await goToAnswer(letter);
    assert.equal(await preview.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(60, 64, 72)');
    const expand = preview.locator('button[aria-expanded]');
    await expand.focus();
    assert.notEqual(await expand.evaluate((element) => getComputedStyle(element).boxShadow), 'none');
    await expand.click();
    assert.equal(await expand.getAttribute('aria-expanded'), 'true');
    const beforeJump = await page.evaluate(() => window.term.buffer.active.viewportY);
    await preview.locator('button[title]').click();
    await preview.waitFor({state:'hidden'});
    assert.ok(await page.evaluate(() => window.term.buffer.active.viewportY) < beforeJump);
    assert.ok(await page.evaluate(() => {
      const b = window.term.buffer.active;
      return b.getLine(b.viewportY).translateToString(true).startsWith('› 질문 A');
    }), 'Click reveals the original question at the viewport top');
    await goToAnswer('A');
    await page.screenshot({path:'/tmp/terminal-input-context-'+engine.name()+'.png'});
    await page.locator('#toggle').click();
    assert.equal(await bar.count(),0);
    await goToAnswer('B');
    await page.locator('#toggle-input').click();
    await preview.waitFor({state:'hidden'});
    await page.locator('#toggle-input').click();
    await preview.waitFor();
    assert.ok((await preview.innerText()).includes('질문 B'), 'No new submission needed after remount');
    await page.evaluate(() => window.saveHistory('질문   B'));
    await page.waitForFunction(() => document.querySelector('[role="region"]')?.textContent.includes('질문   B'));
    await page.evaluate(() => window.term.scrollToBottom());
    await preview.waitFor({state:'hidden'});
    assert.deepEqual(await page.evaluate(() => window.chunks), [], 'Context detection never types into the shell');
    await page.evaluate(() => { window.term.input('새로 보낸 한글 질문', true); window.term.input('\r', true); });
    await page.locator('#history').click();
    assert.equal(await page.getByRole('button', {name:'새로 보낸 한글 질문', exact:true}).count(), 0,
      'Raw terminal input is never persisted');
    await page.evaluate(() => window.saveHistory('명시적으로 저장한 한글 질문'));
    const saved = page.getByRole('button', {name:'명시적으로 저장한 한글 질문', exact:true});
    await saved.waitFor();
    await saved.click();
    assert.equal(await page.evaluate(() => window.pickedCommand), '명시적으로 저장한 한글 질문');
    assert.deepEqual(errors, []);
    console.log(engine.name()+': scrollbar, A/B/C context, background and shared Recent commands passed');
  } finally { await browser.close(); }
}
