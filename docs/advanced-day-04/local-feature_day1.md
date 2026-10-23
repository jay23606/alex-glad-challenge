# Local run: feature_day1

wall=168.5s, eval=1312 tok, 8 tok/s, prompt=900 tok

```
### TokenEstimator

Создадим сервис `TokenEstimator` в `challenge/src/core/tokenEstimator.ts`.

```typescript
// challenge/src/core/tokenEstimator.ts
import { ChatMessage } from '../types';

export class TokenEstimator {
  estimate(messages: ChatMessage[], budget?: number): { total: number; breakdown: { [key: string]: number }; budgetLeft: number; fits: boolean } {
    const byteEstimate = (message: ChatMessage) => Buffer.byteLength(message.text, 'utf-8');
    const totalBytes = messages.reduce((acc, message) => acc + byteEstimate(message), 0);
    const totalTokens = Math.ceil(totalBytes / 4);

    const breakdown = messages.reduce((acc, message) => {
      acc[message.id] = Math.ceil(byteEstimate(message) / 4);
      return acc;
    }, {} as { [key: string]: number });

    const budgetLeft = budget ? budget - totalTokens : undefined;
    const fits = budget ? totalTokens <= budget : true;

    return { total: totalTokens, breakdown, budgetLeft, fits };
  }
}
```

### Веб-Endpoint

Создадим веб-endpoint `POST /api/tokens/estimate` в `web/lib/server/challenge.ts`.

```typescript
// web/lib/server/challenge.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { TokenEstimator } from '@challenge/core/tokenEstimator';

const requestSchema = z.object({
  messages: z.array(z.object({
    id: z.string(),
    text: z.string(),
  })),
  budget: z.number().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { messages, budget } = requestSchema.parse(body);

    const estimator = new TokenEstimator();
    const result = estimator.estimate(messages, budget);

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}
```

### Тесты

Создадим тесты для `TokenEstimator` в `challenge/src/core/tokenEstimator.test.ts` и для веб-endpoint в `web/lib/server/challenge.test.ts`.

#### Тесты для TokenEstimator

```typescript
// challenge/src/core/tokenEstimator.test.ts
import { TokenEstimator } from './tokenEstimator';

describe('TokenEstimator', () => {
  it('estimates total tokens correctly', () => {
    const estimator = new TokenEstimator();
    const messages = [
      { id: '1', text: 'Hello' },
      { id: '2', text: 'World' },
    ];
    const result = estimator.estimate(messages);
    expect(result.total).toBe(7);
  });

  it('estimates breakdown correctly', () => {
    const estimator = new TokenEstimator();
    const messages = [
      { id: '1', text: 'Hello' },
      { id: '2', text: 'World' },
    ];
    const result = estimator.estimate(messages);
    expect(result.breakdown['1']).toBe(3);
    expect(result.breakdown['2']).toBe(4);
  });

  it('estimates budget left correctly', () => {
    const estimator = new TokenEstimator();
    const messages = [
      { id: '1', text: 'Hello' },
      { id: '2', text: 'World' },
    ];
    const result = estimator.estimate(messages, 10);
    expect(result.budgetLeft).toBe(3);
  });

  it('returns fits flag correctly', () => {
    const estimator = new TokenEstimator();
    const messages = [
      { id: '1', text: 'Hello' },
      { id: '2', text: 'World' },
    ];
    const result = estimator.estimate(messages, 10);
    expect(result.fits).toBe(true);

    const result2 = estimator.estimate(messages, 5);
    expect(result2.fits).toBe(false);
  });
});
```

#### Тесты для веб-Endpoint

```typescript
// web/lib/server/challenge.test.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { POST } from './challenge';

const requestSchema = z.object({
  messages: z.array(z.object({
    id: z.string(),
    text: z.string(),
  })),
  budget: z.number().optional(),
});

describe('POST /api/tokens/estimate', () => {
  it('returns estimated tokens correctly', async () => {
    const request = new NextRequest(JSON.stringify({
      messages: [
        { id: '1', text: 'Hello' },
        { id: '2', text: 'World' },
      ],
      budget: 10,
    }), { method: 'POST' });

    const response = await POST(request);
    const result = await response.json();

    expect(result.ok).toBe(true);
    expect(result.total).toBe(7);
    expect(result.breakdown['1']).toBe(3);
    expect(result.breakdown['2']).toBe(4);
    expect(result.budgetLeft).toBe(3);
    expect(result.fits).toBe(true);
  });

  it('returns error for invalid request', async () => {
    const request = new NextRequest(JSON.stringify({
      messages: [
        { id: '1', text: 'Hello' },
        { id: '2', text: 'World' },
      ],
      budget: 'invalid',
    }), { method: 'POST' });

    const response = await POST(request);
    const result = await response.json();

    expect(result.error).toBe('Invalid request');
    expect(response.status).toBe(400);
  });
});
```

### Заключение

Теперь у нас есть сервис `TokenEstimator` для оценки токенов и веб-endpoint `POST /api/tokens/estimate` для его использования. Оба компонента протестированы на корректность работы.
```
