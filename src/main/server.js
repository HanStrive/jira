const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const {
  createDatabase,
  run,
  all,
  first,
  now,
  id,
  toUser,
  toVersion,
  toTask,
  toAttachment
} = require("./database");

const MAX_TASK_ATTACHMENTS = 5;
const TRASH_RETENTION_DAYS = 15;
const IMAGE_VIDEO_MIME = /^(image|video)\//;
const GITHUB_REPO = "HanStrive/jira";
const GITHUB_RAW_UPDATE_URL = `https://raw.githubusercontent.com/${GITHUB_REPO}/main/update.json`;
const GITHUB_LATEST_RELEASE_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
const GITHUB_TAGS_URL = `https://api.github.com/repos/${GITHUB_REPO}/tags?per_page=30`;
const GITHUB_RELEASES_URL = `https://github.com/${GITHUB_REPO}/releases`;

function makeStorage(targetDir) {
  return multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, targetDir),
    filename: (_req, file, callback) => {
      const ext = path.extname(file.originalname || "");
      callback(null, `${Date.now()}-${id()}${ext}`);
    }
  });
}

function normalizeReleaseVersion(value) {
  return String(value || "").trim().replace(/^v/i, "");
}

function compareVersions(a, b) {
  const left = normalizeReleaseVersion(a).split(".").map((part) => Number.parseInt(part, 10) || 0);
  const right = normalizeReleaseVersion(b).split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const next = left[i] || 0;
    const current = right[i] || 0;
    if (next > current) return 1;
    if (next < current) return -1;
  }
  return 0;
}

function pickInstallerAsset(assets = []) {
  return assets.find((asset) => /setup.*\.exe$/i.test(asset.name || ""))
    || assets.find((asset) => /\.exe$/i.test(asset.name || ""))
    || null;
}

function normalizeUpdateManifest(manifest, currentVersion, source) {
  const version = normalizeReleaseVersion(manifest.version || manifest.tagName || currentVersion);
  const hasUpdate = compareVersions(version, currentVersion) > 0;
  const downloadUrl = String(manifest.downloadUrl || "");
  return {
    version,
    currentVersion,
    hasUpdate,
    canDownload: Boolean(downloadUrl) && manifest.canDownload !== false,
    needsReleaseAsset: hasUpdate && (!downloadUrl || manifest.needsReleaseAsset === true),
    tagName: manifest.tagName || (version ? `v${version}` : ""),
    releaseDate: manifest.releaseDate || now().slice(0, 10),
    notes: manifest.notes || (hasUpdate ? "发现新版本。" : "当前已是最新版本。"),
    downloadUrl,
    pageUrl: manifest.pageUrl || GITHUB_RELEASES_URL,
    assetName: manifest.assetName || "",
    source,
    force: Boolean(manifest.force)
  };
}

async function getGithubRawUpdateManifest(currentVersion) {
  const response = await fetch(`${GITHUB_RAW_UPDATE_URL}?t=${Date.now()}`, {
    headers: {
      Accept: "application/json",
      "Cache-Control": "no-cache",
      "User-Agent": "Gorilla-Jira-Updater"
    }
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`GitHub raw update check failed: ${response.status}`);
  }
  return normalizeUpdateManifest(await response.json(), currentVersion, "github-raw");
}

async function getGithubUpdateManifest(currentVersion) {
  const response = await fetch(GITHUB_LATEST_RELEASE_URL, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "Gorilla-Jira-Updater"
    }
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`GitHub update check failed: ${response.status}`);
  }
  const release = await response.json();
  if (release.draft || release.prerelease) {
    return null;
  }
  const asset = pickInstallerAsset(release.assets || []);
  const version = normalizeReleaseVersion(release.tag_name || release.name || currentVersion);
  const hasUpdate = compareVersions(version, currentVersion) > 0;
  return normalizeUpdateManifest({
    version,
    canDownload: Boolean(asset?.browser_download_url),
    needsReleaseAsset: hasUpdate && !asset?.browser_download_url,
    tagName: release.tag_name || "",
    releaseDate: String(release.published_at || release.created_at || now()).slice(0, 10),
    notes: release.body || "发现新版本。",
    downloadUrl: asset?.browser_download_url || release.html_url || "",
    pageUrl: release.html_url || GITHUB_RELEASES_URL,
    assetName: asset?.name || "",
    force: false
  }, currentVersion, "github-release");
}

