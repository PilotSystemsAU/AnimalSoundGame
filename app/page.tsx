"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

// Largest font size at which the name fits the screen without breaking a word.
function FitName({ name }: { name: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  const [size, setSize] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      const maxHeight = window.innerHeight * 0.7;
      let lo = 20;
      let hi = 220;
      while (hi - lo > 1) {
        const mid = Math.floor((lo + hi) / 2);
        el.style.fontSize = `${mid}px`;
        const fits = el.scrollWidth <= el.clientWidth && el.scrollHeight <= maxHeight;
        if (fits) lo = mid;
        else hi = mid;
      }
      el.style.fontSize = `${lo}px`;
      setSize(lo);
    };
    fit();
    window.addEventListener("resize", fit);
    document.fonts?.ready.then(fit).catch(() => {});
    return () => window.removeEventListener("resize", fit);
  }, [name]);

  return (
    <h1 ref={ref} className="animal" style={{ visibility: size == null ? "hidden" : "visible" }}>
      {name}
    </h1>
  );
}

const DEVICE_KEY = "ag_device";
const POLL_MS = 5000;

type View =
  | { kind: "loading" }
  | { kind: "animal"; animal: string; roundId: string }
  | { kind: "waiting" }
  | { kind: "rescan"; reason: "new-round" | "started" }
  | { kind: "error"; message: string };

function randomId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c) c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function readCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

// One ID per phone (per browser), kept in localStorage and a cookie so a
// re-scan or refresh within a round returns the same animal.
function getDeviceId(): string {
  let id: string | null = null;
  try {
    id = localStorage.getItem(DEVICE_KEY);
  } catch {
    /* storage blocked */
  }
  if (!id) id = readCookie(DEVICE_KEY);
  if (!id) id = randomId();
  try {
    localStorage.setItem(DEVICE_KEY, id);
  } catch {
    /* storage blocked */
  }
  document.cookie = `${DEVICE_KEY}=${encodeURIComponent(id)}; path=/; max-age=31536000; samesite=lax`;
  return id;
}

export default function PlayerPage() {
  const [view, setView] = useState<View>({ kind: "loading" });
  const viewRef = useRef(view);
  viewRef.current = view;

  // Joining happens only here, on page load (i.e. when the QR code is scanned).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/join", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deviceId: getDeviceId() }),
          cache: "no-store",
        });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) setView({ kind: "error", message: data.error || "Something went wrong." });
        else if (data.waiting) setView({ kind: "waiting" });
        else setView({ kind: "animal", animal: data.animal, roundId: data.roundId });
      } catch {
        if (!cancelled) setView({ kind: "error", message: "Couldn't reach the game. Check your signal and scan again." });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Watch for the host starting a new round; never re-join on our own.
  const check = useCallback(async () => {
    const current = viewRef.current;
    if (current.kind !== "animal" && current.kind !== "waiting") return;
    if (document.visibilityState !== "visible") return;
    try {
      const res = await fetch("/api/round", { cache: "no-store" });
      if (!res.ok) return;
      const { roundId } = (await res.json()) as { roundId: string | null };
      const latest = viewRef.current;
      if (latest.kind === "animal" && roundId !== latest.roundId) {
        setView({ kind: "rescan", reason: "new-round" });
      } else if (latest.kind === "waiting" && roundId) {
        setView({ kind: "rescan", reason: "started" });
      }
    } catch {
      /* try again next tick */
    }
  }, []);

  useEffect(() => {
    const timer = setInterval(check, POLL_MS);
    document.addEventListener("visibilitychange", check);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [check]);

  if (view.kind === "animal") {
    return (
      <main className="player">
        <FitName name={view.animal} />
      </main>
    );
  }

  let title = "";
  let note = "";
  if (view.kind === "loading") title = "…";
  if (view.kind === "waiting") {
    title = "Waiting for the host";
    note = "Keep this page open.";
  }
  if (view.kind === "rescan") {
    title = view.reason === "new-round" ? "New round" : "The round has started";
    note = "Scan the QR code again to get your animal.";
  }
  if (view.kind === "error") {
    title = "Hmm.";
    note = view.message;
  }

  return (
    <main className="player">
      <div className="status">
        <p className="status-title">{title}</p>
        {note && <p className="status-note">{note}</p>}
      </div>
    </main>
  );
}
