@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title STLManager - Inicializador Windows

echo ========================================================
echo               STLManager - Windows
echo    Gerenciador Inteligente de Acervo de Impressao 3D
echo ========================================================
echo.

:: 1. Verificar instalacao do Python
where python >nul 2>nul
if %errorlevel% equ 0 (
    set "PYTHON_CMD=python"
    goto :PYTHON_OK
)

where py >nul 2>nul
if %errorlevel% equ 0 (
    set "PYTHON_CMD=py"
    goto :PYTHON_OK
)

echo [ERRO] Python nao foi encontrado no sistema!
echo.
echo Por favor, instale o Python 3.11 ou 3.12 baixando em:
echo https://www.python.org/downloads/
echo.
echo IMPORTANTE: Durante a instalacao, marque a opcao:
echo [X] Add python.exe to PATH
echo.
pause
exit /b 1

:PYTHON_OK
echo [1/4] Python detectado com sucesso:
%PYTHON_CMD% --version
echo.

:: 2. Criar .env se nao existir
if exist ".env" goto :ENV_OK
echo [2/4] Arquivo .env nao encontrado. Copiando de .env.example...
copy .env.example .env >nul
echo      Arquivo .env criado com sucesso!
goto :AFTER_ENV

:ENV_OK
echo [2/4] Arquivo .env detectado.

:AFTER_ENV
echo.

:: 3. Criar ambiente virtual se nao existir
if exist ".venv\Scripts\activate.bat" goto :VENV_EXISTS

echo [3/4] Criando ambiente virtual Python (.venv)...
%PYTHON_CMD% -m venv .venv
if %errorlevel% neq 0 (
    echo.
    echo [ERRO] Falha ao criar ambiente virtual .venv com o comando: %PYTHON_CMD% -m venv .venv
    pause
    exit /b 1
)

echo      Instalando dependencias necessarias (primeira execucao)...
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip --quiet
python -m pip install -r backend\requirements.txt
if %errorlevel% neq 0 (
    echo.
    echo [AVISO] Houve um problema ao instalar algumas dependencias. Tentando prosseguir...
)
goto :VENV_READY

:VENV_EXISTS
echo [3/4] Ambiente virtual .venv pronto.
call .venv\Scripts\activate.bat

:VENV_READY
echo.

:: 4. Iniciar servidor FastAPI/Uvicorn
echo [4/4] Iniciando STLManager...
echo.
echo ========================================================
echo   Aplicacao rodando com sucesso!
echo   Acesse no seu navegador: http://localhost:8000
echo   (Para encerrar, feche esta janela ou aperte CTRL + C)
echo ========================================================
echo.

:: Abre o navegador automaticamente
start http://localhost:8000

:: Configurar PYTHONPATH e rodar Uvicorn
set "PYTHONPATH=%CD%\backend;%PYTHONPATH%"
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --app-dir backend

if %errorlevel% neq 0 (
    echo.
    echo [ERRO] O servidor foi encerrado com erro.
    pause
)
