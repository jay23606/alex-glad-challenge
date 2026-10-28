# Артель — Android-клиент

Native Android client for the «Артель» workspace web API. Kotlin + Jetpack Compose + Material 3.

## Features

- **Подключение** — вход по паролю рабочего пространства (`POST /api/mobile/login`); адрес сервера пользователь вводит в приложении (см. «Сервер и вход» ниже), а выданная сессия (token) хранится в DataStore и проверяется `GET /api/mobile/bootstrap`. Пароль нигде не сохраняется.
- **Главная** — XP level ring, streak, achievements, workspace counts, notification badge.
- **Геймификация** — XP/уровень с кольцом прогресса, серия и рекорд, достижения (открытые/закрытые) и журнал очков (`GET /api/gamification`); вход — тап по кольцу уровня или карточке достижения на главной.
- **Проекты** — list, create (name/description/color), project detail with notes/tasks/links, done toggling, item creation.
- **Задачи** — список задач (`GET /api/todos`) со статусами и повтором (ежедневно/по дню недели/каждые N ч/разово), complete/dismiss/delete с подтверждением, форма добавления (текст ≤500, интервал 1–168 ч для hourly); вход — тайл «Задачи» на главной.
- **Автоматизация** — blog rules: enable/disable, interval + auto-publish configuration, run-now, recent runs.
- **Календарь** — events grouped by day with Russian source badges; refresh (`GET /api/calendar`) отделён от Google sync (`POST /api/calendar/sync`, заблокирован без настроенного Google); экспорт `.ics` на 30 дней через share sheet (FileProvider, файл в cache).
- **Уведомления** — list with unread highlighting, mark-all-read; тап по записи — `markRead(id)` и открытие http(s)-`href`; даты принимаются и в SQLite-формате `yyyy-MM-dd HH:mm:ss`, и в ISO.
- **Ассистент** — chat UI over `POST /api/assistant` with a graceful error bubble on 503.
- **Поддержка** — debounced FAQ search and ticket creation.
- **Настройки** — connection info, theme selector (system/dark/light), logout.

## Design

