// Общие контролы «Антоновайзера» для публичного /style (светлый мир .lp) и
// студии /antonov (тёмная админка). Один источник продуктовых формулировок:
// тон отвечает «как говорить с читателем», формат — «какая будет структура».
// Карточки примеров подставляют исходник и обе настройки разом — это и есть
// объяснение продукта без легенды из абстрактных «мягко/жёстко».
'use client';

import {
  styleCopy,
  styleEngines,
  styleFormats,
  styleToneLabel,
  styleFormatLabel,
  styleTones,
  type StyleExample,
  type StyleFormat,
  type StyleLlm,
  type StyleTone,
} from '../../../data/style';

type Variant = 'light' | 'dark';

interface PickerProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  variant?: Variant;
}

const LEGEND: Record<Variant, string> = {
  light: 'block font-mono text-xs uppercase tracking-[0.18em] text-p-dim',
  dark: 'font-mono text-xs uppercase tracking-wider text-dim',
};

const HINT: Record<Variant, string> = {
  light: 'mt-1.5 text-xs leading-relaxed text-p-dim',
  dark: 'mt-1.5 text-xs leading-relaxed text-dim',
};

const CARD_BASE =
  'rounded-xl border p-3 text-left transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

const CARD: Record<Variant, { idle: string; selected: string }> = {
  light: {
    idle: 'border-p-line bg-paper-2 hover:border-brand-300',
    selected: 'border-brand-500 bg-brand-500/15 shadow-lift',
  },
  dark: {
    idle: 'border-line bg-surface hover:border-accent-dim',
    selected: 'border-accent bg-accent/10',
  },
};

const FOCUS: Record<Variant, string> = {
  light: 'focus-visible:ring-brand-500 focus-visible:ring-offset-paper',
  dark: 'focus-visible:ring-accent focus-visible:ring-offset-bg',
};

const FOCUS_WITHIN: Record<Variant, string> = {
  light: 'focus-within:ring-2 focus-within:ring-brand-500 focus-within:ring-offset-2 focus-within:ring-offset-paper',
  dark: 'focus-within:ring-2 focus-within:ring-accent focus-within:ring-offset-2 focus-within:ring-offset-bg',
};

const TITLE: Record<Variant, string> = { light: 'text-p-ink', dark: 'text-ink' };
const DESC: Record<Variant, string> = { light: 'text-p-dim', dark: 'text-dim' };
const TAGLINE: Record<Variant, string> = {
  light: 'text-brand-600 dark:text-brand-300',
  dark: 'text-accent',
};

