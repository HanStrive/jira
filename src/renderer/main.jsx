import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  BadgePlus,
  Bell,
  BarChart3,
  CalendarDays,
  Check,
  ChevronDown,
  ClipboardList,
  Clock3,
  Crown,
  Download,
  Eye,
  EyeOff,
  FileImage,
  FileText,
  Filter,
  Flag,
  FolderOpen,
  Gamepad2,
  Gem,
  Info,
  LayoutDashboard,
  List,
  LogOut,
  Lock,
  Menu as MenuIcon,
  MonitorUp,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  ScrollText,
  Settings,
  Server,
  Shield,
  Sparkles,
  Star,
  Swords,
  Trophy,
  Trash2,
  Upload,
  User,
  Users,
  Wand2,
  X
} from "lucide-react";
import { createPortal } from "react-dom";
import "./styles.css";
import commandHall from "./assets/command-hall.png";

const TOKEN_KEY = "gorilla.token";
const USER_KEY = "gorilla.user";
const SERVER_KEY = "gorilla.serverBaseUrl";

const defaultAvatars = [
  { name: "骑士", colors: ["#f5c766", "#9b562c"], mark: "K" },
  { name: "法师", colors: ["#6eb7ff", "#3946a8"], mark: "M" },
  { name: "射手", colors: ["#72d572", "#2f7b48"], mark: "A" },
  { name: "工匠", colors: ["#f48f4e", "#7d3d24"], mark: "B" },
  { name: "守卫", colors: ["#b6d7ff", "#4e698f"], mark: "G" },
  { name: "队长", colors: ["#f7667f", "#8b2746"], mark: "C" }
].map((item) => ({ ...item, url: avatarDataUrl(item) }));

const statusMap = {
  todo: { label: "待处理", icon: ScrollText },
  doing: { label: "进行中", icon: Swords },
  review: { label: "审查中", icon: Eye },
  done: { label: "已完成", icon: Check }
};

const priorityMap = {
  low: { label: "低", className: "priority-low" },
  medium: { label: "中", className: "priority-medium" },
  high: { label: "高", className: "priority-high" },
  urgent: { label: "紧急", className: "priority-urgent" }
};

function App() {
  const isFloating = window.location.hash === "#/floating";
  if (isFloating) {
    return <FloatingApp />;
  }
  return <MainApp />;
}

