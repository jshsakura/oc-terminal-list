// Real xterm touch/focus checks in mobile Chromium and WebKit. No live sessions.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundle = await build({
  stdin: { resolveDir: root, loader: 'jsx', contents: `
    import React, {useEffect, useRef, useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import createXtermInstance from './src/components/terminal/createXtermInstance';
    import ensureStyles from './src/components/terminal/xtermGlobalCss';
    import attachTerminalInteractions from './src/components/terminal/attachTerminalInteractions';
    import setTerminalReadOnly from './src/components/terminal/setTerminalReadOnly';
    import MobileToolbar from './src/components/MobileToolbar';
    import {TerminalContextMenu} from './src/components/terminal/TerminalOverlays';
    import {ko} from './src/i18n/locales/ko';
    import {resolveMobileKeySets} from './src/utils/mobileKeySets';
    import useMobileViewMode from './src/hooks/useMobileViewMode';
    import {copyToClipboard} from './src/utils/clipboard';
    function App() {
      const container = useRef(); const overlay = useRef(); const termRef = useRef();
      const [viewOnly, setViewOnly] = useMobileViewMode();
      const locked = useRef(viewOnly); locked.current = viewOnly;
      const [text, setText] = useState('');
      const [menu, setMenu] = useState(null);
      const [activeSet, setActiveSet] = useState('basic');
      const keySets = resolveMobileKeySets();
      window.openMenu = () => setMenu({x:16,y:100,hasSelection:termRef.current.hasSelection()});
      window.setViewOnly = setViewOnly;
      useEffect(() => {
        ensureStyles();
        const {term, fitAddon} = createXtermInstance({container:container.current,
          settings:{fontSize:13,predictiveEcho:false},theme:{background:'#11111b',foreground:'#eeeeee'}});
        window.term = termRef.current = term;
        window.input = []; window.pointerInput = []; window.fitTerminal = () => fitAddon.fit();
        fitAddon.fit();
        setTerminalReadOnly(term, locked.current);
        term.onData(data => { if (!locked.current) window.input.push(data); });
        const interactions = attachTerminalInteractions({term,container:container.current,overlay:overlay.current,
          input:{push:data=>window.pointerInput.push(data)},getSocket:()=>({readyState:1}),
          isMobile:()=>true,isReadOnly:()=>locked.current,sessionId:'smoke',
          logger:console,setContextMenu:menu=>{window.selectionMenu=menu;setMenu(menu);},setCopyFlash:()=>{},setImagePasteState:()=>{}});
        term.write(Array.from({length:150},(_,i)=>'출력 내용 '+i+' — 보기 모드에서 안전하게 읽기\\r\\n').join(''));
        return () => { interactions.detach(); term.dispose(); };
      }, []);
      useEffect(() => { setTerminalReadOnly(termRef.current, viewOnly); }, [viewOnly]);
      return <main style={{background:'#11111b',color:'#eee',height:'100dvh',display:'flex',flexDirection:'column'}}>
        <div style={{padding:12,fontFamily:'sans-serif'}}>Terminal List · 모바일 보기 모드</div>
        <div id="pane" style={{position:'relative',flex:1,minHeight:0}}>
          <div ref={container} style={{height:'100%',width:'100%'}} />
          <div ref={overlay} id="touch-surface" style={{position:'absolute',inset:0,zIndex:4,touchAction:'none'}} />
        </div>
        <MobileToolbar language="ko" viewOnly={viewOnly} onOpenCommandInput={()=>setViewOnly(false)}
          keySets={keySets} activeSetId={activeSet} onSelectSet={setActiveSet}
          keys={keySets.find(set=>set.id===activeSet).keys} onOpenSettings={()=>{}}
          onSendKey={data=>{if(!locked.current)termRef.current.input(data,true);}}
          onAction={action=>{
            if(action==='viewAsText')setText('출력 내용: 읽기와 복사 가능');
            if(action==='scrollToBottom')termRef.current.scrollToBottom();
            if(action==='copy')copyToClipboard(termRef.current.getSelection()).then(ok=>{window.copySucceeded=ok;});
          }} />
        {menu && <TerminalContextMenu {...menu} themeUi={{text:'#eee',subtext:'#aaa'}} t={key=>ko[key]}
          readOnly={viewOnly} isMobile onClose={()=>setMenu(null)} onCopyAll={()=>{}}
          onCopy={()=>{copyToClipboard(termRef.current.getSelection()).then(ok=>{window.copySucceeded=ok;});setMenu(null);}}
          onPaste={()=>{}} onScrollToBottom={()=>{termRef.current.scrollToBottom();setMenu(null);}}
          onScreenDump={()=>{setText('출력 내용: 읽기와 복사 가능');setMenu(null);}} />}
        {text && <div role="dialog">{text}</div>}
      </main>;
    }
    createRoot(document.getElementById('root')).render(<App/>);
  ` }, bundle: true, write: false, format: 'iife', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
});

