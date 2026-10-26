// Оркестрация индексации (день 21): загрузка документов -> chunking ->
// батчевые эмбеддинги -> запись в индекс. Поддержка обеих стратегий.

import type { Chunk, ChunkingStrategy, Embedder, IndexStats } from './types.js';
import { loadDocs } from './loader.js';
import { chunkDoc } from './chunker.js';
import type { FixedChunkOptions, StructuredChunkOptions } from './chunker.js';
import type { RagStore } from './store.js';
import { makeEmbedder } from './embedder.js';

export const RAG_STRATEGIES: ChunkingStrategy[] = ['fixed', 'structure'];

// Компактный человекочитаемый формат длительности для live-прогресса:
// <60s → "12s", <60m → "4m", иначе "2h13m".
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '?';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h${m % 60}m`;
}

export interface IndexingResult {
  [strategy: string]: IndexStats;
}

export async function indexDocuments(
  store: RagStore,
  strategy: ChunkingStrategy,
  chunks: Chunk[],
  embedder: Embedder,
  batchSize = 32,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const vecs = await embedder.embed(batch.map((c) => c.text));
    if (vecs.length !== batch.length) {
      throw new Error(`embeddings count mismatch: ${vecs.length} != ${batch.length}`);
    }
    store.insertChunks(strategy, batch, vecs);
    onProgress?.(Math.min(i + batchSize, chunks.length), chunks.length);
  }
}

export interface RunIndexingOptions {
  docsDir: string;
  strategies?: ChunkingStrategy[];
  embedder?: Embedder;
  fixed?: FixedChunkOptions;
  structured?: StructuredChunkOptions;
  /** Прогресс в sink вызова (CLI = console.log). Default — тишина:
   * runIndexing гоняется и из web, шуметь в stdout сервера нельзя (§8.2). */
  onLog?: (line: string) => void;
}

// live-прогресс эмбеддинга одной стратегии: каждые ~5% — строка с ETA,
// на 100% — итог. Считает ms/chunk по уже обработанным, ETA = rate × остаток.
function makeIndexProgress(
  strategy: ChunkingStrategy,
  total: number,
  onLog: (line: string) => void,
): (done: number) => void {
  const start = Date.now();
  let lastBucket = -1;
  return (done: number) => {
    const pct = total > 0 ? Math.min(100, Math.floor((done / total) * 100)) : 100;
    const bucket = Math.floor(pct / 5) * 5; // рапорт каждые ~5%, не каждый батч
    const isDone = done >= total;
    if (!isDone && bucket <= lastBucket) return;
    lastBucket = bucket;
    const elapsed = Date.now() - start;
    if (isDone) {
      onLog(`  [${strategy} ${done}/${total} · 100% · готово за ${formatDuration(elapsed)}]`);
      return;
    }
    const rate = done > 0 ? elapsed / done : 0; // ms на чанк
    const eta = rate * (total - done);
    onLog(
      `  [${strategy} ${done}/${total} · ${pct}% · ~${formatDuration(eta)} left · ${Math.round(rate)}ms/chunk]`,
    );
  };
}

export async function runIndexing(
  store: RagStore,
  opts: RunIndexingOptions,
): Promise<IndexingResult> {
  const onLog = opts.onLog ?? (() => {});
  const strategies = opts.strategies ?? RAG_STRATEGIES;
  const embedder = opts.embedder ?? makeEmbedder();
  const docs = await loadDocs(opts.docsDir);
  if (docs.length === 0) {
    throw new Error(
      `Не найдено документов в ${opts.docsDir} (.md/.txt/.ts/.js). Положите файлы или укажите другой путь.`,
    );
  }

  const result: IndexingResult = {};
  const totalStart = Date.now();
  let totalChunks = 0;
  for (const strategy of strategies) {
    const chunks = docs.flatMap((d) => chunkDoc(d, strategy, { fixed: opts.fixed, structured: opts.structured }));
    totalChunks += chunks.length;
    onLog(`▶ индексация: ${strategy} → ${chunks.length} чанков`);
    store.clearStrategy(strategy);
    await indexDocuments(store, strategy, chunks, embedder, 32, makeIndexProgress(strategy, chunks.length, onLog));
    result[strategy] = store.stats(strategy);
  }
  onLog(`[indexed ${totalChunks} chunks in ${formatDuration(Date.now() - totalStart)}]`);
  return result;
}
