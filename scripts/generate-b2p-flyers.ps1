Add-Type -AssemblyName System.Drawing

$OutDir = Join-Path $PSScriptRoot "..\marketing\flyers"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$W = 1080
$H = 1350
$Safe = 64

$C = @{
  Bg = [System.Drawing.ColorTranslator]::FromHtml("#0A0E14")
  Magenta = [System.Drawing.ColorTranslator]::FromHtml("#FF1A6B")
  Gold = [System.Drawing.ColorTranslator]::FromHtml("#FFD700")
  Neon = [System.Drawing.ColorTranslator]::FromHtml("#B8FF00")
  White = [System.Drawing.ColorTranslator]::FromHtml("#FFFFFF")
  Gray = [System.Drawing.ColorTranslator]::FromHtml("#8C96A8")
}

function Brush($color) { New-Object System.Drawing.SolidBrush($color) }
function PenC($color, $width = 4) { New-Object System.Drawing.Pen($color, $width) }
function FontC($name, $size, $style = [System.Drawing.FontStyle]::Regular) {
  New-Object System.Drawing.Font($name, $size, $style, [System.Drawing.GraphicsUnit]::Pixel)
}

function New-Canvas {
  $bmp = New-Object System.Drawing.Bitmap($W, $H)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $g.Clear($C.Bg)
  return @($bmp, $g)
}

function Draw-Text($g, $text, $x, $y, $w, $h, $font, $color, $align = "Near", $shadow = $false) {
  $fmt = New-Object System.Drawing.StringFormat
  $fmt.Alignment = [System.Drawing.StringAlignment]::$align
  $fmt.LineAlignment = [System.Drawing.StringAlignment]::Near
  $fmt.Trimming = [System.Drawing.StringTrimming]::Word
  $fmt.FormatFlags = 0
  $rect = New-Object System.Drawing.RectangleF($x, $y, $w, $h)
  if ($shadow) {
    $shadowBrush = Brush([System.Drawing.Color]::FromArgb(170, 0, 0, 0))
    $shadowRect = New-Object System.Drawing.RectangleF(($x + 5), ($y + 6), $w, $h)
    $g.DrawString($text, $font, $shadowBrush, $shadowRect, $fmt)
    $shadowBrush.Dispose()
  }
  $b = Brush($color)
  $g.DrawString($text, $font, $b, $rect, $fmt)
  $b.Dispose()
  $fmt.Dispose()
}

function Draw-Logo($g, $x, $y, $scale = 1.0) {
  Draw-Text $g "Birrea" $x $y (240 * $scale) (50 * $scale) (FontC "Arial Narrow" (34 * $scale) ([System.Drawing.FontStyle]::Bold)) $C.White
  Draw-Text $g "2Play" ($x + 118 * $scale) $y (160 * $scale) (50 * $scale) (FontC "Arial Narrow" (34 * $scale) ([System.Drawing.FontStyle]::Bold)) $C.Neon
}

function Draw-TopLogo($g) { Draw-Logo $g $Safe 42 0.78 }

function Draw-Frame($g, $accent) {
  $p1 = PenC $accent 8
  $g.DrawRectangle($p1, 34, 34, $W - 68, $H - 68)
  $p1.Dispose()
  $p2 = PenC ([System.Drawing.Color]::FromArgb([int]70, [System.Drawing.Color]$accent)) 2
  for ($i = 0; $i -lt 6; $i++) {
    $g.DrawLine($p2, ($Safe + $i * 52), ($H - 140), ($Safe + 250 + $i * 52), ($H - 64))
  }
  $p2.Dispose()
}

function Draw-Ball($g, $cx, $cy, $r) {
  $white = Brush($C.White)
  $black = Brush([System.Drawing.Color]::FromArgb(245, 10, 14, 20))
  $g.FillEllipse($white, $cx - $r, $cy - $r, $r * 2, $r * 2)
  $g.FillPolygon($black, @(
    [System.Drawing.PointF]::new($cx, $cy - $r * 0.44),
    [System.Drawing.PointF]::new($cx + $r * 0.42, $cy - $r * 0.12),
    [System.Drawing.PointF]::new($cx + $r * 0.26, $cy + $r * 0.38),
    [System.Drawing.PointF]::new($cx - $r * 0.26, $cy + $r * 0.38),
    [System.Drawing.PointF]::new($cx - $r * 0.42, $cy - $r * 0.12)
  ))
  $pen = PenC ([System.Drawing.Color]::FromArgb(230, 10, 14, 20)) 5
  $g.DrawEllipse($pen, $cx - $r, $cy - $r, $r * 2, $r * 2)
  $white.Dispose(); $black.Dispose(); $pen.Dispose()
}

