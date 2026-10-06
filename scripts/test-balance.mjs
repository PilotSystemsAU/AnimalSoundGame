#!/usr/bin/env node
// Automated acceptance checks from the scope sheet.
// Usage: BASE_URL=https://your-site.vercel.app ADMIN_PASSWORD=... node scripts/test-balance.mjs
//
// It temporarily switches the settings to a 5-animal test pool, runs the checks,
// then restores your settings and starts a clean round so no test players remain.

import { randomUUID } from "node:crypto";

const BASE = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const PASSWORD = process.env.ADMIN_PASSWORD;
if (!PASSWORD) {
  console.error("Set ADMIN_PASSWORD (and BASE_URL) first.");
  process.exit(2);
}

let cookie = "";
let failures = 0;

async function call(path, { method = "GET", body, auth = true } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(auth && cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie && path === "/api/admin/login") cookie = setCookie.split(";")[0];
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

const join = async (deviceId = randomUUID()) => (await call("/api/join", { method: "POST", body: { deviceId }, auth: false })).data;
const counts = async () => {
  const { data } = await call("/api/admin/state");
  return data.round.animals.map((a) => a.count).sort((a, b) => b - a);
};

const TEST_POOL = ["Test-Monkey", "Test-Elephant", "Test-Dog", "Test-Cow", "Test-Duck"];

async function main() {
  // Admin routes must reject requests without the admin cookie.
  for (const [method, path] of [["GET", "/api/admin/state"], ["POST", "/api/admin/config"], ["POST", "/api/admin/new-round"]]) {
    const r = await call(path, { method, auth: false, body: method === "POST" ? {} : undefined });
    check(`${method} ${path} rejects without sign-in`, r.status === 401, `got ${r.status}`);
  }

  const login = await call("/api/admin/login", { method: "POST", body: { password: PASSWORD } });
  if (login.status !== 200) {
    console.error("Could not sign in:", login.data.error || login.status);
    process.exit(1);
  }

  const original = (await call("/api/admin/state")).data.config;
  try {
    await call("/api/admin/config", { method: "POST", body: { pool: TEST_POOL, groupCount: 5 } });

    // 100 sequential joins → 20 each
    await call("/api/admin/new-round", { method: "POST" });
    for (let i = 0; i < 100; i++) await join();
    let c = await counts();
    check("100 sequential joins give 20 per animal", c.every((n) => n === 20), c.join(","));

    // 103 joins → 21,21,21,20,20
    await call("/api/admin/new-round", { method: "POST" });
    for (let i = 0; i < 103; i++) await join();
    c = await counts();
    check("103 joins give 21,21,21,20,20", c.join(",") === "21,21,21,20,20", c.join(","));

    // 100 parallel joins → spread of at most 1
    await call("/api/admin/new-round", { method: "POST" });
    await Promise.all(Array.from({ length: 100 }, () => join()));
    c = await counts();
    check("100 parallel joins stay within 1", c[0] - c[c.length - 1] <= 1 && c.reduce((a, b) => a + b) === 100, c.join(","));

    // Same device 10 times → same animal, counted once
    await call("/api/admin/new-round", { method: "POST" });
    const id = randomUUID();
    const animals = new Set();
    for (let i = 0; i < 10; i++) animals.add((await join(id)).animal);
    const total = (await call("/api/admin/state")).data.round.total;
    check("Same device keeps one animal, counted once", animals.size === 1 && total === 1, `animals=${[...animals]}, total=${total}`);

    // New round picks from the pool, no repeats, counts reset
    const nr = (await call("/api/admin/new-round", { method: "POST" })).data;
    const st = (await call("/api/admin/state")).data.round;
    check(
      "New round: animals from pool, no repeats, counts at 0",
      nr.animals.length === 5 && new Set(nr.animals).size === 5 && nr.animals.every((a) => TEST_POOL.includes(a)) && st.total === 0,
      nr.animals.join(",")
    );

    // Validation
    const bad = await call("/api/admin/config", { method: "POST", body: { pool: ["Dog", "dog"], groupCount: 2 } });
    check("Duplicate animal names rejected", bad.status === 400);
    const tooMany = await call("/api/admin/config", { method: "POST", body: { pool: ["Dog", "Cat"], groupCount: 3 } });
    check("More groups than animals rejected", tooMany.status === 400);
  } finally {
    await call("/api/admin/config", { method: "POST", body: original });
    await call("/api/admin/new-round", { method: "POST" });
    console.log("Restored your settings and started a clean round.");
  }

  console.log(failures ? `\n${failures} check(s) failed.` : "\nAll checks passed.");
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
