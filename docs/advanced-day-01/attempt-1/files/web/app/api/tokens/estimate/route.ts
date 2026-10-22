// POST /api/tokens/estimate — оценка токенов диалога ДО отправки в LLM.
// Чистый расчёт через core TokenEstimator (эвристика UTF-8 байты / 4,
// ceil) — без LLM-вызова, БД и новых зависимостей. Вход — zod-граница
// tokenEstimateSchema (тип/длина/enum): messages (role/content ≤8000,
// ≤200 шт.) + опциональный budget (целый ≥0). Ответ: total, разбивка по
// сообщениям, budget/remaining (null без бюджета) и fits (без бюджета
// всегда true). Ошибки: 400 (zod/не-JSON).
import 'server-only';
import { NextRequest, NextResponse } from 'next/server';

import { tokenEstimateSchema } from '../../../../lib/shared/forms';
import { TokenEstimator } from '../../../../lib/server/challenge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<Response> {
  const parsed = tokenEstimateSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'invalid request' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const { messages, budget } = parsed.data;
  const estimate = TokenEstimator.estimate(messages, budget);
  return NextResponse.json(estimate, { headers: { 'Cache-Control': 'no-store' } });
}
