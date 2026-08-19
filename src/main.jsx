import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  CalendarClock,
  CheckCircle2,
  CircleUserRound,
  ClipboardList,
  LayoutDashboard,
  MessageSquareText,
  PhoneCall,
  RefreshCw,
  Search,
  Siren,
  Star,
  UserCheck,
  UsersRound,
  XCircle
} from "lucide-react";
import "./styles.css";

const API = "/api";
const statusOptions = ["New", "Attempted", "Connected", "Follow Up", "Site Visit", "Super Interested", "Closed", "Rejected"];
const rejectionReasons = ["Budget", "Location", "Not Interested", "Purchased Elsewhere", "Invalid Lead", "Other"];
const callOutcomes = ["Attempted", "Connected", "Follow Up", "Site Visit", "Super Interested", "Rejected"];

function App() {
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [users, setUsers] = useState([]);
  const [page, setPage] = useState("dashboard");
  const [missedTab, setMissedTab] = useState("missed-leads");
  const [allLeadFilters, setAllLeadFilters] = useState({ search: "", status: "", assignedTo: "", preset: "", dateField: "created" });
  const [selectedLeadId, setSelectedLeadId] = useState(null);

  function navigate(nextPage) {
    setSelectedLeadId(null);
    setPage(nextPage);
  }

  useEffect(() => {
    request("/auth/me")
      .then((result) => setUser(result.user))
      .catch(() => setUser(null))
      .finally(() => setAuthChecked(true));
  }, []);

  useEffect(() => {
    if (user?.role !== "admin") {
      setUsers([]);
      return;
    }
    request("/users").then(setUsers).catch(console.error);
  }, [user]);

  if (!authChecked) return <div className="login-shell"><p className="muted">Loading CRM...</p></div>;
  if (!user) return <Login onLogin={setUser} />;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">NM</span>
          <div>
            <strong>Nandd Mahal</strong>
            <small>Lead CRM</small>
          </div>
        </div>
        <nav>
          <NavButton icon={<LayoutDashboard />} label="Dashboard" id="dashboard" page={page} setPage={navigate} />
          <NavButton icon={<PhoneCall />} label="New Leads" id="new" page={page} setPage={navigate} />
          <NavButton icon={<CalendarClock />} label="Follow-ups" id="followups" page={page} setPage={navigate} />
          <NavButton icon={<UserCheck />} label="Site Visits" id="sitevisits" page={page} setPage={navigate} />
          <NavButton icon={<Star />} label="Super Interested" id="super" page={page} setPage={navigate} />
          <NavButton icon={<Siren />} label="Missed" id="missed" page={page} setPage={(id) => { setMissedTab("missed-leads"); navigate(id); }} />
          <NavButton icon={<XCircle />} label="Rejected Leads" id="rejected" page={page} setPage={navigate} />
          <NavButton icon={<ClipboardList />} label="All Leads" id="all" page={page} setPage={navigate} />
          {user.role === "admin" && <NavButton icon={<UsersRound />} label="Users" id="users" page={page} setPage={navigate} />}
        </nav>
        <div className="profile">
          <CircleUserRound />
          <div>
            <strong>{user.name}</strong>
            <small>{user.role}</small>
          </div>
          <button className="icon-button" title="Logout" onClick={() => request("/auth/logout", { method: "POST" }).catch(() => {}).finally(() => {
            setSelectedLeadId(null);
            setPage("dashboard");
            setUser(null);
          })}>x</button>
        </div>
      </aside>

      <main className="main">
        <GlobalSearch openLead={setSelectedLeadId} />
        {selectedLeadId ? (
          <LeadDetail id={selectedLeadId} user={user} users={users} onBack={() => setSelectedLeadId(null)} onChanged={() => {}} />
        ) : (
          <Page
            page={page}
            user={user}
            users={users}
            onUsersChanged={setUsers}
            openLead={setSelectedLeadId}
            setPage={navigate}
            missedTab={missedTab}
            setMissedTab={setMissedTab}
            allLeadFilters={allLeadFilters}
            setAllLeadFilters={setAllLeadFilters}
          />
        )}
      </main>
    </div>
  );
}

function GlobalSearch({ openLead }) {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const query = term.trim();
    if (query.length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ search: query });
        const data = await request(`/leads?${params}`);
        if (!cancelled) {
          setResults(data.slice(0, 8));
          setOpen(true);
        }
      } catch {
        if (!cancelled) {
          setResults([]);
          setOpen(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [term]);

  function choose(lead) {
    openLead(lead.id);
    setTerm("");
    setResults([]);
    setOpen(false);
  }

  return (
    <div className="global-search">
      <label className="global-search-box">
        <Search size={17} />
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onFocus={() => term.trim().length >= 2 && setOpen(true)}
          placeholder="Search name, phone, email, lead ID, or comments"
        />
      </label>
      {open && (
        <div className="global-search-results">
          {loading ? (
            <p className="muted">Searching...</p>
          ) : results.length ? results.map((lead) => (
            <button key={lead.id} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => choose(lead)}>
              <span>
                <strong>{lead.name}</strong>
                <small>{lead.phone} {lead.email ? `- ${lead.email}` : ""}</small>
                {lead.matched_comment && <small className="search-match">Comment: {lead.matched_comment}</small>}
              </span>
              <StatusBadge status={lead.status} />
            </button>
          )) : (
            <p className="muted">No matching leads found.</p>
          )}
        </div>
      )}
    </div>
  );
}

