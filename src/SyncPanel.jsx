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
  const lock = useRef(false);
  const dirty = saved !== null && !sameMapping(draft, saved.mapping || {});
  const busy = Boolean(action);
  const result = preview || (!dirty ? saved : null);

  async function run(kind) {
    if (lock.current || (kind === "sync" && dirty) || (kind === "load" && dirty)) return;
    lock.current = true;
    setAction(kind);
    setError("");
    setNotice("");
    try {
      if (kind === "sync") {
        setSyncMessage("");
        setSyncIssues([]);
        const response = await request("/sync", { method: "POST", body: {} });
        setSyncMessage(response.message);
        setSyncIssues([...(response.errors || []), ...(response.warnings || [])]);
        return;
      }
      const response = kind === "load"
        ? await request("/sync/mapping")
        : await request(kind === "preview" ? "/sync/mapping/preview" : "/sync/mapping", {
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
    if (!expanded && !dirty) void run("load");
  }

  const headers = [...new Set(saved?.headers || [])].filter((header) => header.trim());

  return (
    <div className="sync-settings">
      <div className="sync-strip">
        <div>
          <strong>Google Sheet Sync</strong>
          <small role="status">{dirty ? "Unsaved mapping changes" : syncMessage}</small>
        </div>
        <button type="button" className="secondary" onClick={() => run("sync")} disabled={busy || dirty}>
          <RefreshCw size={16} /> {action === "sync" ? "Syncing" : "Sync Leads"}
        </button>
      </div>
      {syncIssues.length > 0 && <details className="sync-issues">
        <summary>Sync details ({syncIssues.length})</summary>
        <ul>{syncIssues.slice(0, 50).map((issue, index) => <li key={index}>{issue}</li>)}</ul>
        {syncIssues.length > 50 && <p>Showing the first 50 details.</p>}
      </details>}
      <div className="column-mapping">
        <button type="button" className="text-button mapping-disclosure" aria-expanded={expanded}
          aria-controls="column-mapping-content" onClick={toggle} disabled={busy}>
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />} Column mapping
        </button>
        {error && <p className="mapping-error" role="alert">{error}</p>}
        <div id="column-mapping-content" hidden={!expanded} aria-busy={busy}>
          <div className="mapping-source">
            <div><strong>Source</strong><span>{saved?.source?.title || "Render environment"}</span></div>
            <button type="button" className="icon-button" aria-label="Refresh headers" title={dirty ? "Save or cancel changes before refreshing headers" : "Refresh headers"}
              disabled={busy || dirty} onClick={() => run("load")}><RefreshCw size={16} /></button>
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
            <p className="mapping-notice" role="status">{notice || (dirty ? "Unsaved mapping changes" : "")}</p>
          </>}
        </div>
      </div>
    </div>
  );
}
