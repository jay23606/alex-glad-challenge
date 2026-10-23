// Unit: web/next.config.ts — standalone-гейт (issue #88, regression к #51):
// output:'standalone' только вне win32 или при NEXT_STANDALONE=1; на win32 без
// флага — undefined (next build на Windows падает на build traces: EPERM symlink).
// process.platform — accessor-only own property, подменяем через
// Object.defineProperty ДО импорта: конфиг читает platform/env один раз на
// модуль, поэтому каждый кейс — vi.resetModules() + динамический import.
import type { NextConfig } from 'next';
import { afterEach, describe, expect, it, vi } from 'vitest';

const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
const realStandalone = process.env.NEXT_STANDALONE;

/** Подмена process.platform до импорта конфига (own property, configurable). */
function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', {
    value: platform,
    configurable: true,
  });
}

/** Свежая оценка модуля: изоляция top-level чтений platform/env. */
async function loadOutput(): Promise<NextConfig['output']> {
  vi.resetModules();
  const mod = await import('../../next.config');
  return mod.default.output;
}

afterEach(() => {
  if (realPlatform) Object.defineProperty(process, 'platform', realPlatform);
  if (realStandalone === undefined) delete process.env.NEXT_STANDALONE;
  else process.env.NEXT_STANDALONE = realStandalone;
});

describe('next.config standalone gate', () => {
  it('win32 без NEXT_STANDALONE — output undefined', async () => {
    setPlatform('win32');
    delete process.env.NEXT_STANDALONE;
    await expect(loadOutput()).resolves.toBeUndefined();
  });

  it('win32 + NEXT_STANDALONE=1 — output standalone', async () => {
    setPlatform('win32');
    process.env.NEXT_STANDALONE = '1';
    await expect(loadOutput()).resolves.toBe('standalone');
  });

  it('linux без env — output standalone', async () => {
    setPlatform('linux');
    delete process.env.NEXT_STANDALONE;
    await expect(loadOutput()).resolves.toBe('standalone');
  });

  it('win32 + NEXT_STANDALONE=0 — output undefined (форсирует только "1")', async () => {
    setPlatform('win32');
    process.env.NEXT_STANDALONE = '0';
    await expect(loadOutput()).resolves.toBeUndefined();
  });
});
