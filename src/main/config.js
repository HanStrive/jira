const fs = require("fs");
const path = require("path");
const os = require("os");

const APP_NAME = "Gorilla Jira";
const SERVER_PORT = 37371;

function getUserDataPath(app) {
  if (app && app.getPath) {
    return app.getPath("userData");
  }
  return path.join(os.homedir(), "AppData", "Roaming", APP_NAME);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function getPaths(app) {
  const userData = getUserDataPath(app);
  const avatars = path.join(userData, "avatars");
  const attachments = path.join(userData, "attachments");
  const downloads = path.join(userData, "downloads");
  ensureDir(userData);
  ensureDir(avatars);
  ensureDir(attachments);
  ensureDir(downloads);
  return {
    userData,
    avatars,
    attachments,
    downloads,
    db: path.join(userData, "gorilla-jira.db"),
    config: path.join(userData, "config.json")
  };
}

function getDefaultConfig() {
  return {
    serverModeEnabled: true,
    serverBaseUrl: `http://127.0.0.1:${SERVER_PORT}`,
    floatingWindowEnabled: true,
    floatingWindowAlwaysOnTop: true,
    closeBehavior: "tray",
    windowBounds: null
  };
}

function readConfig(app) {
  const paths = getPaths(app);
  const defaults = getDefaultConfig();
  if (!fs.existsSync(paths.config)) {
    writeConfig(app, defaults);
    return defaults;
  }

  try {
    const raw = fs.readFileSync(paths.config, "utf8");
    return { ...defaults, ...JSON.parse(raw) };
  } catch (error) {
    return defaults;
  }
}

function writeConfig(app, config) {
  const paths = getPaths(app);
  fs.writeFileSync(paths.config, JSON.stringify(config, null, 2), "utf8");
}

function patchConfig(app, patch) {
  const next = { ...readConfig(app), ...patch };
  writeConfig(app, next);
  return next;
}

module.exports = {
  APP_NAME,
  SERVER_PORT,
  getPaths,
  readConfig,
  writeConfig,
  patchConfig
};
