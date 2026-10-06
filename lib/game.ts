import { randomInt } from "crypto";
import { getStore } from "./store";

export const DEFAULT_POOL = [
  "Monkey", "Elephant", "Dog", "Cow", "Cat", "Duck", "Sheep", "Pig",
  "Lion", "Chicken", "Horse", "Frog", "Owl", "Donkey", "Goat",
];
export const DEFAULT_GROUP_COUNT = 5;

const ROUND_TTL_SECONDS = 7 * 24 * 60 * 60; // old rounds tidy themselves up after a week
const MAX_POOL = 60;
const MAX_NAME = 30;

export type Config = { pool: string[]; groupCount: number };

const K = {
  config: "config",
  current: "round:current",
  seq: "round:seq",
  animals: (id: string) => `round:${id}:animals`,
  counts: (id: string) => `round:${id}:counts`,
  assign: (id: string) => `round:${id}:assign`,
};

// Atomic join: same device keeps its animal; otherwise join the smallest group.
// ARGV[2] is a random number from the server so ties are broken at random.
const JOIN_SCRIPT = `
local existing = redis.call('HGET', KEYS[1], ARGV[1])
if existing then return existing end
local counts = redis.call('HGETALL', KEYS[2])
if #counts == 0 then return false end
local minCount = nil
local candidates = {}
for i = 1, #counts, 2 do
  local c = tonumber(counts[i + 1])
  if minCount == nil or c < minCount then
    minCount = c
    candidates = { counts[i] }
  elseif c == minCount then
    table.insert(candidates, counts[i])
  end
end
local pick = candidates[(tonumber(ARGV[2]) % #candidates) + 1]
redis.call('HSET', KEYS[1], ARGV[1], pick)
redis.call('HINCRBY', KEYS[2], pick, 1)
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[3]))
return pick
`;

// Atomic new round: write the chosen animals with zero counts, then make it current.
const NEW_ROUND_SCRIPT = `
redis.call('DEL', KEYS[1])
for i = 4, #ARGV do
  redis.call('HSET', KEYS[1], ARGV[i], 0)
end
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
redis.call('SET', KEYS[2], ARGV[3], 'EX', tonumber(ARGV[1]))
redis.call('SET', KEYS[3], ARGV[2])
return 1
`;

export async function getConfig(): Promise<Config> {
  const store = await getStore();
  const raw = await store.get(K.config);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Config;
      if (Array.isArray(parsed.pool) && typeof parsed.groupCount === "number") return parsed;
    } catch {
      /* fall through to defaults */
    }
  }
  return { pool: [...DEFAULT_POOL], groupCount: DEFAULT_GROUP_COUNT };
}

export function validateConfig(input: unknown): { ok: true; config: Config } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "Invalid settings." };
  const { pool, groupCount } = input as { pool?: unknown; groupCount?: unknown };
  if (!Array.isArray(pool)) return { ok: false, error: "The animal pool must be a list." };
  const cleaned: string[] = [];
  const seen = new Set<string>();
  for (const item of pool) {
    const name = String(item ?? "").trim().replace(/\s+/g, " ");
    if (!name) return { ok: false, error: "Animal names can't be blank." };
    if (name.length > MAX_NAME) return { ok: false, error: `"${name}" is too long (max ${MAX_NAME} characters).` };
    const key = name.toLowerCase();
    if (seen.has(key)) return { ok: false, error: `"${name}" is in the pool twice.` };
    seen.add(key);
    cleaned.push(name);
  }
  if (cleaned.length < 2) return { ok: false, error: "The pool needs at least 2 animals." };
  if (cleaned.length > MAX_POOL) return { ok: false, error: `The pool can have at most ${MAX_POOL} animals.` };
  const n = Number(groupCount);
  if (!Number.isInteger(n) || n < 2) return { ok: false, error: "Number of groups must be at least 2." };
  if (n > cleaned.length) {
    return { ok: false, error: `Number of groups (${n}) can't be more than the animals in the pool (${cleaned.length}).` };
  }
  return { ok: true, config: { pool: cleaned, groupCount: n } };
}

export async function saveConfig(config: Config): Promise<void> {
  const store = await getStore();
  await store.set(K.config, JSON.stringify(config));
}

export async function getCurrentRoundId(): Promise<string | null> {
  const store = await getStore();
  return store.get(K.current);
}

export type JoinResult = { waiting: true } | { waiting: false; roundId: string; animal: string };

export async function join(deviceId: string): Promise<JoinResult> {
  const store = await getStore();
  const roundId = await store.get(K.current);
  if (!roundId) return { waiting: true };
  const animal = await store.evalScript(
    JOIN_SCRIPT,
    [K.assign(roundId), K.counts(roundId)],
    [deviceId, String(randomInt(0, 1_000_000_000)), String(ROUND_TTL_SECONDS)]
  );
  if (animal == null || animal === false) return { waiting: true };
  return { waiting: false, roundId, animal: String(animal) };
}

function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export async function newRound(): Promise<{ roundId: string; animals: string[] }> {
  const store = await getStore();
  const config = await getConfig();
  const animals = shuffle(config.pool).slice(0, Math.min(config.groupCount, config.pool.length));
  const roundId = String(await store.incr(K.seq));
  await store.evalScript(
    NEW_ROUND_SCRIPT,
    [K.counts(roundId), K.animals(roundId), K.current],
    [String(ROUND_TTL_SECONDS), roundId, JSON.stringify(animals), ...animals]
  );
  return { roundId, animals };
}

export type RoundState = {
  id: string;
  animals: { name: string; count: number }[];
  total: number;
} | null;

export async function getRoundState(): Promise<RoundState> {
  const store = await getStore();
  const id = await store.get(K.current);
  if (!id) return null;
  const counts = await store.hgetall(K.counts(id));
  const animals = Object.entries(counts)
    .map(([name, c]) => ({ name, count: Number(c) || 0 }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const total = animals.reduce((s, a) => s + a.count, 0);
  return { id, animals, total };
}

export function isValidDeviceId(id: unknown): id is string {
  return typeof id === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(id);
}
