@echo off
rem KOWOO Thai machine watch - start analysis PC (put a shortcut in Windows Startup)
cd /d "%~dp0.."
start "go2rtc" /min "edge\go2rtc.exe" -config "edge\go2rtc.yaml"
timeout /t 4 /nobreak >nul
set CHROME="C:\Program Files\Google\Chrome\Application\chrome.exe"
if not exist %CHROME% set CHROME="C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
start "" %CHROME% --app=http://localhost:1984/analyzer.html --user-data-dir="%LOCALAPPDATA%\kowoo-cctv-chrome" --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows --disable-background-media-suspend --autoplay-policy=no-user-gesture-required
