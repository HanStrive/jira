const path = require("path");
const os = require("os");
const { pathToFileURL } = require("url");
const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage, screen } = require("electron");
const { APP_NAME, SERVER_PORT, getPaths, readConfig, patchConfig } = require("./config");
const { startServer } = require("./server");

const isDev = !app.isPackaged;
let mainWindow = null;
let floatingWindow = null;
let tray = null;
let serverState = null;
let floatingTimer = null;
let mainWindowMode = "main";
let isQuitting = false;
let floatingDrag = null;

const MAIN_WINDOW_DEFAULT_WIDTH = 576;
const MAIN_WINDOW_DEFAULT_HEIGHT = 1024;
const MAIN_WINDOW_MIN_WIDTH = 450;
const MAIN_WINDOW_MIN_HEIGHT = 800;

app.setAppUserModelId("com.gorilla.jira");
Menu.setApplicationMenu(null);

function getMainAssetPath(fileName) {
  return path.join(__dirname, "assets", fileName);
}

function getAppIcon() {
  const icon = nativeImage.createFromPath(getMainAssetPath("app-tray.png"));
  return icon.isEmpty() ? nativeImage.createEmpty() : icon;
}

function getRendererUrl(route = "") {
  if (isDev) {
    return `http://127.0.0.1:5173${route}`;
  }
  return `${pathToFileURL(path.join(__dirname, "../../dist/index.html")).toString()}${route}`;
}

function portraitSize() {
  const { width: workWidth, height: workHeight } = screen.getPrimaryDisplay().workArea;
  const maxWidth = Math.max(320, workWidth - 32);
  const maxHeight = Math.max(560, workHeight - 32);
  const scale = Math.min(1, maxWidth / MAIN_WINDOW_DEFAULT_WIDTH, maxHeight / MAIN_WINDOW_DEFAULT_HEIGHT);
  return {
    width: Math.round(MAIN_WINDOW_DEFAULT_WIDTH * scale),
    height: Math.round(MAIN_WINDOW_DEFAULT_HEIGHT * scale)
  };
}

function centerPortraitBounds() {
  const { width, height } = portraitSize();
  const { x, y, width: workWidth, height: workHeight } = screen.getPrimaryDisplay().workArea;
  return {
    width,
    height,
    x: Math.round(x + (workWidth - width) / 2),
    y: Math.round(y + (workHeight - height) / 2)
  };
}

function normalizeMainWindowBounds(savedBounds = {}) {
  const bounds = centerPortraitBounds();
  if (Number.isFinite(savedBounds.x) && Number.isFinite(savedBounds.y)) {
    return {
      ...bounds,
      x: savedBounds.x,
      y: savedBounds.y
    };
  }
  return bounds;
}

function setPortraitMinimum() {
  const minScale = Math.min(1, screen.getPrimaryDisplay().workArea.height / MAIN_WINDOW_DEFAULT_HEIGHT);
  mainWindow.setMinimumSize(
    Math.round(MAIN_WINDOW_MIN_WIDTH * minScale),
    Math.round(MAIN_WINDOW_MIN_HEIGHT * minScale)
  );
}

function applyPortraitBounds() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  setPortraitMinimum();
  mainWindow.setBounds(centerPortraitBounds(), false);
  mainWindow.setAspectRatio(9 / 16);
}

function restorePortraitPosition() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const config = readConfig(app);
  setPortraitMinimum();
  mainWindow.setBounds(normalizeMainWindowBounds(config.windowBounds), false);
  mainWindow.setAspectRatio(9 / 16);
}

function savePortraitPosition() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const bounds = mainWindow.getBounds();
  patchConfig(app, {
    windowBounds: {
      x: bounds.x,
      y: bounds.y
    }
  });
}

function applyMainWindowMode(mode) {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  mainWindowMode = mode === "auth" ? "auth" : "main";
  restorePortraitPosition();
}

