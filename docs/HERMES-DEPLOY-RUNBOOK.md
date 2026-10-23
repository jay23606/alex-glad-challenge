# HERMES-DEPLOY-RUNBOOK — развёртывание alex-glad-challenge + деплой web/

> Исполняемый рукабук для оператора **Hermes**. Действовать строго сверху вниз.
> Каждая команда — bash на Linux-сервере, трассируется к реальному коду репо
> (ветка `day-30`). После каждого блока — **verify-гейт** (не пропускать).
> На каждой 🔴 **СТОП**-точке — пауза и ручное решение.
>
> Версия стека: pnpm 10.28.0 workspace (2 сиблинга: `challenge/` + `web/`),
> Node 24+, TypeScript strict ESM, SQLite через нативный `node:sqlite` (WAL).

---

## 0. Кому и как пользоваться

- **Оператор:** Hermes. Shell: `bash`. ОС сервера: детектить на Фазе 1.
- **Линейность:** идти строго по фазам 1 → 9. Не прыгать вперёд. Каждая фаза
  заканчивается verify-гейтом; не прошёл — откат (rollback в конце фазы) или СТОП.
- **Команды исполняемые:** пути, порты, переменные взяты из реального кода
  (`challenge/package.json`, `web/package.json`, `web/next.config.ts`,
  `challenge/src/core/env.ts`, `paths.ts`, `cli.ts`, `web/lib/server/*`). Никаких
  выдуманных скриптов. `challenge/` запускается через `tsx` напрямую — **шага сборки
  нет by design**, `pnpm build`/`pnpm test`/`lint` для `challenge/` **не существуют**
  и не вызываются.
- **Красные маркеры:** 🔴 **СТОП** — пауза, требуется человек; 🛑 — запрет (security).

---

## 1. Архитектура того, что ставим (краткая карта)

```
        Internet (браузер Hermes)
           │
           │ https://<DOMAIN>/  ──TLS──┐
           ▼                            │
   ┌───────────────────────────┐        │
   │ reverse-proxy             │ :80 → :443 редирект
   │ (Caddy ИЛИ nginx)         │ :443 TLS + basic-auth + headers
   │ Let's Encrypt             │ + rate-limit (опц.)
   └─────────────┬─────────────┘
                 │ proxy_pass http://127.0.0.1:<WEB_PORT>
                 ▼
   ┌─────────────────────────────────────────────────────┐
   │ web/ Next.js 15 standalone  127.0.0.1:<WEB_PORT>    │ systemd: alexglad-web
   │ (pnpm --filter web start = next start -H 127.0.0.1) │
   │  ─ server-only chokepoint web/lib/server/challenge  │
   │  ─ 31 Route Handler в web/app/api/** (тяжёлые:      │
   │    blog/pipeline, rag/index*, tg/collect, agent)    │
   └────────────┬────────────────────────────────────────┘
                │ единый .env в КОРНЕ репо (loadEnvUpward)
                │ общий challenge/.data/*.sqlite (WAL)
        ┌───────┴────────┬──────────────────┬───────────────┐
        ▼                ▼                  ▼               ▼
  challenge/ CLI     Ollama            Telegram          (опц.)
  tsx oneshot/      127.0.0.1:11434    MTProto +         MCP HTTP / PRIVATE_LLM
  systemd-timer     qwen3.5:4b +       Bot API           127.0.0.1:3001/3021/3030
  (news, db-stats,  qwen3-embedding    через прокси/     (не нужны web/; day-30 —
   rag, tg-collect)                    туннель            demo, см. Фаза 5/7)
```

**Базовый деплой (definition of done):** `web/` на loopback + reverse-proxy
(TLS + basic-auth). Ollama/Telegram/MCP — опциональны, включаются по потребности.

**Ключевые архитектурные факты (из кода):**
- `challenge/` и `web/` — сиблинги в pnpm-workspace. `web/next.config.ts` имеет
  `transpilePackages: ['challenge']` — TS-исходники `challenge/src` компилируются
  SWC в граф `web`. Отдельного шага сборки `challenge/` нет.
- **Server-only chokepoint:** `web/lib/server/challenge.ts:9` (`import 'server-only'`)
  — единственный легальный путь импорта `@challenge/core/*` в `web/`. Client-компонент
  физически не сможет его импортнуть. Client берёт только из `web/lib/shared/*`.
- **Единый `.env` в корне репо:** `loadEnvUpward()` (`challenge/src/core/env.ts`)
  идёт от `process.cwd()` вверх до 6 уровней. Из `web/` поднимется в корень репо.
- **`challenge/.data/`** — общий каталог runtime: `blog/rag/dialog/tg/todos.sqlite`
  (у каждого `-wal`/`-shm`), `tg-session.json` (MTProto session = СЕКРЕТ),
  `memory.json`, `profiles/`. Всё вне git (`.gitignore: challenge/.data/`).
  `DATA_DIR` (`challenge/src/core/paths.ts`) считается от расположения `paths.ts` —
  **cwd-независимый**, override через `CHALLENGE_DATA_DIR`.
- **Публичный периметр = reverse-proxy.** В `web/` **нет** `middleware.ts` и нет
  app-level auth на 31 Route Handler. Всё держится на `bind 127.0.0.1` + basic-auth
  на proxy. 🛑 Голый `0.0.0.0` без auth/TLS — СТОП (триггер обязательного возражения).

---

## 2. Решения по гэпам (явные, с обоснованием)

> Все правки кода, упомянутые здесь, **уже применены в working-tree ветки `day-30`**
> (`git status` показывает `M web/next.config.ts`, `M web/package.json`).
> Оркестратор коммитит их отдельным коммитом с префиксом `day-30:`. Рукабук ниже
> ссылается на `pnpm --filter web build` / `pnpm --filter web start` как на
> **имеющиеся** скрипты. Если патч по какой-то причине откатился — дословный патч в
> приложении **A** в конце файла воспроизводит его.

### Гэп №1 — `web/package.json` без `build`/`start`
**Решение:** добавить скрипты `build` (`next build`) и `start`
(`next start -H 127.0.0.1`) в `web/package.json`.
**Обоснование:**
1. CLAUDE.md (тулчейн-таблица) закрепляет `pnpm --filter web build` /
   `pnpm --filter web start` как канонические команды — они обязаны существовать.
2. `start: next start -H 127.0.0.1` — **loopback вшит в скрипт** (security-by-default):
   оператор не сможет случайно стартовать на `0.0.0.0`. Этот приём уже применён для
   `dev` (`next dev -H 127.0.0.1`).
3. Параметризация сохраняется: порт через `pnpm --filter web start -- -p 3100`.
4. Минимальность: две строки, без обвязки (prebuild/postbuild и т.п.).

### Гэп №2 — `output: 'standalone'` в `web/next.config.ts`
**Решение:** добавить `output: 'standalone'` (одна строка + комментарий).
**Обоснование:**
1. CLAUDE.md требует: «Production build: `pnpm --filter web build` с
   `output: 'standalone'` (артефакты в `web/.next/standalone/`)».
2. `serverExternalPackages` (7 пакетов) + `outputFileTracingRoot` уже настроены —
   это половина standalone-конфигурации; флаг — последняя недостающая часть.
3. Не вредит `next dev`. Артефакт самоочищается через `.gitignore` (`web/.next/`).

### Гэп №3 — Win-dev → Linux-server
**Решение:**
- `.mcp.json` использует `"command": "npx.cmd"` (Windows). **Не трогать:** на
  прод-сервере `.mcp.json` не активен (это конфиг оркестратора Claude Code на
  dev-машине, не server-runtime). Замена сломает desktop.
