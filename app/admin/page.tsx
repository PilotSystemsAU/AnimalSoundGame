"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";

type Config = { pool: string[]; groupCount: number };
type Round = { id: string; animals: { name: string; count: number }[]; total: number } | null;
type State = { config: Config; round: Round };
type Draft = { pool: string[]; groups: number };

const POLL_MS = 3000;

const sameDraft = (d: Draft, c: Config) => d.groups === c.groupCount && d.pool.join("\n") === c.pool.join("\n");

export default function AdminPage() {
  const [auth, setAuth] = useState<"checking" | "out" | "in">("checking");
  const [state, setState] = useState<State | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const draftRef = useRef<Draft | null>(null);
  draftRef.current = draft;
  const stateRef = useRef<State | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/state", { cache: "no-store" });
      const data = await res.json();
      if (res.status === 401) {
        setAuth("out");
        return;
      }
      if (!res.ok) {
        setAuth("in");
        setBanner(data.error || "Couldn't load the game state.");
        return;
      }
      setAuth("in");
      setBanner(null);
      // Pick up settings saved elsewhere, unless there are unsaved edits here.
      const d = draftRef.current;
      const prev = stateRef.current;
      if (!d || !prev || sameDraft(d, prev.config)) {
        setDraft({ pool: data.config.pool, groups: data.config.groupCount });
      }
      stateRef.current = data;
      setState(data);
    } catch {
      setBanner("Can't reach the server. Retrying…");
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  async function saveDraft(d: Draft): Promise<string | null> {
    const res = await fetch("/api/admin/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pool: d.pool, groupCount: d.groups }),
    });
    if (res.ok) return null;
    return (await res.json().catch(() => ({}))).error || "Couldn't save the settings.";
  }

  if (auth === "checking") return <main className="admin"><p className="muted">Loading…</p></main>;
  if (auth === "out") return <Login onDone={load} />;

  const dirty = Boolean(state && draft && !sameDraft(draft, state.config));

  return (
    <main className="admin">
      <header className="admin-head">
        <div>
          <p className="eyebrow">Host panel</p>
          <h1>Animal Noises</h1>
        </div>
        <button
          className="btn ghost"
          onClick={async () => {
            await fetch("/api/admin/logout", { method: "POST" });
            setAuth("out");
          }}
        >
          Sign out
        </button>
      </header>
      {banner && <div className="banner">{banner}</div>}
      {state && draft && (
        <>
          <RoundPanel
            round={state.round}
            draft={draft}
            dirty={dirty}
            saveDraft={saveDraft}
            onChange={load}
            onError={setBanner}
          />
          <SettingsPanel
            draft={draft}
            setDraft={setDraft}
            dirty={dirty}
            saveDraft={saveDraft}
            onSaved={load}
            roundAnimals={state.round?.animals.length ?? null}
          />
          <QrPanel />
        </>
      )}
    </main>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setBusy(false);
    if (res.ok) onDone();
    else setError((await res.json().catch(() => ({}))).error || "Couldn't sign in.");
  }

  return (
    <main className="admin narrow">
      <p className="eyebrow">Host panel</p>
      <h1>Animal Noises</h1>
      <form className="card stack" onSubmit={submit}>
        <label htmlFor="pw">Admin password</label>
        <input
          id="pw"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
        />
        {error && <p className="error">{error}</p>}
        <button className="btn primary" disabled={busy || !password}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}

