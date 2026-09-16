import { useEffect, useState } from "react";
import "./App.css";

import Projects from "./Projects";
import DailyUpdates from "./DailyUpdates";
import PastProjects from "./PastProjects";
import SiteVision from "./SiteVision";
import RiskAlerts from "./RiskAlerts";
import GenAI from "./GenAI";
import ProjectOverview from "./ProjectOverview";
import DashAlerts from "./DashAlerts";
import SiteMiniMap from "./SiteMiniMap";
import Search from "./Search";
import { notify } from "./toast";
import { Icon } from "./icons";

function App() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("Project Manager");
  const [authMode, setAuthMode] = useState("login"); // login | register
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  const [loggedIn, setLoggedIn] = useState(false);

  // Current page
  const [currentPage, setCurrentPage] = useState("dashboard");

  // Live dashboard numbers (falls back to demo values offline)
  const [summary, setSummary] = useState(null);

  // Notifications dropdown (live alert APIs, fetched on first open)
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifs, setNotifs] = useState(null);

  const toggleNotifs = () => {
    const next = !notifOpen;
    setNotifOpen(next);
    if (!next || notifs !== null) return;
    const get = (url) =>
      fetch(url)
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => []);
    Promise.all([get("/api/safety_issues"), get("/api/inspections")]).then(
      ([issues, insp]) => {
        const open = (Array.isArray(issues) ? issues : []).filter(
          (r) => !r.resolved_at
        );
        const items = [];
        const seen = new Set();
        const push = (kind, id, icon, cls, title, sub, page) => {
          const key = `${kind}${id}`;
          if (seen.has(key)) return;
          seen.add(key);
          items.push({ icon, cls, title, sub, page });
        };
        for (const r of open.filter(
          (r) => (r.status || "confirmed") === "pending"
        ).slice(0, 2)) {
          push("s", r.id, "alert", "warning",
            `Pending AI finding: ${r.title}`,
            `Incident #${r.id} needs confirmation`, "risk");
        }
        for (const r of open
          .filter((r) => r.severity === "High" && (r.status || "confirmed") !== "pending")
          .slice(0, 3)) {
          push("s", r.id, "alert", "danger", r.title,
            `HIGH · ${(r.reported_at || "").slice(0, 10) || "date unrecorded"}`, "risk");
        }
        for (const r of (Array.isArray(insp) ? insp : [])
          .filter((x) =>
            ["attention", "delayed", "fail", "failed"].includes(
              (x.status || "").toLowerCase()
            )
          )
          .slice(0, 2)) {
          push("i", r.id, "check", "info", "Update needs attention",
            `#${r.id} · ${r.log_date || "date unrecorded"}`, "dailyUpdates");
        }
        setNotifs(items.slice(0, 6));
      }
    );
  };

  useEffect(() => {
    if (!loggedIn) return;

    fetch("/api/dashboard/summary")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) setSummary(data);
      })
      .catch(() => {});
  }, [loggedIn]);

  // ==========================================
  // ROLE PERMISSIONS
  // ==========================================

  const rolePermissions = {
    "Project Manager": [
      "dashboard",
      "projects",
      "dailyUpdates",
      "maintenance",
      "search",
      "siteVision",
      "risk",
      "genai",
    ],

    "Site Supervisor": [
      "dashboard",
      "projects",
      "dailyUpdates",
      "search",
      "siteVision",
    ],

    "Contractor": [
      "dashboard",
      "projects",
      "dailyUpdates",
      "search",
    ],

    "Safety Officer": [
      "dashboard",
      "search",
      "siteVision",
      "risk",
    ],

    "Client / Owner": [
      "dashboard",
      "projects",
      "search",
    ],

    Admin: [
      "dashboard",
      "projects",
      "dailyUpdates",
      "maintenance",
      "search",
      "siteVision",
      "risk",
      "genai",
    ],
  };

  // ==========================================
  // CHECK ACCESS
  // ==========================================

  const hasAccess = (page) => {
    return rolePermissions[role]?.includes(page);
  };

  // ==========================================
  // NAVIGATION
  // ==========================================

  const navigateTo = (page) => {
    if (hasAccess(page)) {
      setCurrentPage(page);
    } else {
      notify(
        `${role} does not have access to this section.`,
        "error"
      );
    }
  };

  // Restore session (token in localStorage, verified against backend).
  useEffect(() => {
    const token = localStorage.getItem("buildsafe_token");
    if (!token) return;
    fetch("/api/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.user) {
          setName(data.user.name || "");
          setEmail(data.user.email || "");
          setRole(data.user.role || "Project Manager");
          setLoggedIn(true);
        } else {
          localStorage.removeItem("buildsafe_token");
          localStorage.removeItem("buildsafe_user");
        }
      })
      .catch(() => {});
  }, []);

  // ==========================================
  // LOGIN / REGISTER (real backend auth)
  // ==========================================

  const applySession = (data) => {
    localStorage.setItem("buildsafe_token", data.token);
    localStorage.setItem("buildsafe_user", JSON.stringify(data.user));
    setName(data.user.name || "");
    setEmail(data.user.email || "");
    setRole(data.user.role || "Project Manager");
    setPassword("");
    setAuthError("");
    setLoggedIn(true);
    setCurrentPage("dashboard");
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    if (authLoading) return;
    if (!email.trim() || !password) {
      setAuthError("Enter your email and password.");
      return;
    }
    setAuthLoading(true);
    setAuthError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.detail || "Sign in failed.");
      applySession(data);
    } catch (err) {
      setAuthError(err.message);
    }
    setAuthLoading(false);
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    if (authLoading) return;
    if (!name.trim()) {
      setAuthError("Enter your full name.");
      return;
    }
    if (!email.trim() || !password) {
      setAuthError("Enter your email and password.");
      return;
    }
    if (password.length < 6) {
      setAuthError("Password must be at least 6 characters.");
      return;
    }
    setAuthLoading(true);
    setAuthError("");
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          password,
          role,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.detail || "Could not create account.");
      applySession(data);
    } catch (err) {
      setAuthError(err.message);
    }
    setAuthLoading(false);
  };

  const switchAuthMode = (mode) => {
    setAuthMode(mode);
    setAuthError("");
  };

  const handleLogout = () => {
    localStorage.removeItem("buildsafe_token");
    localStorage.removeItem("buildsafe_user");
    setLoggedIn(false);
    setCurrentPage("dashboard");
    setEmail("");
    setPassword("");
    setName("");
    setRole("Project Manager");
    setAuthMode("login");
    setAuthError("");
  };

  // ==========================================
  // COMMON SIDEBAR
  // ==========================================

  const Sidebar = () => {
    const items = [
      { id: "dashboard", label: "Dashboard", icon: "dashboard", section: "MAIN" },
      { id: "projects", label: "Projects", icon: "building", section: "MAIN" },
      { id: "dailyUpdates", label: "Daily Updates", icon: "calendar", section: "MAIN" },
      {
        id: "maintenance",
        label: "Past Projects & Maintenance",
        icon: "wrench",
        section: "MAIN",
      },
      { id: "siteVision", label: "SiteVision AI", icon: "eye", section: "INTELLIGENCE" },
      { id: "risk", label: "Risk & Alerts", icon: "alert", section: "INTELLIGENCE" },
      { id: "genai", label: "GenAI Assistant", icon: "bot", section: "INTELLIGENCE" },
      { id: "search", label: "Search", icon: "search", section: "INTELLIGENCE" },
    ];
    const visible = items.filter((i) => hasAccess(i.id));
    const main = visible.filter((i) => i.section === "MAIN");
    const intel = visible.filter((i) => i.section === "INTELLIGENCE");

    const renderItem = (item) => (
      <button
        key={item.id}
        type="button"
        className={`menu-item ${currentPage === item.id ? "active" : ""}`}
        aria-current={currentPage === item.id ? "page" : undefined}
        title={item.label}
        onClick={() => navigateTo(item.id)}
      >
        <Icon name={item.icon} />
        <span className="menu-label">{item.label}</span>
      </button>
    );

    return (
      <aside className="sidebar" aria-label="Primary">

        {/* BRAND */}
        <div className="sidebar-brand">

          <div className="sidebar-icon" aria-hidden="true">
            <img src="/logo.png" alt="" width="22" height="22" draggable="false" />
          </div>

          <div>
            <h2>BuildSafe</h2>
            <span>CONSTRUCTION INTELLIGENCE</span>
          </div>

        </div>


        {/* MENU */}
        <nav className="menu-section" aria-label="Workspace sections">

          <p className="menu-title" aria-hidden="true">
            MAIN
          </p>

          {main.map(renderItem)}

          {intel.length > 0 && (
            <p className="menu-title ai-title" aria-hidden="true">
              INTELLIGENCE
            </p>
          )}

          {intel.map(renderItem)}

        </nav>


        {/* SIDEBAR BOTTOM */}

        <div className="sidebar-bottom">

          <button type="button" className="menu-item" title="Settings">
            <Icon name="settings" />
            <span className="menu-label">Settings</span>
          </button>


          <button
            className="logout-button"
            title="Log out"
            onClick={handleLogout}
          >
            <Icon name="logout" />
            <span className="menu-label">Logout</span>
          </button>

        </div>

      </aside>
    );
  };


  // ==========================================
  // LOGIN PAGE
  // ==========================================

  if (!loggedIn) {

    return (
      <div className="app">

        <a className="skip-link" href="#login-form">Skip to sign in</a>

        <div className="login-container">

          {/* LEFT SECTION */}

          <div className="login-info">

            <div className="brand">

              <div className="brand-icon" aria-hidden="true">
                <img src="/logo.png" alt="" width="26" height="26" draggable="false" />
              </div>

              <div>

                <h2>
                  BuildSafe
                </h2>

                <p>
                  Construction Intelligence Platform
                </p>

              </div>

            </div>


            <div className="info-content">

              <h1>
                Build smarter.
                <br />
                <span>
                  Manage better.
                </span>
              </h1>


              <p>
                An intelligent platform for managing
                construction projects, site progress,
                materials, safety and inspections.
              </p>


              <div className="features">

                <div>
                  <Icon name="check" />
                  Real-time project tracking
                </div>

                <div>
                  <Icon name="package" />
                  Smart material management
                </div>

                <div>
                  <Icon name="alert" />
                  AI-powered risk detection
                </div>

                <div>
                  <Icon name="sparkles" />
                  Intelligent construction assistant
                </div>

              </div>

            </div>


            <div className="copyright">
              © 2026 BuildSafe Construction Intelligence
            </div>

          </div>


          {/* RIGHT SECTION */}

          <div className="login-card-section">

            <div className="login-card">

              <div className="welcome">

                <h1>
                  {authMode === "register" ? "Create account" : "Welcome back"}
                </h1>

                <p>
                  {authMode === "register"
                    ? "Set up your BuildSafe account to access your construction workspace."
                    : "Sign in to access your construction workspace."}
                </p>

              </div>


              <form
                id="login-form"
                onSubmit={authMode === "register" ? handleRegister : handleLogin}
              >

                {authMode === "register" && (
                  <div className="input-group">

                    <label htmlFor="auth-name">
                      Full Name
                    </label>

                    <input
                      id="auth-name"
                      type="text"
                      placeholder="Enter your full name"
                      value={name}
                      onChange={(e) =>
                        setName(e.target.value)
                      }
                      autoComplete="name"
                    />

                  </div>
                )}

                {/* EMAIL */}

                <div className="input-group">

                  <label htmlFor="auth-email">
                    Email Address
                  </label>

                  <input
                    id="auth-email"
                    type="email"
                    placeholder="Enter your email"
                    value={email}
                    onChange={(e) =>
                      setEmail(e.target.value)
                    }
                    autoComplete="email"
                  />

                </div>


                {/* PASSWORD */}

                <div className="input-group">

                  <div className="password-label">

                    <label htmlFor="auth-password">
                      Password
                    </label>

                  </div>


                  <input
                    id="auth-password"
                    type="password"
                    placeholder={
                      authMode === "register"
                        ? "Minimum 6 characters"
                        : "Enter your password"
                    }
                    value={password}
                    onChange={(e) =>
                      setPassword(e.target.value)
                    }
                    autoComplete={
                      authMode === "register" ? "new-password" : "current-password"
                    }
                  />

                </div>


                {/* ROLE (register only — sign-in uses the role on your account) */}

                {authMode === "register" && (
                <div className="input-group">

                  <label htmlFor="auth-role">
                    Role
                  </label>


                  <select
                    id="auth-role"
                    value={role}
                    onChange={(e) =>
                      setRole(e.target.value)
                    }
                  >

                    <option>
                      Project Manager
                    </option>

                    <option>
                      Site Supervisor
                    </option>

                    <option>
                      Contractor
                    </option>

                    <option>
                      Safety Officer
                    </option>

                    <option>
                      Client / Owner
                    </option>

                    <option>
                      Admin
                    </option>

                  </select>

                </div>
                )}


                {authError && (
                  <p className="auth-error" role="alert">
                    {authError}
                  </p>
                )}

                {/* SUBMIT */}

                <button
                  type="submit"
                  className="login-button"
                  disabled={authLoading}
                >
                  {authLoading
                    ? authMode === "register"
                      ? "Creating account…"
                      : "Signing in…"
                    : authMode === "register"
                      ? "Create Account"
                      : <>Sign In <Icon name="arrowRight" /></>}
                </button>

              </form>


              <p className="signup-text">

                {authMode === "register" ? (
                  <>
                    Already have an account?{" "}

                    <button
                      type="button"
                      className="link-button"
                      onClick={() => switchAuthMode("login")}
                    >
                      Sign in
                    </button>
                  </>
                ) : (
                  <>
                    Don&apos;t have an account?{" "}

                    <button
                      type="button"
                      className="link-button"
                      onClick={() => switchAuthMode("register")}
                    >
                      Create account
                    </button>
                  </>
                )}

              </p>

            </div>

          </div>

        </div>

      </div>
    );
  }


  // ==========================================
  // PROJECTS PAGE
  // ==========================================

  if (currentPage === "projects") {

    return (
      <div className="dashboard">

        <a className="skip-link" href="#main-content">Skip to content</a>

        <Sidebar />

        <main id="main-content" className="main-content" tabIndex="-1">

          <Projects navigateTo={navigateTo} role={role} />

        </main>

      </div>
    );
  }


  // ==========================================
  // SEARCH PAGE
  // ==========================================

  if (currentPage === "search") {

    return (
      <div className="dashboard">

        <a className="skip-link" href="#main-content">Skip to content</a>

        <Sidebar />

        <main id="main-content" className="main-content" tabIndex="-1">

          <Search />

        </main>

      </div>
    );
  }


  // ==========================================
  // DAILY UPDATES PAGE
  // ==========================================

  if (currentPage === "dailyUpdates") {

    return (
      <div className="dashboard">

        <a className="skip-link" href="#main-content">Skip to content</a>

        <Sidebar />

        <main id="main-content" className="main-content" tabIndex="-1">

          <DailyUpdates />

        </main>

      </div>
    );
  }


  // ==========================================
  // PAST PROJECTS & MAINTENANCE
  // ==========================================

  if (currentPage === "maintenance") {

    return (
      <div className="dashboard">

        <a className="skip-link" href="#main-content">Skip to content</a>

        <Sidebar />

        <main id="main-content" className="main-content" tabIndex="-1">

          <PastProjects />

        </main>

      </div>
    );
  }


  // ==========================================
  // SITEVISION AI
  // ==========================================

  if (currentPage === "siteVision") {

    return (
      <div className="dashboard">

        <a className="skip-link" href="#main-content">Skip to content</a>

        <Sidebar />

        <main id="main-content" className="main-content" tabIndex="-1">

          <SiteVision />

        </main>

      </div>
    );
  }


  // ==========================================
  // RISK & ALERTS
  // ==========================================

  if (currentPage === "risk") {

    return (
      <div className="dashboard">

        <a className="skip-link" href="#main-content">Skip to content</a>

        <Sidebar />

        <main id="main-content" className="main-content" tabIndex="-1">

          <RiskAlerts />

        </main>

      </div>
    );
  }


  // ==========================================
  // GENAI ASSISTANT
  // ==========================================

  if (currentPage === "genai") {

    return (
      <div className="dashboard">

        <a className="skip-link" href="#main-content">Skip to content</a>

        <Sidebar />

        <main id="main-content" className="main-content" tabIndex="-1">

          <GenAI />

        </main>

      </div>
    );
  }


  // ==========================================
  // DASHBOARD
  // ==========================================

  return (
    <div className="dashboard">


      {/* SIDEBAR */}

      <a className="skip-link" href="#main-content">Skip to content</a>

      <Sidebar />


      {/* MAIN CONTENT */}

      <main id="main-content" className="main-content" tabIndex="-1">


        {/* TOP BAR */}

        <header className="topbar">

          <div>

            <h1>
              Dashboard
            </h1>

            <p>
              Welcome back! Here's what's happening
              across your projects.
            </p>

          </div>


          <div className="user-area">

            <div className="notif-wrap">
              <button
                type="button"
                className="notification"
                aria-label={
                  notifs && notifs.length > 0
                    ? `Notifications, ${notifs.length} unread`
                    : "Notifications"
                }
                aria-expanded={notifOpen}
                onClick={toggleNotifs}
              >
                <Icon name="bell" />
                {notifs && notifs.length > 0 && (
                  <span className="notification-dot" aria-hidden="true"></span>
                )}
              </button>

              {notifOpen && (
                <div className="notif-panel" role="menu" aria-label="Notifications">
                  <div className="notif-panel-header">
                    <strong>Notifications</strong>
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => setNotifOpen(false)}
                    >
                      Close
                    </button>
                  </div>
                  {notifs === null ? (
                    <p className="voice-note">Loading alerts…</p>
                  ) : notifs.length === 0 ? (
                    <p className="voice-note" role="status">
                      All clear — nothing needs attention.
                    </p>
                  ) : (
                    notifs.map((n, i) => (
                      <button
                        key={i}
                        type="button"
                        role="menuitem"
                        className={`alert-item ${n.cls} notif-item`}
                        onClick={() => {
                          setNotifOpen(false);
                          navigateTo(n.page);
                        }}
                      >
                        <span className="alert-icon" aria-hidden="true">
                          <Icon name={n.icon} />
                        </span>
                        <span>
                          <strong>{n.title}</strong>
                          <small>{n.sub}</small>
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>


            <div className="user-profile">

              <div className="avatar">
                {(name || email || "U").charAt(0).toUpperCase()}
              </div>


              <div>

                <strong>
                  {name || email.split("@")[0]}
                </strong>

                <span>
                  {role}
                </span>

              </div>

            </div>

          </div>

        </header>


        {/* STATS */}

        <section className="stats-grid">


          <div className="stat-card">

            <div className="stat-icon blue" aria-hidden="true">
              <Icon name="building" />
            </div>

            <div>

              <span>
                Total Projects
              </span>

              <h2>
                {summary ? summary.projects_total : 12}
              </h2>

              <small>
                {summary ? "live · project database" : <><span className="stat-trend-up">↑ 8%</span>&nbsp;from last month</>}
              </small>

            </div>

          </div>


          <div className="stat-card">

            <div className="stat-icon green" aria-hidden="true">
              <Icon name="check" />
            </div>

            <div>

              <span>
                {summary ? "Inspections Logged" : "Active Projects"}
              </span>

              <h2>
                {summary ? summary.inspections_total : 8}
              </h2>

              <small>
                {summary ? "live · inspection records" : "3 nearing completion"}
              </small>

            </div>

          </div>


          <div className="stat-card">

            <div className="stat-icon orange" aria-hidden="true">
              <Icon name="chart" />
            </div>

            <div>

              <span>
                {summary ? "Video Observations" : "Overall Progress"}
              </span>

              <h2>
                {summary ? summary.observations_total : "68%"}
              </h2>

              <small>
                {summary ? "AI-analysed site clips" : <><span className="stat-trend-up">↑ 5.2%</span>&nbsp;this week</>}
              </small>

            </div>

          </div>


          <div className="stat-card">

            <div className="stat-icon red" aria-hidden="true">
              <Icon name="alert" />
            </div>

            <div>

              <span>
                Safety Alerts
              </span>

              <h2>
                {summary ? summary.inspections_attention : 7}
              </h2>

              <small>
                {summary ? (
                  summary.safety_open > 0 || summary.inspections_flagged > 0
                    ? `flagged inspections + open safety issues`
                    : "flagged inspections"
                ) : <><span className="stat-trend-alert">3 require attention</span></>}
              </small>

            </div>

          </div>


          <div className="stat-card">

            <div className="stat-icon red" aria-hidden="true">
              <Icon name="wallet" />
            </div>

            <div>

              <span>
                Budget at Risk
              </span>

              <h2>
                {summary?.budget_at_risk_count ?? 1}
              </h2>

              <small>
                {summary?.budget_at_risk_count != null
                  ? "over-budget-risk projects"
                  : "1 project needs attention"}
              </small>

            </div>

          </div>

        </section>


        {/* MIDDLE SECTION */}

        <section className="dashboard-grid">


          {/* PROJECT OVERVIEW — live per-project progress, risk, budget */}

          <ProjectOverview navigateTo={navigateTo} />


          {/* ALERTS — live counts + freshest attention rows */}

          <DashAlerts navigateTo={navigateTo} />

        </section>


        {/* BOTTOM SECTION */}

        <section className="dashboard-grid bottom-grid">


          {/* RECENT ACTIVITY — live site map + AI observation feed */}

          <SiteMiniMap navigateTo={navigateTo} />


          {/* BUILDSAFE AI */}

          <div className="panel ai-panel">

            <div className="ai-header">

              <div className="ai-symbol" aria-hidden="true">
                <Icon name="sparkles" />
              </div>

              <div>

                <h2>
                  BuildSafe Assistant
                </h2>

                <p>
                  AI-powered construction intelligence
                </p>

              </div>

            </div>


            <p className="ai-text">

              Ask questions about project progress,
              materials, safety issues, inspections
              and construction risks.

            </p>


            <button
              className="ai-button"
              onClick={() =>
                navigateTo("genai")
              }
            >
              Open AI Assistant <Icon name="arrowRight" />
            </button>

          </div>

        </section>

      </main>

    </div>
  );
}

export default App;