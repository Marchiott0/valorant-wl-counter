@echo off
setlocal
cd /d "%~dp0"
echo Verificando o Valorant W/L Counter...
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\start.ps1" -CheckOnly
if errorlevel 1 (
  echo Nao foi possivel concluir. Veja a mensagem acima.
) else (
  echo.
  echo Tudo pronto. Abra iniciar.bat para comecar.
  echo No pacote Windows pronto, tambem e possivel abrir Valorant W-L.exe.
  echo Nao ha pacotes npm para instalar.
)
pause
endlocal
