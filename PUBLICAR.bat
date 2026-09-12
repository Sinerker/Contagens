@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"
title Publicando o Contagens

echo.
echo   ==========================================
echo    PUBLICANDO O CONTAGENS NO GITHUB
echo   ==========================================
echo.

rem ---------- 1. Git ----------
set "GIT=git"
where git >nul 2>&1
if not errorlevel 1 goto :temgit

echo   [1/4] Git nao encontrado. Instalando (pode levar uns minutos)...
echo.
winget install --id Git.Git -e --source winget --scope user --accept-package-agreements --accept-source-agreements
echo.

if exist "%LOCALAPPDATA%\Programs\Git\cmd\git.exe" set "GIT=%LOCALAPPDATA%\Programs\Git\cmd\git.exe"
if exist "%ProgramFiles%\Git\cmd\git.exe"          set "GIT=%ProgramFiles%\Git\cmd\git.exe"
if exist "%ProgramFiles(x86)%\Git\cmd\git.exe"     set "GIT=%ProgramFiles(x86)%\Git\cmd\git.exe"

"%GIT%" --version >nul 2>&1
if errorlevel 1 (
  echo   Nao consegui usar o Git depois de instalar.
  echo   Feche esta janela e clique no PUBLICAR.bat de novo:
  echo   as vezes ele so precisa de uma janela nova.
  echo.
  pause
  exit /b 1
)
goto :publica

:temgit
echo   [1/4] Git ja instalado.

:publica
for /f "tokens=*" %%v in ('"%GIT%" --version') do echo         %%v
echo.

rem ---------- 2. Identidade ----------
echo   [2/4] Preparando o repositorio...
"%GIT%" config user.name  >nul 2>&1 || "%GIT%" config user.name  "Sinerker"
"%GIT%" config user.email >nul 2>&1 || "%GIT%" config user.email "alexandrofsilva94@gmail.com"

if not exist .git (
  "%GIT%" init -b main || goto :erro
)

"%GIT%" remote get-url origin >nul 2>&1
if errorlevel 1 "%GIT%" remote add origin https://github.com/Sinerker/Contagens.git

rem ---------- 3. Commit ----------
echo   [3/4] Juntando o que mudou...
"%GIT%" add -A || goto :erro
"%GIT%" commit -m "Atualizacao do Contagens" >nul 2>&1
if errorlevel 1 echo         (nada mudou desde o ultimo envio)

rem ---------- 4. Envio ----------
echo   [4/4] Enviando para o GitHub...
echo.
"%GIT%" push -u origin main --force-with-lease
if errorlevel 1 (
  "%GIT%" fetch origin main >nul 2>&1
  "%GIT%" branch --set-upstream-to=origin/main main >nul 2>&1
  "%GIT%" push -u origin main --force-with-lease || goto :erro
)

echo.
echo   ==========================================
echo    PRONTO
echo    https://sinerker.github.io/Contagens/
echo    O site atualiza em um ou dois minutos.
echo   ==========================================
echo.
pause
exit /b 0

:erro
echo.
echo   ------------------------------------------
echo    DEU ERRO ACIMA
echo    Se falou de login, uma janela do navegador
echo    deve ter aberto para voce entrar no GitHub.
echo   ------------------------------------------
echo.
pause
exit /b 1
