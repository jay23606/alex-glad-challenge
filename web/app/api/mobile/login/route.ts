// Route Handler: /api/mobile/login — вход мобильного клиента (Артель) по паролю
// рабочего пространства. Адрес сервера преднастраивается при сборке (Gradle
// property artel.serverUrl), пароль/токен в APK не зашиваются. В отличие от
// /api/auth/login cookie НЕ выдаётся: наружу — stateless session-токен (тот же
// createSessionValue(), HMAC, TTL 7 дней) в теле ответа; Android хранит его сам
// и шлёт как Authorization: Bearer (принимается isMobileAuthed/requireApiAuth).
// Rate-limit общий с админ-входом (lib/server/loginRateLimit.ts).
// Пароль нигде не сохраняется — только выданный токен (DataStore на клиенте).
import 'server-only';
import { NextRequest, NextResponse } from 'next/server';

import { loginSchema } from '../../../../lib/shared/forms';
import {
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
    // это конфигурация, а не неверный пароль; имена переменных — не секрет).
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

  // Успех: сброс окна + выдача session-токена (без Set-Cookie).
  reset();

  const token = createSessionValue();
  // expiresAt — ровно exp из токена, а не второй Date.now().
  const expiresAt = Number(token.slice(0, token.indexOf('.')));
  return NextResponse.json(
    { ok: true, token, expiresAt },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