- `core.autocrlf=true` (Win-dev), `.gitattributes` отсутствует. На сервере после
  `git clone`: `git config core.autocrlf input && git config core.eol lf`. Для
  `tsx`/`next` CRLF безопасен (JS-парсеры переваривают), но гигиена LF — на всякий.
- `outputFileTracingRoot: path.resolve(__dirname, '..')`, `extensionAlias`, `transpilePackages`
  — **кроссплатформенные**, переносятся на Linux без правок (`__dirname` вычисляется
  runtime; комментарий про `E:\IT\package-lock.json` — Win-специфика, на Linux этого
  файла нет, но явный `outputFileTracingRoot` всё равно нужен и работает).

### Гэп №4 — Инициализация `.data/` с нуля
**Решение:** SQLite-базы **самоинициализируются** при первом открытии (идиома
`mkdirSync({recursive}) → new DatabaseSync → PRAGMA journal_mode=WAL →
CREATE TABLE IF NOT EXISTS`). Внешних миграций нет. Базовый smoke:
`pnpm --filter challenge start -- seed-style` (создаст `blog.sqlite` + образцы
стиля) → `db-stats`. **RAG-индекс `rag.sqlite` — read-only артефакт ручной сборки**:
на свежем сервере перенести с dev-машины через scp (вне git), НЕ реиндексировать.

### Гэп №5 — Сосуществование (на сервере уже много чего крутится)
**Решение:** Фаза 1 — обязательный зондинг `ss -tlnp` ДО установки. alex-glad
занимает свой диапазон loopback: web=`3000`, MCP=`3001/3021/3022`, PRIVATE_LLM=`3030`,
Ollama=`11434`. Все bind **только `127.0.0.1`**. Публично торчит лишь reverse-proxy
на `:80/:443`. Если порт занят — выбрать свободный и зафиксировать в env/юните/proxy.

### Гэп №6 — MTProto-сессия `TG_SESSION` / `tg-session.json`
**Решение:** Сессия = credentials userbot-аккаунта. Перенос **только** защищённо
(scp с шифром `aes256-gcm`, из secrets/dev-машины), 🛑 **НЕ через git/лог/промпт/
субагента**. На сервере — `chmod 600`. `env.ts` отдаёт session только в gramjs,
в error/логи попадают только имена переменных. Рекомендация: `tg-session.json`
(в `.data/`, уже в `.gitignore`) — сессия не лежит в `.env`.

### Гэп №7 — Публичный доступ к `web/`
**Решение:** `bind 127.0.0.1` + reverse-proxy (Caddy рекомендуется для fresh-deploy:
авто-TLS из Let's Encrypt, ~10 строк конфига; nginx — если уже стоит как системный
proxy) с TLS + basic-auth (bcrypt, пароль ≥16 символов) + security-headers.
🛑 `next start -H 0.0.0.0` / `node web/.next/standalone/web/server.js` без `HOSTNAME=127.0.0.1`
без reverse-proxy = **СТОП**.

---

## 3. Фаза 1 — Зонд сервера (ДО установки)

> Все команды read-only, безопасны для работающих сервисов. Цель: понять ОС,
  наличество Node/pnpm/proxy/Ollama, занятые порты, ресурсы.

```bash
# 0. Кто мы, ОС, архитектура (детект дистриба → выбор package-manager)
whoami; id
uname -a
cat /etc/os-release          # ID=debian|ubuntu|fedora VERSION_ID=...

# 1. Node 24+ / pnpm 10.x / corepack
node -v 2>/dev/null     || echo "NODE: нет"
pnpm -v 2>/dev/null     || echo "PNPM: нет"
corepack --version 2>/dev/null || echo "COREPACK: нет"

# 2. Reverse-proxy
nginx -v 2>/dev/null    || echo "NGINX: нет"
caddy version 2>/dev/null || echo "CADDY: нет"

# 3. Внешние сервисы (Ollama)
ollama --version 2>/dev/null || echo "OLLAMA: нет"
curl -sS -m 3 http://127.0.0.1:11434/api/tags || echo "OLLAMA endpoint: нет/пуст"

# 4. Занятые порты — КРИТИЧНО для сосуществования
ss -tlnp | grep -E ':(80|443|3000|3001|3021|3022|3030|11434)\b' || echo "целевые порты свободны"
ss -tlnp | head -40          # полная картина — что уже слушает

# 5. Git, certbot, socat (для TG-туннеля)
git --version
certbot --version 2>/dev/null || echo "CERTBOT: нет"
socat -V 2>/dev/null | head -1 || echo "SOCAT: нет"

# 6. Ресурсы (Ollama: см. Фазу 5 — нужно ≥8 ГБ RAM под qwen3.5:4b+embed)
df -h / /opt 2>/dev/null
free -h
nproc

# 7. Firewall
sudo -n ufw status 2>/dev/null || sudo -n iptables -L INPUT -n 2>/dev/null | head -20 \
  || echo "FIREWALL: нужен sudo (зонд — пропускаем)"

# 8. init-система (ожидаем systemd)
ps -p 1 -o comm=
systemctl --version | head -1

# 9. Доступ к Google Fonts при build (next/font/google тянет IBM Plex)
curl -sI -m 5 https://fonts.googleapis.com/ | head -1 || echo "WARN: fonts.googleapis.com недоступен — next build упадёт"
```

**Verify-гейт:** заполнить таблицу (каждая строка → решение):

| Компонент | Есть? | Действие |
|---|---|---|
| Node 24+ | да/нет | нет → Фаза 2 установка (nvm или NodeSource) |
| pnpm 10.28.0 | да/нет | нет → `corepack enable && corepack prepare pnpm@10.28.0 --activate` |
| systemd | да/нет | да → юниты Фазы 7; нет (контейнер) → альтернатива `pm2`/`screen` (вне рукабука) |
| nginx **или** Caddy | один/оба/нет | стоит → добавим site (Фаза 8); оба нет → ставим **Caddy** |
| `:80`/`:443` заняты | да/нет | да → это чужой proxy, интегрируемся shared-vhost; нет → наш Caddy слушает |
| `:3000` свободен | да/нет | занят → выберем `<WEB_PORT>` (напр. 3100), фиксируем в env/юните/proxy |
| Ollama | да/нет | есть → `ollama pull` (Фаза 5); нет → решаем: ставить или local-LLM off |
| RAM ≥ 8 ГБ | да/нет | <8 ГБ → local-LLM off, RAG через cloud-LLM |
| fonts.googleapis.com | да/нет | нет → build упадёт, нужен исходящий HTTPS |

🔴 **СТОП-точки Фазы 1:**
- `:80`/`:443` заняты чужим сервисом, владельца не согласовали → пауза.
- systemd отсутствует → рукабук далее предполагает systemd; согласовать альтернативу.
- `fonts.googleapis.com` недоступен → build web/ упадёт; обсудить (self-host шрифтов — отдельная задача).

**Rollback:** фаза только для чтения — отката не требует.

---

## 4. Фаза 2 — Подготовка окружения

Цель: юзер без sudo, каталог по FHS, клон репо, Node/pnpm нужных версий.