async function getGithubTagUpdateManifest(currentVersion) {
  const response = await fetch(GITHUB_TAGS_URL, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "Gorilla-Jira-Updater"
    }
  });
  if (!response.ok) {
    throw new Error(`GitHub tag check failed: ${response.status}`);
  }
  const tags = await response.json();
  const latest = (Array.isArray(tags) ? tags : [])
    .map((tag) => ({ ...tag, version: normalizeReleaseVersion(tag.name) }))
    .filter((tag) => /^\d+(\.\d+){1,3}$/.test(tag.version))
    .sort((a, b) => compareVersions(b.version, a.version))[0];

  if (!latest) {
    return null;
  }

  const hasUpdate = compareVersions(latest.version, currentVersion) > 0;
  return normalizeUpdateManifest({
    version: latest.version,
    canDownload: false,
    needsReleaseAsset: hasUpdate,
    tagName: latest.name,
    releaseDate: now().slice(0, 10),
    notes: hasUpdate
      ? "GitHub 已检测到新版本标签，但还没有可下载的 Release 安装包。"
      : "当前已是最新版本。",
    downloadUrl: "",
    pageUrl: GITHUB_RELEASES_URL,
    assetName: "",
    force: false
  }, currentVersion, "github-tag");
}

function getLocalUpdateManifest(paths, currentVersion) {
  const manifestPath = path.resolve(paths.downloads, "app-update.json");
  if (!fs.existsSync(manifestPath)) {
    return null;
  }
  return normalizeUpdateManifest(JSON.parse(fs.readFileSync(manifestPath, "utf-8")), currentVersion, "local");
}

