# Checks Android build prerequisites for the android/ module (see android/README.md).
# Read-only: verifies JDK/JAVA_HOME, the Android SDK and the Gradle wrapper.
# Never downloads, installs or modifies anything; prints manual instructions for what is missing.
# Exit code: 0 = all prerequisites satisfied, 1 = something is missing.

param(
    [string]$AndroidDir = (Join-Path $PSScriptRoot '..\android')
)

$ErrorActionPreference = 'Stop'

if (Test-Path $AndroidDir) { $AndroidDir = (Resolve-Path $AndroidDir).Path }

$okList = New-Object System.Collections.Generic.List[string]
$missing = New-Object System.Collections.Generic.List[string]

Write-Host 'Android build prerequisite check (no downloads, no installs)'
Write-Host "android dir: $AndroidDir"
Write-Host ''

# --- 1. JDK / JAVA_HOME ------------------------------------------------------
$javaExe = $null
if (-not [string]::IsNullOrWhiteSpace($env:JAVA_HOME)) {
    $candidate = Join-Path $env:JAVA_HOME 'bin\java.exe'
    if (Test-Path $candidate) {
        $javaExe = $candidate
    } else {
        $missing.Add("JAVA_HOME is set to '$($env:JAVA_HOME)' but $candidate was not found.")
    }
}
if ($null -eq $javaExe) {
    $onPath = Get-Command java.exe -ErrorAction SilentlyContinue
    if ($onPath) { $javaExe = $onPath.Source }
}

if ($null -ne $javaExe) {
    $ErrorActionPreference = 'Continue'
    $versionOutput = (& $javaExe -version 2>&1 | Out-String)
    $ErrorActionPreference = 'Stop'
    if ($versionOutput -match 'version "(\d+)(?:\.(\d+))?[^"]*"') {
        $major = [int]$Matches[1]
        if ($major -eq 1 -and $Matches[2]) { $major = [int]$Matches[2] } # legacy 1.8 numbering
        if ($major -ge 17) {
            $okList.Add("JDK: $javaExe (major version $major)")
        } else {
            $missing.Add("JDK $javaExe reports version $major, but 17+ is required (Temurin 21 tested).")
        }
    } else {
        $missing.Add("Could not parse 'java -version' output for $javaExe.")
    }
} elseif ($missing.Count -eq 0) {
    $missing.Add('JAVA_HOME is not set and java.exe is not on PATH.')
}

# --- 2. Android SDK ----------------------------------------------------------
$sdkDir = $null
foreach ($envCandidate in @($env:ANDROID_HOME, $env:ANDROID_SDK_ROOT)) {
    if (-not [string]::IsNullOrWhiteSpace($envCandidate) -and (Test-Path $envCandidate)) {
        $sdkDir = $envCandidate
        break
    }
}
if (-not $sdkDir) {
    $propsPath = Join-Path $AndroidDir 'local.properties'
    if (Test-Path $propsPath) {
        foreach ($line in Get-Content $propsPath) {
            if ($line -match '^\s*sdk\.dir\s*=\s*(.+?)\s*$') {
                $dir = $Matches[1] -replace '\\(.)', '$1' # properties escaping: C\:\\Android\\Sdk
                if (Test-Path $dir) { $sdkDir = $dir; break }
            }
        }
    }
}

if (-not $sdkDir) {
    $missing.Add('Android SDK not found: set ANDROID_HOME (or ANDROID_SDK_ROOT), or create android\local.properties with sdk.dir=C\:\\path\\to\\Android\\Sdk.')
} else {
    $okList.Add("Android SDK: $sdkDir")
    if (Test-Path (Join-Path $sdkDir 'platforms\android-36')) {
        $okList.Add('platform android-36 present (compileSdk/targetSdk = 36)')
    } else {
        $missing.Add('platform android-36 missing in the SDK (compileSdk/targetSdk = 36). Install via Android Studio SDK Manager or: sdkmanager "platforms;android-36".')
    }
    $buildTools = Get-ChildItem (Join-Path $sdkDir 'build-tools') -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match '^(\d+)\.' -and [int]$Matches[1] -ge 35 }
    if ($buildTools) {
        $okList.Add("build-tools $($buildTools[0].Name) present (35+)")
    } else {
        $missing.Add('build-tools 35+ missing in the SDK. Install via SDK Manager or: sdkmanager "build-tools;35.0.0".')
    }
    if (Test-Path (Join-Path $sdkDir 'platform-tools\adb.exe')) {
        $okList.Add('platform-tools (adb) present')
    } else {
        Write-Host "[warn] platform-tools (adb) not found in the SDK - needed for 'adb install', not for the build itself."
    }
}

# --- 3. Gradle wrapper ---------------------------------------------------------
$wrapperProps = Join-Path $AndroidDir 'gradle\wrapper\gradle-wrapper.properties'
if (Test-Path $wrapperProps) {
    $distLine = (Get-Content $wrapperProps | Where-Object { $_ -match '^distributionUrl' }) -join ''
    if ($distLine -match 'gradle-([0-9.]+)-') {
        $okList.Add("Gradle wrapper present (expects Gradle $($Matches[1]); downloaded automatically on first run, needs JDK only)")
    } else {
        Write-Host "[warn] could not parse distributionUrl in $wrapperProps"
    }
} else {
    $missing.Add("Gradle wrapper not found at $wrapperProps - the repository checkout looks incomplete.")
}

# --- Summary -------------------------------------------------------------------
Write-Host ''
if ($okList.Count -gt 0) { $okList | ForEach-Object { Write-Host "[ok]   $_" } }
if ($missing.Count -gt 0) {
    Write-Host ''
    Write-Host "Missing prerequisites ($($missing.Count)):"
    $missing | ForEach-Object { Write-Host "[miss] $_" }
    Write-Host ''
    Write-Host 'Portable JDK setup (no installer, no admin rights):'
    Write-Host '  1. Download Temurin 21 zip (Windows x64): https://adoptium.net/temurin/releases/?version=21'
    Write-Host '     direct link to the latest release:'
    Write-Host '     https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jdk/hotspot/normal/eclipse'
    Write-Host '  2. Unzip to a folder of your choice, e.g. %USERPROFILE%\artel-tools\jdk-21 (example path).'
    Write-Host '  3. Point JAVA_HOME at it (for new PowerShell windows):'
    Write-Host '       [Environment]::SetEnvironmentVariable(''JAVA_HOME'', "$env:USERPROFILE\artel-tools\jdk-21", ''User'')'
    Write-Host '     or for the current session only:'
    Write-Host '       $env:JAVA_HOME = "$env:USERPROFILE\artel-tools\jdk-21"; $env:Path = "$env:JAVA_HOME\bin;" + $env:Path'
    Write-Host '  4. Re-run this script, then build:'
    Write-Host '       cd <repo>\android; .\gradlew.bat :app:assembleDebug'
    exit 1
}

Write-Host ''
Write-Host 'All prerequisites satisfied. Build: cd android; .\gradlew.bat :app:assembleDebug'
