// Агент 3. Фактчекинг.
// Сравнивает написанный пост с исходной новостью, проверяет, что все факты
// (имена, клубы, счёт, даты, цифры) соответствуют источнику. Возвращает список
// расхождений, ход рассуждений и итоговый verdict: можно публиковать / нужна
// правка.
//
// Использует chain-of-thought: сначала отдельно прогоняет «reasoning» — анализ
// каждого типа фактов по шагам, затем на основе этого анализа формирует
// финальный JSON-verdict. Это сильно повышает точность фактчекинга (двухшаговый
// prompt vs один мах).

import type { NewsRow } from '../db.js';
import { LlmClient, msg } from '../index.js';

export interface FactCheckIssue {
  claim: string;       // что утверждается в посте
  source: string;      // что есть в источнике
  severity: 'low' | 'medium' | 'high';
}

export interface FactCheckResult {
  verdict: 'ok' | 'needs_revision';
  issues: FactCheckIssue[];
  recommendation: string;
  reasoning: string;   // ход рассуждений (chain-of-thought)
}

export class FactChecker {
  constructor(
    private client: LlmClient,
    private opts: { channel?: string; topic?: string } = {},
  ) {}

  async check(post: string, news: NewsRow): Promise<FactCheckResult> {
    const channel = this.opts.channel ?? 'Иди на факты глянь';
    const topicSuffix = this.opts.topic ? ` (${this.opts.topic})` : '';
    // --- Шаг 1: reasoning (chain-of-thought). ---
    // Агент проходит по типам фактов и записывает свои наблюдения.
    // Без жёсткого формата — здесь важен именно «разговор с собой».
    const reasoningPrompt = `Ты строгий редактор-фактчекер Telegram-канала «${channel}»${topicSuffix}.
Твоя задача сейчас — НЕ выносить финальный вердикт, а расписать рассуждения
по шагам, проверяя каждое утверждение поста против источника.

=== ИСТОЧНИК (НОВОСТЬ) ===
Заголовок: ${news.title}
Текст: ${news.summary}
Источник: ${news.source}
Дата: ${news.published_at}

=== ПОСТ НА ПРОВЕРКУ ===
${post}

Проверь ВСЕ типы фактов последовательно:
1. Имена людей — правильно ли написаны, не выдуманы ли.
2. Названия команд, организаций, турниров, мест — корректны ли.
3. Результаты, счёты, итоги, позиции — совпадают ли с источником.
4. Даты, возраст, сроки, продолжительность.
5. Суммы, деньги, ресурсы.
6. Прямые цитаты — есть ли они в источнике, не перевраны ли.
7. Любые числовые/количественные утверждения.

По каждому типу напиши коротко: что проверил, что нашёл. Если в посте нет
утверждений какого-то типа — так и скажи «не применимо». В конце напиши
«ОТКАЗ ОТ ОТВЕТСТВЕННОСТИ НЕ ДЕЛАТЬ — это рабочий ход рассуждений.»`;

    const reasoning = await this.client.chat(
      [msg.user(reasoningPrompt)],
      { temperature: 0.2, maxTokens: 2000 },
    );

    // --- Шаг 2: финальный verdict на основе рассуждений. ---
    const verdictPrompt = `Ты строгий редактор-фактчекер Telegram-канала «${channel}»${topicSuffix}.
Только что ты провёл пошаговый анализ поста против источника. Ниже — твои
собственные рассуждения. Прими финальное решение.

=== ИСТОЧНИК (НОВОСТЬ) ===
Заголовок: ${news.title}
Текст: ${news.summary}
Источник: ${news.source}
Дата: ${news.published_at}

=== ПОСТ НА ПРОВЕРКУ ===
${post}

=== ТВОИ РАССУЖДЕНИЯ (из предыдущего шага) ===
${reasoning}

=== ЗАДАЧА ===
На основе рассуждений выше, сформируй финальный отчёт.

Ответь СТРОГО JSON-объектом. ПЕРВЫЙ СИМВОЛ ОТВЕТА — "{".
{
  "verdict": "ok" | "needs_revision",
  "issues": [
    {"claim": "что утверждается в посте", "source": "что есть в источнике или 'нет в источнике'", "severity": "low|medium|high"}
  ],
  "recommendation": "короткий совет автору по-русски"
}

Правила:
- issues — пустой массив [], если расхождений нет.
- verdict = "ok" только если нет issues с severity "high" или "medium".
- "low" — мелкие неточности (пунктуация в имени, транслитерация).
- "medium" — существенное искажение (неправильный счёт, перепутан клуб).
- "high" — выдуманный факт, которого нет в источнике.
- Не пиши ничего до или после JSON.`;

    const raw = await this.client.chat(
      [msg.user(verdictPrompt)],
      { temperature: 0.1, maxTokens: 2000 },
    );

    const parsed = parseVerdict(raw);
    return { ...parsed, reasoning };
  }
}

function parseVerdict(raw: string): Omit<FactCheckResult, 'reasoning'> {
  // Снять markdown-обёртку ```json ... ``` если есть.
  const cleaned = raw.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  if (start === -1) {
    return {
      verdict: 'needs_revision',
      issues: [],
      recommendation: 'Не удалось распарсить ответ фактчекера: ' + raw.slice(0, 200),
    };
  }
  // Найти соответствующую '}' через подсчёт скобок (с учётом строк).
  let end = -1;
  let depth = 0;
  let inStr = false;
  let prev = '';
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inStr) {
      if (ch === '"' && prev !== '\\') inStr = false;
    } else {
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    prev = ch;
  }
  // Если JSON обрезан (depth != 0) — пытаемся восстановить, закрыв скобки.
  let jsonStr: string;
  if (end === -1) {
    jsonStr = repairJson(cleaned.slice(start));
  } else {
    jsonStr = cleaned.slice(start, end + 1);
  }
  try {
    const obj = JSON.parse(jsonStr) as Record<string, unknown>;
    const verdict = obj['verdict'] === 'ok' ? 'ok' : 'needs_revision';
    const issuesRaw = Array.isArray(obj['issues']) ? (obj['issues'] as unknown[]) : [];
    const issues: FactCheckIssue[] = issuesRaw
      .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
      .map((x) => ({
        claim: String(x['claim'] ?? ''),
        source: String(x['source'] ?? ''),
        severity: x['severity'] === 'low' || x['severity'] === 'medium' || x['severity'] === 'high'
          ? (x['severity'] as FactCheckIssue['severity'])
          : 'medium',
      }));
    const recommendation = String(obj['recommendation'] ?? '');
    return { verdict, issues, recommendation };
  } catch {
    return {
      verdict: 'needs_revision',
      issues: [],
      recommendation: 'JSON-ошибка при парсинге ответа фактчекера.',
    };
  }
}

// Починить обрезанный JSON: оставить валидные完整ные поля, закрыть скобки.
function repairJson(s: string): string {
  // Обрезаем незавершённую строку после последней ".
  const lastQuote = s.lastIndexOf('"');
  if (lastQuote > 0) {
    // Ищем последний завершённый key-value: ...": "..."
    // Самый простой эвристический подход — отрезать до последнего '},' или '}'.
    const trimmed = s.slice(0, lastQuote + 1);
    // Закрыть issues-массив если открыт.
    const opens = (trimmed.match(/\[/g) ?? []).length;
    const closes = (trimmed.match(/\]/g) ?? []).length;
    let repaired = trimmed;
    if (opens > closes) repaired += ']'.repeat(opens - closes);
    repaired += '}';
    return repaired;
  }
  return s + '}';
}
