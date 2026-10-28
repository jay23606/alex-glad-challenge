// Header (server component). Админ: бренд + MobileNav + core-ссылки + статус активной
// модели + «Выйти». Гость (публичный лендинг, день 36): бренд + тихая «Войти» — БЕЗ
// core-ссылок, MobileNav и статуса модели (анти-утечка инфраструктуры на публичной
// странице; getKeysStatus в гостевой ветке не вызывается). Сервер-сайд: getKeysStatus
// отдаёт public-мету (provider/model), значения ключей NEVER не покидают lib/server/env.
import Link from 'next/link';
import { getKeysStatus } from '../../lib/server/env';
import { MobileNav } from './MobileNav';
import { NavCoreLinks } from './NavLinks';
import { LogoutButton } from './LogoutButton';
import { ThemeToggle } from './ThemeToggle';
import { NotificationBell } from './NotificationBell';

export default function Nav({ isAdmin = false }: { isAdmin?: boolean }) {
  const keys = isAdmin ? getKeysStatus() : null;
  const model =
    keys && keys.activeProvider && keys.activeModel
      ? { provider: keys.activeProvider, model: keys.activeModel }
      : null;
  return (
    <header className="sticky top-0 z-nav border-b border-line bg-surface/80 backdrop-blur">
      <div className="flex h-14 items-center justify-between px-5">
        <div className="flex items-center gap-1">
          {isAdmin && <MobileNav />}
          <Link href="/" className="font-sans text-sm font-semibold tracking-tight text-ink">
            Артемия Артель
            <span className="text-accent">·</span>
            <span className="text-dim">AI</span>
          </Link>
        </div>
        {isAdmin ? (
          <>
            <NavCoreLinks />
            <div className="flex items-center gap-3">
              {/* 640–1023px: блок статуса — главный виновник overflow строки h-14 →
                  скрыт до lg, на lg+ сжат с обрезкой (модель — не критичная инфа).
                  truncate стоит на внутреннем текстовом span: на блоке с inline-flex
                  ребёнком ellipsis не рисуется (клип без «…»). */}
              <div className="hidden max-w-[16rem] font-mono text-xs text-dim lg:block">
                {model ? (
                  <span className="inline-flex max-w-full items-center gap-1.5">
                    <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-ok" />
                    <span className="truncate">{model.provider} · {model.model}</span>
                  </span>
                ) : (
                  <span className="inline-flex max-w-full items-center gap-1.5">
                    <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-dim" />
                    <span className="truncate">no-key</span>
                  </span>
                )}
              </div>
              <NotificationBell />
              <ThemeToggle />
              <LogoutButton />
            </div>
          </>
        ) : (
          <nav className="flex items-center gap-1">
            <ThemeToggle />
            <Link
              href="/login"
              className="rounded-md px-2 py-1 text-sm text-dim transition-colors duration-150 hover:text-ink"
            >
              Войти
            </Link>
          </nav>
        )}
      </div>
    </header>
  );
}
