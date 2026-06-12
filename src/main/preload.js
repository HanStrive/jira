const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("gorilla", {
  getAppInfo: () => ipcRenderer.invoke("app:get-info"),
  getConfig: () => ipcRenderer.invoke("config:get"),
  setConfig: (patch) => ipcRenderer.invoke("config:set", patch),
  openDataDir: () => ipcRenderer.invoke("app:open-data-dir"),
  openExternal: (url) => ipcRenderer.invoke("app:open-external", url),
  showMainWindow: () => ipcRenderer.invoke("window:show-main"),
  closeWindow: () => ipcRenderer.invoke("window:close"),
  quitApp: () => ipcRenderer.invoke("app:quit"),
  setWindowMode: (mode) => ipcRenderer.invoke("window:set-mode", mode),
  startFloatingDrag: (screenX, screenY) => ipcRenderer.invoke("floating:drag-start", screenX, screenY),
  moveFloatingDrag: (screenX, screenY) => ipcRenderer.invoke("floating:drag-move", screenX, screenY),
  endFloatingDrag: () => ipcRenderer.invoke("floating:drag-end"),
  showFloatingMenu: () => ipcRenderer.invoke("floating:show-menu"),
  notifyUserChanged: (user) => ipcRenderer.invoke("user:changed", user),
  onUserChanged: (callback) => {
    const listener = (_event, user) => callback(user);
    ipcRenderer.on("user:changed", listener);
    return () => ipcRenderer.removeListener("user:changed", listener);
  },
  onConfigChanged: (callback) => {
    const listener = (_event, config) => callback(config);
    ipcRenderer.on("config:changed", listener);
    return () => ipcRenderer.removeListener("config:changed", listener);
  },
  onFloatingStats: (callback) => {
    const listener = (_event, stats) => callback(stats);
    ipcRenderer.on("floating:stats", listener);
    return () => ipcRenderer.removeListener("floating:stats", listener);
  }
});
