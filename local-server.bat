@echo off
chcp 65001 >nul
cd /d "%~dp0"

set "PORT=3300"

color 0A
echo.
echo.
echo     ########################################################
echo     #                                                      #
echo     #            QC 스케줄 로컬 서버를 시작합니다          #
echo     #                                                      #
echo     #     접속 주소 : http://localhost:3300                #
echo     #     서버 종료 : 이 창을 닫으세요                     #
echo     #                                                      #
echo     ########################################################
echo.
echo.

rem ── 이미 3300 포트를 쓰고 있는 기존 서버가 있으면 먼저 종료한다 ──
netstat -ano | findstr /c:"LISTENING" | findstr /c:":%PORT% " >nul
if not errorlevel 1 (
    echo     [i]  %PORT% 포트를 쓰고 있는 기존 서버를 종료합니다.
    for /f "tokens=5" %%P in ('netstat -ano ^| findstr /c:"LISTENING" ^| findstr /c:":%PORT% "') do (
        if not "%%P"=="0" taskkill /f /pid %%P >nul 2>&1
    )
    rem 포트가 완전히 해제될 때까지 잠시 기다린다
    ping -n 3 127.0.0.1 >nul
    echo     [i]  기존 서버를 종료했습니다.
    echo.
)

netstat -ano | findstr /c:"LISTENING" | findstr /c:":%PORT% " >nul
if not errorlevel 1 (
    color 0C
    echo     [!]  %PORT% 포트를 비우지 못했습니다.
    echo     [!]  기존 서버 창을 직접 닫은 뒤 다시 실행하세요.
    echo.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo     [i]  의존성을 설치합니다. 잠시만 기다려 주세요.
    call npm install
    if errorlevel 1 (
        color 0C
        echo     [!]  npm install 에 실패했습니다.
        echo.
        pause
        exit /b 1
    )
)

color 07
call npm run dev

color 0A
echo.
echo.
echo     ########################################################
echo     #                                                      #
echo     #              서버가 멈췄습니다                       #
echo     #                                                      #
echo     #     이 창을 닫고                                     #
echo     #     local-server.bat 을 다시 실행하세요              #
echo     #                                                      #
echo     ########################################################
echo.
echo.
pause
