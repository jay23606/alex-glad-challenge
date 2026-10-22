---
name: add-core-service
description: Add or change a reusable service in challenge/src/core without leaking web dependencies, with injected dependencies, immutable contracts, barrel export, and node:test coverage.
---

# Add a core service

Use for logic shared by CLI, REPL, agents, and web.

## Steps

1. Read `challenge/src/core/index.ts` and the closest sibling module/test.
2. Decide the shape:
   - stateless conversion → exported functions;
   - config/dependencies/state → class with `constructor(opts)` and
     `private readonly` fields.
3. Define `readonly` interfaces for inputs/outputs. Use `import type`.
4. Validate domain invariants in the service (e.g. `RangeError`), even if the
   web boundary also uses zod.
5. Export the public class/functions and types from `core/index.ts` if shared.
6. Add `challenge/src/core/<name>.test.ts` with `node:test` and
   `node:assert/strict`. Cover normal, boundary, empty, and error cases.
7. Do not import `web/`, `next`, `server-only`, or `process.env` here. Config
   enters via constructor options or `core/env.ts`.

## Skeleton

```ts
import type { ChatMessage } from './types.js';

export interface ServiceOptions {
  readonly limit?: number;
}

export interface ServiceResult {
  readonly total: number;
}

export class Service {
  private readonly limit: number;

  constructor(opts: ServiceOptions = {}) {
    this.limit = opts.limit ?? 10;
  }

  run(messages: readonly ChatMessage[]): ServiceResult {
    // pure logic; no I/O
    return { total: messages.length };
  }
}
```

## Do not

- no `static`-only utility class for stateless logic;
- no `any`, no `console.log`, no `process.exit`;
- no direct SQL/network in a pure service;
- no non-null assertions to silence a real nullable case.
