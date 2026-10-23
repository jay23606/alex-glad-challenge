# Артель — Android-клиент

Native Android client for the «Артель» workspace web API. Kotlin + Jetpack Compose + Material 3.

## Features

- **Подключение** — server URL + bearer token, persisted in DataStore, validated against `GET /api/mobile/bootstrap`. The token never leaves the device (no hardcoding, no logging).
- **Главная** — XP level ring, streak, achievements, workspace counts, notification badge.
- **Проекты** — list, create (name/description/color), project detail with notes/tasks/links, done toggling, item creation.
- **Автоматизация** — blog rules: enable/disable, interval + auto-publish configuration, run-now, recent runs.
- **Календарь** — events grouped by day with source badges, Google sync action.
- **Уведомления** — list with unread highlighting, mark-all-read.
- **Ассистент** — chat UI over `POST /api/assistant` with a graceful error bubble on 503.
- **Поддержка** — debounced FAQ search and ticket creation.
- **Настройки** — connection info, theme selector (system/dark/light), logout.

## Design

Dark graphite base with electric violet (#8B7CFF) primary and lime (#C6F24E) secondary; oversized display typography; asymmetric bento cards with 28dp corners; animated XP ring; labeled bottom navigation; light theme as a full second palette.

## Architecture

Single module `:app`, package `ru.memo7.artel`.

- Retrofit + OkHttp + kotlinx.serialization (`core/network`), bearer-token interceptor, typed errors (`401` → «Неверный токен»).
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

In the app, enter your server origin (for the emulator: `http://10.0.2.2:3000`) and a valid `MOBILE_API_TOKEN`, then tap «Подключиться».

## API

All endpoints under `/api/*` from the shared project contract; every request carries `Authorization: Bearer <token>`. Errors are surfaced as typed messages in Russian; 401 always means «Неверный токен доступа».