function Draw-Trophy($g, $x, $y, $s) {
  $gold = Brush($C.Gold)
  $dark = PenC $C.Gold 8
  $g.FillRectangle($gold, [System.Drawing.Rectangle]::new($x + 48 * $s, $y + 28 * $s, 74 * $s, 92 * $s))
  $g.FillEllipse($gold, $x + 34 * $s, $y, 102 * $s, 58 * $s)
  $g.DrawArc($dark, $x, $y + 20 * $s, 70 * $s, 75 * $s, 180, 130)
  $g.DrawArc($dark, $x + 100 * $s, $y + 20 * $s, 70 * $s, 75 * $s, 230, 130)
  $g.FillRectangle($gold, [System.Drawing.Rectangle]::new($x + 72 * $s, $y + 118 * $s, 26 * $s, 48 * $s))
  $g.FillRectangle($gold, [System.Drawing.Rectangle]::new($x + 38 * $s, $y + 166 * $s, 94 * $s, 24 * $s))
  $gold.Dispose(); $dark.Dispose()
}

function Draw-DarkPhoto($g, $x, $y, $w, $h, $accent) {
  $bg = Brush([System.Drawing.Color]::FromArgb(255, 20, 34, 26))
  $g.FillRectangle($bg, $x, $y, $w, $h)
  $bg.Dispose()
  $line = PenC ([System.Drawing.Color]::FromArgb([int]95, [System.Drawing.Color]$C.White)) 4
  $g.DrawRectangle($line, $x + 55, $y + 70, $w - 110, $h - 140)
  $g.DrawEllipse($line, $x + $w / 2 - 90, $y + $h / 2 - 90, 180, 180)
  for ($i = 0; $i -lt 9; $i++) {
    $px = $x + 90 + ($i % 3) * 230
    $py = $y + 160 + [Math]::Floor($i / 3) * 150
    $body = Brush([System.Drawing.Color]::FromArgb(210, $accent))
    $head = Brush([System.Drawing.Color]::FromArgb(230, 255, 255, 255))
    $g.FillEllipse($head, $px, $py, 34, 34)
    $g.FillRectangle($body, $px - 8, $py + 38, 50, 70)
    $body.Dispose(); $head.Dispose()
  }
  Draw-Ball $g ($x + $w - 155) ($y + $h - 150) 42
  $overlay = Brush([System.Drawing.Color]::FromArgb(120, 10, 14, 20))
  $g.FillRectangle($overlay, $x, $y, $w, $h)
  $overlay.Dispose(); $line.Dispose()
}

function Draw-PhoneMock($g, $x, $y, $w, $h) {
  $outer = Brush([System.Drawing.Color]::FromArgb(255, 245, 245, 245))
  $inner = Brush($C.Bg)
  $g.FillRectangle($outer, [System.Drawing.Rectangle]::new($x, $y, $w, $h))
  $g.FillRectangle($inner, [System.Drawing.Rectangle]::new($x + 18, $y + 18, $w - 36, $h - 36))
  Draw-Text $g "Birrea2Play" ($x + 42) ($y + 56) ($w - 84) 45 (FontC "Arial Narrow" 32 ([System.Drawing.FontStyle]::Bold)) $C.Neon
  $card = Brush([System.Drawing.Color]::FromArgb(255, 24, 30, 42))
  $g.FillRectangle($card, [System.Drawing.Rectangle]::new($x + 42, $y + 135, $w - 84, 190))
  Draw-Text $g "Fútbol 7" ($x + 70) ($y + 165) ($w - 140) 44 (FontC "Arial Narrow" 34 ([System.Drawing.FontStyle]::Bold)) $C.White
  Draw-Text $g "Hoy · 8:00 PM" ($x + 70) ($y + 220) ($w - 140) 32 (FontC "Segoe UI" 22) $C.Gray
  Draw-Text $g "Cupos 11/14" ($x + 70) ($y + 265) ($w - 140) 36 (FontC "Segoe UI Semibold" 24) $C.Neon
  $btn = Brush($C.Magenta)
  $g.FillRectangle($btn, [System.Drawing.Rectangle]::new($x + 66, $y + 370, $w - 132, 72))
  Draw-Text $g "INSCRIBIRME" ($x + 66) ($y + 385) ($w - 132) 50 (FontC "Arial Narrow" 34 ([System.Drawing.FontStyle]::Bold)) $C.White "Center"
  $outer.Dispose(); $inner.Dispose(); $card.Dispose(); $btn.Dispose()
}

