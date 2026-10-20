@echo off
chcp 65001 > nul
title LEDECA - Build Temizleme Aracı
color 0A

echo ============================================
echo   LEDECA Android Build Temizleme Aracı
echo ============================================
echo.

:: ─── 1. Gradle ve Java süreçlerini durdur ───────────────────────────────────
echo [1/5] Gradle ve Java süreçleri durduruluyor...
taskkill /F /IM java.exe       > nul 2>&1
taskkill /F /IM javaw.exe      > nul 2>&1
taskkill /F /IM gradle.exe     > nul 2>&1
taskkill /F /IM adb.exe        > nul 2>&1
taskkill /F /IM studio64.exe   > nul 2>&1
taskkill /F /IM studio.exe     > nul 2>&1
echo    [OK] Süreçler durduruldu.
echo.

:: ─── 2. Gradle daemon'ını durdur ────────────────────────────────────────────
echo [2/5] Gradle daemon durduruluyor...
if exist "%USERPROFILE%\.gradle\daemon" (
    for /d %%d in ("%USERPROFILE%\.gradle\daemon\*") do (
        taskkill /F /FI "WINDOWTITLE eq Gradle*" > nul 2>&1
    )
)
echo    [OK] Gradle daemon durduruldu.
echo.

:: ─── 3. Gizli desktop.ini dosyalarını sil ───────────────────────────────────
echo [3/5] Gizli desktop.ini dosyaları siliniyor...
del /s /q /f /a:h "%~dp0android\desktop.ini" > nul 2>&1
del /s /q /f /a:h "%~dp0node_modules\desktop.ini" > nul 2>&1
echo    [OK] desktop.ini dosyaları temizlendi.
echo.

:: ─── 4. Kilitli build klasörlerini force-delete ile sil ─────────────────────
echo [4/5] Kilitli build klasörleri siliniyor...

:: Robocopy ile boş klasör üzerine yazarak sil (en güvenilir yöntem)
set EMPTY_DIR=%TEMP%\empty_for_robocopy_%RANDOM%
mkdir "%EMPTY_DIR%" > nul 2>&1

:: [YENİ] android\build (kök seviye - reports/problems buradadır)
set ANDROID_BUILD=%~dp0android\build
if exist "%ANDROID_BUILD%" (
    echo    Siliniyor: android\build
    robocopy "%EMPTY_DIR%" "%ANDROID_BUILD%" /MIR /NFL /NDL /NJH /NJS /NC /NS /NP > nul 2>&1
    rmdir /s /q "%ANDROID_BUILD%" > nul 2>&1
    if exist "%ANDROID_BUILD%" (
        echo    [!] android\build kilili, handle zorla kapatiliyor...
        handle64 "%ANDROID_BUILD%" 2>nul | findstr /I "pid:" > nul 2>&1
    ) else (
        echo    [OK] android\build silindi.
    )
)

:: android\app\build
set BUILD_ROOT=%~dp0android\app\build
if exist "%BUILD_ROOT%" (
    echo    Siliniyor: android\app\build
    robocopy "%EMPTY_DIR%" "%BUILD_ROOT%" /MIR /NFL /NDL /NJH /NJS /NC /NS /NP > nul 2>&1
    rmdir /s /q "%BUILD_ROOT%" > nul 2>&1
    if exist "%BUILD_ROOT%" (
        echo    [!] Uyari: Bazi dosyalar hala kilili, devam ediliyor...
    ) else (
        echo    [OK] app\build silindi.
    )
)

:: node_modules icindeki kilitli build klasorleri
for /d /r "%~dp0node_modules" %%d in (build) do (
    if exist "%%d\intermediates" (
        robocopy "%EMPTY_DIR%" "%%d" /MIR /NFL /NDL /NJH /NJS /NC /NS /NP > nul 2>&1
        rmdir /s /q "%%d" > nul 2>&1
    )
)

:: android icindeki capacitor-cordova build klasoru
set CORDOVA_BUILD=%~dp0android\capacitor-cordova-android-plugins\build
if exist "%CORDOVA_BUILD%" (
    echo    Siliniyor: capacitor-cordova build
    robocopy "%EMPTY_DIR%" "%CORDOVA_BUILD%" /MIR /NFL /NDL /NJH /NJS /NC /NS /NP > nul 2>&1
    rmdir /s /q "%CORDOVA_BUILD%" > nul 2>&1
)

rmdir /s /q "%EMPTY_DIR%" > nul 2>&1
echo    [OK] Build klasörleri temizlendi.
echo.

:: ─── 5. Gradle cache temizle (opsiyonel) ────────────────────────────────────
echo [5/5] Gradle build cache temizleniyor...
if exist "%USERPROFILE%\.gradle\caches\build-cache-1" (
    rmdir /s /q "%USERPROFILE%\.gradle\caches\build-cache-1" > nul 2>&1
)
echo    [OK] Cache temizlendi.
echo.

:: ─── Sonuç ──────────────────────────────────────────────────────────────────
echo ============================================
echo   Temizleme tamamlandı!
echo   Android Studio'yu yeniden başlatın,
echo   ardından Run veya Build APK yapın.
echo ============================================
echo.
pause
