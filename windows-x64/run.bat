@echo off
setlocal
set "KIT_ROOT=%~dp0.."
for %%I in ("%KIT_ROOT%") do set "KIT_ROOT=%%~fI"
set "DB_PATH=%KIT_ROOT%\data\onboarding.sqlite"
set "CONFIG_PATH=%KIT_ROOT%\config.xml"
"%~dp0onboarding-api.exe"
