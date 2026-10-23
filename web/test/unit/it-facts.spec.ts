// Контракты клиент-безопасного набора IT-фактов (отбивка ожидания на /joker).

import { describe, expect, it } from 'vitest';

import { IT_FACTS } from '../../lib/shared/it-facts';

describe('IT_FACTS', () => {
  it('набор непустой и достаточно большой для ротации', () => {
    expect(IT_FACTS.length).toBeGreaterThanOrEqual(10);
  });

  it('все факты — непустые строки без HTML (интерполяция без dangerouslySetInnerHTML)', () => {
    for (const fact of IT_FACTS) {
      expect(typeof fact).toBe('string');
      expect(fact.trim().length).toBeGreaterThan(0);
      expect(fact).not.toContain('<');
    }
  });

  it('факты уникальны (без дублей при ротации)', () => {
    expect(new Set(IT_FACTS).size).toBe(IT_FACTS.length);
  });
});
