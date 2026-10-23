// Пресеты стиля блога: системный промпт, который PostWriter ставит поверх
// профиля голоса. 'default' — без пресета (старое поведение: профиль + few-shot).
// 'antonov' — компактная версия промпта из docs/auantonov-rewrite-prompt.md;
// текст зашит константой, md-файл в рантайме не читается.

export type StylePreset = 'default' | 'antonov';

export const STYLE_PRESETS: readonly StylePreset[] = ['default', 'antonov'];

export const ANTONOV_SYSTEM_PROMPT = `Перепиши текст пользователя в стиле телеграм-канала «инсайдер-практик»: умный
человек говорит как в гараже. Правила:
1. Факты и цифры — только из исходника, ничего не придумывай и не выбрасывай:
   счёт, имена и исходы событий остаются на своих местах. Ирония бьёт только в
   объекты авторской критики.
2. Позиция — в первом абзаце, уверенно, без «эксперты считают».
3. Длинный абзац → короткий удар отдельной строкой («Понимаю.» / «Нет.»).
4. КАПС 1–3 раза на ударения. Без жирного текста. Эмодзи максимум 1–2 (😀 🤣).
5. Разговорные слова: «ну», «типа», «прям», «короче», «блин». Мат — чуть-чуть
   и про ситуацию (если режим не МЯГКО).
6. Формулы: «Переведу на человеческий: …» · «Спрашивается, кому надо?» ·
   концовка — панч отдельной строкой или «Всё будет хорошо.»
7. Читателя не оскорблять. Панику гасить, а не нагнетать.
8. В ответе — только готовый пост, длина как в исходнике (±30%).`;

interface StylePresetDef {
  readonly label: string;
  readonly systemPrompt: string | null; // null = без пресета
}

const REGISTRY: Record<StylePreset, StylePresetDef> = {
  default: { label: 'По умолчанию (профиль + few-shot)', systemPrompt: null },
  antonov: { label: 'Антонов (инсайдер-практик)', systemPrompt: ANTONOV_SYSTEM_PROMPT },
};

// Неизвестное/пустое значение из БД → 'default' (пресет — opt-in, не ломаем легаси).
export function resolveStylePreset(value: string | null | undefined): StylePreset {
  return value === 'antonov' ? 'antonov' : 'default';
}

export function stylePresetLabel(preset: StylePreset): string {
  return REGISTRY[preset].label;
}

export function presetSystemPrompt(preset: StylePreset): string | null {
  return REGISTRY[preset].systemPrompt;
}
