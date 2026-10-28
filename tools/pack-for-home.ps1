param(
    [Parameter(Mandatory)][string]$ExistingExe,
    [Parameter(Mandatory)][ValidateRange(4,999)][int]$HandoffNumber,
    [Parameter(Mandatory)][string]$OutputDirectory,
    [string]$DataPath = (Join-Path $env:APPDATA 'com.jishi.reminder/reminders.json')
)
$ErrorActionPreference = 'Stop'
$sourceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$exePath = (Resolve-Path -LiteralPath $ExistingExe).Path
$statePath = (Resolve-Path -LiteralPath $DataPath).Path
if (Get-Process | Where-Object { $_.Path -eq $exePath -or $_.ProcessName -in @('及时提醒','jishi-reminder') }) { throw '请先从托盘退出及时提醒，再打包完整提醒和设置。脚本不会强制结束程序。' }
$state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
if (!$state.PSObject.Properties['reminders'] -or !$state.PSObject.Properties['settings'] -or $state.reminders -isnot [Array]) { throw '提醒状态文件缺少有效 reminders 或 settings，交接不完整。' }
$null = New-Item -ItemType Directory -Path $OutputDirectory -Force
$destination = (Resolve-Path -LiteralPath $OutputDirectory).Path
if ($destination -eq $sourceRoot -or $destination.StartsWith($sourceRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw '交接输出目录必须在源码目录之外，避免重复嵌套打包。' }
$stamp = [TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTime]::UtcNow,'China Standard Time').ToString('yyyyMMdd_HHmmss')
$name = '及时提醒_' + $stamp + '_公司到家_交接' + $HandoffNumber.ToString('000')
$folder = Join-Path $destination $name
$zip = $folder + '.zip'
if ((Test-Path -LiteralPath $folder) -or (Test-Path -LiteralPath $zip)) { throw '目标交接包已存在，拒绝覆盖。' }
$null = New-Item -ItemType Directory -Path $folder
foreach ($part in @('source','history','app','data')) { $null = New-Item -ItemType Directory -Path (Join-Path $folder $part) }
$head = & git -C $sourceRoot rev-parse HEAD
if ($LASTEXITCODE -ne 0) { throw '无法读取 Git HEAD，交接不完整。' }
$files = @(& git -C $sourceRoot ls-files --cached --others --exclude-standard) | Select-Object -Unique
foreach ($relative in $files) {
    if ($relative -match '(^|/)(target|node_modules|\.git)(/|$)' -or $relative -match '\.(zip|bundle|pem|pfx)$' -or $relative -match '(^|/)(\.env(\..*)?|reminders\.json|credentials\.json)$') { continue }
    $original = Join-Path $sourceRoot $relative
    if (!(Test-Path -LiteralPath $original -PathType Leaf)) { continue }
    $target = Join-Path (Join-Path $folder 'source') $relative
    $null = New-Item -ItemType Directory -Path (Split-Path $target) -Force
    Copy-Item -LiteralPath $original -Destination $target
}
& git -C $sourceRoot bundle create (Join-Path $folder 'history/source.bundle') --all
if ($LASTEXITCODE -ne 0) { throw 'Git Bundle 创建失败，交接不完整。' }
Copy-Item -LiteralPath $exePath -Destination (Join-Path $folder 'app/及时提醒.exe')
Copy-Item -LiteralPath $statePath -Destination (Join-Path $folder 'data/reminders.snapshot.json')
foreach ($doc in @('项目交接.md','需求与问题清单.md','更新记录.md','沟通记录摘录.md','回家首次开发任务.md')) { Copy-Item -LiteralPath (Join-Path $sourceRoot $doc) -Destination $folder }
$manifest = [ordered]@{handoff=$HandoffNumber;direction='公司到家';sourceHead=$head;uncommitted= @(& git -C $sourceRoot status --porcelain);reminders=@($state.reminders).Count;pending=@($state.reminders | Where-Object status -eq pending).Count;done=@($state.reminders | Where-Object status -eq done).Count;dataSha256=(Get-FileHash -LiteralPath $statePath).Hash;exeSha256=(Get-FileHash -LiteralPath $exePath).Hash;exeMatchesSource='由调用者核对；本脚本不重建 EXE';note='包含当前未提交源码与完整 Git 历史。真实提醒只在本地交接包内，禁止上传公开仓库。'}
$manifest | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $folder '交接清单.json') -Encoding utf8
Compress-Archive -LiteralPath $folder -DestinationPath $zip
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($zip)
try {
    $entry = $archive.Entries | Where-Object FullName -like '*data/reminders.snapshot.json' | Select-Object -First 1
    if (!$entry) { throw 'ZIP 缺少提醒快照，交接不完整。' }
    $reader = [IO.StreamReader]::new($entry.Open())
    try { $packed = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
    if (@($packed.reminders).Count -ne @($state.reminders).Count) { throw 'ZIP 提醒数量不一致，交接不完整。' }
} finally { $archive.Dispose() }
Write-Output ('完整交接包：' + $zip)
Write-Output ('提醒数量：' + @($state.reminders).Count)