function Save-Slide($bmp, $g, $name) {
  $g.Dispose()
  $path = Join-Path $OutDir $name
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host $path
}

# Slide 1
$cv = New-Canvas; $bmp = $cv[0]; $g = $cv[1]
Draw-DarkPhoto $g 0 0 $W $H $C.Magenta
Draw-Frame $g $C.Magenta
Draw-Logo $g $Safe 80 1.45
Draw-Text $g "¿ARMÁS BIRRIAS`nCON TUS PANAS?" $Safe 255 ($W - 128) 300 (FontC "Arial Narrow" 102 ([System.Drawing.FontStyle]::Bold)) $C.White "Near" $true
Draw-Text $g "Dejá el quilombo del WhatsApp." $Safe 575 ($W - 128) 70 (FontC "Segoe UI Semibold" 36) $C.White "Near" $true
Draw-Ball $g 835 865 105
Draw-Text $g "deslizá →" 690 1180 300 60 (FontC "Segoe UI Semibold" 34) $C.Neon "Far"
Save-Slide $bmp $g "b2p_carrusel_01.png"

# Slide 2
$cv = New-Canvas; $bmp = $cv[0]; $g = $cv[1]
Draw-Frame $g $C.Magenta; Draw-TopLogo $g
Draw-Text $g "ORGANIZAR NO`nDEBERÍA SER`nUN TRABAJO" $Safe 185 ($W - 128) 380 (FontC "Arial Narrow" 94 ([System.Drawing.FontStyle]::Bold)) $C.White
$box = Brush([System.Drawing.Color]::FromArgb(255, 20, 26, 38))
$g.FillRectangle($box, [System.Drawing.Rectangle]::new($Safe, 650, $W - 128, 360))
Draw-Text $g "Cobrarle a cada uno. Armar los equipos. Llenar el cupo. Que no falte nadie." 104 715 ($W - 208) 240 (FontC "Segoe UI Semibold" 44) $C.White
Draw-Ball $g 850 1115 70
$box.Dispose(); Save-Slide $bmp $g "b2p_carrusel_02.png"

# Slide 3
$cv = New-Canvas; $bmp = $cv[0]; $g = $cv[1]
Draw-Frame $g $C.Neon; Draw-TopLogo $g
Draw-Text $g "BIRREA2PLAY`nLO HACE`nPOR VOS" $Safe 160 ($W - 128) 350 (FontC "Arial Narrow" 95 ([System.Drawing.FontStyle]::Bold)) $C.White
$items = @("Cupos en tiempo real", "Pagos por Yappy o créditos", "Equipos y lista de espera", "Ranking y MVP")
for ($i = 0; $i -lt $items.Count; $i++) {
  $y = 600 + $i * 126
  $itemBrush = Brush([System.Drawing.Color]::FromArgb(255, 20, 26, 38))
  $g.FillRectangle($itemBrush, [System.Drawing.Rectangle]::new($Safe, $y, $W - 128, 92))
  $itemBrush.Dispose()
  Draw-Text $g "✓" 104 ($y + 18) 44 55 (FontC "Segoe UI Semibold" 42) $C.Magenta
  Draw-Text $g $items[$i] 160 ($y + 23) ($W - 240) 55 (FontC "Segoe UI Semibold" 34) $C.White
}
Save-Slide $bmp $g "b2p_carrusel_03.png"

