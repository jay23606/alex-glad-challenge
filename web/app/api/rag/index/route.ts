// SSE Route Handler: RAG index — индексация docs (fixed/structure) → rag.sqlite (день 28, web P3b).
// POST → start → done(статистика по стратегиям) | error.
// runIndexing не имеет внешнего onProgress (внутренний makeIndexProgress пишет в console) —
// поэтому стрим отдаёт только start→done, по аналогии с P4a news/scout. Мутирует rag.sqlite:
// UI /rag/index требует явного confirm перед запуском.
//
// docsDir: считается от DATA_DIR (challenge/.data → .. → challenge/src/data/rag-sample),
// т.к. web/ запускается из web/ и process.cwd() уведёл бы путь. Зеркало cli RAG_DOCS_DIR.
import 'server-only';
import path from 'node:path';
import { NextRequest } from 'next/server';

import { ragIndexSchema } from '../../../../lib/shared/forms';
import type { SseRagIndexEvent, SseRagIndexStrategyStat } from '../../../../lib/shared/sse';
import { getRagStore, withDb } from '../../../../lib/server/db';
import { runIndexing, DATA_DIR } from '../../../../lib/server/challenge';
import { safeMessage } from '../../../../lib/server/safe-message';
import { requireAuth } from '../../../../lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// challenge/.data → challenge/ → src/data/rag-sample (cwd-независимо).
const RAG_DOCS_DIR = path.resolve(DATA_DIR, '..', 'src', 'data', 'rag-sample');

export async function POST(req: NextRequest): Promise<Response> {
  // Второй auth-слой: route мутирует rag.sqlite (reindex) — как /api/rag/index-tg.
  const denied = requireAuth(req);
  if (denied) return denied;

  const parsed = ragIndexSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: parsed.error.issues[0]?.message ?? 'invalid request' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }
  // strategies гарантированно непустое (zod min(1), не optional) — fallback на все
  // стратегии убран: пустое тело больше не триггерит полный reindex (В2, memory-инвариант).
  const strategies = parsed.data.strategies;

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (ev: SseRagIndexEvent): void => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
      };
      try {
        send({ type: 'stage', step: 'start', detail: { docsDir: RAG_DOCS_DIR, strategies } });

        // runIndexing: loadDocs + chunkDoc + батчевые эмбеддинги + insertChunks. Долго,
        // но withDb удерживает mutex (R4, план §6) — рассинхрон с другими route'ами исключён.
        const result = await withDb(() => runIndexing(getRagStore(), { docsDir: RAG_DOCS_DIR, strategies }));

        const stats: SseRagIndexStrategyStat[] = Object.keys(result).map((s) => {
          const st = result[s];
          return { strategy: s, chunks: st.chunks, avgLen: st.avgLen, dim: st.dim ?? null };
        });
        send({ type: 'done', result: stats });
      } catch (e) {
        const message = e instanceof Error ? safeMessage(e.message) : 'internal error';
        send({ type: 'error', message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
