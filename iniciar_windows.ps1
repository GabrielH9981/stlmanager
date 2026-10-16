# STLManager - Inicializador PowerShell Windows
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Set-Location -Path $PSScriptRoot
$Host.UI.RawUI.WindowTitle = "STLManager - Windows"

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "               STLManager - Windows" -ForegroundColor Cyan
Write-Host "    Gerenciador Inteligente de Acervo 3D" -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Verificar Python
$pythonCmd = $null
if (Get-Command python -ErrorAction SilentlyContinue) {
    $pythonCmd = "python"
} elseif (Get-Command py -ErrorAction SilentlyContinue) {
    $pythonCmd = "py"
}

if (-not $pythonCmd) {
    Write-Host "[ERRO] Python nao foi encontrado no sistema!" -ForegroundColor Red
    Write-Host "Instale o Python 3.11 ou 3.12 em: https://www.python.org/downloads/"
    Write-Host "Lembre-se de marcar a opcao: Add python.exe to PATH"
    Read-Host "Pressione ENTER para sair..."
    exit 1
}

Write-Host "[1/4] Python detectado:" -ForegroundColor Green
& $pythonCmd --version
Write-Host ""

# 2. Criar .env se nao existir
if (-not (Test-Path ".env")) {
    Write-Host "[2/4] Criando arquivo de configuracao .env a partir de .env.example..." -ForegroundColor Yellow
    Copy-Item ".env.example" ".env"
} else {
    Write-Host "[2/4] Arquivo .env encontrado." -ForegroundColor Green
}
Write-Host ""

# 3. Criar e ativar .venv
if (-not (Test-Path ".venv\Scripts\Activate.ps1")) {
    Write-Host "[3/4] Criando ambiente virtual Python (.venv)..." -ForegroundColor Yellow
    & $pythonCmd -m venv .venv
    Write-Host "      Instalando dependencias (primeira execucao)..." -ForegroundColor Yellow
    & ".venv\Scripts\python.exe" -m pip install --upgrade pip --quiet
    & ".venv\Scripts\python.exe" -m pip install -r backend\requirements.txt
} else {
    Write-Host "[3/4] Ambiente virtual .venv pronto." -ForegroundColor Green
}
Write-Host ""

# 4. Iniciar Servidor
Write-Host "[4/4] Iniciando STLManager..." -ForegroundColor Green
Write-Host ""
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "  Aplicacao rodando com sucesso!" -ForegroundColor Green
Write-Host "  Acesse no seu navegador: http://localhost:8000" -ForegroundColor White
Write-Host "  (Pressione CTRL + C para encerrar o servidor)" -ForegroundColor Gray
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host ""

Start-Process "http://localhost:8000"

$env:PYTHONPATH = "$PSScriptRoot\backend;$env:PYTHONPATH"
& ".venv\Scripts\python.exe" -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --app-dir backend
