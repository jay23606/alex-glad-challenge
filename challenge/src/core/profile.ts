// Менеджер профилей: много профилей, активный один.
// Каждый профиль — .data/profiles/<name>.json.
// Структура: фиксированные поля + свободные заметки (notes).
// Заметки — массив произвольных строк: история, наблюдения, факты.
// Добавлять может как LLM (через /profile-edit), так и пользователь (/profile-note).
//
// Использование:
//   const mgr = new ProfileManager(dir);
//   mgr.load('default');
//   mgr.addNote('Автор ненавидит тренера сборной Англии');
//   await mgr.editViaLLM('смени клуб на Арсенал', client);

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ChatMessage } from './types.js';
import { msg } from './types.js';

export interface UserProfile {
  канал: string;      // название канала/блога: шапка поста и самоподача автора
  тематика: string;   // о чём канал — строка роли в system-промпте писателя
  любимый_клуб: string;
  стиль: string;
  формат_абзацев: string;
  эмодзи: string;
  длина_постов: string;
  подпись: string;
  табу: string;
  язык: string;
  приемы_юмора: string;
  notes: string[];
}

const DEFAULT_PROFILE: UserProfile = {
  канал: 'Иди на факты глянь',
  тематика: 'футбол: Челси и английская Премьер-лига',
  любимый_клуб: 'Челси',
  стиль: 'ироничный, резкий, с подколами',
  формат_абзацев: '2-4 предложения на абзац, пустая строка между ними',
  эмодзи: 'умеренно (🤣 😁 🙄 🔥)',
  длина_постов: '200-500 символов',
  подпись: '@lookatfacts',
  табу: 'без мата, без политики, без оскорблений игроков',
  язык: 'русский',
  приемы_юмора: '',
  notes: [],
};

const PROFILE_FIELDS = Object.keys(DEFAULT_PROFILE).filter((k) => k !== 'notes') as (keyof UserProfile)[];

export interface LlmClientLike {
  chat(messages: ChatMessage[], params?: { temperature?: number; maxTokens?: number }): Promise<string>;
}

export class ProfileManager {
  private dir: string;
  private _activeName: string | null = null;
  private _data: UserProfile = { ...DEFAULT_PROFILE, notes: [] };

