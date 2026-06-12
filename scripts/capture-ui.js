const fs = require("fs");
const path = require("path");
const os = require("os");
const { pathToFileURL } = require("url");
const { app, BrowserWindow, ipcMain } = require("electron");
const { startServer } = require("../src/main/server");

const ROOT = path.join(__dirname, "..");
const PORT = 37372;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const CAPTURE_DIR = path.join(ROOT, "docs", "screenshots");
const DATA_DIR = path.join(ROOT, ".tmp", "ui-capture-data");
const PREVIEW_PNG = fs.readFileSync(path.join(ROOT, "src", "main", "assets", "app-tray.png"));

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function makePaths() {
  const paths = {
    userData: DATA_DIR,
    avatars: path.join(DATA_DIR, "avatars"),
    attachments: path.join(DATA_DIR, "attachments"),
    downloads: path.join(DATA_DIR, "downloads"),
    db: path.join(DATA_DIR, "gorilla-jira.db"),
    config: path.join(DATA_DIR, "config.json")
  };
  Object.values(paths).forEach((value) => {
    if (!path.extname(value)) ensureDir(value);
  });
  ensureDir(CAPTURE_DIR);
  return paths;
}

async function request(method, route, token, body) {
  const response = await fetch(`${BASE_URL}${route}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || `${method} ${route} failed`);
  }
  return data;
}

async function seedDemoData() {
  const name = `UI测试_${Date.now()}`;
  const auth = await request("POST", "/api/auth/register", "", {
    name,
    password: "123456",
    avatarUrl: ""
  });
  const token = auth.token;
  const versions = await request("GET", "/api/versions", token);
  const versionId = versions.versions[0]?.id;
  const firstTask = await request("POST", "/api/tasks", token, {
    title: "修复战斗结算奖励弹窗",
    description: "奖励数字、道具图标和领取按钮需要和新版本表现一致。",
    versionId,
    assigneeId: auth.user.id,
    status: "doing",
    priority: "urgent"
  });
  const form = new FormData();
  form.append("attachments", new Blob([PREVIEW_PNG], { type: "image/png" }), "reward-preview.png");
  const uploadResponse = await fetch(`${BASE_URL}/api/tasks/${firstTask.task.id}/attachments`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form
  });
  if (!uploadResponse.ok) {
    throw new Error("Attachment upload failed during capture");
  }
  await request("POST", "/api/tasks", token, {
    title: "设计 1.0.2 活动入口卡牌",
    description: "补齐活动入口、红点状态和未解锁表现。",
    versionId,
    assigneeId: auth.user.id,
    status: "todo",
    priority: "high"
  });
  return { ...auth, firstTaskId: firstTask.task.id };
}

function registerIpc(paths, config) {
  ipcMain.handle("app:get-info", async () => ({
    name: "Gorilla Jira",
    version: "1.0.15",
    isPackaged: false,
    serverPort: PORT,
    localIps: ["127.0.0.1"],
    dataPath: paths.userData
  }));
  ipcMain.handle("config:get", async () => config);
  ipcMain.handle("config:set", async (_event, patch) => {
    Object.assign(config, patch);
    BrowserWindow.getAllWindows().forEach((window) => window.webContents.send("config:changed", config));
    return config;
  });
  ipcMain.handle("app:open-data-dir", async () => true);
  ipcMain.handle("app:open-external", async () => true);
  ipcMain.handle("window:show-main", async () => true);
  ipcMain.handle("window:close", async () => true);
  ipcMain.handle("app:quit", async () => true);
  ipcMain.handle("floating:drag-start", async () => true);
  ipcMain.handle("floating:drag-move", async () => true);
  ipcMain.handle("floating:drag-end", async () => true);
  ipcMain.handle("floating:show-menu", async () => true);
  ipcMain.handle("window:set-mode", async (event, mode) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return false;
    window.setMinimumSize(450, 800);
    window.setSize(576, 1024, false);
    window.setAspectRatio(9 / 16);
    window.center();
    return true;
  });
  ipcMain.handle("user:changed", async (_event, user) => {
    BrowserWindow.getAllWindows().forEach((window) => window.webContents.send("user:changed", user || null));
    return true;
  });
}

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function capture(window, filename) {
  await wait(1600);
  const image = await window.webContents.capturePage();
  fs.writeFileSync(path.join(CAPTURE_DIR, filename), image.toPNG());
}

async function clickSelector(window, selector) {
  const point = await window.webContents.executeJavaScript(`
    (() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    })()
  `);
  if (!point) {
    throw new Error(`Unable to click missing selector: ${selector}`);
  }
  window.webContents.sendInputEvent({ type: "mouseMove", x: point.x, y: point.y });
  window.webContents.sendInputEvent({ type: "mouseDown", x: point.x, y: point.y, button: "left", clickCount: 1 });
  window.webContents.sendInputEvent({ type: "mouseUp", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await wait(350);
}

async function typeInto(window, selector, text) {
  await clickSelector(window, selector);
  await window.webContents.insertText(text);
  await wait(250);
  return window.webContents.executeJavaScript(`
    document.querySelector(${JSON.stringify(selector)})?.value || ""
  `);
}

async function setInputValue(window, selector, value) {
  await window.webContents.executeJavaScript(`
    (() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()
  `);
  await wait(250);
}

app.whenReady().then(async () => {
  if (fs.existsSync(DATA_DIR)) {
    const resolved = path.resolve(DATA_DIR);
    const expectedRoot = path.resolve(ROOT, ".tmp");
    if (!resolved.startsWith(expectedRoot + path.sep)) {
      throw new Error(`Refusing to remove unexpected path: ${resolved}`);
    }
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
  }
  const paths = makePaths();
  const config = {
    serverModeEnabled: true,
    serverBaseUrl: BASE_URL,
    floatingWindowEnabled: true,
    floatingWindowAlwaysOnTop: true,
    closeBehavior: "tray",
    lastToken: ""
  };
  const server = await startServer({
    paths,
    port: PORT,
    getConfig: () => config,
    getAppVersion: () => "1.0.15"
  });
  registerIpc(paths, config);

  const window = new BrowserWindow({
    width: 576,
    height: 1024,
    show: false,
    backgroundColor: "#112241",
    webPreferences: {
      preload: path.join(ROOT, "src", "main", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  await window.loadURL(pathToFileURL(path.join(ROOT, "dist", "index.html")).toString());
  await capture(window, "login.png");

  const auth = await seedDemoData();
  config.lastToken = auth.token;
  await window.webContents.executeJavaScript(`
    localStorage.setItem("gorilla.token", ${JSON.stringify(auth.token)});
    localStorage.setItem("gorilla.user", ${JSON.stringify(JSON.stringify(auth.user))});
    localStorage.setItem("gorilla.serverBaseUrl", ${JSON.stringify(BASE_URL)});
  `);
  await window.reload();
  await capture(window, "task-hall.png");

  await clickSelector(window, ".royal-menu-wrap .royal-square-button");
  await clickSelector(window, ".royal-menu-popover button");
  await capture(window, "settings.png");
  await window.webContents.executeJavaScript(`
    Array.from(document.querySelectorAll(".settings-list-card"))
      .find((element) => element.textContent.includes("修改昵称"))?.click();
  `);
  await wait(400);
  await capture(window, "rename-dialog.png");
  await setInputValue(window, ".rename-royal-field input", "昵称验收");
  await clickSelector(window, ".rename-royal-save");
  await wait(900);
  await window.webContents.executeJavaScript(`
    document.querySelector(".toast button")?.click();
  `);
  await wait(250);
  await clickSelector(window, ".royal-frame-actions .royal-square-button.back");

  await clickSelector(window, ".royal-frame-actions .royal-square-button.primary");
  const titleValue = await typeInto(window, ".task-input-wrap input", "可输入标题验证");
  const descriptionValue = await typeInto(window, ".task-input-wrap textarea", "可输入描述验证");
  if (!titleValue.includes("可输入标题验证") || !descriptionValue.includes("可输入描述验证")) {
    throw new Error("New task title or description input is not editable");
  }
  await capture(window, "task-new-input.png");
  await clickSelector(window, ".task-editor-submit button");
  await wait(900);
  await window.webContents.executeJavaScript(`
    document.querySelector(".toast button")?.click();
  `);
  await wait(250);

  await window.webContents.executeJavaScript(`
    document.querySelector(".jira-task-main")?.click();
  `);
  await capture(window, "task-modal-attachments.png");
  await clickSelector(window, ".royal-frame-actions .royal-square-button.back");

  await request("DELETE", `/api/tasks/${auth.firstTaskId}`, auth.token);
  await window.webContents.executeJavaScript(`
    (async () => {
      document.querySelector(".royal-menu-wrap .royal-square-button")?.click();
      await new Promise((resolve) => setTimeout(resolve, 100));
      Array.from(document.querySelectorAll(".royal-menu-popover button")).find((button) => button.textContent.includes("垃圾桶"))?.click();
    })()
  `);
  await capture(window, "trash-bin.png");

  const floatingWindow = new BrowserWindow({
    width: 126,
    height: 146,
    show: false,
    frame: false,
    resizable: false,
    transparent: true,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(ROOT, "src", "main", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  await floatingWindow.loadURL(`${pathToFileURL(path.join(ROOT, "dist", "index.html")).toString()}#/floating`);
  await floatingWindow.webContents.executeJavaScript(`
    localStorage.setItem("gorilla.token", ${JSON.stringify(auth.token)});
    localStorage.setItem("gorilla.user", ${JSON.stringify(JSON.stringify(auth.user))});
    localStorage.setItem("gorilla.serverBaseUrl", ${JSON.stringify(BASE_URL)});
  `);
  await floatingWindow.reload();
  await capture(floatingWindow, "floating-widget.png");
  floatingWindow.close();

  await server.close();
  app.quit();
});
