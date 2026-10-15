$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw '未找到 Node.js，请先安装 Node.js 24 LTS（https://nodejs.org）。'
}

if (-not (Test-Path '.\node_modules')) {
  Write-Host '首次启动：安装依赖（npm ci），请保持联网...'
  npm ci
  if ($LASTEXITCODE -ne 0) { throw '依赖安装失败，请检查网络后重试。' }
}

# 端口已被占用：说明服务已在运行，直接打开页面
$listening = Get-NetTCPConnection -LocalPort 8812 -State Listen -ErrorAction SilentlyContinue
if ($listening) {
  try {$health = Invoke-RestMethod -Uri 'http://127.0.0.1:8812/api/health' -TimeoutSec 3} catch {throw '端口 8812 已被未知服务占用，请检查后重试。'}
  if ($health.app -ne 'LLM Benchmark Studio') {throw '端口 8812 上运行的不是本项目，请检查后重试。'}
  Write-Host 'LLM Benchmark Studio 服务已在运行，直接打开 http://127.0.0.1:8812'
  Start-Process 'http://127.0.0.1:8812'
  exit 0
}

Write-Host 'LLM Benchmark Studio 正在启动。浏览器打开 http://127.0.0.1:8812 ，关闭本窗口即可停止服务。'
Start-Process 'http://127.0.0.1:8812'
node --env-file-if-exists=.env src/server.js
exit $LASTEXITCODE
