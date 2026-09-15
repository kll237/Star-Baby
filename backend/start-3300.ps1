# 一键启动星宝守护后端（端口 3300，单端口部署：后端 dist + 前端 dist_tmp2）
# 用法：在 backend 目录下右键“使用 PowerShell 运行”，或 `powershell -ExecutionPolicy Bypass -File start-3300.ps1`
$ErrorActionPreference = 'Continue'
$port = 3300
$backendDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$frontendDist = Join-Path $backendDir '../frontend/dist_tmp2'

Write-Host "==> 检查端口 $port 是否被旧实例占用..."
$connections = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
if ($connections) {
  $connections | ForEach-Object {
    try { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } catch {}
  }
  Start-Sleep -Seconds 1
  Write-Host "==> 已释放旧实例"
}

$env:PORT = '3300'
$env:FRONTEND_DIST = $frontendDist
Set-Location $backendDir
Write-Host "==> 启动 backend (node dist/main.js)，前端目录：$frontendDist"
node dist/main.js
