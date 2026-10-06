import { NextResponse } from "next/server";
import { StoreNotConfiguredError } from "./store";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export function handleError(err: unknown) {
  if (err instanceof StoreNotConfiguredError) {
    return json({ error: err.message, code: "storage_not_configured" }, 503);
  }
  console.error(err);
  return json({ error: "Something went wrong. Try again." }, 500);
}