async function startServer({ paths, port, getConfig, getAppVersion }) {
  const store = await createDatabase(paths.db);
  const db = store.db;
  purgeExpiredDeletedTasks(db, paths, store);
  const app = express();
  const avatarUpload = multer({
    storage: makeStorage(paths.avatars),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, callback) => callback(null, /^image\//.test(file.mimetype))
  });
  const attachmentUpload = multer({
    storage: makeStorage(paths.attachments),
    limits: { fileSize: 100 * 1024 * 1024 },
    fileFilter: (_req, file, callback) => callback(null, IMAGE_VIDEO_MIME.test(file.mimetype))
  });

  app.use(cors());
  app.use(express.json({ limit: "4mb" }));
  app.use("/avatars", express.static(paths.avatars));
  app.use("/attachments", express.static(paths.attachments));
  app.use("/downloads", express.static(paths.downloads));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, app: "Gorilla Jira", version: getAppVersion(), time: now() });
  });

  app.post("/api/auth/register", (req, res) => {
    const name = String(req.body.name || "").trim();
    const password = String(req.body.password || "");
    const avatarUrl = req.body.avatarUrl || makeAvatar(name);
    if (!name || password.length < 4) {
      return res.status(400).json({ message: "名称不能为空，密码至少 4 位。" });
    }
    if (first(db, "SELECT id FROM users WHERE name = ?", [name])) {
      return res.status(409).json({ message: "这个名称已经被注册了。" });
    }
    const userId = id();
    const token = id();
    const time = now();
    const passwordHash = bcrypt.hashSync(password, 10);
    run(db, "INSERT INTO users (id, name, password_hash, avatar_url, token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [
      userId,
      name,
      passwordHash,
      avatarUrl,
      token,
      time,
      time
    ]);
    store.persist();
    const user = toUser(first(db, "SELECT * FROM users WHERE id = ?", [userId]));
    res.json({ token, user });
  });

  app.post("/api/auth/login", (req, res) => {
    const name = String(req.body.name || "").trim();
    const password = String(req.body.password || "");
    const row = first(db, "SELECT * FROM users WHERE name = ?", [name]);
    if (!row || !bcrypt.compareSync(password, row.password_hash)) {
      return res.status(401).json({ message: "名称或密码不正确。" });
    }
    const token = id();
    run(db, "UPDATE users SET token = ?, updated_at = ? WHERE id = ?", [token, now(), row.id]);
    store.persist();
    res.json({ token, user: toUser(first(db, "SELECT * FROM users WHERE id = ?", [row.id])) });
  });

  app.get("/api/auth/me", requireAuth, (req, res) => {
    res.json({ user: toUser(req.user) });
  });

  app.post("/api/auth/logout", requireAuth, (req, res) => {
    run(db, "UPDATE users SET token = NULL WHERE id = ?", [req.user.id]);
    store.persist();
    res.json({ ok: true });
  });

  app.get("/api/users", requireAuth, (_req, res) => {
    res.json({ users: all(db, "SELECT * FROM users ORDER BY created_at ASC").map(toUser) });
  });

  app.put("/api/users/me", requireAuth, (req, res) => {
    const name = String(req.body.name || "").trim();
    const avatarUrl = req.body.avatarUrl;
    if (!name) {
      return res.status(400).json({ message: "名称不能为空。" });
    }
    const duplicate = first(db, "SELECT id FROM users WHERE name = ? AND id <> ?", [name, req.user.id]);
    if (duplicate) {
      return res.status(409).json({ message: "这个名称已经被使用了。" });
    }
    run(db, "UPDATE users SET name = ?, avatar_url = ?, updated_at = ? WHERE id = ?", [
      name,
      avatarUrl || req.user.avatar_url,
      now(),
      req.user.id
    ]);
    store.persist();
    res.json({ user: toUser(first(db, "SELECT * FROM users WHERE id = ?", [req.user.id])) });
  });

  app.post("/api/users/me/avatar", requireAuth, avatarUpload.single("avatar"), (req, res) => {
    if (!req.file) {
      return res.status(400).json({ message: "请上传图片头像。" });
    }
    const avatarUrl = `/avatars/${req.file.filename}`;
    run(db, "UPDATE users SET avatar_url = ?, updated_at = ? WHERE id = ?", [avatarUrl, now(), req.user.id]);
    store.persist();
    res.json({ avatarUrl, user: toUser(first(db, "SELECT * FROM users WHERE id = ?", [req.user.id])) });
  });

  app.get("/api/versions", requireAuth, (_req, res) => {
    const rows = all(db, "SELECT * FROM project_versions ORDER BY created_at DESC");
    res.json({ versions: rows.map(toVersion) });
  });

  app.post("/api/versions", requireAuth, (req, res) => {
    const name = String(req.body.name || "").trim();
    const description = String(req.body.description || "").trim();
    if (!name) {
      return res.status(400).json({ message: "版本号不能为空。" });
    }
    if (first(db, "SELECT id FROM project_versions WHERE name = ?", [name])) {
      return res.status(409).json({ message: "这个版本号已经存在。" });
    }
    const versionId = id();
    const time = now();
    run(db, "INSERT INTO project_versions (id, name, description, is_archived, created_by, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)", [
      versionId,
      name,
      description,
      req.user.id,
      time,
      time
    ]);
    store.persist();
    res.json({ version: toVersion(first(db, "SELECT * FROM project_versions WHERE id = ?", [versionId])) });
  });

  app.put("/api/versions/:id", requireAuth, (req, res) => {
    const version = first(db, "SELECT * FROM project_versions WHERE id = ?", [req.params.id]);
    if (!version) {
      return res.status(404).json({ message: "版本不存在。" });
    }
    const name = String(req.body.name || version.name).trim();
    const description = String(req.body.description ?? version.description ?? "").trim();
    const isArchived = req.body.isArchived == null ? version.is_archived : req.body.isArchived ? 1 : 0;
    run(db, "UPDATE project_versions SET name = ?, description = ?, is_archived = ?, updated_at = ? WHERE id = ?", [
      name,
      description,
      isArchived,
      now(),
      req.params.id
    ]);
    store.persist();
    res.json({ version: toVersion(first(db, "SELECT * FROM project_versions WHERE id = ?", [req.params.id])) });
  });

  app.delete("/api/versions/:id", requireAuth, (req, res) => {
    run(db, "UPDATE tasks SET version_id = NULL, updated_at = ? WHERE version_id = ?", [now(), req.params.id]);
    run(db, "DELETE FROM project_versions WHERE id = ?", [req.params.id]);
    store.persist();
    res.json({ ok: true });
  });

  app.get("/api/tasks", requireAuth, (req, res) => {
    purgeExpiredDeletedTasks(db, paths, store);
    const { scope, versionId, status } = req.query;
    const clauses = [];
    const params = [];
    if (scope === "trash") {
      clauses.push("t.deleted_at IS NOT NULL");
    } else {
      clauses.push("t.deleted_at IS NULL");
    }
    if (scope === "mine") {
      clauses.push("t.assignee_id = ?");
      params.push(req.user.id);
    }
    if (versionId && versionId !== "all") {
      clauses.push("t.version_id = ?");
      params.push(versionId);
    }
    if (status && status !== "all") {
      clauses.push("t.status = ?");
      params.push(status);
    }

    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = all(db, `
      SELECT
        t.*,
        v.name AS version_name,
        assignee.name AS assignee_name,
        assignee.avatar_url AS assignee_avatar,
        creator.name AS creator_name,
        deleter.name AS deleted_by_name,
        (SELECT COUNT(*) FROM task_attachments a WHERE a.task_id = t.id) AS attachment_count
      FROM tasks t
      LEFT JOIN project_versions v ON v.id = t.version_id
      LEFT JOIN users assignee ON assignee.id = t.assignee_id
      LEFT JOIN users creator ON creator.id = t.creator_id
      LEFT JOIN users deleter ON deleter.id = t.deleted_by
      ${where}
      ORDER BY
        CASE WHEN t.deleted_at IS NULL THEN 0 ELSE 1 END,
        CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
        t.updated_at DESC
    `, params);
    res.json({ tasks: rows.map(toTask) });
  });

  app.post("/api/tasks", requireAuth, (req, res) => {
    const task = normalizeTaskInput(req.body);
    if (!task.title) {
      return res.status(400).json({ message: "任务标题不能为空。" });
    }
    const taskId = id();
    const time = now();
    run(db, "INSERT INTO tasks (id, title, description, version_id, assignee_id, creator_id, status, priority, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
      taskId,
      task.title,
      task.description,
      task.versionId || null,
      task.assigneeId || null,
      req.user.id,
      task.status,
      task.priority,
      time,
      time
    ]);
    store.persist();
    res.json({ task: getTask(db, taskId) });
  });

  app.get("/api/tasks/:id", requireAuth, (req, res) => {
    const task = getTask(db, req.params.id);
    if (!task) {
      return res.status(404).json({ message: "任务不存在。" });
    }
    res.json({ task, attachments: getAttachments(db, req.params.id) });
  });

  app.put("/api/tasks/:id", requireAuth, (req, res) => {
    const existing = first(db, "SELECT * FROM tasks WHERE id = ?", [req.params.id]);
    if (!existing) {
      return res.status(404).json({ message: "任务不存在。" });
    }
    if (existing.deleted_at) {
      return res.status(400).json({ message: "任务已在垃圾桶中，请先恢复。" });
    }
    const input = normalizeTaskInput({ ...existing, ...req.body });
    run(db, "UPDATE tasks SET title = ?, description = ?, version_id = ?, assignee_id = ?, status = ?, priority = ?, updated_at = ? WHERE id = ?", [
      input.title,
      input.description,
      input.versionId || null,
      input.assigneeId || null,
      input.status,
      input.priority,
      now(),
      req.params.id
    ]);
    store.persist();
    res.json({ task: getTask(db, req.params.id) });
  });

  app.delete("/api/tasks/:id", requireAuth, (req, res) => {
    const existing = first(db, "SELECT * FROM tasks WHERE id = ?", [req.params.id]);
    if (!existing) {
      return res.status(404).json({ message: "任务不存在。" });
    }
    const time = now();
    run(db, "UPDATE tasks SET deleted_at = ?, deleted_by = ?, updated_at = ? WHERE id = ?", [time, req.user.id, time, req.params.id]);
    store.persist();
    res.json({ ok: true });
  });

  app.post("/api/tasks/:id/restore", requireAuth, (req, res) => {
    const existing = first(db, "SELECT * FROM tasks WHERE id = ?", [req.params.id]);
    if (!existing) {
      return res.status(404).json({ message: "任务不存在。" });
    }
    run(db, "UPDATE tasks SET deleted_at = NULL, deleted_by = NULL, updated_at = ? WHERE id = ?", [now(), req.params.id]);
    store.persist();
    res.json({ task: getTask(db, req.params.id) });
  });

  app.delete("/api/tasks/:id/permanent", requireAuth, (req, res) => {
    const existing = first(db, "SELECT * FROM tasks WHERE id = ?", [req.params.id]);
    if (!existing) {
      return res.status(404).json({ message: "任务不存在。" });
    }
    hardDeleteTask(db, paths, req.params.id);
    store.persist();
    res.json({ ok: true });
  });

  app.post("/api/tasks/:id/attachments", requireAuth, attachmentUpload.array("attachments", MAX_TASK_ATTACHMENTS), (req, res) => {
    const task = first(db, "SELECT id FROM tasks WHERE id = ? AND deleted_at IS NULL", [req.params.id]);
    if (!task) {
      cleanupFiles(req.files);
      return res.status(404).json({ message: "任务不存在。" });
    }
    const existingCount = first(db, "SELECT COUNT(*) AS total FROM task_attachments WHERE task_id = ?", [req.params.id]).total;
    const incomingCount = req.files?.length || 0;
    if (existingCount + incomingCount > MAX_TASK_ATTACHMENTS) {
      cleanupFiles(req.files);
      return res.status(400).json({ message: `每个任务最多上传 ${MAX_TASK_ATTACHMENTS} 个图片或视频。` });
    }
    (req.files || []).forEach((file, index) => {
      run(db, "INSERT INTO task_attachments (id, task_id, file_name, file_type, file_url, file_size, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [
        id(),
        req.params.id,
        file.originalname,
        file.mimetype,
        `/attachments/${file.filename}`,
        file.size,
        existingCount + index,
        now()
      ]);
    });
    run(db, "UPDATE tasks SET updated_at = ? WHERE id = ?", [now(), req.params.id]);
    store.persist();
    res.json({ attachments: getAttachments(db, req.params.id) });
  });

  app.delete("/api/tasks/:id/attachments/:attachmentId", requireAuth, (req, res) => {
    const attachment = first(db, "SELECT * FROM task_attachments WHERE id = ? AND task_id = ?", [req.params.attachmentId, req.params.id]);
    if (!attachment) {
      return res.status(404).json({ message: "附件不存在。" });
    }
    removeStoredFile(paths.attachments, attachment.file_url);
    run(db, "DELETE FROM task_attachments WHERE id = ?", [req.params.attachmentId]);
    run(db, "UPDATE tasks SET updated_at = ? WHERE id = ?", [now(), req.params.id]);
    store.persist();
    res.json({ ok: true, attachments: getAttachments(db, req.params.id) });
  });

  app.get("/api/settings", requireAuth, (_req, res) => {
    const rows = all(db, "SELECT * FROM app_settings");
    const settings = {};
    rows.forEach((row) => {
      settings[row.key] = row.value;
    });
    res.json({ settings });
  });

  app.put("/api/settings", requireAuth, (req, res) => {
    Object.entries(req.body || {}).forEach(([key, value]) => {
      run(db, "INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)", [
        key,
        String(value),
        now()
      ]);
    });
    store.persist();
    res.json({ ok: true });
  });

  app.get("/api/app/version", (_req, res) => {
    res.json({ version: getAppVersion() });
  });

  app.get("/api/app/update-manifest", async (_req, res) => {
    try {
      const rawManifest = await getGithubRawUpdateManifest(getAppVersion());
      if (rawManifest?.version) {
        return res.json(rawManifest);
      }
    } catch {
      // Fall through to GitHub Releases, then tags, then local manifest.
    }

    let releaseManifest = null;
    try {
      releaseManifest = await getGithubUpdateManifest(getAppVersion());
      if (releaseManifest?.hasUpdate && releaseManifest.canDownload) {
        return res.json(releaseManifest);
      }
    } catch {
      // Try tags next, then fall back to the local manifest so LAN deployments still work offline.
    }

    try {
      const localManifest = getLocalUpdateManifest(paths, getAppVersion());
      if (localManifest?.version && (localManifest.hasUpdate || !releaseManifest?.version)) {
        return res.json(localManifest);
      }
    } catch {
      // Try tags next.
    }

    try {
      const tagManifest = await getGithubTagUpdateManifest(getAppVersion());
      if (tagManifest?.version) {
        if (tagManifest.hasUpdate) {
          return res.json(tagManifest);
        }
        if (releaseManifest?.version) {
          return res.json(releaseManifest);
        }
        return res.json(tagManifest);
      }
    } catch {
      // Fall back to the local manifest.
    }

    if (releaseManifest?.version) {
      return res.json(releaseManifest);
    }

    const currentVersion = getAppVersion();
    res.json({
      version: currentVersion,
      currentVersion,
      hasUpdate: false,
      canDownload: false,
      needsReleaseAsset: false,
      releaseDate: now().slice(0, 10),
      notes: "当前已是最新版本。",
      downloadUrl: "",
      pageUrl: GITHUB_RELEASES_URL,
      source: "local",
      force: false
    });
  });

  app.use((error, _req, res, _next) => {
    if (error) {
      return res.status(400).json({ message: error.message || "请求处理失败。" });
    }
    res.status(404).json({ message: "接口不存在。" });
  });

  const server = await new Promise((resolve) => {
    const listener = app.listen(port, "0.0.0.0", () => resolve(listener));
  });

  return {
    close: () => new Promise((resolve) => server.close(() => {
      store.close();
      resolve();
    })),
    getFloatingStats: async () => {
      const config = getConfig();
      const token = config.lastToken;
      const user = token ? first(db, "SELECT * FROM users WHERE token = ?", [token]) : first(db, "SELECT * FROM users ORDER BY updated_at DESC");
      if (!user) {
        return {
          user: null,
          myOpenTasks: 0
        };
      }
      const count = first(db, "SELECT COUNT(*) AS total FROM tasks WHERE assignee_id = ? AND status <> 'done' AND deleted_at IS NULL", [user.id]).total;
      return {
        user: toUser(user),
        myOpenTasks: count
      };
    }
  };

  function requireAuth(req, res, next) {
    const auth = req.headers.authorization || "";
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      return res.status(401).json({ message: "请先登录。" });
    }
    const user = first(db, "SELECT * FROM users WHERE token = ?", [token]);
    if (!user) {
      return res.status(401).json({ message: "登录已失效，请重新登录。" });
    }
    req.user = user;
    next();
  }
}