function createMainWindow() {
  const config = readConfig(app);
  const bounds = normalizeMainWindowBounds(config.windowBounds);
  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: MAIN_WINDOW_MIN_WIDTH,
    minHeight: MAIN_WINDOW_MIN_HEIGHT,
    show: false,
    frame: false,
    autoHideMenuBar: true,
    title: APP_NAME,
    icon: getMainAssetPath("app-tray.png"),
    backgroundColor: "#112241",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.setMenu(null);
  mainWindow.setMenuBarVisibility(false);
  restorePortraitPosition();
  mainWindow.loadURL(getRendererUrl(""));
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("close", (event) => {
    if (!mainWindow.isDestroyed() && mainWindowMode === "main") {
      savePortraitPosition();
    }
    const config = readConfig(app);
    if (!isQuitting && config.closeBehavior !== "quit") {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function createFloatingWindow() {
  const config = readConfig(app);
  if (!config.floatingWindowEnabled || floatingWindow) {
    return;
  }

  const { width: screenWidth, height: screenHeight } = require("electron").screen.getPrimaryDisplay().workAreaSize;
  floatingWindow = new BrowserWindow({
    width: 126,
    height: 146,
    x: screenWidth - 150,
    y: screenHeight - 172,
    frame: false,
    resizable: false,
    transparent: true,
    skipTaskbar: true,
    title: "",
    alwaysOnTop: config.floatingWindowAlwaysOnTop,
    focusable: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  floatingWindow.loadURL(getRendererUrl("#/floating"));
  floatingWindow.setTitle("");
  floatingWindow.setVisibleOnAllWorkspaces(false);
  floatingWindow.webContents.on("page-title-updated", (event) => {
    event.preventDefault();
    floatingWindow?.setTitle("");
  });
  floatingWindow.on("closed", () => {
    floatingWindow = null;
    floatingDrag = null;
  });
}

function syncFloatingWindow() {
  const config = readConfig(app);
  if (!config.floatingWindowEnabled) {
    if (floatingWindow) {
      floatingWindow.close();
    }
    return;
  }
  if (!floatingWindow) {
    createFloatingWindow();
  }
  if (floatingWindow) {
    floatingWindow.setAlwaysOnTop(Boolean(config.floatingWindowAlwaysOnTop), "floating");
  }
}

function createTray() {
  const image = getAppIcon();
  tray = new Tray(image);
  tray.setToolTip(APP_NAME);
  tray.on("click", showMainWindow);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "打开 Gorilla Jira", click: showMainWindow },
      { label: "显示 / 隐藏浮窗", click: toggleFloatingWindow },
      { type: "separator" },
      { label: "退出", click: quitApp }
    ])
  );
}

function showMainWindow() {
  if (!mainWindow) {
    createMainWindow();
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

function closeMainWindowByPreference() {
  const config = readConfig(app);
  if (config.closeBehavior === "quit") {
    quitApp();
    return;
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    savePortraitPosition();
    mainWindow.hide();
  }
}

function quitApp() {
  isQuitting = true;
  app.quit();
}

function clampFloatingPosition(x, y) {
  if (!floatingWindow || floatingWindow.isDestroyed()) {
    return { x, y };
  }
  const bounds = floatingWindow.getBounds();
  const display = screen.getDisplayNearestPoint({ x, y });
  const area = display.workArea;
  return {
    x: Math.min(Math.max(Math.round(x), area.x), area.x + area.width - bounds.width),
    y: Math.min(Math.max(Math.round(y), area.y), area.y + area.height - bounds.height)
  };
}

function startFloatingDrag(screenX, screenY) {
  if (!floatingWindow || floatingWindow.isDestroyed()) return false;
  const bounds = floatingWindow.getBounds();
  floatingDrag = {
    offsetX: Math.round(screenX) - bounds.x,
    offsetY: Math.round(screenY) - bounds.y
  };
  return true;
}

function moveFloatingDrag(screenX, screenY) {
  if (!floatingWindow || floatingWindow.isDestroyed() || !floatingDrag) return false;
  const next = clampFloatingPosition(
    Math.round(screenX) - floatingDrag.offsetX,
    Math.round(screenY) - floatingDrag.offsetY
  );
  floatingWindow.setPosition(next.x, next.y, false);
  return true;
}

function endFloatingDrag() {
  floatingDrag = null;
  return true;
}

function showFloatingContextMenu() {
  if (!floatingWindow || floatingWindow.isDestroyed()) return false;
  Menu.buildFromTemplate([
    { label: "退出 Gorilla Jira", click: quitApp }
  ]).popup({ window: floatingWindow });
  return true;
}

function toggleFloatingWindow() {
  const config = readConfig(app);
  const next = patchConfig(app, { floatingWindowEnabled: !config.floatingWindowEnabled });
  notifyConfigChanged(next);
  syncFloatingWindow();
}

function notifyConfigChanged(config) {
  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send("config:changed", config);
  });
}

function notifyUserChanged(user) {
  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send("user:changed", user);
  });
  emitFloatingStats();
}

