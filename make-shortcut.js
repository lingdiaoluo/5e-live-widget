// 生成桌面快捷方式（真正的"小程序"入口：没有黑窗口、有图标）
const { app, shell } = require('electron');
const path = require('path');
const os = require('os');

app.whenReady().then(() => {
  const appDir = __dirname;
  const exe = path.join(appDir, 'node_modules', 'electron', 'dist', 'electron.exe');
  const desktop = path.join(os.homedir(), 'Desktop');
  const lnk = path.join(desktop, '5E' + String.fromCharCode(0x6BD4) + String.fromCharCode(0x5206) + '.lnk');

  try {
    shell.writeShortcutLink(lnk, {
      target: exe,
      args: '"' + appDir + '"',
      cwd: appDir,
      description: '5E Score Widget',
      icon: path.join(appDir, 'assets', 'app.ico'),
      iconIndex: 0
    });
    console.log('OK ->', lnk);
  } catch (e) {
    console.log('ERR', e.message);
  }
  app.quit();
});
