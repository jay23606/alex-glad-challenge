// Общие JSON-хелперы Route Handlers: единый error/ok envelope + no-store.
// `error` наружу — человекочитаемое, без секретов (значения чистятся вызывающим).
import { NextResponse } from 'next/server';

const NO_STORE = { 'Cache-Control': 'no-store' };

export function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status, headers: NO_STORE });
}

export function jsonOk(data: Record<string, unknown>, status = 200): NextResponse {
  return NextResponse.json({ ok: true, ...data }, { status, headers: NO_STORE });
}