function Login({ onLogin }) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setError("");
    try {
      const result = await request("/auth/login", { method: "POST", body: { identifier, password } });
      onLogin(result.user);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="login-shell">
      <form className="login-card" onSubmit={submit}>
        <div className="brand login-brand">
          <span className="brand-mark">NM</span>
          <div>
            <strong>Nandd Mahal Leads</strong>
            <small>Private sales CRM</small>
          </div>
        </div>
        <label>Username or email</label>
        <input type="email" autoComplete="username" value={identifier} onChange={(e) => setIdentifier(e.target.value)} required />
        <label>Password</label>
        <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <p className="error">{error}</p>}
        <button className="primary" type="submit">Login</button>
      </form>
    </div>
  );
}

function Page({ page, user, users, onUsersChanged, openLead, setPage, missedTab, setMissedTab, allLeadFilters, setAllLeadFilters }) {
  if (page === "dashboard") return <Dashboard setPage={setPage} setMissedTab={setMissedTab} />;
  if (page === "missed") return <Missed user={user} openLead={openLead} tab={missedTab} setTab={setMissedTab} />;
  if (page === "all") return <AllLeads user={user} users={users} openLead={openLead} filters={allLeadFilters} setFilters={setAllLeadFilters} />;
  if (page === "users") return user.role === "admin"
    ? <UserManagement users={users} onUsersChanged={onUsersChanged} />
    : <Dashboard setPage={setPage} setMissedTab={setMissedTab} />;

  const configs = {
    new: { title: "New Leads", list: "new", quick: ["assignToMe", "callUpdate"] },
    followups: { title: "Follow-ups", list: "followups", dateFilters: true, quick: ["callUpdate", "comment"] },
    sitevisits: { title: "Site Visits", list: "sitevisits", dateFilters: true, quick: ["siteVisited", "callUpdate", "comment"] },
    super: { title: "Super Interested", list: "super", quick: ["callUpdate", "Closed", "comment"] },
    rejected: {
      title: "Rejected Leads",
      subtitle: "Review rejected leads, reasons, and historical notes.",
      list: "rejected",
      quick: ["comment"],
      extraColumns: ["rejectionReason"]
    }
  };
  return <LeadList config={configs[page]} user={user} users={users} openLead={openLead} />;
}

function Dashboard({ setPage, setMissedTab }) {
  const [data, setData] = useState(null);
  const cards = [
    ["New Leads", "newLeads", "new", <PhoneCall />],
    ["Missed Leads", "missedLeads", "missed:missed-leads", <Siren />],
    ["Today's Follow-ups", "todaysFollowups", "followups", <CalendarClock />],
    ["Missed Follow-ups", "missedFollowups", "missed:missed-followups", <Siren />],
    ["Today's Site Visits", "todaysSiteVisits", "sitevisits", <UserCheck />],
    ["Missed Site Visits", "missedSiteVisits", "missed:missed-sitevisits", <Siren />],
    ["Super Interested", "superInterested", "super", <Star />]
  ];

  useEffect(() => {
    request("/dashboard").then(setData).catch(console.error);
  }, []);

  return (
    <section>
      <Header title="Dashboard" subtitle="Today, missed work, and hot leads at a glance." />
      <div className="dashboard-grid">
        {cards.map(([label, key, target, icon]) => (
          <button key={key} className="metric-card" onClick={() => {
            const [nextPage, nextTab] = target.split(":");
            if (nextTab) setMissedTab(nextTab);
            setPage(nextPage);
          }}>
            {icon}
            <span>{label}</span>
            <strong>{data ? data[key] : "-"}</strong>
          </button>
        ))}
      </div>
      <SyncPanel />
    </section>
  );
}