# Slide 4
$cv = New-Canvas; $bmp = $cv[0]; $g = $cv[1]
Draw-Frame $g $C.Magenta; Draw-TopLogo $g
Draw-Text $g "EN 3 PASOS" $Safe 155 520 120 (FontC "Arial Narrow" 105 ([System.Drawing.FontStyle]::Bold)) $C.White
Draw-Text $g "1. Buscás la birria`n2. Te inscribís y pagás`n3. Llegás y jugás" $Safe 345 500 300 (FontC "Segoe UI Semibold" 42) $C.White
Draw-PhoneMock $g 610 220 360 740
Draw-Ball $g 225 1035 78
Save-Slide $bmp $g "b2p_carrusel_04.png"

# Slide 5
$cv = New-Canvas; $bmp = $cv[0]; $g = $cv[1]
Draw-Frame $g $C.Gold; Draw-TopLogo $g
Draw-Text $g "Y SE VIENE`nLO GRANDE" $Safe 180 ($W - 128) 270 (FontC "Arial Narrow" 108 ([System.Drawing.FontStyle]::Bold)) $C.Gold
Draw-Text $g "Polla del Mundial 2026 + Survivor" $Safe 500 ($W - 128) 70 (FontC "Segoe UI Semibold" 38) $C.White
$teaserBrush = Brush([System.Drawing.Color]::FromArgb(255, 22, 28, 38))
$g.FillRectangle($teaserBrush, [System.Drawing.Rectangle]::new($Safe, 620, $W - 128, 260))
$teaserBrush.Dispose()
Draw-Text $g "Premio real.`nContra tus panas." 104 665 ($W - 208) 150 (FontC "Arial Narrow" 66 ([System.Drawing.FontStyle]::Bold)) $C.White
Draw-Text $g "Muy pronto en la app" 104 815 ($W - 208) 55 (FontC "Segoe UI Semibold" 34) $C.Gold
Draw-Trophy $g 735 935 1
Save-Slide $bmp $g "b2p_carrusel_05.png"

# Slide 6
$cv = New-Canvas; $bmp = $cv[0]; $g = $cv[1]
Draw-Frame $g $C.Neon; Draw-TopLogo $g
Draw-Text $g "TU PRÓXIMA`nBIRRIA,`nA UN TOQUE" $Safe 145 520 315 (FontC "Arial Narrow" 92 ([System.Drawing.FontStyle]::Bold)) $C.White
Draw-Text $g "Decenas de jugadas ya armadas en Panamá." $Safe 500 ($W - 128) 70 (FontC "Segoe UI Semibold" 34) $C.Gray
$gridY = 620
for ($i = 0; $i -lt 4; $i++) {
  $x = $Safe + ($i % 2) * 480
  $y = $gridY + [Math]::Floor($i / 2) * 250
  Draw-DarkPhoto $g $x $y 430 210 $(if ($i % 2 -eq 0) { $C.Magenta } else { $C.Neon })
}
Draw-PhoneMock $g 710 875 260 350
Save-Slide $bmp $g "b2p_carrusel_06.png"

# Slide 7
$cv = New-Canvas; $bmp = $cv[0]; $g = $cv[1]
Draw-Frame $g $C.Neon
Draw-Logo $g $Safe 95 1.7
Draw-Text $g "ENTRÁ A →`nbirrea2play.com" $Safe 255 ($W - 128) 270 (FontC "Arial Narrow" 88 ([System.Drawing.FontStyle]::Bold)) $C.White
Draw-Text $g "Armá tu próxima birria hoy." $Safe 555 ($W - 128) 70 (FontC "Segoe UI Semibold" 38) $C.White
$linkBox = Brush([System.Drawing.Color]::FromArgb(255, 184, 255, 0))
$g.FillRectangle($linkBox, [System.Drawing.Rectangle]::new($Safe, 720, $W - 128, 150))
Draw-Text $g "birrea2play.com" $Safe 755 ($W - 128) 90 (FontC "Arial Narrow" 74 ([System.Drawing.FontStyle]::Bold)) $C.Bg "Center"
Draw-Text $g "Seguinos para no perderte la Polla del Mundial" $Safe 945 ($W - 128) 130 (FontC "Segoe UI Semibold" 34) $C.White "Center"
Draw-Ball $g 815 1135 82
Draw-Trophy $g 155 1080 0.72
$linkBox.Dispose(); Save-Slide $bmp $g "b2p_carrusel_07.png"
