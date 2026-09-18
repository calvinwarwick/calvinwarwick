$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

if (-not (Test-Path .venv)) {
  py -3 -m venv .venv
}
& .\.venv\Scripts\Activate.ps1
pip install -e ".[dev]"

Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$Root\frontend'; if (-not (Test-Path node_modules)) { npm install }; npm run dev"
python -m bfclips serve