```bash
# 1. Юзер/группа без sudo (service-user). Shell /bin/bash — чтобы оператор мог
#    sudo -u гнать CLI вручную; home отдельный от repo.
sudo useradd --system --create-home --shell /bin/bash --home-dir /opt/alexglad alexglad

# 2. Каталог repo (FHS /opt — self-contained стороннее приложение)
sudo mkdir -p /opt/alex-glad-challenge
sudo chown alexglad:alexglad /opt/alex-glad-challenge

# 3. Клонирование от имени alexglad
sudo -u alexglad git clone <REPO_URL> /opt/alex-glad-challenge
cd /opt/alex-glad-challenge
sudo -u alexglad git checkout day-30      # после squash-merge в main — checkout main

# 4. CRLF-гигиена (гэп №3): на Linux держим LF
sudo -u alexglad git config core.autocrlf input
sudo -u alexglad git config core.eol lf

# 5. Node 24 + pnpm 10.28.0 под alexglad (nvm — без системного root)
sudo -u alexglad bash -c '
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  source "$HOME/.nvm/nvm.sh"
  nvm install 24 && nvm alias default 24
  corepack enable
  corepack prepare pnpm@10.28.0 --activate
  node -v; pnpm -v
'
# Ожидание: node v24.x; pnpm 10.28.0
```

> **Альтернатива (чище для systemd):** NodeSource-пакет системно
> (`deb.nodesource.com/node_24.x`) — тогда `/usr/bin/node` в PATH юнита без nvm-shim.
> Рекомендуется для прода; ниже в юнитах даю оба варианта (системный Node = основной).

**Verify-гейт:**
```bash
sudo -u alexglad bash -c 'source "$HOME/.nvm/nvm.sh" && node -v && pnpm -v'
# ожидание: v24.x.x AND 10.28.0
test -d /opt/alex-glad-challenge/.git && echo "OK: repo cloned"
sudo -u alexglad git -C /opt/alex-glad-challenge status --porcelain   # чисто (или только M web/* если ещё не закоммичено)
```

🔴 **СТОП-точка:** если `<REPO_URL>` требует приватного ключа — согласовать доступ
(deploy-key или HTTPS-токен в git-credential helper, НЕ в коммите).

**Rollback:**
```bash
sudo rm -rf /opt/alex-glad-challenge
sudo userdel -r alexglad 2>/dev/null || true
```

---

## 5. Фаза 3 — Секреты и `.env`  🔴 СТОП-точка (секреты)

Цель: минимальный `.env` в **корне репо**, защитить `.data/`.

```bash
cd /opt/alex-glad-challenge

# .env — в КОРНЕ репо (loadEnvUpward поднимется из web/ сюда). Права 600.
sudo -u alexglad cp .env.example .env
sudo chmod 600 .env
sudo chown alexglad:alexglad .env

# .data/ — создаётся (БД самоинициализируются при первом запуске, миграций нет).
# Явно создать — для прав и для переноса артефактов.
sudo -u alexglad mkdir -p challenge/.data
sudo chmod 700 challenge/.data
sudo chown alexglad:alexglad challenge/.data
```

Hermes **вручную** вписывает значения в `.env` (рукабук их НЕ содержит — только
имена переменных из `.env.example` + `challenge/src/core/env.ts`):

| Переменная | Назначение | Обязательность |
|---|---|---|
| `OPENROUTER_API_KEY` | cloud-LLM (приоритет) | 1 из 2 cloud — для CLI-демок `latest`/`chat` |
| `DEEPSEEK_API_KEY` | cloud-LLM (fallback) | 1 из 2 cloud |
| `LOCAL_LLM_BASE_URL` | Ollama: `http://127.0.0.1:11434/v1` | для RAG/chat local |
| `LOCAL_LLM_MODEL` | напр. `qwen3.5:4b` | для local |
| `LOCAL_EMBED_BASE_URL` | Ollama: `http://127.0.0.1:11434/v1` | для RAG |
| `LOCAL_EMBED_MODEL` | напр. `qwen3-embedding` (тег = как на dev!) | для RAG |
| `TG_API_ID` / `TG_API_HASH` | MTProto userbot | для TG-scan |
| `TG_SESSION` | MTProto-сессия (или файл `.data/tg-session.json`) | для TG-scan, 🔴 критична |
| `TG_TUNNEL_HOST` / `TG_TUNNEL_PORT` | def `91.199.147.131:8081` | если прямой маршрут к DC заблокирован |
| `TG_BOT_TOKEN` / `TG_CHAT_ID` | Bot API (публикация) | для публикации |
| `MCP_AUTH_TOKEN` | bearer на MCP HTTP-серверах | если поднимаете MCP (опц.) |
| `MCP_SERVER_URL` | URL MCP-сервера для `/api/mcp/call` | если нужно (в `.env.example` нет, добавить) |
| `PRIVATE_LLM_PORT` (def 3030) / `PRIVATE_LLM_AUTH_TOKEN` | gateway (day-30 — demo, см. гэп ниже) | опц., НЕ для базового деплоя |
| `HTTPS_PROXY` | HTTP-прокси для Bot API (`undici.ProxyAgent`) | если api.telegram.org заблокирован |

🔴 **СТОП-точки (Hermes пауза):**
1. Вписать cloud-ключ LLM (`OPENROUTER_API_KEY=` или `DEEPSEEK_API_KEY=`) — минимум для smoke.
2. Перенос MTProto-сессии — осознанное действие (credentials userbot-аккаунта):
   ```bash
   # С dev-машины (где логинились userbot-ом) — scp с шифром, минуя git/лог:
   scp -c aes256-gcm@openssh.com /path/to/tg-session.json \
       alexglad@SERVER:/opt/alex-glad-challenge/challenge/.data/tg-session.json
   # На сервере:
   sudo chmod 600 challenge/.data/tg-session.json
   sudo chown alexglad:alexglad challenge/.data/tg-session.json
   ```
   🛑 НЕ вставлять `TG_SESSION` в чат/промпт/аргумент субагента. Если используется
   `tg-session.json` — `TG_SESSION` в `.env` оставить пустым.
3. (Опц.) Перенос `rag.sqlite` — если нужен RAG over docs с готовым индексом:
   ```bash
   scp -c aes256-gcm@openssh.com challenge/.data/rag.sqlite \
       alexglad@SERVER:/opt/alex-glad-challenge/challenge/.data/rag.sqlite
   ```
   🛑 **НЕ реиндексировать** `rag.sqlite` без явного запроса (read-only артефакт;
   векторы фиксированы под embed-модель — dim должен совпасть).

**Verify-гейт:**
```bash
test "$(stat -c %a .env)" = "600" && echo "OK: .env 600"
sudo -u alexglad bash -c 'source "$HOME/.nvm/nvm.sh" && cd /opt/alex-glad-challenge && \
  pnpm --filter challenge start -- db-stats'
# Ожидание: news: 0 / posts: 0 / style_samples: 0  (создаст blog.sqlite, вернёт нули)
# Если упало на typecheck/env — НЕ двигаться дальше.
```

**Rollback:**
```bash
sudo rm -f .env challenge/.data/*.sqlite* challenge/.data/tg-session.json
```

---

## 6. Фаза 4 — Установка `challenge/` и smoke CLI

Цель: зависимости, typecheck-гейт, первичная инициализация `.data/`.

```bash
cd /opt/alex-glad-challenge
sudo -u alexglad bash -c 'source "$HOME/.nvm/nvm.sh" && \

  # 1. Зависимости workspace (оба пакета). devDeps ОБЯЗАТЕЛЬНЫ — tsx, typescript.
  #    НЕ ставить --prod: pnpm --filter challenge start идёт через tsx (devDep).
  pnpm install --prod=false && \

  # 2. Проверка нативных опциональных (onlyBuiltDependencies: bufferutil,
  #    es5-ext, esbuild, utf-8-validate — для telegram/ws/tailwind).
  ls node_modules/.pnpm | grep -E "bufferutil|utf-8-validate|esbuild" \
    && echo "OK: native optional built" \
    || echo "WARN: native optional не собрались (ws fallback на JS, не блокер)" && \

  # 3. СТАТИЧЕСКИЙ ГЕЙТ — СТРОГО зелёный (единственный статический гейт проекта)
  pnpm --filter challenge typecheck && \

  # 4. Smoke CLI (без секретов/LLM):
  pnpm --filter challenge start -- list         && \
  pnpm --filter challenge start -- db-stats     && \
  pnpm --filter challenge start -- seed-style'
# Ожидание:
#   list        → "Доступные демо: day-01 … day-30"
#   db-stats    → news/posts/style_samples (после seed-style — style_samples > 0)
#   seed-style  → "Залито образцов стиля: N"
```

