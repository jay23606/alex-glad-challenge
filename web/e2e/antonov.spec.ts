// E2E студия канала /antonov (инструмент владельца, за auth). API
// /api/antonov/rewrite мокается через page.route: LLM — внешний эффект, как
// MTProto в rag-ingest (не гоняем). Проверяем: гость → /login; рендер формы;
// генерация с моком, история в localStorage переживает перезагрузку.
import { expect, test } from '@playwright/test';
import { login } from './helpers';

const MOCK_POST = 'Ну что, спишь?\n\nПарковка станет платной. Понимаю.\n\nДержать строй!';

test.describe('Студия Антонова /antonov (админ)', () => {
  test.use({ storageState: undefined });
  test.setTimeout(120_000); // dev-компиляция страницы на 3100

  test('гость → редирект на /login (auth-middleware, роут не публичный)', async ({ page }) => {
    await page.goto('/antonov');
    await expect(page).toHaveURL(/\/login/);
  });

  test('рендер: заголовок, textarea, режимы, формат, подпись, кнопка заблокирована до ввода', async ({
    page,
  }) => {
    await login(page, '/antonov');

    await expect(page.getByRole('heading', { name: 'Антонов такой Антонов', level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Канал ↗' })).toBeVisible();

    const textarea = page.getByLabel('Ваш текст');
    await expect(textarea).toBeVisible();

    const submit = page.getByRole('button', { name: 'Переписать' });
    await expect(submit).toBeDisabled();

    // Чип примера подставляет исходник → кнопка оживает.
    await page.getByRole('group', { name: 'Готовые истории' }).getByRole('button').first().click();
    await expect(textarea).not.toHaveValue('');
    await expect(submit).toBeEnabled();

    // Тон: radio-семантика, дефолт «По-свойски»; движок — дефолт «Облако».
    await expect(page.getByRole('radio', { name: 'По-свойски' })).toBeChecked();
    await page.getByRole('radio', { name: 'Разнести' }).click();
    await expect(page.getByRole('radio', { name: 'Разнести' })).toBeChecked();
    await expect(page.getByRole('radio', { name: 'Облако' })).toBeChecked();
    await page.getByRole('radio', { name: 'Локально' }).click();
    await expect(page.getByRole('radio', { name: 'Локально' })).toBeChecked();

    await expect(page.getByRole('radiogroup', { name: 'Формат' })).toBeVisible();
    await expect(page.getByLabel('Фирменная подпись')).toBeVisible();
  });

  test('генерация с моком (движок «Локально»): пост появляется, история переживает перезагрузку, restore и удаление', async ({
    page,
  }) => {
    await page.route('**/api/antonov/rewrite', async (route) => {
      const body = route.request().postDataJSON() as {
        text: string;
        mode: string;
        signature: boolean;
        llm: string;
      };
      expect(body.mode).toBe('hard');
      expect(body.signature).toBe(true);
      expect(body.llm).toBe('local');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, post: MOCK_POST, provider: 'local' }),
      });
    });
    await login(page, '/antonov');

    await page.getByLabel('Ваш текст').fill('Парковка у офиса станет платной с понедельника.');
    await page.getByRole('radio', { name: 'Разнести' }).click();
    await page.getByRole('radio', { name: 'Локально' }).click();
    await page.getByLabel('Фирменная подпись').check();
    await page.getByRole('button', { name: 'Переписать' }).click();

    await expect(page.getByText(MOCK_POST)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('heading', { name: 'история (последние 10)' })).toBeVisible();

    // Перезагрузка: история живёт в localStorage.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'история (последние 10)' })).toBeVisible();

    // Restore: клик по записи возвращает исходник и пост.
    await page.getByTitle('Открыть в студии').click();
    await expect(page.getByLabel('Ваш текст')).toHaveValue(
      'Парковка у офиса станет платной с понедельника.',
    );
    await expect(page.getByText(MOCK_POST)).toBeVisible();

    // Удаление записи убирает карточку истории.
    await page.getByRole('button', { name: 'Удалить из истории' }).click();
    await expect(page.getByRole('heading', { name: 'история (последние 10)' })).toBeHidden();
  });
});

const THREAD_POSTS = [
  'Перевожу для вас большой разбор TheNearPost. Дальше — от лица автора, я только перевожу. Поехали.',
  'Голос автора: факты, цифры, панч. Вот именно.',
  'Прим. переводчика: жёстко, но по делу.\n\nИсточник: TheNearPost. Перевод и адаптация — мои.',
];

test.describe('Студия /antonov — режим «Поток-перевод» (агент потока)', () => {
  test.use({ storageState: undefined });

  test('переключение режима показывает поля потока; мок /api/antonov/thread → серия постов со счётчиками', async ({
    page,
  }) => {
    await page.route('**/api/antonov/thread', async (route) => {
      const body = route.request().postDataJSON() as {
        text: string;
        author: string;
        source: string;
        images: string[];
        mode: string;
        llm: string;
      };
      expect(body.author).toBe('TheNearPost');
      expect(body.source).toBe('https://example.com/src');
      expect(body.images).toEqual(['схема центра поля']);
      expect(body.mode).toBe('hard');
      expect(body.llm).toBe('cloud');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, posts: THREAD_POSTS, provider: 'cloud' }),
      });
    });
    await login(page, '/antonov');

    // По умолчанию — одиночный пост; переключение на поток показывает его поля
    // и прячет формат/подпись одиночки.
    await expect(page.getByRole('radio', { name: 'Пост', exact: true })).toBeChecked();
    await page.getByRole('radio', { name: 'Поток-перевод' }).click();
    await expect(page.getByRole('radiogroup', { name: 'Формат' })).toBeHidden();
    await expect(page.getByLabel('Фирменная подпись')).toBeHidden();
    await expect(page.getByLabel('Автор оригинала')).toBeVisible();
    await expect(page.getByLabel('Ссылка на источник')).toBeVisible();
    await expect(page.getByLabel('Картинки — по одной в строке')).toBeVisible();

    await page.getByLabel('Ваш текст').fill('Длинный чужой разбор про полузащиту.');
    await page.getByLabel('Автор оригинала').fill('TheNearPost');
    await page.getByLabel('Ссылка на источник').fill('https://example.com/src');
    await page.getByLabel('Картинки — по одной в строке').fill('схема центра поля');
    await page.getByRole('radio', { name: 'Разнести' }).click();
    await page.getByRole('button', { name: 'Собрать поток' }).click();

    await expect(page.getByRole('heading', { name: /Поток · 3/i })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('heading', { name: 'пост 1', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'пост 3', exact: true })).toBeVisible();
    await expect(page.getByText(THREAD_POSTS[1]!)).toBeVisible();
    // Счётчик лимита ТГ у каждого поста.
    await expect(page.getByText(/ \/ 4096/).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Скопировать все' })).toBeVisible();
  });
});