function MainApp() {
  const [booting, setBooting] = useState(true);
  const [appInfo, setAppInfo] = useState(null);
  const [config, setConfig] = useState(null);
  const [serverBaseUrl, setServerBaseUrl] = useState(localStorage.getItem(SERVER_KEY) || "http://127.0.0.1:37371");
  const [token, setToken] = useState(localStorage.getItem(TOKEN_KEY) || "");
  const [user, setUser] = useState(readJson(USER_KEY));
  const [users, setUsers] = useState([]);
  const [versions, setVersions] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [selectedVersion, setSelectedVersion] = useState("all");
  const [scope, setScope] = useState("all");
  const [status, setStatus] = useState("all");
  const [activePanel, setActivePanel] = useState("project");
  const [viewMode, setViewMode] = useState("list");
  const [searchTerm, setSearchTerm] = useState("");
  const [taskModal, setTaskModal] = useState(null);
  const [versionModal, setVersionModal] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const api = useMemo(() => makeApi(serverBaseUrl, token), [serverBaseUrl, token]);

  useEffect(() => {
    async function boot() {
      const [info, savedConfig] = await Promise.all([
        window.gorilla?.getAppInfo?.(),
        window.gorilla?.getConfig?.()
      ]);
      setAppInfo(info || { version: "dev", localIps: ["127.0.0.1"], dataPath: "" });
      const merged = savedConfig || {};
      setConfig(merged);
      if (merged.serverBaseUrl) {
        setServerBaseUrl(merged.serverBaseUrl);
        localStorage.setItem(SERVER_KEY, merged.serverBaseUrl);
      }
      setBooting(false);
    }
    boot();
  }, []);

  useEffect(() => {
    return window.gorilla?.onConfigChanged?.((nextConfig) => {
      setConfig(nextConfig);
      if (nextConfig.serverBaseUrl) {
        setServerBaseUrl(nextConfig.serverBaseUrl);
        localStorage.setItem(SERVER_KEY, nextConfig.serverBaseUrl);
      }
    });
  }, []);

  useEffect(() => {
    if (!token || booting) return;
    refreshAll();
  }, [token, serverBaseUrl, booting]);

  useEffect(() => {
    if (booting) return;
    window.gorilla?.setWindowMode?.(token ? "main" : "auth");
  }, [booting, token]);

  useEffect(() => {
    if (!token || booting) return;
    refreshTasks();
  }, [scope, selectedVersion, status]);

  useEffect(() => {
    return window.gorilla?.onUserChanged?.((nextUser) => {
      if (!nextUser) {
        setUser(null);
        localStorage.removeItem(USER_KEY);
        return;
      }
      setUser(nextUser);
      saveJson(USER_KEY, nextUser);
      setUsers((current) => current.map((item) => (item.id === nextUser.id ? nextUser : item)));
    });
  }, []);

  async function refreshAll() {
    setLoading(true);
    setError("");
    try {
      const [me, userList, versionList] = await Promise.all([
        api.get("/api/auth/me"),
        api.get("/api/users"),
        api.get("/api/versions")
      ]);
      setUser(me.user);
      saveJson(USER_KEY, me.user);
      setUsers(userList.users);
      setVersions(versionList.versions);
      if (selectedVersion !== "all" && !versionList.versions.some((version) => version.id === selectedVersion)) {
        setSelectedVersion("all");
      }
      await refreshTasks();
    } catch (err) {
      if (err.status === 401) {
        handleLogout(false);
      } else {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  }

  async function refreshTasks() {
    if (!token) return;
    const params = new URLSearchParams();
    params.set("scope", scope);
    params.set("versionId", selectedVersion);
    params.set("status", status);
    try {
      const result = await api.get(`/api/tasks?${params.toString()}`);
      setTasks(result.tasks);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleAuth(payload, mode) {
    setError("");
    setLoading(true);
    try {
      localStorage.setItem(SERVER_KEY, serverBaseUrl);
      await window.gorilla?.setConfig?.({ serverBaseUrl });
      const result = await makeApi(serverBaseUrl).post(`/api/auth/${mode}`, payload);
      setToken(result.token);
      setUser(result.user);
      localStorage.setItem(TOKEN_KEY, result.token);
      saveJson(USER_KEY, result.user);
      await window.gorilla?.setConfig?.({ serverBaseUrl, lastToken: result.token });
      window.gorilla?.notifyUserChanged?.(result.user);
      setMessage(mode === "login" ? "欢迎回来，任务大厅已打开。" : "账号创建成功，欢迎加入大厅。");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout(callServer = true) {
    if (callServer && token) {
      api.post("/api/auth/logout", {}).catch(() => {});
    }
    setToken("");
    setUser(null);
    setTasks([]);
    setUsers([]);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    await window.gorilla?.setConfig?.({ lastToken: "" });
    window.gorilla?.notifyUserChanged?.(null);
  }

  function handleUserUpdated(nextUser) {
    setUser(nextUser);
    saveJson(USER_KEY, nextUser);
    window.gorilla?.notifyUserChanged?.(nextUser);
    setUsers((current) => current.map((item) => (item.id === nextUser?.id ? nextUser : item)));
    refreshTasks();
  }

  async function saveTask(values, files) {
    setError("");
    try {
      const result = values.id
        ? await api.put(`/api/tasks/${values.id}`, values)
        : await api.post("/api/tasks", values);

      if (files?.length) {
        const form = new FormData();
        Array.from(files).forEach((file) => form.append("attachments", file));
        await api.upload(`/api/tasks/${result.task.id}/attachments`, form);
      }
      setTaskModal(null);
      setMessage(values.id ? "任务已更新。" : "新任务已加入战场。");
      await refreshTasks();
    } catch (err) {
      setError(err.message);
    }
  }

  async function deleteTask(taskId) {
    if (!window.confirm("确认把这个任务移入垃圾桶吗？15 天后会自动彻底删除。")) return;
    try {
      await api.delete(`/api/tasks/${taskId}`);
      setMessage("任务已移入垃圾桶，15 天后自动彻底删除。");
      await refreshTasks();
    } catch (err) {
      setError(err.message);
    }
  }

  async function restoreTask(taskId) {
    try {
      await api.post(`/api/tasks/${taskId}/restore`, {});
      setMessage("任务已从垃圾桶恢复。");
      await refreshTasks();
    } catch (err) {
      setError(err.message);
    }
  }

  async function permanentDeleteTask(taskId) {
    if (!window.confirm("确认彻底删除这个任务吗？附件也会一起删除，无法恢复。")) return;
    try {
      await api.delete(`/api/tasks/${taskId}/permanent`);
      setMessage("任务已彻底删除。");
      await refreshTasks();
    } catch (err) {
      setError(err.message);
    }
  }

  async function saveVersion(values) {
    try {
      await api.post("/api/versions", values);
      setVersionModal(false);
      setMessage("新版本号已创建。");
      const result = await api.get("/api/versions");
      setVersions(result.versions);
    } catch (err) {
      setError(err.message);
    }
  }

  async function updateConfig(patch) {
    const next = await window.gorilla?.setConfig?.(patch);
    if (next) {
      setConfig(next);
      if (patch.serverBaseUrl) {
        setServerBaseUrl(patch.serverBaseUrl);
        localStorage.setItem(SERVER_KEY, patch.serverBaseUrl);
      }
    }
  }

  const mineCount = tasks.filter((task) => task.assigneeId === user?.id && task.status !== "done").length;
  const doneCount = tasks.filter((task) => task.status === "done").length;

  if (booting) {
    return <Splash />;
  }

  if (!token || !user) {
    return (
      <AuthScreen
        serverBaseUrl={serverBaseUrl}
        setServerBaseUrl={setServerBaseUrl}
        loading={loading}
        error={error}
        onSubmit={handleAuth}
        appInfo={appInfo}
      />
    );
  }

  return (
    <div className="royal-app">
      <div className="window-drag-frame drag-top" aria-hidden="true" />
      <div className="window-drag-frame drag-right" aria-hidden="true" />
      <div className="window-drag-frame drag-bottom" aria-hidden="true" />
      <div className="window-drag-frame drag-left" aria-hidden="true" />

      {message && <Toast type="success" onClose={() => setMessage("")}>{message}</Toast>}
      {error && <Toast type="error" onClose={() => setError("")}>{error}</Toast>}

      {taskModal ? (
        <TaskEditorPage
          task={taskModal}
          users={users}
          versions={versions}
          defaultVersion={selectedVersion === "all" ? versions[0]?.id : selectedVersion}
          serverBaseUrl={serverBaseUrl}
          api={api}
          onClose={() => setTaskModal(null)}
          onSave={saveTask}
          onChanged={refreshTasks}
        />
      ) : activePanel === "settings" ? (
        <SettingsPanel
          appInfo={appInfo}
          config={config}
          user={user}
          serverBaseUrl={serverBaseUrl}
          setServerBaseUrl={setServerBaseUrl}
          api={api}
          onSaveConfig={updateConfig}
          onUserUpdated={handleUserUpdated}
          onError={setError}
          onMessage={setMessage}
          onClose={() => setActivePanel("project")}
        />
      ) : (
        <JiraHomePage
          activePanel={activePanel}
          user={user}
          tasks={tasks}
          versions={versions}
          selectedVersion={selectedVersion}
          setSelectedVersion={setSelectedVersion}
          scope={scope}
          setScope={setScope}
          status={status}
          setStatus={setStatus}
          onNewTask={() => setTaskModal({})}
          onEditTask={(task) => setTaskModal(task)}
          onDeleteTask={deleteTask}
          onRestoreTask={restoreTask}
          onPermanentDeleteTask={permanentDeleteTask}
          onSettings={() => setActivePanel("settings")}
          onTrash={() => {
            setActivePanel("trash");
            setScope("trash");
            setStatus("all");
          }}
          onProject={() => {
            setActivePanel("project");
            setScope(scope === "trash" ? "all" : scope);
            setStatus("all");
          }}
          onLogout={() => handleLogout()}
        />
      )}

      {versionModal && <VersionModal onClose={() => setVersionModal(false)} onSave={saveVersion} />}
    </div>
  );
}

function RoyalFrame({ title, emblem = "shield", headerActions, onClose, children, className = "", closeMode = "close" }) {
  const isBack = closeMode === "back";
  const CloseIcon = isBack ? ArrowLeft : X;
  return (
    <section className={`royal-frame ${className}`}>
      <header className="royal-frame-header">
        <div className="royal-frame-tab">
          <RoyalBadge type={emblem} size="small" />
          <strong>{title}</strong>
        </div>
        <div className="royal-frame-crown"><Crown size={46} /></div>
        <div className="royal-frame-actions">
          {headerActions}
          <button
            className={isBack ? "royal-square-button back" : "royal-square-button danger"}
            type="button"
            onClick={onClose || (() => window.gorilla?.closeWindow?.())}
            title={isBack ? "返回" : "关闭"}
          >
            <CloseIcon size={24} />
          </button>
        </div>
      </header>
      <main className="royal-frame-body">{children}</main>
      <div className="royal-frame-bottom"><Crown size={30} /></div>
    </section>
  );
}

function RoyalBadge({ type = "shield", size = "normal" }) {
  const Icon = type === "settings" ? Settings : type === "task" ? ClipboardList : Crown;
  return (
    <span className={`royal-badge royal-badge-${size} royal-badge-${type}`}>
      <Icon size={size === "large" ? 72 : size === "small" ? 30 : 44} />
    </span>
  );
}

function JiraHomePage(props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const isTrash = props.activePanel === "trash";
  const visibleTasks = props.tasks;
  const currentVersionName = props.selectedVersion === "all"
    ? "全部版本"
    : props.versions.find((version) => version.id === props.selectedVersion)?.name || "未选择版本";

  function setMainScope(nextScope) {
    props.onProject();
    props.setScope(nextScope);
    props.setStatus("all");
  }

  return (
    <RoyalFrame
      title="JiRa"
      emblem="shield"
      className="jira-home-frame"
      closeMode={isTrash ? "back" : "close"}
      onClose={isTrash ? () => setMainScope("all") : undefined}
      headerActions={!isTrash && (
        <>
          <button className="royal-square-button primary" type="button" onClick={props.onNewTask} title="新建任务">
            <Plus size={24} />
          </button>
          <div className="royal-menu-wrap">
            <button className="royal-square-button neutral" type="button" onClick={() => setMenuOpen((current) => !current)} title="菜单">
              <MenuIcon size={24} />
            </button>
            {menuOpen && (
              <div className="royal-menu-popover">
                <button type="button" onClick={() => { setMenuOpen(false); props.onSettings(); }}>
                  <Settings size={23} />设置
                </button>
                <button type="button" onClick={() => { setMenuOpen(false); props.onTrash(); }}>
                  <Trash2 size={23} />垃圾桶
                </button>
                <button type="button" onClick={() => { setMenuOpen(false); props.onLogout(); }}>
                  <User size={23} />退出登录
                </button>
              </div>
            )}
          </div>
        </>
      )}
    >
      <section className="jira-project-hero">
        <RoyalBadge type="shield" size="large" />
        <div>
          <h1>{isTrash ? "垃圾桶" : "皇室项目"} {!isTrash && <Star size={24} />}</h1>
          <p>{isTrash ? "15 天后自动彻底删除" : "软件项目"}</p>
        </div>
      </section>

      {!isTrash ? (
        <div className="jira-scope-tabs">
          <button className={props.scope !== "mine" ? "active" : ""} type="button" onClick={() => setMainScope("all")}>
            <LayoutDashboard size={24} />全部
          </button>
          <button className={props.scope === "mine" ? "active" : ""} type="button" onClick={() => setMainScope("mine")}>
            <User size={24} />我的
          </button>
        </div>
      ) : (
        <div className="jira-trash-note">
          <AlertTriangle size={18} />
          <span>垃圾桶任务可恢复，超过 15 天会自动清理。</span>
        </div>
      )}

      <section className="jira-task-panel">
        <div className="jira-task-panel-head">
          <div>
            <List size={26} />
            <strong>{isTrash ? "垃圾桶任务" : "任务列表"}</strong>
          </div>
          {!isTrash && (
            <button className="jira-filter-button" type="button" onClick={() => setFilterOpen((current) => !current)} title="过滤器">
              <Filter size={28} />
            </button>
          )}
        </div>

        {filterOpen && !isTrash && (
          <TaskFilterPanel
            versions={props.versions}
            selectedVersion={props.selectedVersion}
            setSelectedVersion={props.setSelectedVersion}
            status={props.status}
            setStatus={props.setStatus}
            currentVersionName={currentVersionName}
          />
        )}

        <div className="jira-task-list">
          {visibleTasks.map((task, index) => (
            <JiraTaskCard
              key={task.id}
              task={task}
              index={index}
              isTrash={isTrash}
              onEditTask={props.onEditTask}
              onDeleteTask={props.onDeleteTask}
              onRestoreTask={props.onRestoreTask}
              onPermanentDeleteTask={props.onPermanentDeleteTask}
            />
          ))}
          {!visibleTasks.length && (
            <div className="jira-empty-state">
              <Sparkles size={42} />
              <strong>{isTrash ? "垃圾桶是空的" : "暂无任务"}</strong>
              <span>{isTrash ? "删除的任务会先进入这里。" : "点击右上角 + 创建第一条任务。"}</span>
            </div>
          )}
        </div>
      </section>
    </RoyalFrame>
  );
}

function TaskFilterPanel({ versions, selectedVersion, setSelectedVersion, status, setStatus, currentVersionName }) {
  return (
    <div className="jira-filter-panel">
      <div className="jira-filter-row">
        <span><Flag size={17} />版本号</span>
        <select value={selectedVersion} onChange={(event) => setSelectedVersion(event.target.value)}>
          <option value="all">全部版本</option>
          {versions.map((version) => <option key={version.id} value={version.id}>{version.name}</option>)}
        </select>
      </div>
      <div className="jira-filter-row">
        <span><ScrollText size={17} />状态</span>
        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="all">全部状态</option>
          <option value="todo">待处理</option>
          <option value="doing">进行中</option>
          <option value="review">审查中</option>
          <option value="done">已完成</option>
        </select>
      </div>
      <small>当前：{currentVersionName}</small>
    </div>
  );
}

function JiraTaskCard({ task, index, isTrash, onEditTask, onDeleteTask, onRestoreTask, onPermanentDeleteTask }) {
  const status = statusMap[task.status] || statusMap.todo;
  return (
    <article className="jira-task-card">
      <button className={`jira-task-type ${task.priority}`} type="button" onClick={() => !isTrash && onEditTask(task)} title="打开任务">
        <IssueTypeIcon task={task} />
      </button>
      <button className="jira-task-main" type="button" onClick={() => !isTrash && onEditTask(task)}>
        <strong>{issueCode(index)}</strong>
        <span>{task.title}</span>
      </button>
      <span className={`jira-task-status ${task.status}`}>{status.label}</span>
      {isTrash ? (
        <div className="jira-task-actions">
          <button type="button" onClick={() => onRestoreTask(task.id)} title="恢复"><RefreshCw size={18} /></button>
          <button type="button" className="danger" onClick={() => onPermanentDeleteTask(task.id)} title="彻底删除"><Trash2 size={18} /></button>
        </div>
      ) : (
        <button className="jira-card-delete" type="button" onClick={() => onDeleteTask(task.id)} title="删除">
          <Trash2 size={18} />
        </button>
      )}
    </article>
  );
}

function NavButton({ icon: Icon, label, active, onClick }) {
  return (
    <button className={active ? "clash-nav-item active" : "clash-nav-item"} onClick={onClick}>
      <Icon size={22} />
      <span>{label}</span>
    </button>
  );
}

function ProjectWorkspace(props) {
  const visibleTasks = getVisibleTasks(props.tasks, props.searchTerm);
  const isTrash = props.activePanel === "trash";

  if (props.activePanel === "reports") {
    return <ReportsPanel tasks={visibleTasks} users={props.users} />;
  }

  if (props.activePanel === "filters") {
    return (
      <FiltersPanel
        tasks={props.tasks}
        versions={props.versions}
        selectedVersion={props.selectedVersion}
        setSelectedVersion={props.setSelectedVersion}
        scope={props.scope}
        setScope={props.setScope}
        status={props.status}
        setStatus={props.setStatus}
      />
    );
  }

  return (
    <section className={isTrash ? "project-board-shell trash-board" : "project-board-shell"}>
      {!isTrash && (
        <WorkspaceToolbar
          versions={props.versions}
          selectedVersion={props.selectedVersion}
          setSelectedVersion={props.setSelectedVersion}
          onNewTask={props.onNewTask}
          onNewVersion={props.onNewVersion}
        />
      )}

      {!isTrash && <ViewTabs viewMode={props.viewMode} setViewMode={props.setViewMode} />}

      {isTrash && <IssueList title="垃圾桶 Issue" tasks={visibleTasks} isTrash onRestoreTask={props.onRestoreTask} onPermanentDeleteTask={props.onPermanentDeleteTask} />}
      {!isTrash && props.viewMode === "board" && <IssueBoard tasks={visibleTasks} onEditTask={props.onEditTask} onDeleteTask={props.onDeleteTask} />}
      {!isTrash && props.viewMode === "list" && <IssueList tasks={visibleTasks} onEditTask={props.onEditTask} onDeleteTask={props.onDeleteTask} />}
      {!isTrash && props.viewMode === "calendar" && <IssueCalendar tasks={visibleTasks} onEditTask={props.onEditTask} />}
      {!isTrash && props.viewMode === "timeline" && <IssueTimeline tasks={visibleTasks} versions={props.versions} />}
    </section>
  );
}

function WorkspaceToolbar({ versions, selectedVersion, setSelectedVersion, onNewTask, onNewVersion }) {
  return (
    <div className="workspace-toolbar">
      <div className="project-version-select">
        <Flag size={16} />
        <select value={selectedVersion} onChange={(event) => setSelectedVersion(event.target.value)}>
          <option value="all">全部版本</option>
          {versions.map((version) => <option key={version.id} value={version.id}>{version.name}</option>)}
        </select>
      </div>
      <button className="issue-primary-button" onClick={onNewTask}>新建 Issue <Plus size={17} /></button>
      <button className="issue-menu-button" onClick={onNewVersion} title="新建版本"><MoreHorizontal size={18} /></button>
    </div>
  );
}

function ViewTabs({ viewMode, setViewMode }) {
  const tabs = [
    { value: "board", label: "看板", icon: LayoutDashboard },
    { value: "list", label: "列表", icon: List },
    { value: "calendar", label: "日历", icon: CalendarDays },
    { value: "timeline", label: "时间线", icon: Clock3 }
  ];
  return (
    <div className="project-tabs">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        return (
          <button key={tab.value} className={viewMode === tab.value ? "active" : ""} onClick={() => setViewMode(tab.value)}>
            <Icon size={16} />{tab.label}
          </button>
        );
      })}
    </div>
  );
}

function IssueList({ title = "全部 Issue", tasks, onEditTask, onDeleteTask, isTrash = false, onRestoreTask, onPermanentDeleteTask }) {
  return (
    <div className="issue-panel">
      <div className="issue-list-head">
        <strong><List size={18} />{title}</strong>
        <span>共 {tasks.length} 个 Issue</span>
      </div>
      <div className="issue-list">
        {tasks.map((task, index) => (
          <IssueRow
            key={task.id}
            task={task}
            index={index}
            onEditTask={onEditTask}
            onDeleteTask={onDeleteTask}
            isTrash={isTrash}
            onRestoreTask={onRestoreTask}
            onPermanentDeleteTask={onPermanentDeleteTask}
          />
        ))}
        {!tasks.length && <IssueEmpty />}
      </div>
    </div>
  );
}

function IssueRow({ task, index, onEditTask, onDeleteTask, isTrash = false, onRestoreTask, onPermanentDeleteTask }) {
  return (
    <div className={isTrash ? "issue-row trash-row" : "issue-row"} onDoubleClick={() => !isTrash && onEditTask(task)}>
      <IssueTypeIcon task={task} />
      <button className="issue-title-button" onClick={() => !isTrash && onEditTask(task)}>{task.title}</button>
      <span className="issue-key"><ClipboardList size={13} />{issueCode(index)}</span>
      <Avatar src={task.assigneeAvatar} name={task.assigneeName || "未分配"} />
      <span className={`issue-status ${task.status}`}>{statusMap[task.status]?.label || task.status}</span>
      <span className={`issue-rank ${priorityMap[task.priority]?.className}`}>{priorityScore(task.priority)}</span>
      <div className="issue-actions">
        {isTrash ? (
          <>
            <button onClick={() => onRestoreTask(task.id)} title="恢复"><RefreshCw size={14} /></button>
            <button onClick={() => onPermanentDeleteTask(task.id)} title="彻底删除"><Trash2 size={14} /></button>
          </>
        ) : (
          <>
            <button onClick={() => onEditTask(task)} title="编辑"><Pencil size={14} /></button>
            <button onClick={() => onDeleteTask(task.id)} title="删除"><Trash2 size={14} /></button>
          </>
        )}
      </div>
    </div>
  );
}

function IssueBoard({ tasks, onEditTask, onDeleteTask }) {
  const columns = ["todo", "doing", "review", "done"];
  return (
    <div className="board-columns">
      {columns.map((statusKey) => {
        const columnTasks = tasks.filter((task) => task.status === statusKey);
        return (
          <section className="board-column" key={statusKey}>
            <h3>{statusMap[statusKey].label}<span>{columnTasks.length}</span></h3>
            {columnTasks.map((task, index) => (
              <div
                className="board-issue-card"
                key={task.id}
                role="button"
                tabIndex={0}
                onClick={() => onEditTask(task)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") onEditTask(task);
                }}
              >
                <IssueTypeIcon task={task} />
                <strong>{task.title}</strong>
                <small>{issueCode(index)} · {task.assigneeName || "未分配"}</small>
                <span className={`issue-rank ${priorityMap[task.priority]?.className}`}>{priorityScore(task.priority)}</span>
                <button className="board-delete" onClick={(event) => {
                  event.stopPropagation();
                  onDeleteTask(task.id);
                }}><Trash2 size={13} /></button>
              </div>
            ))}
            {!columnTasks.length && <div className="board-empty">暂无 Issue</div>}
          </section>
        );
      })}
    </div>
  );
}

function IssueCalendar({ tasks, onEditTask }) {
  const groups = groupByDay(tasks);
  return (
    <div className="calendar-panel">
      {groups.map((group) => (
        <section className="calendar-day" key={group.day}>
          <h3><CalendarDays size={17} />{group.day}<span>{group.items.length}</span></h3>
          {group.items.map((task, index) => (
            <button key={task.id} onClick={() => onEditTask(task)}>
              <IssueTypeIcon task={task} />
              <span>{task.title}</span>
              <small>{issueCode(index)}</small>
            </button>
          ))}
        </section>
      ))}
      {!tasks.length && <IssueEmpty />}
    </div>
  );
}

function IssueTimeline({ tasks, versions }) {
  const total = Math.max(1, tasks.length);
  return (
    <div className="timeline-panel">
      {(versions.length ? versions : [{ id: "all", name: "全部版本" }]).map((version) => {
        const items = version.id === "all" ? tasks : tasks.filter((task) => task.versionId === version.id);
        const done = items.filter((task) => task.status === "done").length;
        const progress = Math.round((done / Math.max(1, items.length)) * 100);
        return (
          <div className="timeline-row" key={version.id}>
            <div><Crown size={18} /><strong>{version.name}</strong></div>
            <div className="timeline-track"><span style={{ width: `${progress}%` }} /></div>
            <b>{items.length ? `${done}/${items.length}` : `0/${total}`}</b>
          </div>
        );
      })}
    </div>
  );
}

function ReportsPanel({ tasks, users }) {
  const statuses = ["todo", "doing", "review", "done"];
  const priorities = ["urgent", "high", "medium", "low"];
  return (
    <section className="project-board-shell reports-board">
      <div className="issue-list-head">
        <strong><BarChart3 size={18} />报表</strong>
        <span>共 {tasks.length} 个 Issue</span>
      </div>
      <div className="report-grid">
        {statuses.map((statusKey) => (
          <ReportTile key={statusKey} label={statusMap[statusKey].label} value={tasks.filter((task) => task.status === statusKey).length} />
        ))}
      </div>
      <div className="report-section">
        <h3>优先级分布</h3>
        {priorities.map((priority) => <ReportBar key={priority} label={priorityMap[priority].label} value={tasks.filter((task) => task.priority === priority).length} total={tasks.length} />)}
      </div>
      <div className="report-section">
        <h3>队员任务</h3>
        {users.map((item) => <ReportBar key={item.id} label={item.name} value={tasks.filter((task) => task.assigneeId === item.id).length} total={tasks.length} />)}
      </div>
    </section>
  );
}

function FiltersPanel({ tasks, versions, selectedVersion, setSelectedVersion, scope, setScope, status, setStatus }) {
  return (
    <section className="project-board-shell filters-board">
      <div className="issue-list-head">
        <strong><Filter size={18} />过滤器</strong>
        <span>{tasks.length} 个 Issue 可筛选</span>
      </div>
      <div className="filter-section">
        <h3>版本</h3>
        <div className="filter-pills">
          <button className={selectedVersion === "all" ? "active" : ""} onClick={() => setSelectedVersion("all")}>全部版本</button>
          {versions.map((version) => <button key={version.id} className={selectedVersion === version.id ? "active" : ""} onClick={() => setSelectedVersion(version.id)}>{version.name}</button>)}
        </div>
      </div>
      <div className="filter-section">
        <h3>范围</h3>
        <div className="filter-pills">
          <button className={scope === "all" ? "active" : ""} onClick={() => setScope("all")}>全部 Issue</button>
          <button className={scope === "mine" ? "active" : ""} onClick={() => setScope("mine")}>我的工作</button>
        </div>
      </div>
      <div className="filter-section">
        <h3>状态</h3>
        <div className="filter-pills">
          <button className={status === "all" ? "active" : ""} onClick={() => setStatus("all")}>全部状态</button>
          {["todo", "doing", "review", "done"].map((statusKey) => <button key={statusKey} className={status === statusKey ? "active" : ""} onClick={() => setStatus(statusKey)}>{statusMap[statusKey].label}</button>)}
        </div>
      </div>
    </section>
  );
}

function ReportTile({ label, value }) {
  return (
    <div className="report-tile">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ReportBar({ label, value, total }) {
  const progress = Math.round((value / Math.max(1, total)) * 100);
  return (
    <div className="report-bar">
      <span>{label}</span>
      <div><b style={{ width: `${progress}%` }} /></div>
      <strong>{value}</strong>
    </div>
  );
}

function IssueTypeIcon({ task }) {
  const Icon = task.priority === "urgent" ? AlertTriangle : task.priority === "high" ? Swords : task.priority === "low" ? Gem : Shield;
  return (
    <span className={`issue-type ${task.priority}`}>
      <Icon size={15} />
    </span>
  );
}

function IssueEmpty() {
  return (
    <div className="issue-empty">
      <Sparkles size={32} />
      <strong>暂无 Issue</strong>
      <span>点击“新建 Issue”创建第一条任务。</span>
    </div>
  );
}

function AuthScreen({ serverBaseUrl, setServerBaseUrl, loading, error, onSubmit, appInfo }) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [avatarUrl, setAvatarUrl] = useState(defaultAvatars[0].url);
  const [showPassword, setShowPassword] = useState(false);
  const defaultServerUrl = appInfo?.serverPort ? `http://127.0.0.1:${appInfo.serverPort}` : "http://127.0.0.1:37371";

  function submit(event, nextMode = "login") {
    event.preventDefault();
    onSubmit({ name, password, avatarUrl }, nextMode);
  }

  return (
    <div className="auth-page">
      <section className="royal-login-panel">
        <header className="royal-login-header">
          <div className="royal-login-tab">
            <div className="royal-mini-shield"><Crown size={25} /></div>
            <strong>登录</strong>
          </div>
          <div className="royal-crown-top"><Crown size={44} /></div>
          <button className="royal-close" type="button" onClick={() => window.gorilla?.closeWindow?.()} title="关闭">
            <X size={34} />
          </button>
        </header>

        <form className="royal-login-body" onSubmit={(event) => submit(event, "login")}>
          <div className="royal-large-shield">
            <Crown size={70} />
          </div>

          <label className="royal-field">
            <span><Server size={34} />服务器地址</span>
            <div className="royal-input-wrap has-button">
              <input
                value={serverBaseUrl}
                onChange={(event) => setServerBaseUrl(event.target.value)}
                placeholder="请输入服务器地址"
              />
              <button type="button" onClick={() => setServerBaseUrl(defaultServerUrl)} title="使用本机服务器地址">
                <ChevronDown size={34} />
              </button>
            </div>
          </label>

          <label className="royal-field">
            <span><User size={34} />账号</span>
            <div className="royal-input-wrap">
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="请输入账号" />
            </div>
          </label>

          <label className="royal-field">
            <span><Lock size={34} />密码</span>
            <div className="royal-input-wrap has-button">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="请输入密码"
              />
              <button type="button" onClick={() => setShowPassword((current) => !current)} title={showPassword ? "隐藏密码" : "显示密码"}>
                {showPassword ? <EyeOff size={32} /> : <Eye size={32} />}
              </button>
            </div>
          </label>

          {error && <div className="inline-error royal-login-error">{error}</div>}

          <div className="royal-actions">
            <button className="royal-button royal-login-button" type="submit" disabled={loading}>
              {loading ? <RefreshCw className="spin" size={24} /> : null}
              登录
            </button>
            <button className="royal-button royal-register-button" type="button" disabled={loading} onClick={(event) => submit(event, "register")}>
              注册
            </button>
          </div>

        </form>

        <div className="royal-login-bottom">
          <Crown size={32} />
        </div>
      </section>
    </div>
  );
}

function TaskHall(props) {
  const currentVersionName = props.selectedVersion === "all"
    ? "全部版本"
    : props.versions.find((version) => version.id === props.selectedVersion)?.name || "未选择";
  const todoCount = props.tasks.filter((task) => task.status === "todo").length;
  const doingCount = props.tasks.filter((task) => task.status === "doing").length;

  return (
    <div className="task-hall" style={{ "--hall-bg": `url(${commandHall})` }}>
      <header className="hall-header">
        <div>
          <div className="eyebrow"><Crown size={16} />当前战役</div>
          <h2>{currentVersionName}</h2>
        </div>
        <div className="header-actions">
          <button className="icon-button" onClick={props.onRefresh} title="刷新">
            <RefreshCw size={18} />
          </button>
          <button className="secondary-button" onClick={props.onNewVersion}>
            <BadgePlus size={18} />新建版本
          </button>
          <button className="primary-button" onClick={props.onNewTask}>
            <Plus size={18} />新建任务
          </button>
        </div>
      </header>

      <section className="war-room">
        <div className="war-room-copy">
          <div className="season-ribbon"><Crown size={17} />{currentVersionName}</div>
          <h1>任务战役大厅</h1>
          <p>把版本目标拆成可执行的任务卡，分配给队员，追踪每一次推进。</p>
          <div className="war-actions">
            <button className="primary-button" onClick={props.onNewTask}>
              <Swords size={18} />发布任务悬赏
            </button>
            <button className="secondary-button" onClick={props.onNewVersion}>
              <BadgePlus size={18} />创建版本旗帜
            </button>
          </div>
        </div>
        <div className="war-stats">
          <StatBadge icon={ScrollText} label="待处理" value={todoCount} tone="blue" />
          <StatBadge icon={Swords} label="进行中" value={doingCount} tone="red" />
          <StatBadge icon={Gem} label="我的未完成" value={props.mineCount} tone="gold" />
        </div>
      </section>

      <section className="version-strip">
        <button className={props.selectedVersion === "all" ? "version-chip active" : "version-chip"} onClick={() => props.setSelectedVersion("all")}>
          <Archive size={16} />全部版本
        </button>
        {props.versions.map((version) => (
          <button
            key={version.id}
            className={props.selectedVersion === version.id ? "version-chip active" : "version-chip"}
            onClick={() => props.setSelectedVersion(version.id)}
          >
            <Crown size={16} />{version.name}
          </button>
        ))}
      </section>

      <section className="control-bar">
        <Segmented
          value={props.scope}
          onChange={props.setScope}
          options={[
            { value: "all", label: "全部任务", icon: Eye },
            { value: "mine", label: "我的任务", icon: User }
          ]}
        />
        <Segmented
          value={props.status}
          onChange={props.setStatus}
          options={[
            { value: "all", label: "全部状态", icon: ScrollText },
            { value: "todo", label: "待处理", icon: ScrollText },
            { value: "doing", label: "进行中", icon: Swords },
            { value: "done", label: "已完成", icon: Check }
          ]}
        />
        <div className="stat-pill">
          <Swords size={17} />{props.tasks.length} 个任务
        </div>
        <div className="stat-pill done">
          <Check size={17} />{props.doneCount} 已完成
        </div>
      </section>

      <section className="task-grid">
        {props.tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            serverBaseUrl={props.serverBaseUrl}
            onEdit={() => props.onEditTask(task)}
            onDelete={() => props.onDeleteTask(task.id)}
          />
        ))}
        {!props.tasks.length && (
          <div className="empty-state bounty-board">
            <div className="bounty-icon"><Sparkles size={42} /></div>
            <strong>悬赏板还空着</strong>
            <span>新建一个任务，选择版本和执行人，第一张任务卡就会钉在这里。</span>
            <div className="empty-actions">
              <button className="primary-button" onClick={props.onNewTask}><Plus size={18} />新建任务</button>
              <button className="secondary-button" onClick={props.onNewVersion}><BadgePlus size={18} />新建版本</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function StatBadge({ icon: Icon, label, value, tone }) {
  return (
    <div className={`stat-badge ${tone}`}>
      <Icon size={24} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function TaskCard({ task, onEdit, onDelete }) {
  const StatusIcon = statusMap[task.status]?.icon || ScrollText;
  return (
    <article className={`task-row task-${task.priority}`}>
      <div className="task-row-main">
        <span className={`priority-badge ${priorityMap[task.priority]?.className}`}>
          {priorityMap[task.priority]?.label || "中"}
        </span>
        <span className="status-badge">
          <StatusIcon size={15} />{statusMap[task.status]?.label}
        </span>
        <h3>{task.title}</h3>
      </div>
      <div className="task-row-desc">{task.description || "暂无描述"}</div>
      <div className="task-meta task-row-meta">
        <span><Crown size={14} />{task.versionName || "未归属版本"}</span>
        <span><FileImage size={14} />{task.attachmentCount || 0}</span>
      </div>
      <div className="assignee task-row-assignee">
        <Avatar src={task.assigneeAvatar} name={task.assigneeName || "未分配"} />
        <span>{task.assigneeName || "未分配"}</span>
      </div>
      <div className="card-actions">
        <button className="icon-button small" onClick={onEdit} title="修改任务"><Pencil size={16} /></button>
        <button className="icon-button small danger" onClick={onDelete} title="删除任务"><Trash2 size={16} /></button>
      </div>
    </article>
  );
}

function TaskEditorPage({ task, users, versions, defaultVersion, serverBaseUrl, api, onClose, onSave, onChanged }) {
  const [values, setValues] = useState({
    id: task.id,
    title: task.title || "",
    description: task.description || "",
    versionId: task.versionId || defaultVersion || "",
    assigneeId: task.assigneeId || users[0]?.id || "",
    status: task.status || "todo",
    priority: task.priority || "medium"
  });
  const [files, setFiles] = useState([]);
  const [attachments, setAttachments] = useState([]);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!task.id) return;
    api.get(`/api/tasks/${task.id}`).then((result) => {
      setAttachments(result.attachments || []);
    }).catch((err) => setError(err.message));
  }, [task.id]);

  const pendingPreviews = useMemo(() => files.map((file) => ({
    file,
    url: URL.createObjectURL(file)
  })), [files]);

  useEffect(() => () => {
    pendingPreviews.forEach((preview) => URL.revokeObjectURL(preview.url));
  }, [pendingPreviews]);

  const remainingSlots = Math.max(0, 5 - attachments.length - files.length);

  function update(field, value) {
    setDirty(true);
    setValues((current) => ({ ...current, [field]: value }));
  }

  function closeEditor() {
    if (dirty && !window.confirm("当前任务内容尚未保存，确认返回主界面吗？")) {
      return;
    }
    onClose();
  }

  async function submit(event) {
    event.preventDefault();
    if (!values.title.trim()) {
      setError("任务标题不能为空。");
      return;
    }
    if (attachments.length + files.length > 5) {
      setError("单个任务最多上传 5 个附件。");
      return;
    }
    await onSave({ ...values, title: values.title.trim(), description: values.description.trim() }, files);
  }

  function addFiles(fileList) {
    const incoming = Array.from(fileList || []).filter((file) => /^(image|video)\//.test(file.type));
    if (!incoming.length) return;
    setDirty(true);
    setFiles((current) => {
      const slots = Math.max(0, 5 - attachments.length - current.length);
      if (incoming.length > slots) {
        setError("最多上传 5 个附件，多出的文件已忽略。");
      }
      return [...current, ...incoming.slice(0, slots)];
    });
  }

  function removePendingFile(index) {
    setDirty(true);
    setFiles((current) => current.filter((_file, currentIndex) => currentIndex !== index));
  }

  async function deleteAttachment(attachmentId) {
    try {
      const result = await api.delete(`/api/tasks/${task.id}/attachments/${attachmentId}`);
      setDirty(true);
      setAttachments(result.attachments || []);
      onChanged();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <RoyalFrame title={task.id ? "编辑任务" : "新建任务"} emblem="settings" className="task-editor-frame" closeMode="back" onClose={closeEditor}>
      <form className="task-editor-page" onSubmit={submit}>
        <div className="task-editor-scroll">
          <section className="task-editor-titlebar">
            <ClipboardList size={30} />
            <strong>{task.id ? "编辑任务" : "新建任务"}</strong>
          </section>

          {error && <div className="inline-error task-editor-error">{error}</div>}

          <TaskField icon={Star} label="任务标题">
            <div className="task-input-wrap">
              <input
                value={values.title}
                maxLength={50}
                onChange={(event) => update("title", event.target.value)}
                placeholder="请输入任务标题"
              />
              <small>{values.title.length}/50</small>
            </div>
          </TaskField>

          <TaskField icon={FileText} label="任务描述">
            <div className="task-input-wrap textarea">
              <textarea
                value={values.description}
                maxLength={200}
                onChange={(event) => update("description", event.target.value)}
                placeholder="请输入任务描述（选填）"
              />
              <small>{values.description.length}/200</small>
            </div>
          </TaskField>

          <TaskField icon={FileImage} label="上传附件（图片和视频）">
            <div className="task-attachment-zone">
              <label className="task-upload-box">
                <Plus size={34} />
                <strong>上传文件</strong>
                <span>支持图片和视频格式</span>
                <input
                  type="file"
                  accept="image/*,video/*"
                  multiple
                  onChange={(event) => {
                    addFiles(event.target.files);
                    event.target.value = "";
                  }}
                />
              </label>
              <div className="task-attachment-list">
                {pendingPreviews.map(({ file, url }, index) => (
                  <AttachmentListItem
                    key={`${file.name}-${file.lastModified}-${index}`}
                    fileName={file.name}
                    fileType={file.type}
                    fileSize={file.size}
                    src={url}
                    onDelete={() => removePendingFile(index)}
                  />
                ))}
                {attachments.map((attachment) => (
                  <AttachmentListItem
                    key={attachment.id}
                    fileName={attachment.fileName}
                    fileType={attachment.fileType}
                    fileSize={attachment.fileSize}
                    src={absoluteUrl(serverBaseUrl, attachment.fileUrl)}
                    onDelete={() => deleteAttachment(attachment.id)}
                  />
                ))}
                {!files.length && !attachments.length && (
                  <div className="task-attachment-empty">还没有附件，最多可上传 5 个。</div>
                )}
              </div>
            </div>
            <small className="task-upload-count">剩余可选 {remainingSlots} 个</small>
          </TaskField>

          <div className="task-compact-fields">
            <TaskInlineField icon={User} label="任务执行人">
              <select value={values.assigneeId} onChange={(event) => update("assigneeId", event.target.value)}>
                <option value="">请选择任务执行人</option>
                {users.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </TaskInlineField>

            <TaskInlineField icon={Flag} label="版本号">
              <select value={values.versionId} onChange={(event) => update("versionId", event.target.value)}>
                <option value="">请选择版本号</option>
                {versions.map((version) => <option key={version.id} value={version.id}>{version.name}</option>)}
              </select>
            </TaskInlineField>

            <TaskInlineField icon={AlertTriangle} label="紧急程度">
              <select value={values.priority} onChange={(event) => update("priority", event.target.value)}>
                <option value="low">低</option>
                <option value="medium">中</option>
                <option value="high">高</option>
                <option value="urgent">紧急</option>
              </select>
            </TaskInlineField>
          </div>

          <TaskField icon={ScrollText} label="任务状态">
            <select value={values.status} onChange={(event) => update("status", event.target.value)}>
              <option value="todo">待处理</option>
              <option value="doing">进行中</option>
              <option value="review">审查中</option>
              <option value="done">已完成</option>
            </select>
          </TaskField>
        </div>

        <div className="task-editor-submit">
          <button type="submit">{task.id ? "保存" : "新建"}</button>
        </div>
      </form>
    </RoyalFrame>
  );
}

function TaskField({ icon: Icon, label, children }) {
  return (
    <section className="task-field-card">
      <span className="task-field-label"><Icon size={24} />{label}</span>
      {children}
    </section>
  );
}

function TaskInlineField({ icon: Icon, label, children }) {
  return (
    <section className="task-inline-field">
      <span className="task-inline-label"><Icon size={18} />{label}</span>
      <div className="task-inline-control">{children}</div>
    </section>
  );
}

function AttachmentListItem({ fileName, fileType, fileSize, src, onDelete }) {
  const isVideo = fileType?.startsWith("video/");
  return (
    <div className="task-attachment-item">
      <div className="task-attachment-thumb">
        <AttachmentPreview fileType={fileType} src={src} fileName={fileName} compact />
        {isVideo && <span className="task-video-play">▶</span>}
      </div>
      <span>
        <strong>{fileName}</strong>
        <small>{formatFileSize(fileSize)}</small>
      </span>
      <button type="button" onClick={onDelete} title="删除附件"><Trash2 size={22} /></button>
    </div>
  );
}

function TaskModal({ task, users, versions, defaultVersion, serverBaseUrl, api, onClose, onSave, onChanged }) {
  const [values, setValues] = useState({
    id: task.id,
    title: task.title || "",
    description: task.description || "",
    versionId: task.versionId || defaultVersion || "",
    assigneeId: task.assigneeId || users[0]?.id || "",
    status: task.status || "todo",
    priority: task.priority || "medium"
  });
  const [files, setFiles] = useState([]);
  const [attachments, setAttachments] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!task.id) return;
    api.get(`/api/tasks/${task.id}`).then((result) => {
      setAttachments(result.attachments || []);
    }).catch((err) => setError(err.message));
  }, [task.id]);

  const maxRemaining = Math.max(0, 5 - attachments.length);
  const canChooseCount = Math.max(0, maxRemaining - files.length);
  const pendingPreviews = useMemo(() => files.map((file) => ({
    file,
    url: URL.createObjectURL(file)
  })), [files]);

  useEffect(() => () => {
    pendingPreviews.forEach((preview) => URL.revokeObjectURL(preview.url));
  }, [pendingPreviews]);

  function update(field, value) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  function submit(event) {
    event.preventDefault();
    if (files.length > maxRemaining) {
      setError(`这个任务还可以上传 ${maxRemaining} 个附件。`);
      return;
    }
    onSave(values, files);
  }

  function addFiles(fileList) {
    const incoming = Array.from(fileList || []).filter((file) => /^(image|video)\//.test(file.type));
    setFiles((current) => {
      const next = [...current, ...incoming];
      return next.slice(0, maxRemaining);
    });
  }

  function removePendingFile(index) {
    setFiles((current) => current.filter((_file, currentIndex) => currentIndex !== index));
  }

  async function deleteAttachment(attachmentId) {
    try {
      const result = await api.delete(`/api/tasks/${task.id}/attachments/${attachmentId}`);
      setAttachments(result.attachments || []);
      onChanged();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <Modal onClose={onClose}>
      <form className="task-modal" onSubmit={submit}>
        <div className="modal-title">
          <div><Swords size={24} /></div>
          <section>
            <h2>{task.id ? "修改任务" : "新建任务"}</h2>
            <p>把目标、执行人和版本号放到同一张任务卡里。</p>
          </section>
        </div>

        {error && <div className="inline-error">{error}</div>}

        <label>
          标题
          <input value={values.title} onChange={(event) => update("title", event.target.value)} placeholder="例如：修复战斗结算奖励显示" />
        </label>
        <label>
          描述
          <textarea value={values.description} onChange={(event) => update("description", event.target.value)} placeholder="补充任务背景、验收点或注意事项" />
        </label>

        <div className="form-grid">
          <label>
            所属版本
            <select value={values.versionId} onChange={(event) => update("versionId", event.target.value)}>
              <option value="">未归属版本</option>
              {versions.map((version) => <option key={version.id} value={version.id}>{version.name}</option>)}
            </select>
          </label>
          <label>
            执行人
            <select value={values.assigneeId} onChange={(event) => update("assigneeId", event.target.value)}>
              <option value="">未分配</option>
              {users.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label>
            状态
            <select value={values.status} onChange={(event) => update("status", event.target.value)}>
              <option value="todo">待处理</option>
              <option value="doing">进行中</option>
              <option value="review">审查中</option>
              <option value="done">已完成</option>
            </select>
          </label>
          <label>
            优先级
            <select value={values.priority} onChange={(event) => update("priority", event.target.value)}>
              <option value="low">低</option>
              <option value="medium">中</option>
              <option value="high">高</option>
              <option value="urgent">紧急</option>
            </select>
          </label>
        </div>

        <label className="file-drop">
          <Upload size={24} />
          <strong>上传图片或视频</strong>
          <span>单个任务最多 5 个，当前还可选择 {canChooseCount} 个</span>
          <input
            type="file"
            accept="image/*,video/*"
            multiple
            onChange={(event) => {
              addFiles(event.target.files);
              event.target.value = "";
            }}
          />
        </label>

        {!!files.length && (
          <section className="attachment-section">
            <div className="attachment-title">
              <strong>待上传附件</strong>
              <span>{files.length} / {maxRemaining}</span>
            </div>
            <div className="pending-file-list">
              {pendingPreviews.map(({ file, url }, index) => (
                <div className="pending-file-row" key={`${file.name}-${file.lastModified}-${index}`}>
                  <AttachmentPreview fileType={file.type} src={url} fileName={file.name} compact />
                  <span>{file.name}</span>
                  <small>{formatFileSize(file.size)}</small>
                  <button type="button" onClick={() => removePendingFile(index)} title="取消上传">
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {!!attachments.length && (
          <section className="attachment-section">
            <div className="attachment-title">
              <strong>已上传附件</strong>
              <span>{attachments.length} / 5</span>
            </div>
            <div className="attachment-grid">
              {attachments.map((attachment) => (
                <div className="attachment-tile" key={attachment.id}>
                  <AttachmentPreview
                    fileType={attachment.fileType}
                    src={absoluteUrl(serverBaseUrl, attachment.fileUrl)}
                    fileName={attachment.fileName}
                  />
                  <div className="attachment-name"><FileImage size={13} />{attachment.fileName}</div>
                  <button type="button" onClick={() => deleteAttachment(attachment.id)} title="取消上传"><X size={14} /></button>
                </div>
              ))}
            </div>
          </section>
        )}

        {!attachments.length && !files.length && (
          <div className="attachment-empty">
            <FileImage size={18} />
            <span>还没有附件。选择图片或视频后，会先出现在待上传列表中。</span>
          </div>
        )}

        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={onClose}>取消</button>
          <button className="primary-button"><Save size={18} />保存任务</button>
        </div>
      </form>
    </Modal>
  );
}

function AttachmentPreview({ fileType, src, fileName, compact = false }) {
  const className = compact ? "attachment-preview compact" : "attachment-preview";
  if (fileType?.startsWith("image/")) {
    return <img className={className} src={src} alt={fileName} />;
  }
  if (fileType?.startsWith("video/")) {
    return <video className={className} src={src} muted controls={!compact} />;
  }
  return (
    <div className={className}>
      <FileImage size={compact ? 16 : 26} />
    </div>
  );
}

function VersionModal({ onClose, onSave }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  return (
    <Modal onClose={onClose}>
      <form className="version-modal" onSubmit={(event) => {
        event.preventDefault();
        onSave({ name, description });
      }}>
        <div className="modal-title">
          <div><Crown size={24} /></div>
          <section>
            <h2>新建版本号</h2>
            <p>例如 1.0.1、1.0.2，任务会归属到对应版本。</p>
          </section>
        </div>
        <label>
          版本号
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="1.0.2" />
        </label>
        <label>
          版本说明
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="这个版本的目标" />
        </label>
        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={onClose}>取消</button>
          <button className="primary-button"><BadgePlus size={18} />创建版本</button>
        </div>
      </form>
    </Modal>
  );
}

function SettingsPanel({ appInfo, config, user, serverBaseUrl, api, onSaveConfig, onUserUpdated, onError, onMessage, onClose }) {
  const [checking, setChecking] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [updateInfo, setUpdateInfo] = useState(null);
  const hasUpdate = Boolean(updateInfo?.version && appInfo?.version && isNewer(updateInfo.version, appInfo.version));

  useEffect(() => {
    let active = true;
    async function loadUpdateInfo() {
      try {
        const result = await api.get("/api/app/update-manifest");
        if (active) {
          setUpdateInfo(result);
        }
      } catch {
        if (active) {
          setUpdateInfo(null);
        }
      }
    }
    if (appInfo?.version) {
      loadUpdateInfo();
    }
    return () => {
      active = false;
    };
  }, [api, appInfo?.version]);

  async function uploadAvatar(file) {
    if (!file) return;
    const form = new FormData();
    form.append("avatar", file);
    try {
      const result = await api.upload("/api/users/me/avatar", form);
      onUserUpdated(result.user);
      onMessage("头像已更新。");
    } catch (err) {
      onError(err.message);
    }
  }

  async function renameUser(nextName) {
    try {
      const result = await api.put("/api/users/me", {
        name: nextName.trim(),
        avatarUrl: user?.avatarUrl
      });
      onUserUpdated(result.user);
      setRenameOpen(false);
      onMessage("昵称已更新。");
    } catch (err) {
      onError(err.message);
    }
  }

  async function checkUpdate() {
    setChecking(true);
    try {
      const result = await api.get("/api/app/update-manifest");
      setUpdateInfo(result);
      if (isNewer(result.version, appInfo.version)) {
        const targetUrl = result.downloadUrl || result.pageUrl;
        if (targetUrl) {
          await window.gorilla?.openExternal?.(targetUrl);
          onMessage(`发现新版本 ${result.version}，已打开下载页面。`);
        } else {
          onMessage(`发现新版本 ${result.version}，但未配置下载地址。`);
        }
      } else {
        onMessage("当前已是最新版本。");
      }
    } catch (err) {
      onError(err.message);
    } finally {
      setChecking(false);
    }
  }

  return (
    <>
      <RoyalFrame title="设置" emblem="settings" className="settings-royal-frame" closeMode="back" onClose={onClose}>
        <div className="royal-settings-scroll">
          <SettingsSection icon={User} title="账号信息">
            <label className="settings-list-card avatar-card">
              <Avatar src={absoluteUrl(serverBaseUrl, user?.avatarUrl)} name={user?.name || "玩家"} size="large" />
              <span>
                <strong>修改头像</strong>
                <small>点击更换当前头像</small>
              </span>
              <b>›</b>
              <input
                type="file"
                accept="image/*"
                onChange={(event) => {
                  uploadAvatar(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
            </label>
            <button className="settings-list-card" type="button" onClick={() => setRenameOpen(true)}>
              <RoyalBadge type="shield" />
              <span>
                <strong>修改昵称</strong>
                <small>当前昵称：{user?.name || "未设置"}</small>
              </span>
              <b>›</b>
            </button>
          </SettingsSection>

          <SettingsSection icon={Settings} title="通用设置">
            <div className="settings-list-card">
              <RoyalBadge type="task" />
              <span>
                <strong>悬浮窗是否显示</strong>
                <small>开启后将在应用外显示悬浮窗</small>
              </span>
              <SwitchButton checked={Boolean(config?.floatingWindowEnabled)} onChange={(checked) => onSaveConfig({ floatingWindowEnabled: checked })} />
            </div>
            <div className="settings-list-card">
              <RoyalBadge type="task" />
              <span>
                <strong>悬浮窗是否置顶</strong>
                <small>开启后悬浮窗将在所有应用上层显示</small>
              </span>
              <SwitchButton checked={Boolean(config?.floatingWindowAlwaysOnTop)} onChange={(checked) => onSaveConfig({ floatingWindowAlwaysOnTop: checked })} />
            </div>
            <div className="settings-list-card settings-choice-card">
              <RoyalBadge type="settings" />
              <span>
                <strong>关闭主界面时</strong>
                <small>{config?.closeBehavior === "quit" ? "点击关闭会彻底退出 App" : "默认隐藏窗口并保留托盘运行"}</small>
              </span>
              <SettingsChoice
                value={config?.closeBehavior || "tray"}
                options={[
                  { value: "tray", label: "放托盘" },
                  { value: "quit", label: "退出" }
                ]}
                onChange={(value) => onSaveConfig({ closeBehavior: value })}
              />
            </div>
          </SettingsSection>

          <SettingsSection icon={Info} title="关于">
            <button className={hasUpdate ? "settings-list-card update-card has-update" : "settings-list-card update-card"} type="button" onClick={checkUpdate} disabled={checking}>
              <RoyalBadge type="settings" />
              <span>
                <strong>软件版本</strong>
                <small>{hasUpdate ? `发现 ${updateInfo.version}，点击下载更新` : `当前版本：${appInfo?.version || "dev"}`}</small>
              </span>
              {hasUpdate && <i className="settings-update-dot" aria-label="有新版本" />}
              {checking ? <RefreshCw className="spin" size={24} /> : hasUpdate ? <Download size={24} /> : <b>›</b>}
            </button>
            <button className="settings-list-card" type="button" onClick={() => onMessage("用户协议与隐私政策页面将在后续版本补充。")}>
              <FileText size={34} />
              <span>
                <strong>用户协议与隐私政策</strong>
                <small>查看应用使用说明</small>
              </span>
              <b>›</b>
            </button>
          </SettingsSection>
        </div>
      </RoyalFrame>
      {renameOpen && (
        <RenameUserDialog
          currentName={user?.name || ""}
          onClose={() => setRenameOpen(false)}
          onSave={renameUser}
        />
      )}
    </>
  );
}

function RenameUserDialog({ currentName, onClose, onSave }) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const trimmed = name.trim();
  const disabled = saving || trimmed.length < 2 || trimmed.length > 16 || trimmed === currentName;

  async function submit(event) {
    event.preventDefault();
    if (disabled) return;
    setSaving(true);
    try {
      await onSave(trimmed);
    } finally {
      setSaving(false);
    }
  }

  return (
    createPortal(
      <div className="rename-royal-backdrop" onMouseDown={onClose}>
        <form className="rename-royal-dialog" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
          <header className="rename-royal-header">修改昵称</header>
          <section className="rename-royal-body">
            <label className="rename-royal-field">
              <span>请输入新的昵称</span>
              <input
                autoFocus
                value={name}
                maxLength={16}
                onChange={(event) => setName(event.target.value)}
                placeholder="请输入 2-16 个字符"
              />
            </label>
            <div className="rename-royal-actions">
              <button type="button" className="rename-royal-cancel" onClick={onClose}>取消</button>
              <button type="submit" className="rename-royal-save" disabled={disabled}>{saving ? "保存中" : "保存"}</button>
            </div>
          </section>
        </form>
      </div>,
      document.body
    )
  );
}

function SettingsSection({ icon: Icon, title, children }) {
  return (
    <section className="royal-settings-section">
      <h2><Icon size={30} />{title}</h2>
      <div className="royal-settings-cards">{children}</div>
    </section>
  );
}

function SettingsChoice({ value, options, onChange }) {
  return (
    <div className="settings-choice">
      {options.map((option) => (
        <button
          key={option.value}
          className={value === option.value ? "active" : ""}
          type="button"
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function SwitchButton({ checked, onChange }) {
  return (
    <button className={checked ? "royal-switch active" : "royal-switch"} type="button" onClick={() => onChange(!checked)}>
      <span />
    </button>
  );
}

function FloatingApp() {
  const [config, setConfig] = useState(null);
  const [serverBaseUrl, setServerBaseUrl] = useState(localStorage.getItem(SERVER_KEY) || "http://127.0.0.1:37371");
  const [token] = useState(localStorage.getItem(TOKEN_KEY) || "");
  const [user, setUser] = useState(readJson(USER_KEY));
  const [count, setCount] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragState = useRef({ active: false, moved: false, startX: 0, startY: 0 });

  useEffect(() => {
    const previousTitle = document.title;
    document.title = "";
    return () => {
      document.title = previousTitle;
    };
  }, []);

  useEffect(() => {
    window.gorilla?.getConfig?.().then((next) => {
      if (next) {
        setConfig(next);
        if (next.serverBaseUrl) setServerBaseUrl(next.serverBaseUrl);
      }
    });
    return window.gorilla?.onConfigChanged?.((next) => {
      setConfig(next);
      if (next.serverBaseUrl) setServerBaseUrl(next.serverBaseUrl);
    });
  }, []);

  useEffect(() => {
    const unsubscribeStats = window.gorilla?.onFloatingStats?.((stats) => {
      if (stats?.user) {
        setUser(stats.user);
        saveJson(USER_KEY, stats.user);
      }
      if (Number.isFinite(stats?.myOpenTasks)) {
        setCount(stats.myOpenTasks);
      }
    });
    const unsubscribeUser = window.gorilla?.onUserChanged?.((nextUser) => {
      if (!nextUser) {
        setUser(null);
        localStorage.removeItem(USER_KEY);
        return;
      }
      setUser(nextUser);
      saveJson(USER_KEY, nextUser);
    });
    return () => {
      unsubscribeStats?.();
      unsubscribeUser?.();
    };
  }, []);

  useEffect(() => {
    if (!token) return;
    const api = makeApi(serverBaseUrl, token);
    async function load() {
      try {
        const [me, tasks] = await Promise.all([
          api.get("/api/auth/me"),
          api.get("/api/tasks?scope=mine&status=all&versionId=all")
        ]);
        setUser(me.user);
        setCount(tasks.tasks.filter((task) => task.status !== "done").length);
      } catch {
        setCount(0);
      }
    }
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [token, serverBaseUrl]);

  if (config && !config.floatingWindowEnabled) {
    return null;
  }

  function openMainWindow() {
    window.gorilla?.showMainWindow?.();
  }

  function handlePointerDown(event) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragState.current = {
      active: true,
      moved: false,
      startX: event.screenX,
      startY: event.screenY
    };
    window.gorilla?.startFloatingDrag?.(event.screenX, event.screenY);
  }

  function handlePointerMove(event) {
    const state = dragState.current;
    if (!state.active) return;
    const delta = Math.hypot(event.screenX - state.startX, event.screenY - state.startY);
    if (delta > 4) {
      state.moved = true;
      setDragging(true);
    }
    if (state.moved) {
      event.preventDefault();
      window.gorilla?.moveFloatingDrag?.(event.screenX, event.screenY);
    }
  }

  function handlePointerUp(event) {
    const state = dragState.current;
    if (!state.active) return;
    event.preventDefault();
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    window.gorilla?.endFloatingDrag?.();
    dragState.current = { active: false, moved: false, startX: 0, startY: 0 };
    setDragging(false);
    if (!state.moved) {
      openMainWindow();
    }
  }

  function handleContextMenu(event) {
    event.preventDefault();
    event.stopPropagation();
    window.gorilla?.endFloatingDrag?.();
    dragState.current = { active: false, moved: false, startX: 0, startY: 0 };
    setDragging(false);
    window.gorilla?.showFloatingMenu?.();
  }

  return (
    <main
      className={dragging ? "floating-root dragging" : "floating-root"}
      role="button"
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onContextMenu={handleContextMenu}
      onKeyDown={(event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openMainWindow();
      }
    }}
    >
      <div className="floating-card" aria-label="打开主界面">
        <Avatar src={absoluteUrl(serverBaseUrl, user?.avatarUrl)} name={user?.name || "未登录"} size="large" />
        <span>
          <strong>{user?.name || "未登录"}</strong>
          <small>{count} 个任务</small>
        </span>
        <b>{count}</b>
      </div>
    </main>
  );
}

function Segmented({ value, options, onChange }) {
  return (
    <div className="segmented">
      {options.map((option) => {
        const Icon = option.icon;
        return (
          <button key={option.value} className={value === option.value ? "active" : ""} onClick={() => onChange(option.value)}>
            <Icon size={16} />{option.label}
          </button>
        );
      })}
    </div>
  );
}

function Toggle({ label, checked, onChange }) {
  return (
    <label className="toggle-row">
      <span>{label}</span>
      <button type="button" className={checked ? "toggle active" : "toggle"} onClick={() => onChange(!checked)}>
        {checked ? <Eye size={16} /> : <EyeOff size={16} />}
      </button>
    </label>
  );
}

function Avatar({ src, name, size = "normal" }) {
  return (
    <img
      className={`avatar avatar-${size}`}
      src={src || avatarDataUrl({ name, colors: ["#f5c766", "#315caa"], mark: (name || "?").slice(0, 1).toUpperCase() })}
      alt={name || "avatar"}
    />
  );
}

function Modal({ children, onClose }) {
  return createPortal(
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal-panel" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={onClose}><X size={18} /></button>
        {children}
      </div>
    </div>,
    document.body
  );
}

function Toast({ children, type, onClose }) {
  return (
    <div className={`toast ${type}`}>
      {type === "success" ? <Check size={18} /> : <AlertTriangle size={18} />}
      <span>{children}</span>
      <button onClick={onClose}><X size={14} /></button>
    </div>
  );
}

function Splash() {
  return (
    <div className="splash">
      <Crown size={52} />
      <strong>Gorilla Jira</strong>
      <span>正在打开任务大厅...</span>
    </div>
  );
}

function makeApi(baseUrl, token = "") {
  async function request(method, path, body) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: body == null ? undefined : JSON.stringify(body)
    });
    return parseResponse(response);
  }

  return {
    get: (path) => request("GET", path),
    post: (path, body) => request("POST", path, body),
    put: (path, body) => request("PUT", path, body),
    delete: (path) => request("DELETE", path),
    upload: async (path, formData) => {
      const response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData
      });
      return parseResponse(response);
    }
  };
}

async function parseResponse(response) {
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const error = new Error(data.message || "请求失败");
    error.status = response.status;
    throw error;
  }
  return data;
}

function absoluteUrl(base, url) {
  if (!url) return "";
  if (/^https?:|^data:/.test(url)) return url;
  return `${base}${url}`;
}

function formatFileSize(size) {
  if (!Number.isFinite(size)) return "";
  if (size < 1024 * 1024) {
    return `${Math.max(1, Math.round(size / 1024))} KB`;
  }
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function getVisibleTasks(tasks, searchTerm) {
  const keyword = String(searchTerm || "").trim().toLowerCase();
  if (!keyword) return tasks;
  return tasks.filter((task, index) => {
    const haystack = [
      task.title,
      task.description,
      task.versionName,
      task.assigneeName,
      statusMap[task.status]?.label,
      priorityMap[task.priority]?.label,
      issueCode(index)
    ].filter(Boolean).join(" ").toLowerCase();
    return haystack.includes(keyword);
  });
}

function getPanelTitle(activePanel) {
  if (activePanel === "work") return "我的工作";
  if (activePanel === "todo") return "待办事项";
  if (activePanel === "board") return "皇家看板";
  if (activePanel === "trash") return "垃圾桶";
  return "皇家项目";
}

function issueCode(index) {
  return `CR-${String(101 + index).padStart(3, "0")}`;
}

function priorityScore(priority) {
  return {
    urgent: 5,
    high: 4,
    medium: 3,
    low: 2
  }[priority] || 3;
}

function groupByDay(tasks) {
  const formatter = new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", weekday: "short" });
  const groups = new Map();
  tasks.forEach((task) => {
    const day = formatter.format(new Date(task.createdAt || Date.now()));
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(task);
  });
  return Array.from(groups, ([day, items]) => ({ day, items }));
}

function readJson(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function avatarDataUrl({ name, colors, mark }) {
  const label = mark || (name || "?").slice(0, 1).toUpperCase();
  const [a, b] = colors || ["#f5c766", "#315caa"];
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="${a}"/>
          <stop offset="1" stop-color="${b}"/>
        </linearGradient>
      </defs>
      <rect width="128" height="128" rx="28" fill="#1d2745"/>
      <path d="M64 10 112 30 103 96 64 118 25 96 16 30Z" fill="url(#g)" stroke="#ffe6a6" stroke-width="7"/>
      <circle cx="64" cy="59" r="25" fill="rgba(255,255,255,.25)"/>
      <text x="64" y="78" text-anchor="middle" font-size="48" font-family="Arial, sans-serif" font-weight="900" fill="#fff">${escapeSvg(label)}</text>
    </svg>
  `;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function escapeSvg(value) {
  return String(value).replace(/[<>&'"]/g, (char) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    "'": "&apos;",
    "\"": "&quot;"
  }[char]));
}

function isNewer(remote, current) {
  const a = String(remote || "0").split(".").map(Number);
  const b = String(current || "0").split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const next = a[i] || 0;
    const old = b[i] || 0;
    if (next > old) return true;
    if (next < old) return false;
  }
  return false;
}

createRoot(document.getElementById("root")).render(<App />);
