$ErrorActionPreference = "Stop"

$bundledNode = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"

if (Test-Path $bundledNode) {
  & $bundledNode backend/server.js
  exit $LASTEXITCODE
}

$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
  & $node.Source backend/server.js
  exit $LASTEXITCODE
}

throw "Node.js non trovato. Installa Node 18+ oppure avvia da Codex con il runtime bundled."
