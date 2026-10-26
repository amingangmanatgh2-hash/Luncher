'use strict';

/*
 * NEON RUSH for Windows.
 *
 * This is only a small, locked-down desktop shell. The actual game remains
 * the single shared WebGL build in app/src/main/assets/game, copied into
 * ./game by scripts/copy-game.cjs during start/build. The shell exposes no
 * Node.js or Electron IPC API to the page and refuses navigation away from
 * the bundled game.
 */

const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

const GAME_INDEX = path.join(__dirname, 'game', 'index.html');
const GAME_URL = pathToFileURL(GAME_INDEX).href;

let mainWindow = null;

function focusWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    title: 'NEON RUSH',
    width: 1280,
    height: 720,
    minWidth: 960,
    minHeight: 540,
    backgroundColor: '#070312',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  mainWindow.setMenuBarVisibility(false);

  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Do not let game content create browser/app windows. A GitHub link, if
    // one is ever added to the UI, can still be opened in the user's browser.
    if (url.startsWith('https://github.com/')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== GAME_URL) event.preventDefault();
  });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;

    if (input.code === 'F11' || (input.alt && input.code === 'Enter')) {
      event.preventDefault();
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
    } else if (input.control && input.code === 'KeyQ') {
      event.preventDefault();
      app.quit();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  void mainWindow.loadFile(GAME_INDEX);
}

app.setName('NEON RUSH');

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', focusWindow);

  void app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