  constructor(dir: string) {
    this.dir = dir;
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  get activeName(): string | null {
    return this._activeName;
  }

  get active(): UserProfile | null {
    return this._activeName ? this._data : null;
  }

  list(): string[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''))
      .sort();
  }

  load(name: string): boolean {
    const filePath = path.join(this.dir, `${name}.json`);
    if (!existsSync(filePath)) return false;
    try {
      const raw = readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      // Фиксированные поля: фильтруем, приводим к string.
      const cleaned: UserProfile = { ...DEFAULT_PROFILE, notes: [] };
      for (const key of PROFILE_FIELDS) {
        const val = parsed[key];
        if (val !== undefined) {
          (cleaned as unknown as Record<string, string>)[key] =
            Array.isArray(val) ? val.join(', ') : String(val);
        }
      }
      // Notes: массив произвольных строк.
      if (Array.isArray(parsed['notes'])) {
        cleaned.notes = (parsed['notes'] as unknown[]).map((n) => String(n));
      }
      this._data = cleaned;
      this._activeName = name;
      return true;
    } catch {
      return false;
    }
  }

  save(): void {
    if (!this._activeName) return;
    const filePath = path.join(this.dir, `${this._activeName}.json`);
    writeFileSync(filePath, JSON.stringify(this._data, null, 2), 'utf-8');
  }

  create(name: string, base?: Partial<UserProfile>): void {
    this._data = { ...DEFAULT_PROFILE, notes: base?.notes ?? [], ...stripNotes(base) };
    this._activeName = name;
    this.save();
  }

  copy(newName: string): boolean {
    if (!this._activeName) return false;
    this.create(newName, this._data);
    return true;
  }

  delete(name: string): boolean {
    if (name === this._activeName) return false;
    const filePath = path.join(this.dir, `${name}.json`);
    if (!existsSync(filePath)) return false;
    import('node:fs').then(({ unlinkSync }) => unlinkSync(filePath));
    return true;
  }

  get<K extends keyof UserProfile>(key: K): UserProfile[K] {
    return this._data[key];
  }

  set<K extends keyof UserProfile>(key: K, value: string): void {
    if (!PROFILE_FIELDS.includes(key)) {
      throw new Error(`Неизвестное поле: "${key}". Доступно: ${PROFILE_FIELDS.join(', ')}`);
    }
    (this._data as unknown as Record<string, string>)[key] = value;
  }

  reset(): void {
    this._data = { ...DEFAULT_PROFILE, notes: [] };
  }

  get fields(): (keyof UserProfile)[] {
    return PROFILE_FIELDS;
  }

  get notes(): string[] {
    return [...this._data.notes];
  }

  addNote(text: string): void {
    const trimmed = text.trim();
    if (trimmed) {
      this._data.notes.push(trimmed);
      this.save();
    }
  }

  removeNote(index: number): boolean {
    if (index < 0 || index >= this._data.notes.length) return false;
    this._data.notes.splice(index, 1);
    this.save();
    return true;
  }

  clearNotes(): void {
    this._data.notes = [];
    this.save();
  }

  snapshot(): UserProfile {
    return { ...this._data, notes: [...this._data.notes] };
  }

  toPromptText(): string {
    const lines = PROFILE_FIELDS.map((k) => `- ${k}: ${this._data[k]}`);
    if (this._data.notes.length > 0) {
      lines.push('');
      lines.push('Заметки и история:');
      for (const note of this._data.notes) {
        lines.push(`- ${note}`);
      }
    }
    return lines.join('\n');
  }

  toSystemBlock(): string {
    return `Профиль автора канала:\n${this.toPromptText()}`;
  }

  // Редактирование профиля естественным языком через LLM.
  // LLM может менять фиксированные поля И добавлять заметки.
  async editViaLLM(instruction: string, client: LlmClientLike): Promise<string> {
    const current = JSON.stringify(this._data, null, 2);
    const prompt = `Ты редактор профиля Telegram-канала.
Тебе передан текущий профиль в JSON и инструкция от пользователя.
Примени изменения и верни ОБНОВЛЁННЫЙ профиль в том же JSON-формате.

ПРАВИЛА:
- Верни СТРОГО JSON. ПЕРВЫЙ СИМВОЛ — "{".
- Сохраняй ВСЕ поля, даже если инструкция их не затрагивает.
- Поле "notes" — массив произвольных строк. Можешь:
  - добавлять новые заметки (если инструкция просит что-то запомнить),
  - изменять существующие,
  - НЕ удаляй заметки, если пользователь явно не просит.
- Не добавляй новые поля кроме существующих.

ТЕКУЩИЙ ПРОФИЛЬ:
${current}

ИНСТРУКЦИЯ ПОЛЬЗОВАТЕЛЯ:
${instruction}

ОБНОВЛЁННЫЙ ПРОФИЛЬ:`;

    const raw = await client.chat(
      [msg.user(prompt)],
      { temperature: 0.2, maxTokens: 2000 },
    );

    const updated = parseProfileJson(raw);
    if (!updated) {
      throw new Error('LLM вернул невалидный JSON профиля');
    }
    const changes: string[] = [];

    // Фиксированные поля.
    for (const key of PROFILE_FIELDS) {
      const val = (updated as Record<string, unknown>)[key];
      if (val !== undefined) {
        const strVal = Array.isArray(val) ? val.join(', ') : String(val);
        const oldVal = (this._data as unknown as Record<string, string>)[key];
        if (oldVal !== strVal) {
          changes.push(`  ${key}: "${oldVal}" → "${strVal}"`);
          (this._data as unknown as Record<string, string>)[key] = strVal;
        }
      }
    }

    // Notes.
    if (Array.isArray(updated['notes'])) {
      const oldNotes = this._data.notes;
      const newNotes = (updated['notes'] as unknown[]).map((n) => String(n));
      const added = newNotes.filter((n) => !oldNotes.includes(n));
      const removed = oldNotes.filter((n) => !newNotes.includes(n));
      if (added.length > 0) {
        changes.push(`  notes +${added.length}: ${added.map((n) => `"${n.slice(0, 50)}"`).join(', ')}`);
      }
      if (removed.length > 0) {
        changes.push(`  notes -${removed.length}: ${removed.map((n) => `"${n.slice(0, 50)}"`).join(', ')}`);
      }
      this._data.notes = newNotes;
    }

    this.save();

    if (changes.length === 0) return 'Без изменений';
    return changes.join('\n');
  }
}

function parseProfileJson(raw: string): Record<string, unknown> | null {
  const cleaned = raw.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function stripNotes(base?: Partial<UserProfile>): Partial<UserProfile> {
  if (!base) return {};
  const { notes: _notes, ...rest } = base;
  void _notes;
  return rest;
}
