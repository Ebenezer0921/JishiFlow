@echo off
setlocal
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
where cargo >nul 2>nul
if errorlevel 1 goto missing
if defined VSCMD_VER goto build
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
if not exist "%VSWHERE%" goto missing
for /f "usebackq tokens=*" %%i in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "VSDIR=%%i"
if not defined VSDIR goto missing
call "%VSDIR%\Common7\Tools\VsDevCmd.bat" -arch=x64 -host_arch=x64
if errorlevel 1 goto failed
:build
cargo test --release --locked --manifest-path "%~dp0src-tauri\Cargo.toml" --lib
if errorlevel 1 goto failed
cargo build --release --locked --manifest-path "%~dp0src-tauri\Cargo.toml"
if errorlevel 1 goto failed
echo Build succeeded. See src-tauri\target\release\jishi-reminder.exe
pause
exit /b 0
:missing
echo Rust MSVC and Visual Studio C++ Build Tools are required. See docs.
pause
exit /b 1
:failed
echo Build failed. Keep the error output for diagnosis.
pause
exit /b 1