for (const engine of [chromium, webkit]) {
  const browser = await engine.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('http://terminal-view.test/', route => route.fulfill({contentType:'text/html',
      body:'<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}.xterm{width:100%!important;height:100%!important;overflow:hidden!important}.xterm-scrollable-element{height:100%!important}</style><div id="root"></div>'}));
    const boot = async () => {
      await page.goto('http://terminal-view.test/');
      await page.addStyleTag({path:path.join(root,'node_modules/@xterm/xterm/css/xterm.css')});
      await page.addScriptTag({content:bundle.outputFiles[0].text});
      await page.waitForFunction(() => window.term?.buffer.active.baseY > 90);
    };
    await boot();
    await page.getByRole('button', {name:'퀵바 세트 선택',exact:true}).waitFor();
    assert.equal(await page.locator('textarea').evaluate(el => el.readOnly && el.inputMode === 'none'), true);
    await page.locator('#touch-surface').tap();
    assert.equal(await page.evaluate(() => document.activeElement === window.term.textarea), false);
    await page.keyboard.type('unwanted');
    assert.deepEqual(await page.evaluate(() => window.input), []);
    const before = await page.evaluate(() => window.term.buffer.active.viewportY);
    await page.evaluate(() => {
      const el = document.getElementById('touch-surface');
      const touch = (type,y) => {
        const event = new Event(type,{bubbles:true,cancelable:true});
        Object.defineProperty(event,'touches',{value:type==='touchend'?[]:[{clientX:80,clientY:y}]});
        el.dispatchEvent(event);
      };
      touch('touchstart',100); touch('touchmove',220); touch('touchend',220);
    });
    await page.waitForFunction(before => window.term.buffer.active.viewportY < before, before);
    assert.deepEqual(await page.evaluate(() => window.pointerInput), []);
    await page.evaluate(()=>window.openMenu());
    await page.getByRole('button',{name:'맨 아래로 이동',exact:true}).tap();
    await page.waitForFunction(() => window.term.buffer.active.viewportY === window.term.buffer.active.baseY);
    assert.equal(await page.evaluate(() => window.term.options.disableStdin), true);
    assert.equal(await page.getByRole('button',{name:'입력 모드로 전환',exact:true}).count(), 0);

    const url = 'https://example.test/'+'a'.repeat(60)+'/wrapped-link';
    await page.evaluate(url => new Promise(resolve => window.term.write('\r\nselect alpha beta\r\n한글 '+url+'\r\n',resolve)), url);
    await page.evaluate(() => {
      window.cellPoint = text => {
        const term = window.term;
        const rect = term.element.querySelector('.xterm-screen').getBoundingClientRect();
        const cell = term._core._renderService.dimensions.css.cell;
        for (let row = 0; row < term.rows; row++) {
          const line = term.buffer.active.getLine(term.buffer.active.viewportY + row);
          const index = line.translateToString(true).indexOf(text);
          if (index < 0) continue;
          let offset = 0;
          for (let col = 0; col < term.cols; col++) {
            const chars = line.getCell(col).getChars();
            if (offset >= index && chars) return {x:rect.left+(col+0.5)*cell.width,y:rect.top+(row+0.5)*cell.height};
            offset += chars.length;
          }
        }
        throw Error('Missing visible text: '+text);
      };
      window.viewTouch = (type,p) => {
        const event = new Event(type,{bubbles:true,cancelable:true});
        Object.defineProperty(event,'touches',{value:type==='touchend'?[]:[{clientX:p.x,clientY:p.y}]});
        document.getElementById('touch-surface').dispatchEvent(event);
      };
      // Exercise the real clipboard helper's fallback, including its DOM selection.
      document.addEventListener('copy', () => {
        const selected = document.querySelector('body > textarea[readonly]');
        window.copiedText = selected?.value.slice(selected.selectionStart,selected.selectionEnd);
      });
    });
    await page.evaluate(async () => {
      const start = window.cellPoint('alpha');
      const end = window.cellPoint('beta');
      window.viewTouch('touchstart',start);
      await new Promise(resolve => setTimeout(resolve,550));
      window.viewTouch('touchmove',{...end,x:end.x+3*window.term._core._renderService.dimensions.css.cell.width});
      window.viewTouch('touchend',end);
    });
    assert.equal(await page.evaluate(() => window.term.getSelection()), 'alpha beta');
    assert.equal(await page.evaluate(() => window.selectionMenu.hasSelection), true);
    await page.getByRole('button',{name:'선택 복사'}).tap();
    await page.waitForFunction(() => window.copySucceeded === true);
    assert.equal(await page.evaluate(() => window.copiedText), 'alpha beta');
    assert.equal(await page.evaluate(() => document.activeElement === window.term.textarea), false);
    await page.context().route('https://example.test/**', route => route.fulfill({body:'link destination'}));
    const point = await page.evaluate(() => window.cellPoint('-link'));
    const opened = page.waitForEvent('popup');
    await page.touchscreen.tap(point.x,point.y);
    const popup = await opened;
    await popup.waitForLoadState();
    assert.equal(popup.url(), url);
    assert.equal(await popup.evaluate(() => window.opener), null);
    await popup.close();
    assert.deepEqual(await page.evaluate(() => window.pointerInput), []);
    assert.deepEqual(await page.evaluate(() => window.input), []);
    await page.evaluate(()=>window.openMenu());
    await page.getByRole('button',{name:'텍스트로 보기'}).tap();
    assert.match(await page.getByRole('dialog').innerText(), /읽기와 복사/);
    await page.getByTitle('빠른 입력').tap();
    await page.waitForFunction(() => !window.term.options.disableStdin);
    await page.locator('#touch-surface').tap();
    assert.equal(await page.evaluate(() => document.activeElement === window.term.textarea), true);
    await page.keyboard.type('hello');
    assert.equal(await page.evaluate(() => window.input.join('')), 'hello');
    await boot();
    assert.equal(await page.locator('textarea').evaluate(el=>!el.readOnly), true);
    await page.evaluate(()=>window.setViewOnly(true));
    await page.waitForFunction(() => window.term.options.disableStdin);
    assert.equal(await page.evaluate(() => document.activeElement === window.term.textarea), false);
    await boot();
    await page.getByRole('button',{name:'퀵바 세트 선택',exact:true}).waitFor();
    for (const width of [320,375,430]) {
      await page.setViewportSize({width,height:667});
      await page.evaluate(() => window.fitTerminal());
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow');
      const settings = await page.getByRole('button',{name:/설정$/}).boundingBox();
      assert.ok(settings.x >= 0 && settings.x + settings.width <= width, 'Settings button stays visible');
    }
    await page.screenshot({path:'/tmp/terminal-mobile-view-'+engine.name()+'.png'});
    assert.deepEqual(errors, []);
    console.log(engine.name()+': view/input, selection/copy, wrapped links, bottom button and persistence passed');
  } finally { await browser.close(); }
}