function normalizeTaskInput(input) {
  return {
    title: String(input.title || "").trim(),
    description: String(input.description || "").trim(),
    versionId: input.versionId || input.version_id || null,
    assigneeId: input.assigneeId || input.assignee_id || null,
    status: ["todo", "doing", "review", "done"].includes(input.status) ? input.status : "todo",
    priority: ["low", "medium", "high", "urgent"].includes(input.priority) ? input.priority : "medium"
  };
}

function getTask(db, taskId) {
  const rows = all(db, `
    SELECT
      t.*,
      v.name AS version_name,
      assignee.name AS assignee_name,
      assignee.avatar_url AS assignee_avatar,
      creator.name AS creator_name,
      deleter.name AS deleted_by_name,
      (SELECT COUNT(*) FROM task_attachments a WHERE a.task_id = t.id) AS attachment_count
    FROM tasks t
    LEFT JOIN project_versions v ON v.id = t.version_id
    LEFT JOIN users assignee ON assignee.id = t.assignee_id
    LEFT JOIN users creator ON creator.id = t.creator_id
    LEFT JOIN users deleter ON deleter.id = t.deleted_by
    WHERE t.id = ?
  `, [taskId]);
  return toTask(rows[0]);
}

function purgeExpiredDeletedTasks(db, paths, store) {
  const cutoff = new Date(Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const expired = all(db, "SELECT id FROM tasks WHERE deleted_at IS NOT NULL AND deleted_at <= ?", [cutoff]);
  expired.forEach((task) => hardDeleteTask(db, paths, task.id));
  if (expired.length) {
    store.persist();
  }
}

function hardDeleteTask(db, paths, taskId) {
  const attachments = getAttachments(db, taskId);
  attachments.forEach((attachment) => removeStoredFile(paths.attachments, attachment.fileUrl));
  run(db, "DELETE FROM tasks WHERE id = ?", [taskId]);
}

function getAttachments(db, taskId) {
  return all(db, "SELECT * FROM task_attachments WHERE task_id = ? ORDER BY sort_order ASC, created_at ASC", [taskId]).map(toAttachment);
}

function makeAvatar(name) {
  const seed = encodeURIComponent(name || "hero");
  return `https://api.dicebear.com/9.x/bottts/svg?seed=${seed}`;
}

function cleanupFiles(files = []) {
  files.forEach((file) => {
    if (file.path && fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }
  });
}

function removeStoredFile(baseDir, fileUrl) {
  const filename = path.basename(fileUrl || "");
  if (!filename) return;
  const filePath = path.join(baseDir, filename);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

module.exports = {
  startServer
};
