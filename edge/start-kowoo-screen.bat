@echo off
rem KOWOO Thai machine watch - screen capture mode (put a shortcut in Windows Startup)
rem Set CCTV_WINDOW to a word from the CCTV program window title so Chrome picks it automatically.
set CCTV_WINDOW=CCTV
set URL=https://appshin.github.io/kowoo-machine-watch/analyzer.html
set CHROME="C:\Program Files\Google\Chrome\Application\chrome.exe"
if not exist %CHROME% set CHROME="C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
timeout /t 20 /nobreak >nul
start "" %CHROME% --app=%URL% --user-data-dir="%LOCALAPPDATA%\kowoo-cctv-chrome" --auto-select-desktop-capture-source="%CCTV_WINDOW%" --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows --disable-background-media-suspend