function RoundPanel({
  round,
  draft,
  dirty,
  saveDraft,
  onChange,
  onError,
}: {
  round: Round;
  draft: Draft;
  dirty: boolean;
  saveDraft: (d: Draft) => Promise<string | null>;
  onChange: () => void;
  onError: (msg: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const max = round ? Math.max(1, ...round.animals.map((a) => a.count)) : 1;
  const lonely = round && round.total > 0 ? round.animals.filter((a) => a.count < 2) : [];

  // New round always uses the settings currently on screen (saving them first).
  async function start() {
    const what = `${draft.groups} groups (${draft.groups} animals picked at random from your pool of ${draft.pool.length})`;
    const msg = round
      ? `Start a new round with ${what}?\n\nEveryone will need to scan the QR code again.`
      : `Start the first round with ${what}?`;
    if (!confirm(msg)) return;
    setBusy(true);
    if (dirty) {
      const err = await saveDraft(draft);
      if (err) {
        setBusy(false);
        onError(err);
        return;
      }
    }
    const res = await fetch("/api/admin/new-round", { method: "POST" });
    setBusy(false);
    if (!res.ok) onError((await res.json().catch(() => ({}))).error || "Couldn't start a new round.");
    onChange();
  }

  return (
    <section className="card">
      <div className="row between">
        <div>
          <h2>{round ? `Round ${round.id}` : "No round yet"}</h2>
          <p className="muted">
            {round
              ? `${round.animals.length} animals in play · ${round.total} ${round.total === 1 ? "player has" : "players have"} scanned`
              : "Start a round, then have everyone scan the QR code."}
          </p>
        </div>
        <button className="btn primary big" onClick={start} disabled={busy}>
          {busy ? "Starting…" : "New round"}
        </button>
      </div>

      {round && (
        <ul className="counts">
          {round.animals.map((a) => (
            <li key={a.name}>
              <span className="count-name">{a.name}</span>
              <span className="bar">
                <span style={{ width: `${(a.count / max) * 100}%` }} />
              </span>
              <span className="count-num">{a.count}</span>
            </li>
          ))}
        </ul>
      )}

      {lonely.length > 0 && (
        <p className="warning">
          So far {lonely.map((a) => a.name).join(", ")} {lonely.length === 1 ? "has" : "have"} fewer than 2 players
          — nobody to find. If everyone has scanned, lower the number of groups and start a new round.
        </p>
      )}
    </section>
  );
}

function SettingsPanel({
  draft,
  setDraft,
  dirty,
  saveDraft,
  onSaved,
  roundAnimals,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  dirty: boolean;
  saveDraft: (d: Draft) => Promise<string | null>;
  onSaved: () => void;
  roundAnimals: number | null;
}) {
  const [newName, setNewName] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const { pool, groups } = draft;

  function add(e: FormEvent) {
    e.preventDefault();
    const name = newName.trim().replace(/\s+/g, " ");
    if (!name) return;
    if (pool.some((p) => p.toLowerCase() === name.toLowerCase())) {
      setMsg({ kind: "error", text: `"${name}" is already in the pool.` });
      return;
    }
    setDraft({ ...draft, pool: [...pool, name] });
    setNewName("");
    setMsg(null);
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    const err = await saveDraft(draft);
    setBusy(false);
    if (err) {
      setMsg({ kind: "error", text: err });
      return;
    }
    setMsg({ kind: "ok", text: "Saved. Used when you start the next round." });
    onSaved();
  }

  const differsFromRound = roundAnimals != null && roundAnimals !== groups;

  return (
    <section className="card">
      <h2>Settings for the next round</h2>
      <p className="muted">
        Tapping <strong>New round</strong> uses these settings, saving any changes first.
      </p>

      <div className="field">
        <label htmlFor="groups">Number of groups</label>
        <div className="stepper">
          <button className="btn" onClick={() => setDraft({ ...draft, groups: Math.max(2, groups - 1) })} aria-label="Fewer groups">−</button>
          <input
            id="groups"
            type="number"
            min={2}
            max={pool.length}
            value={groups}
            onChange={(e) => setDraft({ ...draft, groups: Number(e.target.value) })}
          />
          <button className="btn" onClick={() => setDraft({ ...draft, groups: Math.min(pool.length, groups + 1) })} aria-label="More groups">+</button>
        </div>
        <p className="muted small">
          Each round picks this many animals at random from the pool, and everyone is split evenly between them.
          {differsFromRound && ` The current round has ${roundAnimals}; start a new round to switch to ${groups}.`}
        </p>
      </div>

      <div className="field">
        <label>Animal pool ({pool.length})</label>
        <ul className="chips">
          {pool.map((name) => (
            <li key={name}>
              {name}
              <button onClick={() => setDraft({ ...draft, pool: pool.filter((p) => p !== name) })} aria-label={`Remove ${name}`}>×</button>
            </li>
          ))}
        </ul>
        <form className="row" onSubmit={add}>
          <input
            placeholder="Add an animal"
            value={newName}
            maxLength={30}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button className="btn" disabled={!newName.trim()}>Add</button>
        </form>
      </div>

      <div className="row">
        <button className="btn" onClick={save} disabled={!dirty || busy}>
          {busy ? "Saving…" : "Save settings"}
        </button>
        {dirty && <span className="muted small">Unsaved changes (New round will save them)</span>}
      </div>
      {msg && <p className={msg.kind === "ok" ? "ok" : "error"}>{msg.text}</p>}
    </section>
  );
}

function QrPanel() {
  const [url, setUrl] = useState("");
  const [dataUrl, setDataUrl] = useState("");
  const [full, setFull] = useState(false);

  useEffect(() => {
    const playerUrl = `${window.location.origin}/`;
    setUrl(playerUrl);
    QRCode.toDataURL(playerUrl, { width: 1024, margin: 2, errorCorrectionLevel: "M" }).then(setDataUrl);
  }, []);

  return (
    <section className="card">
      <h2>QR code</h2>
      <p className="muted">The same code works for every round, so you can print it once.</p>
      <div className="qr-row">
        {dataUrl && <img className="qr" src={dataUrl} alt={`QR code for ${url}`} />}
        <div className="stack">
          <code className="url">{url}</code>
          <button className="btn" onClick={() => setFull(true)}>Show full screen</button>
          {dataUrl && (
            <a className="btn" href={dataUrl} download="animal-noises-qr.png">
              Download PNG
            </a>
          )}
        </div>
      </div>
      {full && (
        <div className="qr-full" onClick={() => setFull(false)} role="dialog" aria-label="QR code, tap to close">
          <img src={dataUrl} alt={`QR code for ${url}`} />
          <p>Scan to get your animal · tap to close</p>
        </div>
      )}
    </section>
  );
}
