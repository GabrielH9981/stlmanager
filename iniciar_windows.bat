@echo off
chcp 65001 >nul
title STLManager - Inicializador Windows

echo ========================================================
echo               🧊 STLManager - Windows
echo    Gerenciador Inteligente de Acervo de Impressão 3D
echo ========================================================
echo.

:: 1. Verificar se o Python está instalado no Windows
where python >nul 2>nul
if %errorlevel% neq 0 (
    where py >nul 2>nul
    if %errorlevel% neq 0 (
        echo [ERRO] Python não foi encontrado no seu computador!
        echo.
        echo Por favor, instale o Python 3.11 ou 3.12 baixando em:
        echo https://www.python.org/downloads/
        echo.
        echo ATENÇÃO: Na tela de instalação do instalador do Python,
        echo marque a caixinha "Add python.exe to PATH" antes de prosseguir!
        echo.
        pause
        exit /b 1
    ) else (
        set PYTHON_CMD=py
    )
) else (
    set PYTHON_CMD=python
)

echo [1/4] Python detectado com sucesso:
%PYTHON_CMD% --version
echo.

:: 2. Criar .env a partir do .env.example se não existir
if not exist ".env" (
    echo [2/4] Arquivo .env não encontrado. Criando a partir de .env.example...
    copy .env.example .env >nul
    echo      Arquivo .env criado com sucesso!
    echo      DICA: Você pode editar o .env com o Bloco de Notas para mudar a pasta dos arquivos STL.
) else (
    echo [2/4] Arquivo .env de configuração detectado.
)
echo.

:: 3. Criar e ativar ambiente virtual .venv
if not exist ".venv" (
    echo [3/4] Criando ambiente virtual Python (.venv)...
    %PYTHON_CMD% -m venv .venv
    if %errorlevel% neq 0 (
        echo [ERRO] Falha ao criar ambiente virtual .venv.
        pause
        exit /b 1
    )
    echo      Instalando dependências (isso ocorre apenas na primeira execução)...
    call .venv\Scripts\activate.bat
    pip install --upgrade pip --quiet
    pip install -r backend\requirements.txt
) else (
    echo [3/4] Ambiente virtual .venv pronto.
    call .venv\Scripts\activate.bat
)
echo.

:: 4. Iniciar servidor FastAPI/Uvicorn
echo [4/4] Iniciando STLManager...
echo.
echo ========================================================
echo   ✅ Aplicação rodando com sucesso!
echo   Acesse no seu navegador: http://localhost:8000
echo   (Para encerrar o servidor, feche esta janela ou aperte CTRL + C)
echo ========================================================
echo.

:: Abrir navegador automaticamente
start http://localhost:8000

:: Configurar PYTHONPATH e rodar Uvicorn
set PYTHONPATH=%CD%\backend;%PYTHONPATH%
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --app-dir backend

pause
