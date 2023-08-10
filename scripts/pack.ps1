Set-Location "$PSScriptRoot/.."
if (-not (Test-Path 'dist' -PathType Container)) { New-Item 'dist' -ItemType Directory }
Compress-Archive -Path 'manifest.json', 'main.js', 'styles.css' -DestinationPath './dist/dist.zip' -Force