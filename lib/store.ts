// Thin storage layer.
// Production: Upstash Redis over REST (env vars added by the Vercel Marketplace integration).
// Local development and tests: a normal Redis server via REDIS_URL.

import { Redis as UpstashRedis } from "@upstash/redis";
import type IORedis from "ioredis";

export interface Store {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  incr(key: string): Promise<number>;
  hgetall(key: string): Promise<Record<string, string>>;
  evalScript(script: string, keys: string[], args: string[]): Promise<unknown>;
}

let cached: Store | null = null;

export class StoreNotConfiguredError extends Error {
  constructor() {
    super(
      "Storage is not connected yet. Add Upstash Redis to this Vercel project from the Marketplace, then redeploy."
    );
  }
}

function upstashStore(url: string, token: string): Store {
  const r = new UpstashRedis({ url, token, automaticDeserialization: false });
  return {
    async get(key) {
      const v = await r.get<string>(key);
      return v == null ? null : String(v);
    },
    async set(key, value) {
      await r.set(key, value);
    },
    async incr(key) {
      return r.incr(key);
    },
    async hgetall(key) {
      const v = await r.hgetall<Record<string, string>>(key);
      return v ?? {};
    },
    async evalScript(script, keys, args) {
      return r.eval(script, keys, args);
    },
  };
}

async function ioredisStore(url: string): Promise<Store> {
  const { default: Redis } = await import("ioredis");
  const r: IORedis = new Redis(url);
  return {
    get: (key) => r.get(key),
    async set(key, value) {
      await r.set(key, value);
    },
    incr: (key) => r.incr(key),
    hgetall: (key) => r.hgetall(key),
    evalScript: (script, keys, args) => r.eval(script, keys.length, ...keys, ...args),
  };
}

export async function getStore(): Promise<Store> {
  if (cached) return cached;
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (url && token) {
    cached = upstashStore(url, token);
  } else if (process.env.REDIS_URL && process.env.REDIS_URL.startsWith("redis")) {
    cached = await ioredisStore(process.env.REDIS_URL);
  } else {
    throw new StoreNotConfiguredError();
  }
  return cached;
}
