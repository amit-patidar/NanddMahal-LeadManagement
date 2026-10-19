import React, { useRef, useState } from "react";
import { ChevronDown, ChevronRight, Eye, RefreshCw, RotateCcw, Save, X } from "lucide-react";

function sameMapping(a, b) {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && a[key] === b[key]);
}

export default function SyncPanel({ request }) {
  const [expanded, setExpanded] = useState(false);
  const [saved, setSaved] = useState(null);
  const [draft, setDraft] = useState({});
  const [preview, setPreview] = useState(null);
  const [action, setAction] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [syncMessage, setSyncMessage] = useState("");
  const [syncIssues, setSyncIssues] = useState([]);
  const [sources, setSources] = useState([]);
  const [sourceId, setSourceId] = useState("");
  const [sourceDraft, setSourceDraft] = useState({ label: "", spreadsheet: "", title: "" });
  const [sourceResults, setSourceResults] = useState([]);
  const lock = useRef(false);
  const dirty = saved !== null && !sameMapping(draft, saved.mapping || {});
  const busy = Boolean(action);
  const result = preview || (!dirty ? saved : null);

  async function run(kind, selectedId = sourceId) {
    if (lock.current || (kind === "sync" && dirty) || (kind === "load" && dirty)) return;
    lock.current = true;
    setAction(kind);
    setError("");
    setNotice("");
    try {
      if (kind === "sync") {
        setSyncMessage("");
        setSyncIssues([]);
        setSourceResults([]);
        const response = await request("/sync", { method: "POST", body: {} });
        setSyncMessage(response.message);
        setSyncIssues([...(response.errors || []), ...(response.warnings || [])]);
        setSourceResults(response.sources || []);
        return;
      }
      if (kind === "sources" || kind === "add" || kind === "enable") {
        let nextId = selectedId;
        if (kind === "add") {
          const added = await request("/sync/sources", { method: "POST", body: sourceDraft });
          setSourceDraft({ label: "", spreadsheet: "", title: "" });
          setSourceId(added.source.id);
          nextId = added.source.id;
          setSaved(null);
          setDraft({});
          setPreview(null);
          setNotice("Source connected. Review its column mapping before syncing.");
        }
        if (kind === "enable") {
          const source = sources.find((item) => item.id === selectedId);
          await request(`/sync/sources/${encodeURIComponent(source.id)}`, { method: "PATCH", body: { enabled: !source.enabled } });
        }
        const response = await request("/sync/sources");
        setSources(response.sources);
        if (kind !== "enable" && response.sources.length) {
          nextId = nextId || response.sources[0].id;
          setSourceId(nextId);
          const loaded = await request(`/sync/mapping?sourceId=${encodeURIComponent(nextId)}`);
          setSaved(loaded);
          setDraft(loaded.mapping || {});
          setPreview(null);
        }
        return;
      }
      const suffix = selectedId ? `?sourceId=${encodeURIComponent(selectedId)}` : "";
      const response = kind === "load"
        ? await request(`/sync/mapping${suffix}`)
        : await request(`${kind === "preview" ? "/sync/mapping/preview" : "/sync/mapping"}${suffix}`, {
          method: kind === "preview" ? "POST" : "PUT",
          body: { source: saved.source, revision: saved.revision, mapping: draft }
        });
      if (kind === "load" || (kind === "save" && !response.errors?.length)) {
        setSaved(response);
        setDraft(response.mapping || {});
        setPreview(null);
        if (kind === "save") setNotice("Mapping saved.");
      } else {
        setPreview(response);
        if (kind === "preview" && !response.errors?.length) setNotice("Preview validated.");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      lock.current = false;
      setAction("");
    }
  }

  function changeDraft(next) {
    setDraft(next);
    setPreview(null);
    setError("");
    setNotice("");
  }

  function toggle() {
    setExpanded(!expanded);
    if (!expanded && !dirty) void run("sources");
  }

  const headers = [...new Set(saved?.headers || [])].filter((header) => header.trim());

  return (
    <div className="sync-settings">
      <div className="sync-strip">
        <div>
          <strong>Google Sheets Sync</strong>
          <small role="status">{dirty ? "Unsaved mapping changes" : syncMessage}</small>
        </div>
        <button type="button" className="secondary" onClick={() => run("sync")} disabled={busy || dirty}>
          <RefreshCw size={16} /> {action === "sync" ? "Syncing" : "Sync Leads"}
        </button>
      </div>
      {sourceResults.length > 0 && <ul className="sync-source-results" aria-label="Results by sheet">
        {sourceResults.map((source) => <li key={source.id}>
          <strong>{source.label}</strong>: {source.ok
            ? `${source.created} created, ${source.updated} updated, ${source.skipped} skipped, ${source.failed} failed rows`
            : source.error}
        </li>)}
      </ul>}
      {syncIssues.length > 0 && <details className="sync-issues">
        <summary>Sync details ({syncIssues.length})</summary>
        <ul>{syncIssues.slice(0, 50).map((issue, index) => <li key={index}>{issue}</li>)}</ul>
        {syncIssues.length > 50 && <p>Showing the first 50 details.</p>}
      </details>}
      <div className="column-mapping">
        <button type="button" className="text-button mapping-disclosure" aria-expanded={expanded}
          aria-controls="column-mapping-content" onClick={toggle} disabled={busy}>
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />} Sheet sources &amp; column mapping
        </button>
        {error && <p className="mapping-error" role="alert">{error}</p>}
        <div id="column-mapping-content" hidden={!expanded} aria-busy={busy}>
          <p className="muted">Connect spreadsheet tabs and map each one separately. Sync Leads imports from all enabled sources. Share each spreadsheet with your configured Google service account.</p>
          <div className="sheet-source-list">
            {sources.map((source) => <div className="sheet-source-item" key={source.id}>
              <div><strong>{source.label}</strong><small>{source.title} · {source.enabled ? "Enabled" : "Disabled"}</small></div>
              <div className="sheet-source-actions">
                <button type="button" className="secondary" disabled={busy || dirty}
                  onClick={() => {
                    setSourceId(source.id);
                    setSaved(null);
                    setPreview(null);
                    setDraft({});
                    void run("load", source.id);
                  }} aria-pressed={sourceId === source.id}>Map {source.label}</button>
                <button type="button" className="secondary" disabled={busy || dirty}
                  onClick={() => run("enable", source.id)}>{source.enabled ? "Disable" : "Enable"} {source.label}</button>
              </div>
            </div>)}
            {!sources.length && action !== "sources" && <p>No sheet sources connected yet.</p>}
          </div>
          <form className="sheet-source-form" onSubmit={(event) => { event.preventDefault(); void run("add"); }}>
            <label>Source name<input required maxLength={100} value={sourceDraft.label} disabled={busy || dirty}
              onChange={(event) => setSourceDraft({ ...sourceDraft, label: event.target.value })} placeholder="e.g. Indore campaign" /></label>
            <label>Google Sheet URL or ID<input required value={sourceDraft.spreadsheet} disabled={busy || dirty}
              onChange={(event) => setSourceDraft({ ...sourceDraft, spreadsheet: event.target.value })} placeholder="Paste the spreadsheet link" /></label>
            <label>Tab name<input maxLength={100} value={sourceDraft.title} disabled={busy || dirty}
              onChange={(event) => setSourceDraft({ ...sourceDraft, title: event.target.value })} placeholder="Optional if the link includes gid" /></label>
            <button className="primary" type="submit" disabled={busy || dirty}>{action === "add" ? "Connecting…" : "Connect sheet"}</button>
          </form>
          <p className="muted">Disabling a source stops future imports and keeps existing leads. Lead IDs are shared across sources; the same Lead ID refers to the same CRM lead.</p>
          <div className="mapping-source">
            <div><strong>Column mapping</strong><span>{saved?.source?.title || "Choose Map beside a source"}</span></div>
            <button type="button" className="icon-button" aria-label="Refresh headers" title={dirty ? "Save or cancel changes before refreshing headers" : "Refresh headers"}
              disabled={busy || dirty || !sourceId} onClick={() => run("load")}><RefreshCw size={16} /></button>
          </div>
          {action === "load" && <p role="status">Loading headers...</p>}
          {saved && <>
            <div className="mapping-column-headings" aria-hidden="true"><span>CRM field</span><span>Sheet header</span><span>Sample</span></div>
            {saved.fields.map((field) => {
              const explicit = Object.hasOwn(draft, field.key);
              const selected = draft[field.key];
              const missing = explicit && selected !== null && !headers.includes(selected);
              const value = !explicit ? "auto" : selected === null ? "ignore" : `header:${selected}`;
              const resolved = result?.resolved?.[field.key];
              return <div className="mapping-row" key={field.key}>
                <label htmlFor={`mapping-${field.key}`}>{field.label}{field.required && <span className="mapping-required"> (required)</span>}</label>
                <div className="mapping-choice">
                  <select id={`mapping-${field.key}`} aria-label={field.label} value={value} disabled={busy} aria-invalid={missing}
                    aria-describedby={`mapping-detail-${field.key}`} onChange={(event) => {
                      const next = { ...draft };
                      const choice = event.target.value;
                      if (choice === "auto") delete next[field.key];
                      else next[field.key] = choice === "ignore" ? null : choice.slice(7);
                      changeDraft(next);
                    }}>
                    <option value="auto">Automatic</option>
                    {!field.required && <option value="ignore">Ignore</option>}
                    {missing && <option value={`header:${selected}`}>Missing: {selected}</option>}
                    {headers.map((header) => <option key={header} value={`header:${header}`}>{header}</option>)}
                  </select>
                  <small id={`mapping-detail-${field.key}`} className={missing ? "mapping-error" : ""}>
                    {missing ? `Missing header: ${selected}` : explicit ? selected === null ? "Ignored" : selected
                      : result ? `Automatic: ${resolved || "No matching header"}` : "Automatic"}
                  </small>
                </div>
                <div className="mapping-samples" aria-label={`${field.label} samples`}>
                  {result?.samples?.length ? result.samples.slice(0, 3).map((sample, index) =>
                    <span key={index}>{sample[field.key] == null || sample[field.key] === "" ? "-" : String(sample[field.key])}</span>) : <span>-</span>}
                </div>
              </div>;
            })}
            {Boolean(result?.errors?.length) && <ul className="mapping-error" role="alert">{result.errors.map((item, index) => <li key={index}>{item}</li>)}</ul>}
            {Boolean(result?.warnings?.length) && <ul className="mapping-warning" role="status">{result.warnings.map((item, index) => <li key={index}>{item}</li>)}</ul>}
            <div className="mapping-actions">
              <button type="button" className="secondary" disabled={busy} onClick={() => run("preview")}><Eye size={16} />{action === "preview" ? "Previewing" : "Preview"}</button>
              <button type="button" className="primary" disabled={busy || !dirty} onClick={() => run("save")}><Save size={16} />{action === "save" ? "Saving" : "Save Mapping"}</button>
              <button type="button" className="secondary" disabled={busy} onClick={() => changeDraft(saved.mapping || {})}><X size={16} />Cancel</button>
              <button type="button" className="secondary" disabled={busy || !Object.keys(draft).length} onClick={() => changeDraft({})}><RotateCcw size={16} />Reset to automatic</button>
            </div>
          </>}
          <p className="mapping-notice" role="status">{notice || (dirty ? "Unsaved mapping changes" : "")}</p>
        </div>
      </div>
    </div>
  );
}
