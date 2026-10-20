@echo off
setlocal enabledelayedexpansion
title LEDECA Build Fixer v5 (ULTRA)

echo ========================================================
echo [LEDECA] Build Kilidi Acma ve Temizlik Araci v5 (ULTRA)
echo ========================================================
echo.
echo BU ISLEM ASAGIDAKILERI YAPACAKTIR:
echo 1. Android Studio, Java ve Gradle sureclerini zorla kapatacak.
echo 2. Windows Gezgini'ni (Explorer) kilitleri cozmek icin gecici durduracak.
echo 3. TUM 'build' klasorlerini kokten temizleyecek.
echo.
echo UYARI: Android Studio'yu kapattiginizdan emin olun.
echo Devam etmek icin BIR TUSA BASIN...
pause >nul

echo.
echo [1/4] Surecler sonlandiriliyor...
taskkill /F /IM java.exe /T 2>NUL
taskkill /F /IM studio64.exe /T 2>NUL
taskkill /F /IM gradle.exe /T 2>NUL
taskkill /F /IM adb.exe /T 2>NUL
echo Surecler kapatildi.
timeout /t 2 /nobreak >nul

echo.
echo [2/4] Windows Gezgini gecici olarak durduruluyor (Kilitleri cozmek icin)...
taskkill /F /IM explorer.exe 2>NUL
timeout /t 2 /nobreak >nul

echo.
echo [3/4] Build klasorleri zorla temizleniyor...
:: Manuel olarak bilinen tum build yollarini temizle
echo -> Ana klasorler temizleniyor...
if exist "android\app\build" rmdir /s /q "android\app\build" 2>NUL
if exist "android\build" rmdir /s /q "android\build" 2>NUL
if exist "android\capacitor-cordova-android-plugins\build" rmdir /s /q "android\capacitor-cordova-android-plugins\build" 2>NUL

echo -> Plugin klasorleri taranip temizleniyor...
for /d /r . %%d in (build) do (
    if exist "%%d" (
        echo   [SILINIYOR] %%d
        rmdir /s /q "%%d" 2>NUL
    )
)

echo -> Gecici Gradle dosyalari temizleniyor...
if exist "android\.gradle" rmdir /s /q "android\.gradle" 2>NUL

echo.
echo [4/4] Windows Gezgini tekrar baslatiliyor...
start explorer.exe
timeout /t 2 /nobreak >nul

echo.
echo ========================================================
echo [ISLEM BASARIYLA TAMAMLANDI]
echo ========================================================
echo.
echo Simdi sunlari yapin:
echo 1. Android Studio'yu tekrar acin.
echo 2. Gradle Sync bitince 'Build -> Generate APK's' yolunu izleyin.
echo.
echo NOT: Eger hala hata alirsaniz lutfen BILGISAYARI YENIDEN BASLATIN.
echo.
pause
