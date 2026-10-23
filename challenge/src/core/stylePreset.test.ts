import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ANTONOV_SYSTEM_PROMPT,
  STYLE_PRESETS,
  presetSystemPrompt,
  resolveStylePreset,
  stylePresetLabel,
} from './stylePreset.js';

test('stylePreset: resolveStylePreset — только известные значения, остальное → default', () => {
  assert.equal(resolveStylePreset('antonov'), 'antonov');
  assert.equal(resolveStylePreset('default'), 'default');
  assert.equal(resolveStylePreset(null), 'default');
  assert.equal(resolveStylePreset(undefined), 'default');
  assert.equal(resolveStylePreset('antonov-full'), 'default');
  assert.equal(resolveStylePreset(''), 'default');
});

test('stylePreset: presetSystemPrompt — у default нет промпта, у antonov компактный промпт', () => {
  assert.equal(presetSystemPrompt('default'), null);
  const prompt = presetSystemPrompt('antonov');
  assert.ok(prompt);
  assert.equal(prompt, ANTONOV_SYSTEM_PROMPT);
  assert.match(prompt, /Перепиши текст пользователя/);
  assert.match(prompt, /Факты и цифры — только из исходника/);
});

test('stylePreset: реестр покрывает весь union, у каждого пресета есть label', () => {
  assert.deepEqual([...STYLE_PRESETS].sort(), ['antonov', 'default']);
  for (const preset of STYLE_PRESETS) {
    assert.ok(stylePresetLabel(preset).length > 0);
  }
});
