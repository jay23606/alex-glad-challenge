// E2E: шапка (Nav) без горизонтального overflow на узких десктопных ширинах
// 640–1024px (issue #106: блок статуса модели ломал строку h-14 на 640–671px).
// Проба — documentElement scrollWidth/clientWidth, паттерн demo.spec.ts:38-45;
// вход — UI-логин из helpers (пароль только fill, в вывод не попадает).
import { expect, test } from '@playwright/test';
import { login } from './helpers';

const WIDTHS = [640, 671, 767, 1024] as const;
const PAGES = ['/integrations', '/mcp/todos'] as const;

test.describe('Шапка: нет горизонтального скролла (640–1024px)', () => {
  for (const width of WIDTHS) {
    for (const pathname of PAGES) {
      test(`${width}px ${pathname}: scrollWidth − clientWidth ≤ 1`, async ({ page }) => {
        await login(page, pathname);
        await page.setViewportSize({ width, height: 800 });

        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(1);
      });
    }
  }

  test('640px: триггер мобильного меню виден (навигация не потеряна)', async ({ page }) => {
    await login(page, '/integrations');
    await page.setViewportSize({ width: 640, height: 800 });

    await expect(page.getByRole('button', { name: 'Меню' })).toBeVisible();
  });
});
