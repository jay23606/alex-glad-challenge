# Генерация 1 vs Генерация 2: что дали правила

Один и тот же промпт, два свежих субагента, разные наборы правил.

## Сводная таблица

| Критерий | Gen1: v1 | Gen2: v2 |
|---|---|---|
| Typecheck | PASS | PASS |
| Core tests | 101/101 (7 новых) | 105/105 (11 новых) |
| Route tests | 10/10 | 10/10 |
| Lint | не настроен | не настроен |
| Web build | не запускался | compile/typecheck/40 pages PASS; trace EPERM |
| Core-сервис | `static`-класс | instance-класс + options |
| Immutability | нет `readonly` | `readonly` входы/поля/массив |
| Domain guards | нет | `RangeError` для ratio/budget |
| Response envelope | без `ok` | `{ ok: true, ... }` |
| Error mapping | 400 | 400 + 500 + `safeMessage` |
| Unrelated diff | комментарий `P2b→P3b` | нет |
| CHANGELOG | нет | есть |
| Время | ~12 мин | ~2 мин 42 с |

## Ключевые diff'ы

### 1. Форма сервиса

```ts
// Gen1: stateless-класс со static
export class TokenEstimator {
  static readonly BYTES_PER_TOKEN = 4;
  static estimate(messages: ChatMessage[], budget?: number): TokenEstimate { ... }
}

// Gen2: instance-класс с конфигом и валидацией
export class TokenEstimator {
  constructor(opts: TokenEstimatorOptions = {}) {
    const bytesPerToken = opts.bytesPerToken ?? DEFAULT_BYTES_PER_TOKEN;
    if (!Number.isFinite(bytesPerToken) || bytesPerToken <= 0) {
      throw new RangeError('bytesPerToken must be a positive finite number');
    }
    this.bytesPerToken = bytesPerToken;
  }

  estimate(messages: readonly ChatMessage[], budget?: number): TokenEstimate {
    if (budget !== undefined && (!Number.isInteger(budget) || budget < 0)) {
      throw new RangeError('budget must be a non-negative integer');
    }
    ...
  }
}
```

Причина: §6.3–6.4 v2 («чистые функции для stateless; instance-класс, когда есть
конфиг/зависимости») + §9.1 (шаблон с `readonly` и конструктором).

### 2. Контракт ответа

```ts
// Gen1
return NextResponse.json(estimate, { headers: { 'Cache-Control': 'no-store' } });

// Gen2
return NextResponse.json(
  { ok: true, ...estimate },
  { headers: { 'Cache-Control': 'no-store' } },
);
```

Причина: §9.2 v2 фиксирует `{ ok: true, ... }` для action-endpoint.

### 3. Обработка ошибок

```ts
// Gen1: только zod/не-JSON → 400
// Gen2: + доменный RangeError → 400, неожиданный сбой → 500, safeMessage
try {
  const estimate = new TokenEstimator().estimate(...);
  ...
} catch (error) {
  if (error instanceof RangeError) { ... 400 ... }
  return NextResponse.json({ error: 'estimate failed' }, { status: 500 });
}
```

Причина: §6.5 (домен защищает инварианты), §5.3 (`safeMessage`), §9.2
(error mapping).

### 4. Immutability

Gen1:

```ts
export interface MessageEstimate {
  index: number;
  role: Role;
  bytes: number;
  tokens: number;
}
static estimate(messages: ChatMessage[], ...): TokenEstimate
```

Gen2:

```ts
export interface MessageEstimate extends TextEstimate {
  readonly index: number;
  readonly role: Role;
}
estimate(messages: readonly ChatMessage[], ...): TokenEstimate
```

Причина: §6.1, §9.1.

### 5. Surgical diff

Gen1 изменил несвязанный комментарий в `web/lib/server/challenge.ts`
(`P2b` → `P3b`). Gen2 не трогал чужие строки. Причина: §6.7 и
`.omp/RULES.md` («keep the diff surgical»).

## Что больше всего повлияло на качество

1. **Явные шаблоны файлов (§9).** Именно они дали `readonly`, instance-класс,
   `RangeError`, `{ ok: true }` и структуру теста. Без шаблона модель
   воспроизводит ближайший пример, а не «лучшую практику».
2. **Sticky `.omp/RULES.md`.** Короткие жёсткие запреты (no `any`, no
   `console.log`, surgical diff, no new deps) сработали как фильтр на этапе
   генерации, а не на этапе ревью.
3. **Скилл `add-web-endpoint`.** Даёт последовательность: schema → chokepoint →
   route → test → typecheck. Gen2 прошёл её за 2m42 вместо 12m.
4. **Project-scoped субагент `project-implementer`.** Отдельный system prompt
   с «load skill first» и запретом на build/test внутри среза уменьшил
   метания и лишние прогоны. Скиллы в текущей сессии были созданы после
   старта, поэтому Gen2 прочитал `SKILL.md` напрямую; свежий `omp -p`
   подтверждает, что они видны как `add-core-service`, `add-web-endpoint`,
   `project-validation`.
5. **Раздел валидации (§10).** Заставил gen2 добавить CHANGELOG и явно
   проверить границы; но не отменил необходимость прогнать полный suite —
   именно он выявил проблему с воркерами и тяжёлым chokepoint-импортом.

## Что правила не решают

- Не заменяют чтение существующего кода: gen1 был хорош именно потому, что
  ассистент открыл `forms.ts`, `challenge.ts` и route-тесты.
- Не фиксируют предметные лимиты (8k vs 100k) — это должно быть в правиле или
  в самом промпте.
- Не гарантируют зелёный полный suite: инфраструктурные ограничения Windows
  (Vitest workers, symlink EPERM в standalone build) остаются на человеке/CI.