Warm oven palette: dark graphite base (#161110) with tomato (#FF5A36) primary, basil (#8FE36B) secondary and cheese (#FFB443) accent; light theme is a full second palette on paper (#FAF3EA). Oversized display typography, asymmetric bento cards with 28dp corners, animated XP ring. Bottom navigation is labeled at normal widths and icon-only on narrow screens or large font scale; full labels stay in accessibility descriptions.

## Architecture

Single module `:app`, package `ru.memo7.artel`.

- Retrofit + OkHttp + kotlinx.serialization (`core/network`), bearer-token interceptor, typed errors (`401` → «Сессия истекла. Войдите заново.» с автоматическим выходом на экран входа).
- Repository with small in-memory caches for instant re-entry (`data/ArtelRepository.kt`).
- Manual DI via `AppContainer` (`di/`), ViewModels with `StateFlow`, `loading/error/empty` states on every screen.
- DataStore preferences for credentials + theme (`data/CredentialsStore.kt`).
- Network security config: cleartext allowed **only** in debug builds (`app/src/debug/res/xml/`), release forbids cleartext.

## Пререквизиты

| Компонент | Требование | Источник истины |
|---|---|---|
| JDK | 17+ (проверено на Eclipse Temurin 21) | `app/build.gradle.kts`: `jvmTarget = "17"`; AGP 8.10.1 требует минимум JDK 17 |
| Android SDK | platform `android-36`, build-tools 35+, platform-tools (`adb`) | `app/build.gradle.kts`: `compileSdk = 36`, `targetSdk = 36`, `minSdk = 26` |
| Gradle | 8.13 — только как wrapper, отдельно ставить не нужно | `gradle/wrapper/gradle-wrapper.properties` → `gradle-8.13-bin.zip`; скачается сам при первом запуске (нужен интернет), wrapper'у для запуска нужен только JDK |

На чистой машине `java` часто не установлен и `JAVA_HOME` пуст — тогда `gradlew.bat` не запустится. Быстрая проверка (PowerShell):

```powershell
java -version          # ожидаем openjdk version 17+
echo $env:JAVA_HOME    # ожидаем путь к корню JDK, например ...\jdk-21.0.x+y
```

В корне репозитория есть скрипт-проверка (ничего не скачивает и не устанавливает, только сообщает, чего не хватает):

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup-android-jdk.ps1
```

### JDK: два способа

**Установщик.** Eclipse Temurin 21 с <https://adoptium.net/temurin/releases/?version=21>; MSI-установщик может прописать `JAVA_HOME` сам — отметьте эту опцию.

**Portable-zip (без прав администратора).**

1. Скачайте zip Temurin 21 для Windows x64 с той же страницы или по прямой ссылке на последний релиз:
   `https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jdk/hotspot/normal/eclipse`
2. Распакуйте в любую папку, например `%USERPROFILE%\artel-tools\jdk-21` (это пример — путь может быть любым, подставьте свой в шаге 3).
3. Выставьте `JAVA_HOME`. На постоянку (для новых окон PowerShell):

   ```powershell
   [Environment]::SetEnvironmentVariable('JAVA_HOME', "$env:USERPROFILE\artel-tools\jdk-21", 'User')
   ```

   или только на текущую сессию:

   ```powershell
   $env:JAVA_HOME = "$env:USERPROFILE\artel-tools\jdk-21"
   $env:Path = "$env:JAVA_HOME\bin;" + $env:Path
   ```

### Android SDK

- Проще всего через Android Studio → SDK Manager: *SDK Platforms* → «Android SDK Platform 36», *SDK Tools* → «Android SDK Build-Tools 35+» и «Android SDK Platform-Tools».
- Без Studio — `sdkmanager` из commandline-tools: `sdkmanager "platforms;android-36" "build-tools;35.0.0" "platform-tools"`.
- Путь до SDK берётся из `ANDROID_HOME`/`ANDROID_SDK_ROOT` или из файла `android\local.properties` со строкой `sdk.dir=C\:\\путь\\к\\Sdk` (двоеточие и обратные слэши экранируются; файл в git не коммитится).

## Build

При установленных пререквизитах (см. «Пререквизиты» выше):

```bash
cd android
./gradlew :app:assembleDebug        # Linux/macOS
.\gradlew.bat :app:assembleDebug    # Windows PowerShell (в cmd — gradlew.bat без .\)
# faster compile-only check:
./gradlew :app:compileDebugKotlin
```

The debug APK lands in `app/build/outputs/apk/debug/app-debug.apk` (~17 МБ). Install and run:

```bash
adb install app/build/outputs/apk/debug/app-debug.apk
```

In the app, enter the workspace server address — just as you would type a site URL in a browser — and the workspace password, then tap «Войти» (see below).

## Сервер и вход

- **Адрес сервера.** Пользователь вводит адрес рабочей области прямо в приложении — так же, как вводит адрес сайта в браузере (например, `https://artel.example.com` или `http://192.168.1.50:3000`). Адрес без схемы дополняется `http://` до дефолтного. Успешно подключённый адрес запоминается на устройстве и подставляется при следующем входе; после logout или истечения сессии поле предзаполнено последним успешным адресом, и его можно изменить в любой момент. В APK ничего не зашивается — приложение универсально: подходит для любой рабочей области с этим API.
- **Вход по паролю.** Второе поле — пароль рабочего пространства: `POST /api/mobile/login` возвращает session-токен, приложение проверяет подключение `GET /api/mobile/bootstrap` и сохраняет токен в DataStore. Неверный пароль — «Неверный пароль»; пароль на устройстве не хранится. Токен живёт 7 дней; 401 от любого API-запроса означает «Сессия истекла. Войдите заново.» и возвращает на экран входа с предзаполненным адресом.
- **Доступность сервера.** Телефон должен достучаться до сервера напрямую: в той же Wi-Fi/LAN-сети (адрес вида `http://192.168.x.x:3000`) или через VPN вроде Tailscale. Эмулятору доступен `http://10.0.2.2:3000` (host-машина). Cleartext-HTTP разрешён только в debug-сборках; для продакшена используйте HTTPS за reverse-proxy.
- **«Сервер не отвечает — проверьте адрес и сеть»** (техническая форма: «Сервер недоступен: failed to connect … after 15000ms» из OkHttp; приложение переводит её через `ConnectRules.describeConnectFailure`). Ошибка TCP-подключения (`connectTimeout` в `ApiFactory`), она возникает **до** отправки HTTP-запроса — до проверки пароля дело не доходит, пароль ни при чём. Чеклист по порядку:
  1. Сервер запущен? На машине с сервером локально должен отвечать `http://127.0.0.1:3000` (например, POST на `/api/mobile/login` с пустым телом отдаёт HTTP 400/401 — это подтверждает живой endpoint).
  2. Штатные скрипты репо bind'ят сервер только на `127.0.0.1` (`web/package.json`: `dev`/`start`), поэтому телефон по сети его не увидит. Для телефона поднимайте сервер доступным ему способом: на Tailscale-IP — `pnpm --filter web exec next dev -H <tailscale-ip>` (как в приёмке 2026-10-25, см. CHANGELOG), либо держите loopback и открывайте наружу через `tailscale serve` (даёт HTTPS из коробки).
  3. Телефон идёт через VPN? В ошибке `from /<ip>:<port>` — это адрес источника на телефоне: `192.168.x.x`/`10.x.x.x` = запрос шёл мимо VPN (в момент ошибки Tailscale на телефоне был выключен/не поднят), `100.x.x.x` = запрос шёл через tailnet. Включите Tailscale на телефоне и повторите.
  4. Firewall: если после пунктов 1–3 таймаут остался — разрешите входящий TCP 3000 на tailnet-интерфейсе (правило с ограничением по источникам `100.64.0.0/10`, не «всем»).
  5. Release-сборка? `http://` в ней запрещён network security config — приложение вернёт «Сервер требует защищённое соединение»: для release URL должен быть HTTPS.

## API

All endpoints under `/api/*` from the shared project contract; every workspace request carries `Authorization: Bearer <token>`. Вход — `POST api/mobile/login` (`{ password }` → `{ ok, token, expiresAt }`). Errors are surfaced as typed messages in Russian; 401 always means «Сессия истекла. Войдите заново.».