> **Примечание про `day-18`/`day-11`/`day-13`:** эти демо используют
> `path.join(process.cwd(), ...)` вместо cwd-независимого `dataPath()`. Запуск
> строго через `pnpm --filter challenge` (cwd = `challenge/`) — гарантирует
> корректное место `todos.sqlite`. Активные БД-классы (`BlogDb`/`RagStore`/`TgStore`/
> `DialogDb`) — cwd-независимые.

**Verify-гейт:**
- `pnpm --filter challenge typecheck` → exit 0. 🛑 Если ошибка — **СТОП**, не коммитить.
- `list` печатает дни; `seed-style` → `style_samples > 0` в `db-stats`.

**Rollback:**
```bash
sudo rm -rf node_modules challenge/.data/*.sqlite*
# повторить pnpm install
```

---

## 7. Фаза 5 — Внешние сервисы (Ollama, Telegram)  🔴 СТОП-точки (опционально)

> Фаза **опциональна** для базового деплоя web/ + cloud-LLM. Обязательна только
> если в проде нужны RAG/local-LLM или TG-scan.

### 7.1. Ollama (local-LLM + эмбеддинги)

Ollama — стандартный системный пакет со своим `ollama.service` (bind `127.0.0.1:11434`
по умолчанию — уже безопасно). **Не оборачивать в свой юнит.**

```bash
# Установка, если нет (Debian/Ubuntu):
curl -fsSL https://ollama.com/install.sh | sh
sudo systemctl enable --now ollama
curl -sS http://127.0.0.1:11434/api/tags | head -c 400    # verify сервис жив

# Pull моделей. Имена = LOCAL_LLM_MODEL / LOCAL_EMBED_MODEL из .env.
# Точный тег embed-модели — тот же, что на dev-машине (dim векторов в rag.sqlite!).
sudo -u ollama ollama pull qwen3.5:4b        # LLM (RAG/chat). [memory: think:false критичен]
sudo -u ollama ollama pull qwen3-embedding   # embed (уточнить тег через `ollama list` на dev)
ollama list
```

**RAM/диск-бюджет (возражение для оркестратора):**

| Модель | RAM инференс | Диск |
|---|---|---|
| `qwen3.5:4b` (Q4_K_M) | ~5–6 ГБ (веса + KV-cache при `num_ctx:4096`) | ~2.5 ГБ |
| `qwen3-embedding` | ~2–3 ГБ | ~1–2 ГБ |
| вместе (пиково) | **~8–10 ГБ** | ~4–5 ГБ |

**Правило:** RAM сервера ≥ (модель × 1.3) + 2 ГБ. Меньше 8 ГБ → 🛑 local-LLM off
(`.env` без `LOCAL_LLM_*`), RAG-роуты web/ уходят в graceful `configured:false`.
Cloud-LLM (DeepSeek/OpenRouter) работает без Ollama вообще.

**Verify Ollama (нативный `/api/chat` с `think:false` — критичный knob):**
```bash
curl -sS http://127.0.0.1:11434/api/chat -d '{
  "model":"qwen3.5:4b",
  "messages":[{"role":"user","content":"Скажи одно слово: привет"}],
  "stream":false,"think":false,
  "options":{"num_predict":64,"temperature":0.2}
}' | head -c 400
# Ожидание: {"message":{"content":"Привет."}} — НЕ пустой content.
# Если пустой/долгий — модель ушла в thinking (think:false не сработал) — memory day-26.
```

🔴 **СТОП-точка:** RAM < 8 ГБ → отказаться от local-LLM.

### 7.2. Telegram MTProto (userbot)

Требует `TG_API_ID`/`TG_API_HASH`/`TG_SESSION` (или `tg-session.json`) + маршрут к
DC2 (`149.154.167.51:80`). Если VPS заблокирован для прямых IP DC — нужен туннель.

**Туннель (если `TG_TUNNEL_HOST` по умолчанию `91.199.147.131` недоступен):**
```bash
# Вариант A — внешний прокси (def): TG_TUNNEL_HOST=91.199.147.131 TG_TUNNEL_PORT=8081
#   socat на сервере НЕ нужен.

# Вариант B — локальный socat на сервере:
sudo apt install -y socat
# проброс к DC2 149.154.167.51:80 (bind только loopback — не светить наружу):
sudo -u alexglad socat TCP-LISTEN:8081,bind=127.0.0.1,fork,reuseaddr TCP:149.154.167.51:80 &
# тогда в .env: TG_TUNNEL_HOST=127.0.0.1 TG_TUNNEL_PORT=8081
```

**Smoke MTProto (dry-run, БЕЗ печати сессии):**
```bash
sudo -u alexglad bash -c 'source "$HOME/.nvm/nvm.sh" && cd /opt/alex-glad-challenge && \
  pnpm --filter challenge start -- tg-collect <chatRef> <topicId> --probe --limit 5'
# --probe = GO/NO-GO гейт (5 сообщений, без записи в tg.sqlite).
# Ожидание: "✅ ...-путь: прочитано N сообщений." (N>0)
# Ошибки PEER_ID_INVALID/CHAT_/FORUM/TOPIC → проверьте chat/topicId, что userbot — участник чата.
# 🛑 В stdout НЕ печатается TG_SESSION (env.ts отдаёт только в gramjs).
```

### 7.3. Telegram Bot API (публикация) — только если готовы публиковать

```bash
# getMe — проверка токена без побочных эффектов:
curl -sS "https://api.telegram.org/bot${TG_BOT_TOKEN}/getMe"
# Если api.telegram.org заблокирован → HTTPS_PROXY=http://localhost:3128 в .env
```

**Verify-гейт Фазы 5:**
- Ollama `/api/tags` содержит обе модели; нативный `/api/chat` с `think:false` отдаёт контент.
- `tg-collect --probe` → N>0 сообщений (если MTProto нужен).

**Rollback:**
- Ollama timeout → `ollama ps`, `free -h` (модель не загружена / мало RAM).
- MTProto не коннектит → проверить туннель/`TG_TUNNEL_HOST`/`HTTPS_PROXY`, таймаут connect 45 c.

🔴 **СТОП-точки:** перенос сессии (Фаза 3); бюджет RAM; решение «нужен ли TG-scan на сервере».

---

## 8. Фаза 6 — Сборка `web/` (production standalone)

> Решение гэпов №1/№2 применено (см. §2). `pnpm --filter web build` / `start` —
> **имеющиеся** скрипты; `output: 'standalone'` — в `next.config.ts:27`.

```bash
cd /opt/alex-glad-challenge
sudo -u alexglad bash -c 'source "$HOME/.nvm/nvm.sh" && \

  # 1. typecheck ДО — СТРОГО зелёный (статический гейт)
  pnpm --filter web typecheck && \

  # 2. Сборка standalone-артефакта (= next build). output:standalone уже в next.config.ts.
  pnpm --filter web build'
# Артефакт → web/.next/ + web/.next/standalone/web/server.js
```

