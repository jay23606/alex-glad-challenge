// /api/tokens/estimate — грубая оценка токенов чат-сообщений (UTF-8 bytes / 4).
// POST {messages, budget?} → {ok, total, messages:[{index,role,bytes,tokens}],
// budget, remaining, fits}. 400 — zod/доменный RangeError; 500 — неожиданный сбой.
// server-only: core/ только через chokepoint web/lib/server/challenge.
import 'server-only';
import { NextRequest, NextResponse } from 'next/server';

import { tokenEstimateSchema } from '../../../../lib/shared/forms';
import { TokenEstimator } from '../../../../lib/server/challenge';
import { safeMessage } from '../../../../lib/server/safe-message';

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

  try {
    const estimate = new TokenEstimator().estimate(parsed.data.messages, parsed.data.budget);
    return NextResponse.json(
      { ok: true, ...estimate },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    // Домен всё равно проверяет инварианты (§6.5): минус/дробь в budget → 400.
    if (error instanceof RangeError) {
      return NextResponse.json(
        { error: safeMessage(error.message) },
        { status: 400, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    return NextResponse.json(
      { error: 'estimate failed' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
