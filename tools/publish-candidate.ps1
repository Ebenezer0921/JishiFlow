param([Parameter(Mandatory)][string]$Tag)
$ErrorActionPreference = 'Stop'
if ($Tag -notmatch '^v(\d+\.\d+\.\d+)-rc\.\d+$') { throw 'Only explicit rc prerelease tags are allowed.' }
$version = $Matches[1]
$manifest = Get-Content -LiteralPath 'src-tauri/Cargo.toml' -Raw
if ($manifest -notmatch ('(?m)^version = "' + [regex]::Escape($version) + '"\r?$')) { throw 'Tag does not match the package version.' }
if (-not $env:GH_TOKEN -or -not $env:GITHUB_REPOSITORY -or -not $env:GITHUB_SHA) { throw 'Run this publisher in the repository GitHub Actions workflow.' }
$root = (Get-Location).Path
$source = Join-Path $root 'src-tauri/target/release/jishi-reminder.exe'
if (-not (Test-Path -LiteralPath $source)) { throw 'Windows EXE is missing.' }
$stage = Join-Path $root "release-output/JishiFlow-$Tag-windows-x64"
New-Item -ItemType Directory -Force -Path $stage | Out-Null
Copy-Item -LiteralPath $source -Destination (Join-Path $stage '及时提醒.exe')
Copy-Item -LiteralPath "版本更新报告-v$version.md" -Destination $stage
@"
JishiFlow $Tag — Windows x64 预发布候选版

1. 先在当前版本设置中导出备份，并从托盘退出旧程序。
2. 将本 ZIP 解压到新文件夹，再运行“及时提醒.exe”。不要覆盖正在运行的程序。
3. 需要 Windows 已安装 WebView2 Runtime；本包不包含任何真实提醒或 QA 数据。

本候选增加四角定位、智能换列和重叠堆叠，并包含近期导入/图片/设置同步修复。
BUG-013 仍未关闭。多显示器、混合 DPI、真实跨屏拖动及全部大小组合仍待实机验收。
本包是 GitHub Actions 对同一源码的重新构建，不应将本地候选 EXE 的哈希用于校验本包。
"@ | Set-Content -LiteralPath (Join-Path $stage '使用说明.txt') -Encoding utf8

# Keep packaging independent of a developer machine's SDK/toolchain paths.
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
$dumpbin = & $vswhere -latest -products '*' -find 'VC/Tools/MSVC/**/bin/Hostx64/x64/dumpbin.exe' | Select-Object -First 1
if (-not $dumpbin) { throw 'Cannot verify native DLL dependencies.' }
$dependencies = & $dumpbin /dependents $source
if ($LASTEXITCODE) { throw 'dumpbin failed.' }
$dependencies | Set-Content -LiteralPath (Join-Path $stage 'DLL依赖.txt') -Encoding utf8
$system = @('kernel32.dll','advapi32.dll','bcryptprimitives.dll','ntdll.dll','user32.dll','ole32.dll','gdi32.dll','shlwapi.dll','comctl32.dll','shell32.dll','dwmapi.dll','combase.dll','imm32.dll','oleaut32.dll','bcrypt.dll','ws2_32.dll','secur32.dll','crypt32.dll','version.dll','winhttp.dll','winmm.dll','dbghelp.dll','rpcrt4.dll','ucrtbase.dll')
foreach ($line in $dependencies) {
  if ($line -match '^\s+([\w.-]+\.dll)\s*$') {
    $dll = $Matches[1].ToLowerInvariant()
    if ($dll -notlike 'api-ms-*' -and $dll -notlike 'ext-ms-*' -and $dll -notin $system) { throw "Unbundled non-system DLL: $dll" }
  }
}
$exeHash = (Get-FileHash -LiteralPath (Join-Path $stage '及时提醒.exe') -Algorithm SHA256).Hash
"$exeHash  及时提醒.exe" | Set-Content -LiteralPath (Join-Path $stage 'SHA256SUMS.txt') -Encoding utf8
$zip = Join-Path $root "release-output/JishiFlow-$Tag-windows-x64.zip"
Compress-Archive -LiteralPath $stage -DestinationPath $zip
$zipHash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash
$checksum = "$zip.sha256"
"$zipHash  $([IO.Path]::GetFileName($zip))" | Set-Content -LiteralPath $checksum -Encoding utf8

$api = "https://api.github.com/repos/$env:GITHUB_REPOSITORY"
$headers = @{ Authorization="Bearer $env:GH_TOKEN"; Accept='application/vnd.github+json'; 'User-Agent'='JishiFlow-candidate-release'; 'X-GitHub-Api-Version'='2022-11-28' }
$body = @"
## v$version 候选版

- 四格定位示意，切换后已有卡片在各自工作区立即重排。
- 默认智能换列，空间不足退为重叠；支持直接选择重叠堆叠。
- 包含近期提醒设置同步、严格日期导入、图片拖入和按钮反馈修复。

**这是预发布版。BUG-013 保持未关闭；多显示器、混合 DPI 和完整人工验收仍待完成。**

下载 Windows x64 ZIP，解压后运行“及时提醒.exe”。需要 WebView2 Runtime。先导出备份并从托盘退出旧版本。本包不含提醒数据或隔离测试数据。

GitHub Actions 已运行前端回归、Rust 单元测试、Windows release 构建和 DLL 依赖检查；这些不代替 Windows 人工界面验收。

ZIP SHA-256: ``$zipHash``

源码提交：$env:GITHUB_SHA
"@
# A draft prevents an incomplete Release being published if an upload fails.
$payload = @{ tag_name=$Tag; target_commitish=$env:GITHUB_SHA; name="JishiFlow $Tag · Windows 候选版"; body=$body; prerelease=$true; draft=$true; make_latest='false' } | ConvertTo-Json
$release = Invoke-RestMethod -Method Post -Uri "$api/releases" -Headers $headers -Body $payload -ContentType 'application/json; charset=utf-8'
$upload = $release.upload_url -replace '\{.*\}$',''
foreach ($asset in @($zip,$checksum)) {
  $name = [Uri]::EscapeDataString([IO.Path]::GetFileName($asset))
  Invoke-RestMethod -Method Post -Uri "${upload}?name=$name" -Headers $headers -InFile $asset -ContentType 'application/octet-stream' | Out-Null
}
$published = Invoke-RestMethod -Method Patch -Uri "$api/releases/$($release.id)" -Headers $headers -Body (@{draft=$false;prerelease=$true;make_latest='false'} | ConvertTo-Json) -ContentType 'application/json; charset=utf-8'
"Published prerelease: $($published.html_url)" | Add-Content -LiteralPath $env:GITHUB_STEP_SUMMARY
Write-Output "Published prerelease: $($published.html_url)"
