# Starts the three RoleFit AI services in separate windows (Windows PowerShell).
# Prerequisites: see README "Installation". Uses server/.env and backend/.env.
#   -LocalDb   use the bundled local mongod (no MongoDB install needed; data in server/.mongo-data)
param([switch]$LocalDb)
$root = $PSScriptRoot
$serverCmd = if ($LocalDb) { 'npm run dev:localdb' } else { 'npm run dev' }
Start-Process powershell -ArgumentList '-NoExit', '-Command', "cd '$root\backend'; .\.venv\Scripts\python.exe run.py"
Start-Process powershell -ArgumentList '-NoExit', '-Command', "cd '$root\server'; $serverCmd"
Start-Process powershell -ArgumentList '-NoExit', '-Command', "cd '$root\frontend'; npm run dev"
Write-Host 'AI service: http://127.0.0.1:8000/docs (internal)'
Write-Host 'API:        http://127.0.0.1:5000/api/health'
Write-Host 'App:        http://localhost:5173'
