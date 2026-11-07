const { _electron } = require('playwright'); const fs = require('fs');
const APP = require('path').resolve(__dirname, '../..'); const S = process.env.S; const OUT = process.env.OUT; const CSS = process.env.CSS ? fs.readFileSync(process.env.CSS,'utf8') : '';
const JS = process.env.JS ? fs.readFileSync(process.env.JS,'utf8') : '';
(async () => {
  const app = await _electron.launch({ executablePath: require('path').join(APP, 'node_modules/electron/dist/electron'),
    args: [APP, '--no-sandbox'], env: { ...process.env, HOME: S + '/fakehome', ENGRAM_TODAY: '2026-11-07' } });
  const win = await app.firstWindow();
  win.on('pageerror', e => console.log('PAGEERR', e.message));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
  await win.evaluate(() => localStorage.setItem('engram-theme-choice', 'dark'));
  await win.reload(); await win.waitForTimeout(4500);
  const apply = async () => { if (CSS) await win.addStyleTag({ content: CSS }); if (JS) await win.evaluate(JS); await win.waitForTimeout(400); };
  const shot = async (n) => { await apply(); await win.screenshot({ path: `${OUT}/${n}.png` }); };
  await win.getByRole('button', { name: /^home$/i }).first().click().catch(()=>console.log('nohome')); await win.waitForTimeout(2000); await shot('1-home');
  await win.keyboard.press('Control+1'); await win.waitForTimeout(1800); await shot('2-learn');
  await win.keyboard.press('Control+3'); await win.waitForTimeout(2500); await shot('3-topicmap');
  await win.keyboard.press('Control+4'); await win.waitForTimeout(2500); await shot('4-coach');
  await win.keyboard.press('Control+1'); await win.waitForTimeout(1500);
  await win.click('button:has-text("Continue")'); await win.waitForTimeout(7000); await shot('5-session');
  await app.close();
})().catch(e => { console.error(e); process.exit(1) });
