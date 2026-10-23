// GET /api/health — публичный health-check: факт живости + версия, без секретов.
// Версия — статический импорт package.json (resolveJsonModule), НЕ process.env:
// в рантайме Next переменной npm_package_version нет, а process.env в бизнес-коде
// запрещён (AGENTS §5.3).
import 'server-only';
import { NextResponse } from 'next/server';

import packageJson from '../../../../package.json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  return NextResponse.json(
    { ok: true, uptimeS: Math.round(process.uptime()), version: packageJson.version },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
