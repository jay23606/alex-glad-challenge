// /api/support/faq — поиск по FAQ-корпусу (GET ?q=).
import 'server-only';
import { NextRequest } from 'next/server';

import { requireApiAuth } from '../../../../lib/auth';
import { jsonOk } from '../../../../lib/server/http';
import { searchFaq } from '../../../../lib/server/challenge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  const denied = requireApiAuth(req);
  if (denied) return denied;
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim().slice(0, 500);
  const results = q ? searchFaq(q) : [];
  return jsonOk({ results: results.map((r) => ({ question: r.question, answer: r.answer, score: r.score })) });
}
