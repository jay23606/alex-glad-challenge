// E2E: блог — список (таблица/TG-статусы), карточка поста, удаление до confirm
// (БЕЗ подтверждения удаления — данные не трогаем).
import { expect, test } from '@playwright/test';
import { login } from './helpers';

test.describe('Блог (админ)', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, '/blog/posts');
  });

  test('список постов: заголовок, колонки таблицы с TG-статусами', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Посты блога' })).toBeVisible();

    const table = page.locator('table');
    const isEmpty = await page.getByText('Постов пока нет').isVisible().catch(() => false);
    if (!isEmpty) {
      await expect(table).toBeVisible();
      await expect(page.getByRole('columnheader', { name: 'telegram' })).toBeVisible();
    }
  });

  test('управление блогами: шпаргалка и раскрываемая TG-команда', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/blog/settings');

    await expect(page.getByRole('heading', { name: 'Управление блогами' })).toBeVisible();
    await expect(page.getByText('шпаргалка · как пользоваться')).toBeVisible();
    await expect(page.getByText('Выберите блог', { exact: true })).toBeVisible();
    await expect(page.getByText('Задайте расписание')).toBeVisible();

    const summary = page.getByText('Telegram-команда и частые вопросы');
    await expect(summary).toBeVisible();
    await summary.click();

    await expect(
      page.getByText('/пост <блог> [publish] <тема> [| комментарий]'),
    ).toBeVisible();
    await expect(page.getByText(/Публикуется только первый вариант/)).toBeVisible();
  });

  test('карточка поста: textarea со счётчиком, toolbar, verdict', async ({ page }) => {
    await page.goto('/blog/posts');
    const firstPost = page.locator('a[href^="/blog/posts/"]').first();
    await firstPost.click();
    await page.waitForURL(/\/blog\/posts\/\d+/);

    await expect(page.getByRole('heading', { name: /Пост #\d+/ })).toBeVisible();
    const textarea = page.locator('textarea');
    await expect(textarea).toBeVisible();
    await expect(page.getByText(/\/ 4096/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Опубликовать в Telegram/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Удалить' })).toBeVisible();
  });

  test('удаление останавливается на danger-confirm (Отмена) — данные не трогаем', async ({ page }) => {
    await page.goto('/blog/posts');
    await page.locator('a[href^="/blog/posts/"]').first().click();
    await page.waitForURL(/\/blog\/posts\/\d+/);
    const urlBefore = page.url();

    await page.getByRole('button', { name: 'Удалить' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('безвозвратно');
    await page.getByRole('button', { name: 'Отмена' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(page.url()).toBe(urlBefore);
  });

  test('правка textarea включает Сохранить и Откатить', async ({ page }) => {
    await page.goto('/blog/posts');
    await page.locator('a[href^="/blog/posts/"]').first().click();
    await page.waitForURL(/\/blog\/posts\/\d+/);

    const save = page.getByRole('button', { name: 'Сохранить' });
    const revert = page.getByRole('button', { name: 'Откатить' });
    const textarea = page.locator('textarea');

    // Контент загружен в контролируемый textarea
    await expect(textarea).toHaveValue(/.+/);
    const original = await textarea.inputValue();
    await expect(save).toBeDisabled();
    await expect(revert).toBeDisabled();

    // Правка через клавиатуру: в конец текста + хвост
    await textarea.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' e2e-правка');
    await expect(textarea).toHaveValue(original + ' e2e-правка');
    await expect(save).toBeEnabled();
    await expect(revert).toBeEnabled();

    await revert.click(); // откат — изменения не сохраняем
    await expect(textarea).toHaveValue(original);
    await expect(save).toBeDisabled();
    await expect(revert).toBeDisabled();
  });
});
