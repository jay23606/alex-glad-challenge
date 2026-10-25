// /style — публичная страница «Антоновайзер»: рерайт любого текста в стиле
// канала-инсайдера. Server Component по канону гостевых световых страниц
// (паттерн /demo): hero + aurora-блобы, «было → стало», единственный
// client-остров StyleForm, секция «как устроено», CTA-панель.
// Метаданные page-local, без openGraph.
import type { Metadata } from 'next';
import { SubscribeButton } from '../components/landing/SubscribeButton';
import { channel } from '../../data/landing';
import {
  styleCopy,
  styleExamples,
  styleHow,
  styleLead,
  styleMeta,
  styleProof,
  styleShowcase,
} from '../../data/style';
import { StyleForm } from './StyleForm';

export const metadata: Metadata = {
  title: styleMeta.title,
  description: styleMeta.description,
};

// Секционный лейбл светового мира — как на /demo (там не экспортирован).
function StyleLabel({ children }: { children: string }) {
  return (
    <div className="font-mono text-xs uppercase tracking-[0.22em] text-brand-600">
      {`// ${children}`}
    </div>
  );
}

export default function StylePage() {
  return (
    <div className="lp">
      {/* Hero: тезис + aurora-подложка — канон гостевых световых страниц */}
      <section className="relative overflow-hidden">
        <div className="lp-grid-bg absolute inset-0" aria-hidden="true" />
        <div className="lp-blob lp-blob-violet -top-24 right-[8%] h-80 w-80" aria-hidden="true" />
        <div className="lp-blob lp-blob-mint top-32 left-[-6%] h-72 w-72" aria-hidden="true" />

        <div className="relative mx-auto w-full max-w-6xl px-5 pb-10 pt-10 md:pb-12 md:pt-20">
          <StyleLabel>{styleLead.label}</StyleLabel>
          <h1 className="mt-4 max-w-[22ch] font-display text-[clamp(1.75rem,3.6vw,2.85rem)] font-bold leading-[1.1] tracking-tight text-p-ink">
            {styleLead.headline.split(' ').slice(0, 2).join(' ')}{' '}
            <span className="lp-gradient-text">{styleLead.headline.split(' ').slice(2).join(' ')}</span>
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-p-dim md:text-lg">
            {styleLead.subhead}
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            {styleProof.map((proof) => (
              <span key={proof} className="lp-chip">
                {proof}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Было → стало: показываем продукт до того, как гость что-то вставил */}
      <section className="relative">
        <div className="mx-auto w-full max-w-6xl px-5 pb-10 md:pb-14">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 className="font-display text-[clamp(1.25rem,2.4vw,1.75rem)] font-bold leading-tight tracking-tight text-p-ink">
              {styleShowcase.title}
            </h2>
            <p className="text-sm text-p-dim">{styleShowcase.subtitle}</p>
          </div>
          <div className="mt-5 grid items-start gap-3 md:grid-cols-2">
            <div className="rounded-[20px] border border-p-line bg-paper-2 p-5 md:p-6">
              <span className="font-mono text-xs uppercase tracking-[0.18em] text-p-dim">
                {styleShowcase.beforeLabel}
              </span>
              <p className="mt-3 text-sm leading-relaxed text-p-dim md:text-base">
                {styleShowcase.before}
              </p>
            </div>
            <div className="relative overflow-hidden rounded-[20px] border border-brand-500/40 bg-brand-500/10 p-5 md:p-6">
              <div className="lp-blob lp-blob-mint -right-8 -top-10 h-32 w-32" aria-hidden="true" />
              <div className="relative">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-xs uppercase tracking-[0.18em] text-brand-600">
                    {styleShowcase.afterLabel}
                  </span>
                  <span className="font-mono text-[11px] text-brand-600">
                    {styleShowcase.settings}
                  </span>
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-p-ink md:text-base">
                  {styleShowcase.after}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Форма (client-остров) */}
      <section className="relative">
        <div className="mx-auto w-full max-w-6xl px-5 pb-16 md:pb-20">
          <StyleForm examples={styleExamples} />
        </div>
      </section>

      {/* Как это устроено */}
      <section className="border-t border-p-line/70 bg-paper-2/60">
        <div className="mx-auto w-full max-w-3xl px-5 py-14 md:py-16">
          <h2 className="font-display text-[clamp(1.25rem,2.4vw,1.75rem)] font-bold leading-tight tracking-tight text-p-ink">
            {styleHow.title}
          </h2>
          <div className="mt-6 grid gap-5">
            {styleHow.steps.map((step, index) => (
              <div key={step.title} className="flex gap-4">
                <span className="font-mono text-sm font-semibold text-brand-600">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <div>
                  <h3 className="font-display text-base font-semibold text-p-ink">{step.title}</h3>
                  <p className="mt-1 text-[15px] leading-relaxed text-p-dim">{step.body}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-6 text-xs leading-relaxed text-p-dim">{styleCopy.noteBody}</p>
        </div>
      </section>

      {/* CTA — единственный конверсионный элемент страницы */}
      <section>
        <div className="mx-auto w-full max-w-6xl px-5 pb-20 md:pb-24">
          <div className="relative overflow-hidden rounded-[28px] bg-panel px-6 py-14 text-center text-white md:px-14 md:py-16">
            <div className="lp-blob lp-blob-violet left-1/2 -top-20 h-72 w-[36rem] -translate-x-1/2" aria-hidden="true" />
            <div className="lp-blob lp-blob-mint bottom-[-5rem] right-[-3rem] h-64 w-64" aria-hidden="true" />
            <div className="relative mx-auto max-w-2xl">
              <h2 className="font-display text-[clamp(1.5rem,3vw,2.25rem)] font-bold leading-tight tracking-tight">
                Понравился голос? Он звучит <span className="lp-gradient-text">каждый день</span>
              </h2>
              <p className="mt-4 text-sm leading-relaxed text-white/70 md:text-base">
                Свежие разборы, подколы и «быть добру» — в телеграме. Подписывайся.
              </p>
              <div className="mt-8 flex flex-col items-center gap-3">
                <SubscribeButton href={channel.url} label={channel.subscribeLabel} />
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
