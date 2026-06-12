const fs = require("fs");
const path = require("path");
const initSqlJs = require("sql.js");

let SQL = null;

async function createDatabase(dbPath) {
  if (!SQL) {
    SQL = await initSqlJs({
      locateFile: (file) => {
        if (process.resourcesPath) {
          const resourceFile = path.join(process.resourcesPath, file);
          if (fs.existsSync(resourceFile)) {
            return resourceFile;
          }
        }
        return path.join(__dirname, "../../node_modules/sql.js/dist", file);
      }
    });
  }

  const db = fs.existsSync(dbPath)
    ? new SQL.Database(fs.readFileSync(dbPath))
    : new SQL.Database();

  const persist = () => {
    const data = db.export();
    fs.writeFileSync(dbPath, Buffer.from(data));
  };

  migrate(db);
  seed(db);
  persist();

  return {
    db,
    persist,
    close: () => {
      persist();
      db.close();
    }
  };
}

function migrate(db) {
  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      avatar_url TEXT,
      token TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_versions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      is_archived INTEGER NOT NULL DEFAULT 0,
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      version_id TEXT,
      assignee_id TEXT,
      creator_id TEXT,
      status TEXT NOT NULL,
      priority TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      deleted_by TEXT,
      FOREIGN KEY(version_id) REFERENCES project_versions(id) ON DELETE SET NULL,
      FOREIGN KEY(assignee_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY(creator_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY(deleted_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS task_attachments (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_type TEXT NOT NULL,
      file_url TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT NOT NULL
    );
  `);

  const taskColumns = all(db, "PRAGMA table_info(tasks)").map((column) => column.name);
  if (!taskColumns.includes("deleted_at")) {
    run(db, "ALTER TABLE tasks ADD COLUMN deleted_at TEXT");
  }
  if (!taskColumns.includes("deleted_by")) {
    run(db, "ALTER TABLE tasks ADD COLUMN deleted_by TEXT");
  }
}

function seed(db) {
  const count = first(db, "SELECT COUNT(*) AS total FROM project_versions").total;
  if (count === 0) {
    run(db, "INSERT INTO project_versions (id, name, description, is_archived, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)", [
      id(),
      "1.0.1",
      "首个任务版本",
      now(),
      now()
    ]);
  }

  const settings = {
    floating_window_enabled: "true",
    floating_window_always_on_top: "true",
    server_mode_enabled: "true",
    server_base_url: "http://127.0.0.1:37371"
  };

  Object.entries(settings).forEach(([key, value]) => {
    const existing = first(db, "SELECT key FROM app_settings WHERE key = ?", [key]);
    if (!existing) {
      run(db, "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)", [key, value, now()]);
    }
  });
}

function now() {
  return new Date().toISOString();
}

function id() {
  return crypto.randomUUID();
}

function run(db, sql, params = []) {
  db.run(sql, params);
}

function all(db, sql, params = []) {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    return rows;
  } finally {
    stmt.free();
  }
}

function first(db, sql, params = []) {
  return all(db, sql, params)[0] || null;
}

function one(db, table, idValue) {
  return first(db, `SELECT * FROM ${table} WHERE id = ?`, [idValue]);
}

function toUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    avatarUrl: row.avatar_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toVersion(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description || "",
    isArchived: Boolean(row.is_archived),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toAttachment(row) {
  if (!row) return null;
  return {
    id: row.id,
    taskId: row.task_id,
    fileName: row.file_name,
    fileType: row.file_type,
    fileUrl: row.file_url,
    fileSize: row.file_size,
    sortOrder: row.sort_order,
    createdAt: row.created_at
  };
}

function toTask(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    description: row.description || "",
    versionId: row.version_id,
    versionName: row.version_name,
    assigneeId: row.assignee_id,
    assigneeName: row.assignee_name,
    assigneeAvatar: row.assignee_avatar,
    creatorId: row.creator_id,
    creatorName: row.creator_name,
    status: row.status,
    priority: row.priority,
    attachmentCount: Number(row.attachment_count || 0),
    deletedAt: row.deleted_at || null,
    deletedBy: row.deleted_by || null,
    deletedByName: row.deleted_by_name || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

module.exports = {
  createDatabase,
  run,
  all,
  first,
  one,
  now,
  id,
  toUser,
  toVersion,
  toTask,
  toAttachment
};