function SyncPanel() {
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState("");

  async function sync() {
    setSyncing(true);
    setMessage("");
    try {
      const result = await request("/sync", { method: "POST", body: {} });
      setMessage(result.message);
    } catch (err) {
      setMessage(err.message);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="sync-strip">
      <div>
        <strong>Google Sheet Sync</strong>
        <small>{message || "Manual import is ready. Add Google credentials when you want live sheet sync."}</small>
      </div>
      <button className="secondary" onClick={sync} disabled={syncing}>
        <RefreshCw size={16} /> {syncing ? "Syncing" : "Sync Leads"}
      </button>
    </div>
  );
}

function UserManagement({ users, onUsersChanged }) {
  const [members, setMembers] = useState(users);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "sales" });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    const result = await request("/users");
    setMembers(result);
    onUsersChanged(result);
  }

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, []);

  async function create(e) {
    e.preventDefault();
    setSaving(true);
    setMessage("");
    setError("");
    try {
      await request("/users", { method: "POST", body: form });
      setForm({ name: "", email: "", password: "", role: "sales" });
      setMessage("User created.");
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function update(id, body) {
    setMessage("");
    setError("");
    try {
      await request(`/users/${id}`, { method: "PATCH", body });
      setMessage("User updated.");
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  function resetPassword(member) {
    const password = window.prompt(`Set a new password for ${member.name} (minimum 8 characters):`);
    if (password === null) return;
    update(member.id, { password });
  }

  return (
    <section className="user-management">
      <Header title="Users" subtitle="Create team accounts and control which users can access assigned leads." />
      <form className="user-create-form" onSubmit={create}>
        <label>Name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
        <label>Username or email<input type="email" autoComplete="off" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></label>
        <label>Temporary password<input type="password" autoComplete="new-password" minLength="8" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required /></label>
        <label>Role<select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}><option value="sales">Sales</option><option value="admin">Admin</option></select></label>
        <button className="primary" type="submit" disabled={saving}>{saving ? "Creating" : "Create User"}</button>
      </form>
      {message && <p className="success-text">{message}</p>}
      {error && <p className="error">{error}</p>}
      <div className="user-table-wrap">
        <table className="user-table">
          <thead><tr><th>Name</th><th>Username / email</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {members.map((member) => (
              <tr key={member.id}>
                <td>{member.name}</td>
                <td>{member.email}</td>
                <td>{member.role}</td>
                <td><span className={`badge ${member.active ? "connected" : "attempted"}`}>{member.active ? "Active" : "Inactive"}</span></td>
                <td className="user-actions">
                  <button className="secondary" type="button" onClick={() => resetPassword(member)}>Reset password</button>
                  <button className={member.active ? "danger" : "secondary"} type="button" onClick={() => update(member.id, { active: !member.active })}>{member.active ? "Deactivate" : "Activate"}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Missed({ user, openLead, tab, setTab }) {
  const config = {
    title: "Missed",
    list: tab,
    quick: tab === "missed-leads" ? ["assignToMe", "callUpdate"] : ["callUpdate", "comment"]
  };

  return (
    <section>
      <Header title="Missed" subtitle="Calculated dynamically from dates and activity." />
      <div className="tabs">
        <button className={tab === "missed-leads" ? "active" : ""} onClick={() => setTab("missed-leads")}>Missed Leads</button>
        <button className={tab === "missed-followups" ? "active" : ""} onClick={() => setTab("missed-followups")}>Missed Follow-ups</button>
        <button className={tab === "missed-sitevisits" ? "active" : ""} onClick={() => setTab("missed-sitevisits")}>Missed Site Visits</button>
      </div>
      <LeadList config={config} user={user} openLead={openLead} embedded />
    </section>
  );
}

function AllLeads({ user, users, openLead, filters, setFilters }) {
  const params = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
  const config = { title: "All Leads", list: "", endpoint: `/leads?${params}`, quick: ["callUpdate", "comment"] };

  return (
    <section>
      <Header title="All Leads" subtitle="Search by lead details or comments, then narrow by status, user, or date." />
      {user.role === "admin" && <div className="tabs">
        <button className={!filters.assignedTo ? "active" : ""} onClick={() => setFilters({ ...filters, assignedTo: "" })}>All Leads</button>
        <button className={String(filters.assignedTo) === String(user.id) ? "active" : ""} onClick={() => setFilters({ ...filters, assignedTo: String(user.id) })}>My Leads</button>
      </div>}
      <div className="filters">
        <label className="search-box"><Search size={16} /><input placeholder="Search name, phone, or comments" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} /></label>
        <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
          <option value="">All statuses</option>
          {statusOptions.map((s) => <option key={s}>{s}</option>)}
        </select>
        {user.role === "admin" && <select value={filters.assignedTo} onChange={(e) => setFilters({ ...filters, assignedTo: e.target.value })}>
          <option value="">All users</option>
          {users.filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>}
        <select value={filters.dateField} onChange={(e) => setFilters({ ...filters, dateField: e.target.value })}>
          <option value="created">Created Date</option>
          <option value="followup">Follow-up Date</option>
          <option value="sitevisit">Site Visit Date</option>
        </select>
        <select value={filters.preset} onChange={(e) => setFilters({ ...filters, preset: e.target.value })}>
          <option value="">Any date</option>
          <option value="today">Today</option>
          <option value="yesterday">Yesterday</option>
          <option value="last7">Last 7 Days</option>
          <option value="month">This Month</option>
        </select>
      </div>
      <LeadList config={config} user={user} openLead={openLead} embedded />
    </section>
  );
}

const LEAD_COLUMNS = [
  { key: "name", label: "Name", width: "180px", className: "lead-col-name" },
  { key: "phone", label: "Phone", width: "128px", className: "lead-col-phone" },
  { key: "status", label: "Status", width: "128px", className: "lead-col-status" },
  { key: "lookingFor", label: "Looking For", width: "150px", className: "lead-col-requirement" },
  { key: "buyPlan", label: "Buy Plan", width: "132px", className: "lead-col-plan" },
  { key: "assigned", label: "Assigned", width: "132px", className: "lead-col-assigned" },
  { key: "lastComment", label: "Last Comment", width: "260px", className: "comment-cell" },
  { key: "actions", label: "Actions", width: "230px", className: "lead-col-actions" }
];

const EXTRA_LEAD_COLUMNS = {
  rejectionReason: { key: "rejectionReason", label: "Rejection Reason", width: "180px", className: "lead-col-rejection" }
};

function LeadList({ config, user, openLead, embedded = false }) {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dateFilter, setDateFilter] = useState("today");
  const [dialog, setDialog] = useState(null);

  const endpoint = useMemo(() => {
    if (config.endpoint) return config.endpoint;
    const params = new URLSearchParams();
    if (config.list) params.set("list", config.list);
    if (config.dateFilters) params.set("dateFilter", dateFilter);
    return `/leads?${params}`;
  }, [config, dateFilter]);

  async function load() {
    setLoading(true);
    try {
      setLeads(await request(endpoint));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [endpoint]);

  async function quick(lead, action) {
    if (action === "assignToMe") return mutate(lead.id, { action: "assignToMe" });
    if (action === "siteVisited") return mutate(lead.id, { action: "siteVisited" });
    if (["Follow Up", "Site Visit", "Rejected", "comment", "callUpdate"].includes(action)) return setDialog({ lead, action });
    return mutate(lead.id, { action: "status", status: action });
  }

  async function mutate(id, body) {
    await request(`/leads/${id}`, { method: "POST", body });
    await load();
  }

  const columns = useMemo(() => {
    const extras = (config.extraColumns || []).map((key) => EXTRA_LEAD_COLUMNS[key]).filter(Boolean);
    const actionColumn = LEAD_COLUMNS.find((column) => column.key === "actions");
    return [
      ...LEAD_COLUMNS.filter((column) => column.key !== "actions"),
      ...extras,
      actionColumn
    ];
  }, [config.extraColumns]);

  return (
    <section>
      {!embedded && <Header title={config.title} subtitle={config.subtitle || "Open a lead for the full timeline and details."} />}
      {config.dateFilters && (
        <div className="tabs">
          {["today", "tomorrow", "upcoming", "missed", "all"].map((f) => (
            <button key={f} className={dateFilter === f ? "active" : ""} onClick={() => setDateFilter(f)}>{title(f)}</button>
          ))}
        </div>
      )}
      <div className="lead-table-wrap">
        <table className="lead-table">
          <colgroup>
            {columns.map((column) => (
              <col key={column.key} style={{ width: column.width }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key} className={column.className || ""}>{column.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={columns.length} className="empty">Loading leads...</td></tr>
            ) : leads.map((lead) => (
              <tr key={lead.id}>
                <td className="lead-col-name"><button className="row-link" onClick={() => openLead(lead.id)}>{lead.name}</button><small>{formatDate(lead.meta_created_at)}</small></td>
                <td className="lead-col-phone"><a href={`tel:${lead.phone}`}>{lead.phone}</a></td>
                <td className="lead-col-status"><StatusBadge status={lead.status} /></td>
                <td className="lead-col-requirement">{lead.looking_for || "-"}</td>
                <td className="lead-col-plan">{lead.buy_plan || "-"}</td>
                <td className="lead-col-assigned">{lead.assigned_name || "Unassigned"}</td>
                <td className="comment-cell"><span className="comment-text">{lead.last_comment || "-"}</span></td>
                {config.extraColumns?.includes("rejectionReason") && (
                  <td className="lead-col-rejection">{lead.rejection_reason || "-"}</td>
                )}
                <td className="lead-col-actions">
                  <div className="row-actions">
                    {(config.quick || []).map((action) => (
                      <button key={action} className={buttonClass(action)} onClick={() => quick(lead, action)}>
                        {label(action)}
                      </button>
                    ))}
                    <button className="secondary" onClick={() => openLead(lead.id)}>Open</button>
                  </div>
                </td>
              </tr>
            ))}
            {!loading && leads.length === 0 && <tr><td colSpan={columns.length} className="empty">No leads found.</td></tr>}
          </tbody>
        </table>
      </div>
      {dialog && <ActionDialog dialog={dialog} onClose={() => setDialog(null)} onSubmit={(body) => mutate(dialog.lead.id, body).then(() => setDialog(null))} />}
    </section>
  );
}

function LeadDetail({ id, user, users, onBack }) {
  const [data, setData] = useState(null);
  const [whatsappStatus, setWhatsappStatus] = useState(null);
  const [whatsappMessages, setWhatsappMessages] = useState([]);
  const [whatsappReplyWindow, setWhatsappReplyWindow] = useState(null);
  const [dialog, setDialog] = useState(null);

  async function load() {
    const [leadData, status, messages] = await Promise.all([
      request(`/leads/${id}`),
      request("/whatsapp/status").catch(() => null),
      request(`/leads/${id}/whatsapp/messages`).catch(() => ({ messages: [], replyWindow: null }))
    ]);
    setData(leadData);
    setWhatsappStatus(status);
    setWhatsappMessages(messages.messages || []);
    setWhatsappReplyWindow(messages.replyWindow || null);
  }

  useEffect(() => {
    load();
  }, [id]);

  async function mutate(body) {
    await request(`/leads/${id}`, { method: "POST", body });
    setDialog(null);
    await load();
  }

  async function assignLead(e) {
    await mutate({ action: "assign", assignedTo: e.target.value || null });
  }

  if (!data) return <p className="muted">Loading lead...</p>;
  const { lead, activities } = data;

  return (
    <section>
      <button className="text-button" onClick={onBack}>Back to list</button>
      <div className="detail-header">
        <div>
          <h1>{lead.name}</h1>
          <p>{lead.phone} {lead.email ? `- ${lead.email}` : ""}</p>
        </div>
        <StatusBadge status={lead.status} />
      </div>
      <div className="detail-grid">
        <Info label="Meta Lead ID" value={lead.meta_lead_id} />
        <Info label="Meta Created" value={formatDateTime(lead.meta_created_at)} />
        <Info label="Campaign" value={lead.campaign || "-"} />
        <Info label="Looking For" value={lead.looking_for || "-"} />
        <Info label="Buy Plan" value={lead.buy_plan || "-"} />
        <Info label="Assigned" value={lead.assigned_name || "Unassigned"} />
        <Info label="Follow-up" value={lead.followup_date || "-"} />
        <Info label="Site Visit" value={lead.site_visit_date || "-"} />
      </div>
      {user.role === "admin" && <label className="detail-assignment">Assigned to
        <select value={lead.assigned_to || ""} onChange={assignLead}>
          <option value="">Unassigned</option>
          {users.filter((member) => member.active).map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
        </select>
      </label>}
      <div className="actions detail-actions">
        {["callUpdate", "comment", "Closed"].map((action) => (
          <button key={action} className={buttonClass(action)} onClick={() => {
            if (["comment", "callUpdate"].includes(action)) setDialog({ lead, action });
            else mutate({ action: "status", status: action });
          }}>{label(action)}</button>
        ))}
      </div>
      <WhatsAppPanel lead={lead} user={user} status={whatsappStatus} messages={whatsappMessages} replyWindow={whatsappReplyWindow} onChanged={load} />
      <h2>Activity Timeline</h2>
      <div className="timeline">
        {activities.map((a) => (
          <div className="timeline-item" key={a.id}>
            <strong>{formatDateTime(a.created_at)} - {a.user_name || "System"}</strong>
            <p>{activityText(a)}</p>
            {a.comment && <blockquote>{a.comment}</blockquote>}
          </div>
        ))}
      </div>
      {dialog && <ActionDialog dialog={dialog} onClose={() => setDialog(null)} onSubmit={mutate} />}
    </section>
  );
}

function WhatsAppPanel({ lead, user, status, messages, replyWindow, onChanged }) {
  const [localMessages, setLocalMessages] = useState(messages);
  const [localReplyWindow, setLocalReplyWindow] = useState(replyWindow);
  const [templates, setTemplates] = useState([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [bodyParameters, setBodyParameters] = useState([]);
  const [headerImageUrl, setHeaderImageUrl] = useState("");
  const [mediaAssets, setMediaAssets] = useState([]);
  const [selectedMediaId, setSelectedMediaId] = useState("");
  const [mediaLoading, setMediaLoading] = useState(false);
  const [mediaUploading, setMediaUploading] = useState(false);
  const [mediaError, setMediaError] = useState("");
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [replying, setReplying] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const [lastRefreshedAt, setLastRefreshedAt] = useState("");
  const [message, setMessage] = useState("");
  const selectedTemplate = templates.find((template) => template.id === selectedTemplateId);
  const canReply = Boolean(status?.sendConfigured && localReplyWindow?.open);
  const unsupportedHeader = selectedTemplate?.headerVariableCount > 0 && selectedTemplate?.headerType === "TEXT";
  const headerImageMissing = selectedTemplate?.requiresHeaderImage && !headerImageUrl.trim();
  const missingBodyParameters = bodyParameters.some((value) => !value.trim());
  const canSendTemplate = Boolean(status?.sendConfigured && selectedTemplate && !unsupportedHeader && !headerImageMissing && !missingBodyParameters);

  useEffect(() => {
    setLocalMessages(messages);
  }, [messages]);

  useEffect(() => {
    setLocalReplyWindow(replyWindow);
  }, [replyWindow]);

  useEffect(() => {
    loadTemplates();
    loadMedia();
  }, []);

  useEffect(() => {
    if (!selectedTemplate) {
      setBodyParameters([]);
      setHeaderImageUrl("");
      return;
    }
    setBodyParameters(Array.from({ length: selectedTemplate.bodyVariableCount || 0 }, () => ""));
    setHeaderImageUrl("");
    setSelectedMediaId("");
  }, [selectedTemplateId]);

  useEffect(() => {
    const asset = mediaAssets.find((item) => String(item.id) === String(selectedMediaId));
    if (asset) setHeaderImageUrl(asset.secure_url || asset.secureUrl || asset.url);
  }, [selectedMediaId, mediaAssets]);

  async function loadTemplates(force = false) {
    setTemplatesLoading(true);
    setTemplatesError("");
    try {
      const result = await request(force ? "/whatsapp/templates/refresh" : "/whatsapp/templates", { method: force ? "POST" : "GET" });
      const nextTemplates = result.templates || [];
      setTemplates(nextTemplates);
      if ((!selectedTemplateId || !nextTemplates.some((template) => template.id === selectedTemplateId)) && nextTemplates[0]) {
        setSelectedTemplateId(nextTemplates[0].id);
      }
    } catch (err) {
      setTemplatesError(err.message);
    } finally {
      setTemplatesLoading(false);
    }
  }

  async function refreshMessages() {
    setRefreshing(true);
    setRefreshError("");
    try {
      const result = await request(`/leads/${lead.id}/whatsapp/messages`);
      setLocalMessages(result.messages || []);
      setLocalReplyWindow(result.replyWindow || null);
      setLastRefreshedAt(new Date().toISOString());
    } catch (err) {
      setRefreshError(err.message);
    } finally {
      setRefreshing(false);
    }
  }

  async function loadMedia() {
    setMediaLoading(true);
    setMediaError("");
    try {
      setMediaAssets(await request("/whatsapp/media"));
    } catch (err) {
      setMediaError(err.message);
    } finally {
      setMediaLoading(false);
    }
  }

  async function uploadMedia(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setMediaUploading(true);
    setMediaError("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const asset = await uploadRequest("/whatsapp/media", formData);
      await loadMedia();
      setSelectedMediaId(String(asset.id));
      setHeaderImageUrl(asset.secure_url || asset.secureUrl || asset.url);
    } catch (err) {
      setMediaError(err.message);
    } finally {
      setMediaUploading(false);
    }
  }

  async function send(e) {
    e.preventDefault();
    setSending(true);
    setMessage("");
    try {
      const result = await request(`/leads/${lead.id}/whatsapp/send`, {
        method: "POST",
        body: {
          templateName: selectedTemplate.name,
          language: selectedTemplate.language,
          parameters: bodyParameters.map((item) => item.trim()),
          headerImageUrl
        }
      });
      setMessage(`WhatsApp template sent${result.providerMessageId ? ` (${result.providerMessageId})` : ""}.`);
      setBodyParameters(Array.from({ length: selectedTemplate.bodyVariableCount || 0 }, () => ""));
      setHeaderImageUrl("");
      await refreshMessages();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setSending(false);
    }
  }

  async function sendReply(e) {
    e.preventDefault();
    setReplying(true);
    setMessage("");
    try {
      const result = await request(`/leads/${lead.id}/whatsapp/messages`, {
        method: "POST",
        body: { text: replyText }
      });
      setMessage(`WhatsApp reply sent${result.providerMessageId ? ` (${result.providerMessageId})` : ""}.`);
      setReplyText("");
      await refreshMessages();
    } catch (err) {
      setMessage(err.message);
      await refreshMessages();
    } finally {
      setReplying(false);
    }
  }

  return (
    <section className="whatsapp-panel">
      <div className="panel-heading">
        <div>
          <h2><MessageSquareText size={20} /> WhatsApp</h2>
          <p className="muted">Callback URL path: <code>{status?.callbackUrlPath || "/api/webhooks/whatsapp/meta"}</code></p>
        </div>
        <span className={`badge ${status?.sendConfigured ? "connected" : "attempted"}`}>
          {status?.sendConfigured ? "Send Ready" : "Setup Needed"}
        </span>
      </div>
      <form className="whatsapp-send" onSubmit={send}>
        <label>
          Template
          <select value={selectedTemplateId} onChange={(e) => setSelectedTemplateId(e.target.value)} disabled={templatesLoading || templates.length === 0} required>
            {templatesLoading && <option>Loading templates...</option>}
            {!templatesLoading && templates.length === 0 && <option>No approved templates</option>}
            {!templatesLoading && templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name} - {template.language}{template.category ? ` - ${template.category}` : ""}
              </option>
            ))}
          </select>
        </label>
        <div className="template-summary">
          <small className="muted">Language</small>
          <strong>{selectedTemplate?.language || "-"}</strong>
        </div>
        {bodyParameters.map((value, index) => (
          <label key={index}>
            Variable {index + 1}
            <input value={value} onChange={(e) => setBodyParameters((current) => current.map((item, itemIndex) => itemIndex === index ? e.target.value : item))} required />
          </label>
        ))}
        {selectedTemplate?.requiresHeaderImage && (
          <label className="template-media-field">
            Header Image URL
            <input value={headerImageUrl} onChange={(e) => setHeaderImageUrl(e.target.value)} placeholder="https://example.com/image.jpg" required />
          </label>
        )}
        <button className="primary" type="submit" disabled={sending || !canSendTemplate}>
          <MessageSquareText size={16} /> {sending ? "Sending" : "Send Template"}
        </button>
      </form>
      <div className="template-tools">
        <button className="secondary" type="button" onClick={() => loadTemplates(true)} disabled={templatesLoading}>
          <RefreshCw size={16} /> {templatesLoading ? "Refreshing Templates" : "Refresh Templates"}
        </button>
        {templatesError && <small className="error">{templatesError}</small>}
        {selectedTemplate?.bodyText && <small className="muted template-preview">{selectedTemplate.bodyText}</small>}
        {unsupportedHeader && <small className="error">Text header variables are not supported yet. Use an image-header or body-only template.</small>}
      </div>
      {status?.mediaLibrary?.configured && (
        <div className="media-library">
          <div className="media-library-head">
            <div>
              <strong>Header Image Library</strong>
              <small className="muted">
                {selectedTemplate?.requiresHeaderImage
                  ? "Select or upload a public header image for this template."
                  : "Saved images are available when an image-header template is selected."}
              </small>
            </div>
            <div className="media-actions">
              <button className="secondary" type="button" onClick={loadMedia} disabled={mediaLoading}>
                <RefreshCw size={16} /> {mediaLoading ? "Refreshing" : "Refresh Images"}
              </button>
              <label className="secondary file-button">
                {mediaUploading ? "Uploading" : "Upload Image"}
                <input type="file" accept="image/*" onChange={uploadMedia} disabled={mediaUploading} />
              </label>
            </div>
          </div>
          <label>
            Saved Images
            <select value={selectedMediaId} onChange={(e) => setSelectedMediaId(e.target.value)} disabled={mediaLoading || mediaAssets.length === 0}>
              <option value="">{mediaAssets.length ? "Select saved image" : "No uploaded images"}</option>
              {mediaAssets.map((asset) => (
                <option key={asset.id} value={asset.id}>{asset.name}</option>
              ))}
            </select>
          </label>
          {headerImageUrl && <img className="media-preview" src={headerImageUrl} alt="Selected WhatsApp header" />}
          {mediaError && <small className="error">{mediaError}</small>}
        </div>
      )}
      {selectedTemplate?.requiresHeaderImage && !status?.mediaLibrary?.configured && (
        <small className="error">Cloudinary image upload is not configured on this service.</small>
      )}
      {message && <p className={message.toLowerCase().includes("sent") ? "success-text" : "error"}>{message}</p>}
      <div className="whatsapp-history">
        <div className="whatsapp-history-head">
          <div>
            <strong>Recent WhatsApp Activity</strong>
            {lastRefreshedAt && <small className="muted">Updated {formatDateTime(lastRefreshedAt)}</small>}
          </div>
          <button className="secondary" type="button" onClick={refreshMessages} disabled={refreshing} aria-label="Refresh WhatsApp messages">
            <RefreshCw size={16} /> {refreshing ? "Refreshing" : "Refresh"}
          </button>
        </div>
        {refreshError && <small className="error">{refreshError}</small>}
        {localMessages.length === 0 ? (
          <p className="muted">No WhatsApp messages recorded for this lead yet.</p>
        ) : localMessages.map((item) => <WhatsAppMessage key={item.id} item={item} />)}
      </div>
      <form className="whatsapp-reply" onSubmit={sendReply}>
        <label>
          Direct Reply
          <textarea
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder="Type a WhatsApp reply"
            disabled={!canReply || replying}
            maxLength={4096}
          />
        </label>
        <div className="reply-footer">
          <small className="muted">{replyWindowText(localReplyWindow)}</small>
          <button className="secondary" type="submit" disabled={!canReply || replying || !replyText.trim()}>
            {replying ? "Sending Reply" : "Send Reply"}
          </button>
        </div>
      </form>
    </section>
  );
}

function WhatsAppMessage({ item }) {
  const failure = failureDetails(item);
  return (
    <div className={`whatsapp-message ${item.status === "failed" ? "failed-message" : ""}`}>
      <span className="badge">{item.status}</span>
      <div>
        <strong>{item.direction} {item.message_type}</strong>
        <p>{item.body || item.template_name || item.error_message || "-"}</p>
        <small className="muted">{formatDateTime(item.created_at)}</small>
        {item.status === "failed" && (
          <div className="failure-log">
            <strong>Failed: {failure.reason}</strong>
            <small>Code: {failure.code}</small>
            <small>Failed at: {formatDateTime(item.failed_at || item.created_at)}</small>
            {failure.details && (
              <details>
                <summary>Details</summary>
                <p>{failure.details}</p>
              </details>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ActionDialog({ dialog, onClose, onSubmit }) {
  const { action } = dialog;
  const [comment, setComment] = useState("");
  const [outcome, setOutcome] = useState("Follow Up");
  const [followupDate, setFollowupDate] = useState(today());
  const [followupTime, setFollowupTime] = useState("");
  const [siteVisitDate, setSiteVisitDate] = useState(today());
  const [siteVisitTime, setSiteVisitTime] = useState("");
  const [rejectionReason, setRejectionReason] = useState("Not Interested");

  function submit(e) {
    e.preventDefault();
    if (action === "callUpdate") {
      return onSubmit({
        action: "status",
        status: outcome,
        followupDate: outcome === "Follow Up" ? followupDate : null,
        followupTime: outcome === "Follow Up" ? followupTime : null,
        siteVisitDate: outcome === "Site Visit" ? siteVisitDate : null,
        siteVisitTime: outcome === "Site Visit" ? siteVisitTime : null,
        rejectionReason: outcome === "Rejected" ? rejectionReason : null,
        comment
      });
    }
    if (action === "comment") return onSubmit({ action: "comment", comment });
    if (action === "Follow Up") return onSubmit({ action: "status", status: "Follow Up", followupDate, followupTime, comment });
    if (action === "Site Visit") return onSubmit({ action: "status", status: "Site Visit", siteVisitDate, siteVisitTime, comment });
    if (action === "Rejected") return onSubmit({ action: "status", status: "Rejected", rejectionReason, comment });
  }

  return (
    <div className="modal-backdrop">
      <form className="modal" onSubmit={submit}>
        <h2>{label(action)}</h2>
        {action === "callUpdate" && <>
          <label>Call Outcome</label>
          <select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            {callOutcomes.map((item) => <option key={item}>{item}</option>)}
          </select>
        </>}
        {(action === "Follow Up" || (action === "callUpdate" && outcome === "Follow Up")) && <>
          <label>Follow-up Date</label><input type="date" required value={followupDate} onChange={(e) => setFollowupDate(e.target.value)} />
          <label>Follow-up Time</label><input type="time" value={followupTime} onChange={(e) => setFollowupTime(e.target.value)} />
        </>}
        {(action === "Site Visit" || (action === "callUpdate" && outcome === "Site Visit")) && <>
          <label>Site Visit Date</label><input type="date" required value={siteVisitDate} onChange={(e) => setSiteVisitDate(e.target.value)} />
          <label>Site Visit Time</label><input type="time" value={siteVisitTime} onChange={(e) => setSiteVisitTime(e.target.value)} />
        </>}
        {(action === "Rejected" || (action === "callUpdate" && outcome === "Rejected")) && <>
          <label>Reason</label><select value={rejectionReason} onChange={(e) => setRejectionReason(e.target.value)}>{rejectionReasons.map((r) => <option key={r}>{r}</option>)}</select>
        </>}
        <label>Comment</label>
        <textarea required={action === "callUpdate"} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add short note" />
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose}>Cancel</button>
          <button className={action === "Rejected" || outcome === "Rejected" ? "danger" : "primary"} type="submit">Save</button>
        </div>
      </form>
    </div>
  );
}

function Header({ title, subtitle }) {
  return <header className="page-header"><div><h1>{title}</h1><p>{subtitle}</p></div></header>;
}

function NavButton({ icon, label, id, page, setPage }) {
  return <button className={page === id ? "active" : ""} onClick={() => setPage(id)}>{icon}<span>{label}</span></button>;
}

function StatusBadge({ status }) {
  return <span className={`badge ${status.toLowerCase().replaceAll(" ", "-")}`}>{status}</span>;
}

function Info({ label, value }) {
  return <div className="info"><small>{label}</small><strong>{value}</strong></div>;
}

function label(action) {
  return {
    assignToMe: "Assign to Me",
    callUpdate: "Call / Update",
    comment: "Add Comment",
    siteVisited: "Mark Visited"
  }[action] || action;
}

function buttonClass(action) {
  if (action === "Rejected") return "danger";
  if (["Super Interested", "Closed", "siteVisited"].includes(action)) return "success";
  return "secondary";
}

function replyWindowText(replyWindow) {
  if (replyWindow?.open && replyWindow.expiresAt) {
    return `Free-text replies available until ${formatDateTime(replyWindow.expiresAt)}.`;
  }
  if (replyWindow?.lastInboundAt) {
    return "The 24-hour reply window has expired. Send an approved template instead.";
  }
  return "Free-text replies unlock after the customer replies on WhatsApp.";
}

function failureDetails(item) {
  const raw = parseRawPayload(item.raw_payload);
  const error = raw?.status?.errors?.[0] || raw?.error || raw?.entry?.[0]?.changes?.[0]?.value?.statuses?.[0]?.errors?.[0];
  return {
    reason: item.error_message || error?.title || error?.message || "No failure reason provided",
    code: item.error_code || error?.code || error?.error_subcode || "-",
    details: error?.error_data?.details || error?.message || ""
  };
}

function parseRawPayload(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function activityText(a) {
  if (a.old_value && a.new_value) return `${a.activity_type}: ${a.old_value} to ${a.new_value}`;
  if (a.new_value) return `${a.activity_type}: ${a.new_value}`;
  return a.activity_type;
}

function title(value) {
  return value.split("-").map((part) => part[0].toUpperCase() + part.slice(1)).join(" ");
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function formatDateTime(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

async function request(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    method: options.method || "GET",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

async function uploadRequest(path, formData) {
  const response = await fetch(`${API}${path}`, {
    method: "POST",
    credentials: "same-origin",
    body: formData
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Upload failed");
  return data;
}

createRoot(document.getElementById("root")).render(<App />);
