<#
.SYNOPSIS
  Build WebCraftBridge with the JDK 25 bundled with MSLX, without Gradle or network access.

.DESCRIPTION
  Extracts the official paper-api jar that is already bundled inside a Paper 26.2 jar
  (read-only) into %TEMP%, adds the Paper runtime's compile-time libraries from the adjacent
  libraries/ directory, compiles src/main/java with javac --release 25, and packages
  plugin.yml + config.yml into build/dist/WebCraftBridge-0.1.0.jar.

  Nothing under G:\Minecraftserver\DaemonData\Servers\1 is modified. The server does not
  need to be stopped. This only reads Paper jars/library files.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\build-local.ps1

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\build-local.ps1 `
    -PaperJar "C:\paper\paper-26.2-129.jar" -JdkHome "C:\Java\jdk-25"
#>
param(
    [string]$PaperJar = "G:\Minecraftserver\DaemonData\Servers\1\paper-26.2-129.jar",
    [string]$JdkHome = "G:\Minecraftserver\DaemonData\Tools\Java\25",
    # Optional: point at a paper-api jar you already have. If empty, it is extracted from PaperJar.
    [string]$ApiJar = "",
    # Directory containing the Paper server's libraries/ folder. Defaults to the folder next to PaperJar.
    [string]$LibrariesDirectory = "",
    [string]$OutputDirectory = ""
)

$ErrorActionPreference = "Stop"

$root = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = Join-Path $root "build"
}
$classes = Join-Path $OutputDirectory "classes"
$dist = Join-Path $OutputDirectory "dist"
$javac = Join-Path $JdkHome "bin\javac.exe"
$jarTool = Join-Path $JdkHome "bin\jar.exe"

if (-not (Test-Path $javac)) {
    throw "javac not found at $javac. Pass -JdkHome <jdk-25-home>."
}
if (-not (Test-Path $jarTool)) {
    throw "jar tool not found at $jarTool."
}
if (-not (Test-Path $PaperJar)) {
    throw "Paper jar not found at $PaperJar. Pass -PaperJar <paper-26.2.jar>."
}
$paperPath = (Resolve-Path $PaperJar).Path
if ([string]::IsNullOrWhiteSpace($LibrariesDirectory)) {
    $LibrariesDirectory = Join-Path (Split-Path $paperPath) "libraries"
}
if (-not (Test-Path $LibrariesDirectory)) {
    throw "Paper libraries directory not found at $LibrariesDirectory. Pass -LibrariesDirectory."
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$classpath = [System.Collections.Generic.List[string]]::new()
$temporaryApi = $null
$temporaryBungee = $null

function Add-LibraryJar {
    param(
        [string]$RelativeDirectory,
        [string]$Filter
    )
    $directory = Join-Path $LibrariesDirectory $RelativeDirectory
    if (-not (Test-Path $directory)) {
        throw "Missing library directory: $directory"
    }
    $jar = Get-ChildItem -Path $directory -Recurse -Filter $Filter |
        Sort-Object FullName -Descending |
        Select-Object -First 1
    if ($null -eq $jar) {
        throw "Missing $Filter under $directory"
    }
    $script:classpath.Add($jar.FullName)
}

try {
    if ([string]::IsNullOrWhiteSpace($ApiJar)) {
        $zip = [System.IO.Compression.ZipFile]::OpenRead($paperPath)
        try {
            $entry = $zip.Entries |
                Where-Object { $_.FullName -match '^META-INF/libraries/io/papermc/paper/paper-api/.+/paper-api-.+\.jar$' } |
                Select-Object -First 1
            if ($null -eq $entry) {
                throw "No bundled paper-api jar found inside $PaperJar. Pass -ApiJar <paper-api.jar>."
            }
            $temporaryApi = Join-Path $env:TEMP ("webcraft-paper-api-" + [Guid]::NewGuid().ToString("N") + ".jar")
            [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $temporaryApi, $true)
            $ApiJar = $temporaryApi
            Write-Host "Using bundled API: $($entry.FullName)"
        }
        finally {
            $zip.Dispose()
        }
    }

    if (-not (Test-Path $ApiJar)) {
        throw "paper-api jar not found at $ApiJar."
    }
    $classpath.Add((Resolve-Path $ApiJar).Path)

    # Compile-time dependencies declared by paper-api's POM. At runtime Paper supplies them.
    Add-LibraryJar "net\kyori\adventure-key" "adventure-key-*.jar"
    Add-LibraryJar "net\kyori\adventure-api" "adventure-api-*.jar"
    Add-LibraryJar "net\kyori\examination-api" "examination-api-*.jar"
    Add-LibraryJar "org\jetbrains\annotations" "annotations-*.jar"
    Add-LibraryJar "com\google\guava\guava" "guava-*.jar"

    # bungeecord-chat is needed because CommandSender.sendMessage is overloaded with BaseComponent.
    $bungeeDirectory = Join-Path $LibrariesDirectory "net\md-5\bungeecord-chat"
    if (Test-Path $bungeeDirectory) {
        Add-LibraryJar "net\md-5\bungeecord-chat" "bungeecord-chat-*.jar"
    }
    else {
        $zip = [System.IO.Compression.ZipFile]::OpenRead($paperPath)
        try {
            $bungeeEntry = $zip.Entries |
                Where-Object { $_.FullName -match '^META-INF/libraries/net/md-5/bungeecord-chat/.+\.jar$' } |
                Select-Object -First 1
            if ($null -eq $bungeeEntry) {
                throw "bungeecord-chat is missing from $LibrariesDirectory and $PaperJar."
            }
            $temporaryBungee = Join-Path $env:TEMP ("webcraft-bungee-chat-" + [Guid]::NewGuid().ToString("N") + ".jar")
            [System.IO.Compression.ZipFileExtensions]::ExtractToFile($bungeeEntry, $temporaryBungee, $true)
            $classpath.Add($temporaryBungee)
        }
        finally {
            $zip.Dispose()
        }
    }

    if (Test-Path $classes) {
        Remove-Item -Path $classes -Recurse -Force
    }
    New-Item -ItemType Directory -Path $classes -Force | Out-Null
    New-Item -ItemType Directory -Path $dist -Force | Out-Null

    $sources = @(Get-ChildItem -Path (Join-Path $root "src\main\java") -Recurse -Filter "*.java" |
        ForEach-Object { $_.FullName })
    if ($sources.Count -eq 0) {
        throw "No Java sources found under src/main/java."
    }

    $compileClasspath = $classpath -join [System.IO.Path]::PathSeparator
    Write-Host "Compiling $($sources.Count) source file(s) with $javac ..."
    & $javac "-encoding" "UTF-8" "--release" "25" "-Xlint:deprecation" "-cp" $compileClasspath "-d" $classes $sources
    if ($LASTEXITCODE -ne 0) {
        throw "javac failed with exit code $LASTEXITCODE."
    }

    Copy-Item -Path (Join-Path $root "src\main\resources\*") -Destination $classes -Recurse -Force

    $outputJar = Join-Path $dist "WebCraftBridge-0.1.0.jar"
    if (Test-Path $outputJar) {
        Remove-Item -Path $outputJar -Force
    }
    & $jarTool "--create" "--file" $outputJar "-C" $classes "."
    if ($LASTEXITCODE -ne 0) {
        throw "jar failed with exit code $LASTEXITCODE."
    }

    Write-Host ""
    Write-Host "Built: $outputJar"
    Write-Host ""
    Write-Host "Install (only when you choose to restart your server):"
    Write-Host "  Copy-Item '$outputJar' 'G:\Minecraftserver\DaemonData\Servers\1\plugins\'"
}
finally {
    if ($null -ne $temporaryApi -and (Test-Path $temporaryApi)) {
        Remove-Item -Path $temporaryApi -Force -ErrorAction SilentlyContinue
    }
    if ($null -ne $temporaryBungee -and (Test-Path $temporaryBungee)) {
        Remove-Item -Path $temporaryBungee -Force -ErrorAction SilentlyContinue
    }
}