**Verify после сборки:**
```bash
# 1. standalone server.js существует
test -f web/.next/standalone/web/server.js && echo "OK: standalone server.js present" \
  || { echo "FAIL: no standalone server.js"; exit 1; }

# 2. serverExternalPackages НЕ в bundle (требуют node_modules при runtime — это ОК)
test -e web/.next/standalone/node_modules/telegram && \
  echo "WARN: telegram в standalone/node_modules — проверь serverExternalPackages" \
  || echo "OK: telegram external (резолвится из node_modules при runtime)"

# 3. Client-bundle НЕ содержит секретов/MTProto (security-инвариант CLAUDE.md)
sudo -u alexglad grep -rlE "TG_SESSION|DEEPSEEK_API_KEY|OPENROUTER_API_KEY|MCP_AUTH_TOKEN" \
  web/.next/static 2>/dev/null \
  && { echo "FAIL: секреты в client bundle — пробой chokepoint, СТОП"; exit 1; } \
  || echo "OK: client bundle чист (0 совпадений)"
```

> **Что вошло в `web/.next/standalone/`:** `web/server.js` (entrypoint, читает
> `HOSTNAME`/`PORT` из env), минимальный `node_modules/` (только то, что не в bundle).
> `serverExternalPackages` (telegram, undici, socks, https-proxy-agent, websocket,
> fast-xml-parser, qrcode) **требуют** полного `node_modules` рядом при runtime —
> поэтому на сервере держим полный `pnpm install` (Фаза 4 его уже сделала).
> `web/public/` в репо отсутствует — копировать нечего.

🔴 **СТОП-точка:** client-bundle grep дал совпадение → пробой server-only chokepoint.
Откат, диагностика `web/lib/server/challenge.ts` (не сломан ли `import 'server-only'`).

**Rollback:** `next build` падает на `@challenge/*`-импортах → сборка идёт из корня
workspace (не из `web/`), `transpilePackages:['challenge']` и `extensionAlias .js→.ts`
активны (они в `next.config.ts`, трогать не нужно). Если `fonts.googleapis.com`
недоступен — build упадёт на `next/font/google` (IBM Plex).

---

## 9. Фаза 7 — Запуск `web/` на loopback (systemd)

Цель: long-running `web/` на `127.0.0.1`, автозапуск, секреты из `.env`.

### 9.1. systemd-юнит `alexglad-web.service`

```bash
sudo tee /etc/systemd/system/alexglad-web.service >/dev/null <<'UNIT'
[Unit]
Description=alex-glad-challenge web/ (Next.js, loopback)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=alexglad
Group=alexglad
# cwd = КОРЕНЬ репо: loadEnvUpward() отсюда найдёт .env, dataPath() — challenge/.data
WorkingDirectory=/opt/alex-glad-challenge
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOSTNAME=127.0.0.1

# ОСНОВНОЙ режим (рекомендуется): next start через pnpm-скрипт.
# Loopback гарантирован флагом -H 127.0.0.1 в самом скрипте web/package.json.
# Если Node ставили через nvm — раскомментируйте строку PATH ниже и закомментируйте ExecStart=/usr/bin/node...
# Environment=PATH=/opt/alexglad/.nvm/versions/node/v24/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=/usr/bin/node /usr/local/bin/pnpm --filter web start

# АЛЬТЕРНАТИВА (тонкий деплой, standalone): расскомментируйте и закомментируйте ExecStart выше.
# HOSTNAME=127.0.0.1 ОБЯЗАТЕЛЬНО — иначе standalone bind 0.0.0.0 (security-триггер).
# Дополнительно: cp -r web/.next/static web/.next/standalone/web/.next/static
# ExecStart=/usr/bin/node /opt/alex-glad-challenge/web/.next/standalone/web/server.js

Restart=always
RestartSec=5
StartLimitBurst=5
StartLimitIntervalSec=60

NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/opt/alex-glad-challenge/challenge/.data /opt/alex-glad-challenge/web/.next

StandardOutput=journal
StandardError=journal
SyslogIdentifier=alexglad-web

[Install]
WantedBy=multi-user.target
UNIT
```

> **Почему НЕ `EnvironmentFile=` для `.env`:** `loadEnvUpward()` сам читает `.env`
> из корня репо (cwd = `WorkingDirectory`); дублирование через `EnvironmentFile`
> создаст второй источник истины и риск рассинхрона. `.env` — единственная точка
> секретов (security-инвариант). В юните только не-секретные флаги (`NODE_ENV`,
> `PORT`, `HOSTNAME`).
>
> **Путь к `node`/`pnpm`:** если Node ставили через nvm под alexglad — в юните
> `Environment=PATH=/opt/alexglad/.nvm/versions/node/v24/bin:...` и `ExecStart=
> /opt/alexglad/.nvm/versions/node/v24/bin/node ... pnpm --filter web start`
> (systemd не грузит `~/.bashrc`). Если NodeSource-системный — `/usr/bin/node`.

### 9.2. Запуск и smoke

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now alexglad-web.service
sudo systemctl status alexglad-web.service --no-pager
sudo journalctl -u alexglad-web.service -n 50 --no-pager

# Smoke на loopback (ключевые маршруты из web/app/api/** — все серверные, через chokepoint):
for path in "/" "/dashboard" "/showcase" "/api/settings" "/api/todos" "/api/blog/posts"; do
  code=$(curl -sS -o /dev/null -w "%{http_code}" "http://127.0.0.1:3000${path}")
  echo "${path} → ${code}"
done
# Ожидание: все → 200. /dashboard и /api/todos валидируют SQLite+dataPath на Linux.
# Тяжёлые роуты (/api/rag/*, /api/blog/pipeline) без Ollama/ключей вернут graceful 4xx/5xx —
# это НЕ регрессия деплоя (env-accessors кидают → route ловит → configured:false).

# bind-проверка: снаружи loopback — НЕ должно отвечать
ss -tlnp | grep ':3000'    # ожидаем 127.0.0.1:3000, НЕ 0.0.0.0:3000
```

**Verify-гейт:**
- `systemctl status` → `active (running)`.
- HTTP 200 на `/`, `/dashboard`, `/api/settings`, `/api/todos`.
- `ss -tlnp | grep ':3000'` → слушает `127.0.0.1` (🛑 `0.0.0.0` = СТОП).

🔴 **СТОП-точка:** порт 3000 занят → выбрать `<WEB_PORT>` (напр. 3100):
`Environment=PORT=3100` в юните + `-- -p 3100` нет нужды (standalone читает `PORT`);
в reverse-proxy (Фаза 8) указать тот же порт.

**Rollback:**
```bash
sudo systemctl disable --now alexglad-web.service
sudo rm /etc/systemd/system/alexglad-web.service
sudo systemctl daemon-reload
```

### 9.3. Опционально: блог-pipeline по расписанию (systemd-timer)

`news` (RSS→пост) — периодический oneshot, не long-running:
```bash
sudo tee /etc/systemd/system/alexglad-news.service >/dev/null <<'UNIT'
[Unit]
Description=alex-glad blog news pipeline (oneshot)
After=network-online.target
[Service]
Type=oneshot
User=alexglad
WorkingDirectory=/opt/alex-glad-challenge
Environment=NODE_ENV=production
ExecStart=/usr/bin/node /usr/local/bin/pnpm --filter challenge start -- news --hours 24
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/opt/alex-glad-challenge/challenge/.data
StandardOutput=journal
StandardError=journal
SyslogIdentifier=alexglad-news
UNIT

sudo tee /etc/systemd/system/alexglad-news.timer >/dev/null <<'UNIT'
[Unit]
Description=Run alex-glad news pipeline daily ~09:00
[Timer]
OnCalendar=*-*-* 09:07:00
Persistent=true
RandomizedDelaySec=300
[Install]
WantedBy=timers.target
UNIT

