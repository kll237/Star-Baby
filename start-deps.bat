@echo off
chcp 65001 >nul
echo 启动 StarGuard 本地依赖（Redis / MQTT / MailHog）...
start "Redis"   D:\redis\redis-server.exe --port 6379
start "MQTT"    cmd /c "cd /d D:\mqtt && node broker.js"
start "MailHog" D:\mailhog\MailHog.exe
echo.
echo Redis   监听 6379    （应用缓存 / Socket.IO 适配器 / 滥用检测）
echo MQTT    监听 1883    （桌宠可连真实设备，broker 在 D:\mqtt\broker.js）
echo MailHog SMTP 1025 / Web UI 8025  （本地真实 SMTP 捕获，浏览器开 http://localhost:8025 看邮件）
echo.
echo 依赖启动后，再开一个终端启动后端：
echo   cd D:\WorkBuddy\backend
echo   node dist\main.js
echo.
pause
