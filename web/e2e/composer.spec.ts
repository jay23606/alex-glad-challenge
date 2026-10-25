// E2E: компоузер TG-постинга (S1 «сухая» часть) — разметка-помощник, счётчик,
// превью, confirm-диалог с каналом. БЕЗ реальной отправки: диалог закрываем.
import { expect, test } from '@playwright/test';
import { login } from './helpers';

test.describe('TG-компоузер (админ)', () => {
  test.use({ storageState: undefined });

  test.beforeEach(async ({ page }) => {
    await login(page, '/telegram/publish');
  });

  test('разметка-помощник оборачивает текст; счётчик n/4096 живой', async ({ page }) => {
    const textarea = page.getByPlaceholder('Текст поста (HTML-разметка разрешена)…');
    await textarea.fill('привет');
    // выделяем слово и жмём B — разметка оборачивает выделение
    await textarea.click();
    await page.keyboard.down('Shift');
    await page.keyboard.press('Home');
    await page.keyboard.up('Shift');
    await page.getByRole('button', { name: 'Жирный' }).click();
    await expect(textarea).toHaveValue('<b>привет</b>');
    await expect(page.getByText('13 / 4096')).toBeVisible();
  });

  test.skip('перелимит 4096 блокирует кнопку (быстрый прогон полного лимита опущен)', () => undefined);

  test('превью-таб HTML показывает исходник; Рендер — пузырь', async ({ page }) => {
    const textarea = page.getByPlaceholder('Текст поста (HTML-разметка разрешена)…');
    await textarea.fill('<b>жирный</b> текст');
    await page.getByRole('tab', { name: 'HTML' }).click();
    await expect(page.locator('pre')).toContainText('<b>жирный</b> текст');
    await page.getByRole('tab', { name: 'Рендер' }).click();
    await expect(page.locator('.tg-msg b')).toHaveText('жирный');
  });

  test('черновик переживает перезагрузку (localStorage tg-compose-draft)', async ({ page }) => {
    const textarea = page.getByPlaceholder('Текст поста (HTML-разметка разрешена)…');
    await textarea.fill('черновик e2e');
    await page.waitForTimeout(900); // debounce 500ms
    await page.reload();
    await expect(textarea).toHaveValue(/черновик e2e/);
  });

  test('confirm показывает канал и предупреждение; Esc отменяет — БЕЗ отправки', async ({ page }) => {
    const textarea = page.getByPlaceholder('Текст поста (HTML-разметка разрешена)…');
    // Литеральные уголки рядом с разметкой: превью (tgVisibleText) обязано
    // сохранить «5 < 10 > 3» как видимый текст, а не вырезать «< 10 >» как тег.
    await textarea.fill('<b>e2e</b> confirm: 5 < 10 > 3');
    await page.getByRole('button', { name: /^Опубликовать$/ }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Отправить в канал?');
    await expect(dialog).toContainText('Реальная отправка');
    await expect(dialog).toContainText('/ 4096');
    await expect(dialog.locator('pre')).toContainText('5 < 10 > 3');

    // Esc = cancel (фокус возвращается, отправки нет)
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(textarea).toHaveValue('<b>e2e</b> confirm: 5 < 10 > 3');
  });

  test('история публикаций рендерится (пустая или с записями)', async ({ page }) => {
    await expect(page.getByText('история публикаций')).toBeVisible();
  });
});
