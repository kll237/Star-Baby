# 停止占用 3300 端口的星宝守护实例
$port = 3300
$connections = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
if (-not $connections) { Write-Host '3300 无运行实例'; exit 0 }
$connections | ForEach-Object { try { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } catch {} }
Write-Host '已停止 3300 实例'