sudo systemctl enable --now alexglad-news.timer
systemctl list-timers | grep alexglad
```

### 9.4. PRIVATE_LLM-gateway (day-30) — НЕ поднимать как long-running

🛑 **Возражение (право возражать, CLAUDE.md):** `challenge/src/demos/day-30.ts` —
это **demo**: `run()` поднимает сервер на `127.0.0.1:3030`, прогоняет self-test
(H/A/X/R/C/S) и **закрывается в `finally` → `exit 0`** (`day-30.ts:814-816`).
Положить `pnpm --filter challenge start -- day-30` в systemd `Type=simple` **нельзя** —
процесс немедленно выйдет 0, systemd будет рестартить в цикле. Это **намеренная
семантика demo**, не баг. Архитектура в самом файле (`day-30.ts:20-31`): production-
gateway = отдельная задача (BACKEND vLLM → GATEWAY → PUBLIC EDGE); репо содержит
только эталон логики.

**Smoke gateway (опционально, одноразово):**
```bash
sudo -u alexglad bash -c 'source "$HOME/.nvm/nvm.sh" && cd /opt/alex-glad-challenge && \
  pnpm --filter challenge start -- day-30'
# Ожидание: таблица H/A/X/R/C/S · N PASS · выход. Не long-running.
```
**Для 24/7-gateway** требуется кодовая правка вне репо (вынос `startService` без
self-test/close в отдельный runnable) — 🔴 **открытый вопрос для Hermes**, не базовый деплой.
Базовому деплою web/ gateway **не нужен**: `LOCAL_LLM_BASE_URL` можно указать прямо
на Ollama (`http://127.0.0.1:11434/v1`), RAG/chat ходят напрямую через
`makeLocalLlmClient()`.

### 9.5. Опционально: MCP HTTP-серверы (oneshot)

web/ их **не требует** (`/api/admin/servers` — только индикация configured). Нужны,
если оператор гоняет `agent`/`mcp-server`/`scheduler` CLI на сервере или external-MCP-
клиент стучится на loopback. Все bind `127.0.0.1` (`core/mcpHttpServer.ts:90`).

🛑 **Конфликт портов:** `mcp-server` (day-17) и `scheduler` (day-18) оба дефолтят на
**3001** — одновременно не запускать, каждый со своим `--port`:
```bash
sudo -u alexglad bash -c 'source "$HOME/.nvm/nvm.sh" && cd /opt/alex-glad-challenge && \
  pnpm --filter challenge start -- mcp-server --port 3011'   # /mcp, MCP_AUTH_TOKEN
sudo -u alexglad bash -c '... pnpm --filter challenge start -- scheduler --port 3012'
sudo -u alexglad bash -c '... pnpm --filter challenge start -- day-20-server --port 3021'
#   day-20: world-mcp=3021, telegram-mcp=3022 (port+1)
```

---

## 10. Фаза 8 — Reverse-proxy + TLS (публичный доступ)  🔴 СТОП (домен + auth)

Цель: единственный легальный публичный путь — TLS + basic-auth → `127.0.0.1:<WEB_PORT>`.
🛑 **ЗАПРЕЩЕНО:** публиковать `0.0.0.0` без auth/TLS (CLAUDE.md trigger).

**Выбор proxy:** **Caddy** для fresh-deploy (авто-TLS из Let's Encrypt, ~10 строк,
меньше точек отказа в TLS-renewal — критично для одиночки-оператора). **nginx** —
только если уже стоит как системный reverse-proxy (не тянуть второй proxy). Оба
конфига ниже; Hermes выбирает по итогам Фазы 1.

### 10.1. Caddy (рекомендуется)

```bash
# Установка (Debian/Ubuntu):
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install caddy
# Caddy слушает :80/:443 через systemd (caddy.service) + setcap cap_net_bind_service.

# bcrypt-хэш для пароля Hermes (пароль ≥ 16 символов из менеджера паролей):
caddy hash-password
# → вывод вида $2a$14$... вставьте в <BCRYPT_HASH> ниже.

# /etc/caddy/Caddyfile (<DOMAIN> и <USER>/<BCRYPT_HASH> вписывает Hermes):
sudo tee /etc/caddy/Caddyfile >/dev/null <<'CADDY'
<DOMAIN> {
    # TLS автоматический (Let's Encrypt), Caddy сам ведёт renewal.

    basic_auth {
        <USER> <BCRYPT_HASH>
    }

    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "SAMEORIGIN"
        Referrer-Policy "strict-origin-when-cross-origin"
        # CSP НЕ переопределяем — Next.js её уже задаёт (next.config.ts).
    }

    reverse_proxy 127.0.0.1:3000 {
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
        flush_interval -1      # SSE/long-poll — без буферизации
    }

    encode gzip zstd

    log {
        output file /var/log/caddy/glad.log
        format json
    }
}
CADDY

sudo systemctl reload caddy
```

### 10.2. nginx (если уже стоит)

```bash
# htpasswd (bcrypt через -B):
sudo apt install -y apache2-utils
sudo htpasswd -cB /etc/nginx/.htpasswd-alexglad hermes       # спросит пароль
sudo chmod 640 /etc/nginx/.htpasswd-alexglad
sudo chown root:www-data /etc/nginx/.htpasswd-alexglad

# /etc/nginx/sites-available/alexglad.conf:
sudo tee /etc/nginx/sites-available/alexglad.conf >/dev/null <<'NGINX'
server {
    listen 80;
    server_name <DOMAIN>;
    return 301 https://$host$request_uri;
}
server {
    listen 443 ssl http2;
    server_name <DOMAIN>;

    ssl_certificate     /etc/letsencrypt/live/<DOMAIN>/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/<DOMAIN>/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    auth_basic "Restricted";
    auth_basic_user_file /etc/nginx/.htpasswd-alexglad;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # limit_req zone=alexglad burst=20 nodelay;   # нужен limit_req_zone в http{} (см. ниже)

    client_max_body_size 10m;     # /api/blog/* (LLM-payload), embeddings

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_buffering off;       # SSE/long-poll
        proxy_cache off;
        proxy_read_timeout 300s;
        proxy_set_header Connection "";
    }

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml;
}
NGINX

# В /etc/nginx/nginx.conf → http{} блок добавить (для rate-limit):
#   limit_req_zone $binary_remote_addr zone=alexglad:10m rate=10r/s;

# TLS через certbot:
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d <DOMAIN> --redirect
# certbot поставит systemd-timer на renewal (certbot.timer).

sudo ln -s /etc/nginx/sites-available/alexglad.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### 10.3. Firewall (публично открыты только 80/443/SSH)

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status verbose
# 🛑 3000/3001/3021/3022/3030/11434 — НЕ открывать (loopback-only по дизайну).
```

**Verify-гейт публичного деплоя:**
```bash
# 1. HTTPS без auth → 401; с auth → 200
curl -sS -o /dev/null -w "no-auth:  %{http_code}\n" https://<DOMAIN>/            # 401
curl -sS -o /dev/null -w "with-auth:%{http_code}\n" -u <USER>:<PASS> https://<DOMAIN>/   # 200

# 2. HTTP → HTTPS редирект
curl -sS -o /dev/null -w "http: %{http_code} → %{redirect_url}\n" http://<DOMAIN>/   # 301 → https

# 3. Цепочка прокси доходит: /api/settings отдаёт JSON (env-accessors без значений)
curl -sS -u <USER>:<PASS> https://<DOMAIN>/api/settings | head -c 200

# 4. TLS валиден
curl -sI https://<DOMAIN>/ | grep -iE 'strict-transport|content-security-policy'
```

🔴 **СТОП-точки:**
1. **Домен** для TLS (`<DOMAIN>`) — A-запись на IP сервера. Без него TLS-сертификат
   не выпустится.
