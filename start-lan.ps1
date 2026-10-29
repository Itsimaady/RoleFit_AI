Write-Host "Starting RoleFit-AI LAN demo..." -ForegroundColor Cyan
Write-Host "Backend:  http://192.168.169.155:8000/docs"
Write-Host "Frontend: http://192.168.169.155:5173"
Write-Host "Make sure teammates are on the same Wi-Fi."

Start-Process powershell -ArgumentList '-NoExit','-Command',"cd '$PSScriptRoot\\backend'; .\\.venv\\Scripts\\Activate.ps1; python run.py"
Start-Process powershell -ArgumentList '-NoExit','-Command',"cd '$PSScriptRoot\\frontend'; npm run dev -- --host 0.0.0.0"
