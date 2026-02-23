@echo off
echo Pushing backend to GitHub...
cd /d "%~dp0"

git remote add origin https://github.com/jeanaih/cook-server.git 2>nul
if errorlevel 1 (
    echo Remote already exists, updating URL...
    git remote set-url origin https://github.com/jeanaih/cook-server.git
)

git branch -M main
git add .
git commit -m "Backend server update" 2>nul
if errorlevel 1 (
    echo No changes to commit or commit failed
)

git push -u origin main

echo.
echo Done! Check the output above for any errors.
pause
