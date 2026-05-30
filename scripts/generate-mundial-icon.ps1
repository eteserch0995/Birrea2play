Add-Type -AssemblyName System.Drawing

# Reemplaza assets/mundial/mundial-logo.png (trofeo FIFA + texto "FIFA WORLD CUP")
# por un icono GENERICO: tile oscuro de marca + "26" de fondo + copa generica dorada.
# Respalda el original FIFA a un .bak NO referenciado (no se empaqueta en el bundle).

$AssetDir = Join-Path $PSScriptRoot "..\assets\mundial"
$Target = Join-Path $AssetDir "mundial-logo.png"
$Backup = Join-Path $AssetDir "mundial-logo.fifa-original.bak"

if ((Test-Path $Target) -and -not (Test-Path $Backup)) {
  Copy-Item $Target $Backup
  Write-Host "Backup -> $Backup"
}

$S = 1254

$bg1   = [System.Drawing.ColorTranslator]::FromHtml("#16203A")
$bg2   = [System.Drawing.ColorTranslator]::FromHtml("#080B11")
$num   = [System.Drawing.ColorTranslator]::FromHtml("#243049")
$gold  = [System.Drawing.ColorTranslator]::FromHtml("#FFD700")
$neon  = [System.Drawing.ColorTranslator]::FromHtml("#B8FF00")

function Brush($c) { New-Object System.Drawing.SolidBrush($c) }
function ABrush($a, $c) { New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb([int]$a, $c)) }
function APen($a, $c, $w) { New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb([int]$a, $c), [single]$w) }
function FontC($n, $sz, $st) { New-Object System.Drawing.Font($n, [single]$sz, $st, [System.Drawing.GraphicsUnit]::Pixel) }

function RoundedPath($x, $y, $w, $h, $r) {
  $d = $r * 2
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

$bmp = New-Object System.Drawing.Bitmap($S, $S)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$g.Clear([System.Drawing.Color]::Transparent)

# Tile squircle con degradado de marca
$tile = RoundedPath 36 36 ($S - 72) ($S - 72) 280
$rect = New-Object System.Drawing.RectangleF(0, 0, [single]$S, [single]$S)
$lg = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $bg1, $bg2, [single]60)
$g.FillPath($lg, $tile)
$lg.Dispose()

# "26" de fondo (sutil, detras)
$fmt = New-Object System.Drawing.StringFormat
$fmt.Alignment = [System.Drawing.StringAlignment]::Center
$fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
$f26 = FontC "Arial Black" 720 ([System.Drawing.FontStyle]::Bold)
$nb = Brush $num
$g.DrawString("26", $f26, $nb, $rect, $fmt)
$nb.Dispose(); $f26.Dispose()

# Glow dorado detras de la copa
for ($i = 6; $i -ge 1; $i--) {
  $a = [int](70 * $i / 14)
  $rr = 300 * $i / 6
  $b = ABrush $a $gold
  $g.FillEllipse($b, [single](627 - $rr), [single](660 - $rr), [single]($rr * 2), [single]($rr * 2))
  $b.Dispose()
}

# Copa GENERICA dorada (cuenco + 2 asas + pie) - centrada, escala grande
function Draw-Trophy($x, $y, $s) {
  $gb = Brush $gold
  $gp = APen 255 $gold (7 * $s)
  $g.FillRectangle($gb, [single]($x + 48 * $s), [single]($y + 28 * $s), [single](74 * $s), [single](92 * $s))
  $g.FillEllipse($gb, [single]($x + 34 * $s), [single]$y, [single](102 * $s), [single](58 * $s))
  $g.DrawArc($gp, [single]$x, [single]($y + 20 * $s), [single](70 * $s), [single](75 * $s), 180, 130)
  $g.DrawArc($gp, [single]($x + 100 * $s), [single]($y + 20 * $s), [single](70 * $s), [single](75 * $s), 230, 130)
  $g.FillRectangle($gb, [single]($x + 72 * $s), [single]($y + 118 * $s), [single](26 * $s), [single](48 * $s))
  $g.FillRectangle($gb, [single]($x + 38 * $s), [single]($y + 166 * $s), [single](94 * $s), [single](24 * $s))
  $gb.Dispose(); $gp.Dispose()
}
$ts = 3.0
$tw = 170 * $ts
$th = 190 * $ts
Draw-Trophy (627 - $tw / 2) (660 - $th / 2) $ts

# Borde sutil del tile (lima) + base "2026"
$ep = APen 150 $neon 6
$g.DrawPath($ep, $tile); $ep.Dispose()
$f2026 = FontC "Arial Narrow" 120 ([System.Drawing.FontStyle]::Bold)
$rb = New-Object System.Drawing.RectangleF(0, [single]($S - 230), [single]$S, 140)
$nbz = Brush $neon
$g.DrawString("2026", $f2026, $nbz, $rb, $fmt)
$nbz.Dispose(); $f2026.Dispose(); $fmt.Dispose()

$g.Dispose()
$tile.Dispose()
$bmp.Save($Target, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Host "OK icono generico -> $Target ($S x $S)"
