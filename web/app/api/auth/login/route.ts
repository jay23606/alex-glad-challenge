// Route Handler: /api/auth/login — вход единственного админа (день 36).
// zod на входе → rate-limit → fail-closed (503 при незаданном env; имена переменных
// — не секрет) → timing-safe сравнение → stateless cookie admin_session
// (httpOnly, sameSite=lax, path=/, maxAge 7 дней — копия параметров settings-роута).
// Rate-limit — общий с мобильным входом (lib/server/loginRateLimit.ts):
// глобальный fixed-window 10/15 мин, там же обоснование глобальности.
import 'server-only';
import { NextRequest, NextResponse } from 'next/server';

import { loginSchema } from '../../../../lib/shared/forms';
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_S,
  createSessionValue,
  isAdminAuthConfigured,
  verifyAdminPassword,
} from '../../../../lib/auth';
import {
  RETRY_AFTER_S,
  isRateLimited,
  registerFailure,
  reset,
} from '../../../../lib/server/loginRateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<Response> {
  if (isRateLimited()) {
    return NextResponse.json(
      { ok: false, error: 'Слишком много попыток входа. Подождите до конца 15-минутного окна.' },
      { status: 429, headers: { 'Cache-Control': 'no-store', 'Retry-After': String(RETRY_AFTER_S) } },
    );
  }

  const parsed = loginSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid request' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  if (!isAdminAuthConfigured()) {
    // fail-closed: без пароля/секрета вход невозможен в принципе (503, не 401 —
    // это конфигурация, а не неверный пароль).
    return NextResponse.json(
      {
        ok: false,
        error: 'Админ-доступ не настроен: задайте WEB_ADMIN_PASSWORD и WEB_AUTH_SECRET в .env',
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  if (!verifyAdminPassword(parsed.data.password)) {
    registerFailure();
    return NextResponse.json(
      { ok: false, error: 'Неверный пароль' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // Успех: сброс окна + выдача сессии.
  reset();

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, createSessionValue(), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_S,
  });
  return res;
}