2. **Пароль basic-auth** — Hermes задаёт (≥16 символов, менеджер паролей).
3. Если `:80`/`:443` уже обслуживают чужой proxy → координировать shared-vhost
   (или edge-провайдер с auth).

**Rollback:**
```bash
# Caddy:  sudo systemctl disable --now caddy  (или закомментировать site-block, reload)
# nginx: sudo rm /etc/nginx/sites-enabled/alexglad.conf && sudo systemctl reload nginx
# web/ остаётся на loopback — публичный доступ закрыт, данные не затронуты.
```

---

## 11. Фаза 9 — Пост-деплой проверки (Security-чеклист)

> Все инварианты CLAUDE.md (раздел 3 спецификации). Каждый пункт → `[x]` с фактом.

```bash
cd /opt/alex-glad-challenge

# [ ] 1. typecheck обоих пакетов зелёный (на сервере, post-checkout)
sudo -u alexglad bash -c 'source "$HOME/.nvm/nvm.sh" && \
  pnpm --filter challenge typecheck && pnpm --filter web typecheck'
# ОЖИДАНИЕ: exit 0 (оба).

# [ ] 2. Client-bundle grep = 0 (server-only chokepoint цел)
sudo -u alexglad grep -rlE "telegram|TG_SESSION|DEEPSEEK_API_KEY|OPENROUTER_API_KEY|MCP_AUTH_TOKEN" \
  web/.next/static 2>/dev/null && echo "FAIL" || echo "OK: 0 совпадений"

# [ ] 3. Секреты не в коммите/working-tree-vcs
git status --porcelain | grep -E '\.env|\.data/' && echo "FAIL: в VCS" || echo "OK: чисто"
git ls-files | grep -E '(^|/)\.env$|\.data/' && echo "FAIL: отслеживается" || echo "OK: не отслеживается"

# [ ] 4. Права на .env и .data
test "$(stat -c %a .env)" = "600" && echo "OK: .env 600" || echo "FAIL"
test "$(stat -c %a challenge/.data)" = "700" && echo "OK: .data 700" || echo "FAIL"
ls -la .env challenge/.data/tg-session.json 2>/dev/null    # владелец alexglad, НЕ root

# [ ] 5. bind loopback на всех тяжёлых портах (никто не слушает 0.0.0.0)
sudo ss -tlnp | grep -E ':(3000|3001|3021|3022|3030|11434)\b'
# ОЖИДАНИЕ: везде 127.0.0.1. 🛑 0.0.0.0:3000 = СТОП.

# [ ] 6. Публичный доступ — только через reverse-proxy
sudo ss -tlnp | grep -E ':(80|443)\b'    # caddy/nginx; web/ извне НЕ виден

# [ ] 7. MTProto-сессия не в логах journald
sudo journalctl -u alexglad-web.service --no-pager | grep -iE 'TG_SESSION|session' \
  && echo "WARN: проверить контекст (значения быть не должно)" || echo "OK: сессии в логах нет"

# [ ] 8. SQL parameterized (audit точек записи) — выборочно
grep -rn '\.prepare(' challenge/src/core/*.ts | grep -v '?' \
  | grep -viE 'CREATE TABLE|CREATE INDEX|PRAGMA'
# ОЖИДАНИЕ: пусто (нет интерполяции в параметризованных запросах).

# [ ] 9. fetch allowlist — потенциальный долг (текущих tainted-URL точек нет)
# RSS-URL захардкожены (rss.ts: FEEDS const), LLM/embed-baseUrl из .env, MCP_URL из env.
# Новые источники с URL из ввода вводить БЕЗ allowlist (блок RFC1918/169.254/metadata) — 🛑 нельзя.

# [ ] 10. Reverse-proxy: TLS + auth, нет голого 0.0.0.0 без auth
curl -sS -o /dev/null -w "%{http_code}\n" https://<DOMAIN>/                      # 401 без auth
curl -sS -o /dev/null -w "%{http_code}\n" -u <USER>:<PASS> https://<DOMAIN>/     # 200 с auth

# [ ] 11. CSP не ослаблен
curl -sI -u <USER>:<PASS> https://<DOMAIN>/ | grep -i content-security-policy
# ОЖИДАНИЕ: default-src 'self'; script-src 'self' (без unsafe-eval, без внешних в connect-src).

# [ ] 12. sanitize.clean() применяется к внешнему контенту перед БД/промптом
grep -rn 'clean(' challenge/src/core/agents challenge/src/core/rag challenge/src/core/dialogDb.ts
# ОЖИДАНИЕ: RSS-текст, TG-сообщения, profile-edit проходят clean() (rss.ts, dialogDb.ts).

# [ ] 13. NEXT_PUBLIC_* секретов нет
grep -rn 'NEXT_PUBLIC_' web/ --include=*.ts --include=*.tsx | grep -iE 'key|token|secret|session|hash'
# ОЖИДАНИЕ: 0 совпадений.
```

**Критерий прохода:** все пункты `[x]` с зафиксированным фактом. Любой FAIL →
диагностика, откат на соответствующую фазу.

---

## 12. Troubleshooting (типовые поломки → диагностика → фикс)