function getLocalIps() {
  const nets = os.networkInterfaces();
  const results = [];
  Object.values(nets).forEach((items) => {
    items?.forEach((item) => {
      if (item.family === "IPv4" && !item.internal) {
        results.push(item.address);
      }
    });
  });
  return results;
}

async function emitFloatingStats() {
  if (!floatingWindow || !serverState?.getFloatingStats) {
    return;
  }
  const stats = await serverState.getFloatingStats().catch(() => null);
  if (stats) {
    floatingWindow.webContents.send("floating:stats", stats);
  }
}

function registerIpc() {
  ipcMain.handle("app:get-info", async () => ({
    name: APP_NAME,
    version: app.getVersion(),
    isPackaged: app.isPackaged,
    serverPort: SERVER_PORT,
    localIps: getLocalIps(),
    dataPath: getPaths(app).userData
  }));

  ipcMain.handle("config:get", async () => readConfig(app));

  ipcMain.handle("config:set", async (_event, patch) => {
    const next = patchConfig(app, patch);
    notifyConfigChanged(next);
    syncFloatingWindow();
    return next;
  });

  ipcMain.handle("app:open-data-dir", async () => {
    await shell.openPath(getPaths(app).userData);
    return true;
  });

  ipcMain.handle("app:open-external", async (_event, url) => {
    const target = String(url || "");
    if (/^https?:\/\//i.test(target)) {
      await shell.openExternal(target);
      return true;
    }
    return false;
  });

  ipcMain.handle("window:show-main", async () => {
    showMainWindow();
    return true;
  });

  ipcMain.handle("app:quit", async () => {
    quitApp();
    return true;
  });

  ipcMain.handle("window:close", async () => {
    closeMainWindowByPreference();
    return true;
  });

  ipcMain.handle("window:set-mode", async (event, mode) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window || window !== mainWindow) {
      return false;
    }
    applyMainWindowMode(mode);
    return true;
  });

  ipcMain.handle("floating:drag-start", async (event, screenX, screenY) => {
    if (BrowserWindow.fromWebContents(event.sender) !== floatingWindow) return false;
    return startFloatingDrag(screenX, screenY);
  });

  ipcMain.handle("floating:drag-move", async (event, screenX, screenY) => {
    if (BrowserWindow.fromWebContents(event.sender) !== floatingWindow) return false;
    return moveFloatingDrag(screenX, screenY);
  });

  ipcMain.handle("floating:drag-end", async (event) => {
    if (BrowserWindow.fromWebContents(event.sender) !== floatingWindow) return false;
    return endFloatingDrag();
  });

  ipcMain.handle("floating:show-menu", async (event) => {
    if (BrowserWindow.fromWebContents(event.sender) !== floatingWindow) return false;
    return showFloatingContextMenu();
  });

  ipcMain.handle("user:changed", async (_event, user) => {
    notifyUserChanged(user || null);
    return true;
  });
}

app.whenReady().then(async () => {
  const paths = getPaths(app);
  serverState = await startServer({
    paths,
    port: SERVER_PORT,
    getConfig: () => readConfig(app),
    getAppVersion: () => app.getVersion()
  });
  registerIpc();
  createMainWindow();
  createFloatingWindow();
  createTray();
  floatingTimer = setInterval(emitFloatingStats, 5000);
  emitFloatingStats();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
    syncFloatingWindow();
  }
});

app.on("window-all-closed", () => {
  if (isQuitting || readConfig(app).closeBehavior === "quit") {
    quitApp();
  }
});

app.on("before-quit", async () => {
  isQuitting = true;
  if (floatingTimer) {
    clearInterval(floatingTimer);
  }
  if (serverState?.close) {
    await serverState.close();
  }
});