export function StyleTonePicker({ value, onChange, disabled, variant = 'light' }: PickerProps<StyleTone>) {
  return (
    <fieldset disabled={disabled}>
      <legend className={LEGEND[variant]}>{styleCopy.toneLabel}</legend>
      <p className={HINT[variant]}>{styleCopy.toneHint}</p>
      <div
        role="radiogroup"
        aria-label={styleCopy.toneLabel}
        className="mt-3 grid gap-2 sm:grid-cols-3"
      >
        {styleTones.map((tone) => {
          const selected = value === tone.id;
          return (
            <button
              key={tone.id}
              type="button"
              role="radio"
              aria-checked={selected}
              className={`${CARD_BASE} ${FOCUS[variant]} ${
                selected ? CARD[variant].selected : CARD[variant].idle
              }`}
              onClick={() => onChange(tone.id)}
            >
              <span className={`block text-sm font-semibold ${TITLE[variant]}`}>{tone.label}</span>
              <span className={`mt-0.5 block text-xs font-medium ${TAGLINE[variant]}`}>
                {tone.tagline}
              </span>
              <span className={`mt-1.5 block text-xs leading-relaxed ${DESC[variant]}`}>
                {tone.description}
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export function StyleFormatPicker({ value, onChange, disabled, variant = 'light' }: PickerProps<StyleFormat>) {
  return (
    <fieldset disabled={disabled}>
      <legend className={LEGEND[variant]}>{styleCopy.formatLabel}</legend>
      <p className={HINT[variant]}>{styleCopy.formatHint}</p>
      <div
        role="radiogroup"
        aria-label={styleCopy.formatLabel}
        className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3"
      >
        {styleFormats.map((format) => {
          const selected = value === format.id;
          return (
            <button
              key={format.id}
              type="button"
              role="radio"
              aria-checked={selected}
              className={`${CARD_BASE} ${FOCUS[variant]} ${
                selected ? CARD[variant].selected : CARD[variant].idle
              }`}
              onClick={() => onChange(format.id)}
            >
              <span className={`block text-sm font-semibold ${TITLE[variant]}`}>{format.label}</span>
              <span className={`mt-0.5 block text-xs font-medium ${TAGLINE[variant]}`}>
                {format.tagline}
              </span>
              <span className={`mt-1.5 block text-xs leading-relaxed ${DESC[variant]}`}>
                {format.description}
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export function StyleSignatureToggle({
  checked,
  onChange,
  disabled,
  variant = 'light',
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  variant?: Variant;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors duration-fast ${FOCUS_WITHIN[variant]} ${
        checked ? CARD[variant].selected : CARD[variant].idle
      } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
    >
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 accent-brand-600"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
      />
      <span>
        <span className={`block text-sm font-semibold ${TITLE[variant]}`}>
          {styleCopy.signatureLabel}
        </span>
        <span className={`mt-0.5 block font-mono text-xs ${DESC[variant]}`}>
          {`«${styleCopy.signaturePreview}»`}
        </span>
        <span className={`mt-1 block text-xs leading-relaxed ${DESC[variant]}`}>
          {styleCopy.signatureHint}
        </span>
      </span>
    </label>
  );
}

export function StyleEnginePicker({
  value,
  onChange,
  disabled,
  variant = 'light',
  hint,
}: PickerProps<StyleLlm> & { hint?: string }) {
  const active = styleEngines.find((engine) => engine.id === value);
  return (
    <fieldset disabled={disabled}>
      <legend className={LEGEND[variant]}>{styleCopy.llmLabel}</legend>
      <div
        role="radiogroup"
        aria-label={styleCopy.llmLabel}
        className={`mt-2 inline-flex rounded-full border p-1 ${
          variant === 'light' ? 'border-p-line bg-paper-2' : 'border-line bg-surface'
        }`}
      >
        {styleEngines.map((engine) => {
          const selected = value === engine.id;
          return (
            <button
              key={engine.id}
              type="button"
              role="radio"
              aria-checked={selected}
              className={`rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors duration-fast ${FOCUS[variant]} ${
                selected
                  ? variant === 'light'
                    ? 'bg-brand-600 text-white shadow-lift'
                    : 'bg-accent text-accent-ink'
                  : variant === 'light'
                    ? 'text-p-dim hover:text-brand-600'
                    : 'text-dim hover:text-ink'
              }`}
              onClick={() => onChange(engine.id)}
            >
              {engine.label}
            </button>
          );
        })}
      </div>
      <p className={HINT[variant]}>
        {active?.hint ?? ''}
        {hint !== undefined ? ` · ${hint}` : ''}
      </p>
    </fieldset>
  );
}

export function StyleExampleCards({
  examples,
  onApply,
  disabled,
  variant = 'light',
  appliedLabel,
}: {
  examples: readonly StyleExample[];
  onApply: (example: StyleExample) => void;
  disabled?: boolean;
  variant?: Variant;
  appliedLabel?: string | null;
}) {
  return (
    <div className="mt-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className={`font-display text-base font-semibold ${TITLE[variant]}`}>
          {styleCopy.examplesTitle}
        </h3>
        <p className={`text-xs ${DESC[variant]}`}>{styleCopy.examplesHint}</p>
      </div>
      <div
        role="group"
        aria-label={styleCopy.examplesLabel}
        className="mt-3 grid gap-2 md:grid-cols-2"
      >
        {examples.map((example, index) => (
          <button
            key={example.title}
            type="button"
            disabled={disabled}
            onClick={() => onApply(example)}
            className={`${CARD_BASE} ${FOCUS[variant]} flex h-full flex-col ${
              variant === 'light'
                ? 'border-p-line bg-paper hover:border-brand-300'
                : 'border-line bg-surface hover:border-accent-dim'
            }`}
          >
            <span className="flex items-start justify-between gap-3">
              <span className={`font-mono text-[11px] uppercase tracking-[0.16em] ${TAGLINE[variant]}`}>
                {`история ${String(index + 1).padStart(2, '0')}`}
              </span>
              <span className={`shrink-0 text-right font-mono text-[11px] ${DESC[variant]}`}>
                {example.outcome}
              </span>
            </span>
            <span className={`mt-1.5 block text-sm font-semibold ${TITLE[variant]}`}>
              {example.title}
            </span>
            <span className={`mt-1 block text-xs leading-relaxed ${DESC[variant]}`}>
              {`Настроение: ${example.mood}`}
            </span>
            <span className={`mt-2 line-clamp-2 block text-xs leading-relaxed ${DESC[variant]} opacity-80`}>
              {example.text}
            </span>
            <span className={`mt-auto block pt-2 font-mono text-[11px] ${TAGLINE[variant]}`}>
              {`подставить: тон «${styleToneLabel(example.tone)}» · формат «${styleFormatLabel(example.format)}»`}
            </span>
          </button>
        ))}
      </div>
      {appliedLabel !== null && appliedLabel !== undefined && (
        <p className={`mt-2 text-xs ${DESC[variant]}`} aria-live="polite">
          {appliedLabel}
        </p>
      )}
    </div>
  );
}