| Симптом | Причина | Фикс |
|---|---|---|
| `pnpm --filter web build` падает на `@challenge/*`-импортах | сборка не из корня workspace, `extensionAlias`/`transpilePackages` не активны | собирать из `/opt/alex-glad-challenge` (корень), НЕ из `web/`. `transpilePackages:['challenge']` + `extensionAlias .js→.ts` уже в `next.config.ts` — трогать не нужно |
| `next build` падает на `next/font/google` (IBM Plex) | build-машине недоступен `fonts.googleapis.com` | исходящий HTTPS к `fonts.googleapis.com` (Фаза 1, п.9). Self-host шрифтов — отдельная задача |
| `next build`: `Cannot find module 'sanitize.js'` | `extensionAlias` не сработал | проверить `webpack.resolve.extensionAlias: '.js': ['.ts','.tsx','.js']` в `next.config.ts:46-51` |
| standalone `server.js` bind `0.0.0.0` | не задан `HOSTNAME=127.0.0.1` | 🛑 СТОП. В юните `Environment=HOSTNAME=127.0.0.1` ОБЯЗАТЕЛЬНО для standalone. Для `next start` флаг уже в скрипте |
| `/dashboard` или `/api/todos` → 500 на сервере | права на `challenge/.data/` или WAL | первый запуск под целевым юзером (`alexglad`), `chmod 700 challenge/.data`, владелец — `alexglad`. module-singletons `web/lib/server/db.ts` открывают SQLite с WAL |
| `SQLITE_BUSY` во время `rag index-tg` | long-running web/ + oneshot-CLI пишут в одну БД | WAL допускает много читателей + один писатель. На время тяжёлой индексации — остановить web/ (`systemctl stop alexglad-web`) либо мириться с retry |
| SQLite-файлы создались root-owned | первый smoke запущен под root | `sudo chown -R alexglad:alexglad challenge/.data` и перезапуск под `alexglad` |
| Ollama timeout / пустой `content` | модель не pulled / мало RAM / `think:false` не сработал | `ollama ps`, `free -h`, `ollama pull <model>`. Проверить нативный `/api/chat` с `think:false` (memory day-26: qwen3.5 ломала RAG thinking'ом) |
| MTProto не коннектит (45 c timeout) | прямой маршрут к DC заблокирован / туннель | `tg-collect --probe` (NO-GO гейт). Поднять socat на `127.0.0.1:8081 → 149.154.167.51:80`, выставить `TG_TUNNEL_HOST=127.0.0.1 TG_TUNNEL_PORT=8081`. Для Bot API — `HTTPS_PROXY` |
| CSP рубит SSE в prod | `connect-src 'self'`, браузер идёт на иной origin | проверить, что страница и SSE-эндпоинт на одном домене (same-origin). Reverse-proxy не должен пробрасывать внешние домены в connect-src |
| CSP рубит гидратацию (dev) | memory `web-csp-blocks-dev-hydration`: streaming-swap + `app/loading.tsx` | в **production** неактивно (нет dev streaming-swap). Если воспроизводится — удалить `web/app/loading.tsx` (проверить, не восстановлен ли в day-30) |
| systemd-юнит рестартит в цикле (day-30 gateway) | demo self-closes в `finally` → exit 0 | 🛑 НЕ ставить `day-30` как сервис. Gateway — smoke-only (§9.4). Для 24/7 — правка кода вне репо |
| `day-18`/`day-11`/`day-13` пишут `todos.sqlite` не туда | `process.cwd()` вместо `dataPath()` | запуск строго через `pnpm --filter challenge` (cwd = `challenge/`) |
| `mcp-server` и `scheduler` падают с `EADDRINUSE` | оба дефолтят на `3001` | каждый со своим `--port` (`3011`, `3012`) |
| `.env` не подхватывается | лежит не в корне репо / cwd юнита не тот | `.env` строго в `/opt/alex-glad-challenge/.env`. `WorkingDirectory=/opt/alex-glad-challenge` в юните (loadEnvUpward идёт от cwd вверх) |
| pnpm ругается на build-скрипты нативных пакетов | `onlyBuiltDependencies` не разблокировал | `pnpm-workspace.yaml` + `challenge/package.json` содержат список `bufferutil, es5-ext, esbuild, utf-8-validate`. На Linux нужен `build-essential` (`python3 make g++`) для нативных аддонов |

---

## 13. Rollback (полный)

```bash
# 1. Остановить и убрать юниты
sudo systemctl disable --now alexglad-web.service alexglad-news.timer 2>/dev/null
sudo rm -f /etc/systemd/system/alexglad-web.service /etc/systemd/system/alexglad-news.{service,timer}
sudo systemctl daemon-reload

# 2. Убрать публичный доступ
# Caddy:  sudo systemctl disable --now caddy  (или закомментировать site-block, reload)
# nginx:  sudo rm -f /etc/nginx/sites-enabled/alexglad.conf && sudo systemctl reload nginx

# 3. Оставить challenge/ как было (runtime не затронут, .data/ сохранён):
#    - код/БД на месте, можно повторить деплой с любой фазы
# Полный демонтаж (при необходимости):
#   sudo rm -rf /opt/alex-glad-challenge
#   sudo userdel -r alexglad 2>/dev/null || true
```

---

## 14. Открытые вопросы для Hermes (требуют человеческого решения)

1. **Домен для TLS** (`<DOMAIN>`) — A-запись на IP сервера. Без него сертификат не выпустится.
2. **nginx или Caddy?** — зависит от того, что уже стоит (Фаза 1). Рекомендация: Caddy.
3. **Ollama: ставить или local-LLM off?** — зависит от RAM (Фаза 1). <8 ГБ → off.
4. **Точный тег embed-модели** в Ollama (`LOCAL_EMBED_MODEL`) — тот же, что на dev
   (dim векторов в переносимом `rag.sqlite` должен совпасть).
5. **PRIVATE_LLM-gateway 24/7 нужен?** — если да, это отдельная кодовая задача (§9.4),
   не базовый деплой. Базовому деплою gateway не нужен (`LOCAL_LLM_BASE_URL` → Ollama напрямую).
6. **MTProto-сессия (`TG_SESSION`/`tg-session.json`)** — перенос защищённо (scp из
   secrets, НЕ через git/лог). Решение: нужен ли TG-scan на сервере вообще.
7. **Нужны ли MCP-серверы (day-17/18/20) как long-running?** — по умолчанию oneshot
   (§9.5); 24/7 только если external-MCP-клиент стучится.
8. **Порт web/** — 3000 по умолчанию; если занят — `<WEB_PORT>` с синхронизацией
   `Environment=PORT=` юнита + `reverse_proxy` Caddy/nginx.

---

## Приложение A. Код-патч по гэпам №1/№2 (дословный)

> Эти правки **уже применены в working-tree ветки `day-30`** (`git status` показывает
> `M web/next.config.ts`, `M web/package.json`). Оркестратор коммитит их отдельным
> коммитом с префиксом `day-30:`. Патч ниже — для воспроизводимости на случай отката.

### A.1. `web/package.json` — секция `scripts`

```diff
   "scripts": {
     "dev": "next dev -H 127.0.0.1",
+    "build": "next build",
+    "start": "next start -H 127.0.0.1",
     "typecheck": "tsc --noEmit"
   },
```

### A.2. `web/next.config.ts` — объект `nextConfig` (после `reactStrictMode: true,`)

```diff
 const nextConfig: NextConfig = {
   reactStrictMode: true,
+  // Production-build в standalone-режиме (scoped override день 30): артефакт в
+  // web/.next/standalone/ — внутри web/.next/, уже в .gitignore. serverExternalPackages
+  // + outputFileTracingRoot корректно трейсят нативные/тяжёлые зависимости challenge.
+  output: 'standalone',
   transpilePackages: ['challenge'],
```

### A.3. Финальный вид `web/package.json` (scripts)

```json
"scripts": {
  "dev": "next dev -H 127.0.0.1",
  "build": "next build",
  "start": "next start -H 127.0.0.1",
  "typecheck": "tsc --noEmit"
}
```

После применения — `pnpm --filter web typecheck` обязан быть зелёным (правки не
трогают TS-граф). Коммит: `day-30: web build/start-скрипты + output:standalone для production-деплоя`.

---

## Приложение B. Шпаргалка (10 главных команд)

```bash
# 1. Зонд (Фаза 1) — ДО установки
ss -tlnp | grep -E ':(80|443|3000|3001|3030|11434)\b'; node -v; pnpm -v; cat /etc/os-release

# 2. Юзер + клон (Фаза 2)
sudo useradd --system --create-home --shell /bin/bash --home-dir /opt/alexglad alexglad
sudo -u alexglad git clone <REPO_URL> /opt/alex-glad-challenge && cd /opt/alex-glad-challenge

# 3. Зависимости (Фаза 4)
sudo -u alexglad bash -c 'source "$HOME/.nvm/nvm.sh" && pnpm install --prod=false'

# 4. Секреты (Фаза 3, 🔴 СТОП) — .env в КОРНЕ репо, chmod 600
sudo -u alexglad cp .env.example .env && sudo chmod 600 .env   # Hermes вписывает ключи

# 5. Инициализация .data/ (Фаза 4)
sudo -u alexglad bash -c '... pnpm --filter challenge start -- seed-style && pnpm --filter challenge start -- db-stats'

# 6. Build web/ standalone (Фаза 6)
sudo -u alexglad bash -c '... pnpm --filter web typecheck && pnpm --filter web build'

# 7. systemd web-юнит (Фаза 7)
sudo systemctl enable --now alexglad-web && curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/

# 8. Reverse-proxy + TLS (Фаза 8, 🔴 СТОП — домен/пароль) — Caddy
sudo apt install caddy && sudo nano /etc/caddy/Caddyfile && sudo systemctl reload caddy

# 9. Публичный verify (Фаза 8)
curl -sS -o /dev/null -w "%{http_code}\n" -u <USER>:<PASS> https://<DOMAIN>/   # 200

# 10. Security-чек (Фаза 9) — client-bundle grep = 0
sudo -u alexglad grep -rlE "TG_SESSION|DEEPSEEK_API_KEY|OPENROUTER_API_KEY" web/.next/static 2>/dev/null || echo "CLEAN: 0 совпадений"
```
