Add-Type -AssemblyName System.Drawing

# ============================================================
# Generador de flyers MUNDIAL 2026 - Birrea2Play
# Tokens reales de constants/themeMundial.js (COLORS_WC)
# Salida: marketing/flyers/b2p_mundial_*.png  (1080x1350, feed 4:5)
# Trofeo GENERICO (no FIFA). Texto horneado nitido.
# ============================================================

$OutDir = Join-Path $PSScriptRoot "..\marketing\flyers"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$W = 1080
$H = 1350
$Safe = 64

$C = @{
  Bg        = [System.Drawing.ColorTranslator]::FromHtml("#0A0E14")
  Card      = [System.Drawing.ColorTranslator]::FromHtml("#141821")
  Card2     = [System.Drawing.ColorTranslator]::FromHtml("#1C2230")
  Magenta   = [System.Drawing.ColorTranslator]::FromHtml("#FF1A6B")
  Blue      = [System.Drawing.ColorTranslator]::FromHtml("#0033CC")
  BlueLt    = [System.Drawing.ColorTranslator]::FromHtml("#3D6BFF")
  Purple    = [System.Drawing.ColorTranslator]::FromHtml("#6E22FF")
  Red       = [System.Drawing.ColorTranslator]::FromHtml("#E1062C")
  RedLt     = [System.Drawing.ColorTranslator]::FromHtml("#FF2D4E")
  Gold      = [System.Drawing.ColorTranslator]::FromHtml("#FFD700")
  Neon      = [System.Drawing.ColorTranslator]::FromHtml("#B8FF00")
  Green     = [System.Drawing.ColorTranslator]::FromHtml("#23D18B")
  White     = [System.Drawing.ColorTranslator]::FromHtml("#FFFFFF")
  Gray      = [System.Drawing.ColorTranslator]::FromHtml("#8C96A8")
}

function Brush($color) { New-Object System.Drawing.SolidBrush($color) }
function ABrush($alpha, $color) { New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb([int]$alpha, $color)) }
function PenC($color, $width = 4) { New-Object System.Drawing.Pen($color, [single]$width) }
function APen($alpha, $color, $width = 4) { New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb([int]$alpha, $color), [single]$width) }
function FontC($name, $size, $style = [System.Drawing.FontStyle]::Regular) {
  New-Object System.Drawing.Font($name, [single]$size, $style, [System.Drawing.GraphicsUnit]::Pixel)
}
$Head = "Arial Narrow"
$Body = "Segoe UI Semibold"
$BodyR = "Segoe UI"

function New-Canvas {
  $bmp = New-Object System.Drawing.Bitmap($W, $H)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $g.Clear($C.Bg)
  return @($bmp, $g)
}

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

function Fill-Round($g, $x, $y, $w, $h, $r, $brush) {
  $p = RoundedPath $x $y $w $h $r
  $g.FillPath($brush, $p); $p.Dispose()
}
function Stroke-Round($g, $x, $y, $w, $h, $r, $pen) {
  $p = RoundedPath $x $y $w $h $r
  $g.DrawPath($pen, $p); $p.Dispose()
}

function Draw-Text($g, $text, $x, $y, $w, $h, $font, $color, $align = "Near", $shadow = $false) {
  $fmt = New-Object System.Drawing.StringFormat
  $fmt.Alignment = [System.Drawing.StringAlignment]::$align
  $fmt.LineAlignment = [System.Drawing.StringAlignment]::Near
  $rect = New-Object System.Drawing.RectangleF([single]$x, [single]$y, [single]$w, [single]$h)
  if ($shadow) {
    $sb = ABrush 170 ([System.Drawing.Color]::Black)
    $sr = New-Object System.Drawing.RectangleF([single]($x + 4), [single]($y + 5), [single]$w, [single]$h)
    $g.DrawString($text, $font, $sb, $sr, $fmt); $sb.Dispose()
  }
  $b = Brush($color)
  $g.DrawString($text, $font, $b, $rect, $fmt)
  $b.Dispose(); $fmt.Dispose()
}

function Draw-Logo($g, $x, $y, $scale = 1.0) {
  Draw-Text $g "BIRREA" $x $y (400 * $scale) (70 * $scale) (FontC $Head (52 * $scale) ([System.Drawing.FontStyle]::Bold)) $C.White
  $off = [int](175 * $scale)
  Draw-Text $g "2PLAY" ($x + $off) $y (300 * $scale) (70 * $scale) (FontC $Head (52 * $scale) ([System.Drawing.FontStyle]::Bold)) $C.Neon
}
function Draw-TopLogo($g) {
  Draw-Logo $g $Safe 46 0.62
  Draw-Text $g "MUNDIAL 2026" $Safe 92 400 34 (FontC $Body 22) $C.Magenta
}

function Draw-Frame($g, $accent) {
  $p = APen 235 $accent 7
  Stroke-Round $g 30 30 ($W - 60) ($H - 60) 34 $p
  $p.Dispose()
}

function Draw-Trophy($g, $x, $y, $s) {
  # Copa generica dorada (NO FIFA): cuenco + 2 asas + pie
  $gold = Brush($C.Gold)
  $pen = PenC $C.Gold ([single](7 * $s))
  $g.FillRectangle($gold, [single]($x + 48 * $s), [single]($y + 28 * $s), [single](74 * $s), [single](92 * $s))
  $g.FillEllipse($gold, [single]($x + 34 * $s), [single]$y, [single](102 * $s), [single](58 * $s))
  $g.DrawArc($pen, [single]$x, [single]($y + 20 * $s), [single](70 * $s), [single](75 * $s), 180, 130)
  $g.DrawArc($pen, [single]($x + 100 * $s), [single]($y + 20 * $s), [single](70 * $s), [single](75 * $s), 230, 130)
  $g.FillRectangle($gold, [single]($x + 72 * $s), [single]($y + 118 * $s), [single](26 * $s), [single](48 * $s))
  $g.FillRectangle($gold, [single]($x + 38 * $s), [single]($y + 166 * $s), [single](94 * $s), [single](24 * $s))
  $gold.Dispose(); $pen.Dispose()
}

function Draw-Rays($g, $cx, $cy, $count, $len, $alpha, $color) {
  $pen = APen $alpha $color 7
  for ($i = 0; $i -lt $count; $i++) {
    $ang = ($i / $count) * 2 * [Math]::PI
    $x2 = $cx + [Math]::Cos($ang) * $len
    $y2 = $cy + [Math]::Sin($ang) * $len
    $g.DrawLine($pen, [single]$cx, [single]$cy, [single]$x2, [single]$y2)
  }
  $pen.Dispose()
}

function Draw-Heart($g, $cx, $cy, $s, $color, $alpha = 255) {
  $b = ABrush $alpha $color
  $lobe = $s * 0.6
  $g.FillEllipse($b, [single]($cx - $lobe), [single]($cy - $lobe * 0.6), [single]$lobe, [single]$lobe)
  $g.FillEllipse($b, [single]$cx, [single]($cy - $lobe * 0.6), [single]$lobe, [single]$lobe)
  $pts = @(
    [System.Drawing.PointF]::new([single]($cx - $lobe), [single]($cy + $lobe * 0.02)),
    [System.Drawing.PointF]::new([single]($cx + $lobe), [single]($cy + $lobe * 0.02)),
    [System.Drawing.PointF]::new([single]$cx, [single]($cy + $lobe * 1.25))
  )
  $g.FillPolygon($b, $pts)
  $b.Dispose()
}

function Draw-Check($g, $cx, $cy, $s, $color) {
  $pen = New-Object System.Drawing.Pen($color, [single]($s * 0.18))
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pts = [System.Drawing.PointF[]]@(
    [System.Drawing.PointF]::new([single]($cx - $s * 0.5), [single]$cy),
    [System.Drawing.PointF]::new([single]($cx - $s * 0.1), [single]($cy + $s * 0.4)),
    [System.Drawing.PointF]::new([single]($cx + $s * 0.55), [single]($cy - $s * 0.45))
  )
  $g.DrawLines($pen, $pts)
  $pen.Dispose()
}

function Draw-Ball($g, $cx, $cy, $r) {
  $white = Brush($C.White)
  $black = ABrush 245 $C.Bg
  $g.FillEllipse($white, [single]($cx - $r), [single]($cy - $r), [single]($r * 2), [single]($r * 2))
  $g.FillPolygon($black, @(
      [System.Drawing.PointF]::new([single]$cx, [single]($cy - $r * 0.44)),
      [System.Drawing.PointF]::new([single]($cx + $r * 0.42), [single]($cy - $r * 0.12)),
      [System.Drawing.PointF]::new([single]($cx + $r * 0.26), [single]($cy + $r * 0.38)),
      [System.Drawing.PointF]::new([single]($cx - $r * 0.26), [single]($cy + $r * 0.38)),
      [System.Drawing.PointF]::new([single]($cx - $r * 0.42), [single]($cy - $r * 0.12))
    ))
  $pen = APen 230 $C.Bg 5
  $g.DrawEllipse($pen, [single]($cx - $r), [single]($cy - $r), [single]($r * 2), [single]($r * 2))
  $white.Dispose(); $black.Dispose(); $pen.Dispose()
}

function Draw-Bracket($g, $x, $y, $alpha, $color) {
  $pen = APen $alpha $color 4
  $rows = @(0, 90, 220, 310)
  foreach ($r in $rows) {
    $g.DrawLine($pen, [single]$x, [single]($y + $r), [single]($x + 70), [single]($y + $r))
  }
  $g.DrawLine($pen, [single]($x + 70), [single]($y), [single]($x + 70), [single]($y + 90))
  $g.DrawLine($pen, [single]($x + 70), [single]($y + 220), [single]($x + 70), [single]($y + 310))
  $g.DrawLine($pen, [single]($x + 70), [single]($y + 45), [single]($x + 140), [single]($y + 45))
  $g.DrawLine($pen, [single]($x + 70), [single]($y + 265), [single]($x + 140), [single]($y + 265))
  $g.DrawLine($pen, [single]($x + 140), [single]($y + 45), [single]($x + 140), [single]($y + 265))
  $g.DrawLine($pen, [single]($x + 140), [single]($y + 155), [single]($x + 210), [single]($y + 155))
  $pen.Dispose()
}

function Glow-Disc($g, $cx, $cy, $r, $color, $alpha) {
  for ($i = 5; $i -ge 1; $i--) {
    $a = [int]($alpha * $i / 12)
    $rr = $r * $i / 5
    $b = ABrush $a $color
    $g.FillEllipse($b, [single]($cx - $rr), [single]($cy - $rr), [single]($rr * 2), [single]($rr * 2))
    $b.Dispose()
  }
}

function Save-Slide($bmp, $g, $name) {
  $g.Dispose()
  $path = Join-Path $OutDir $name
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host "OK $path"
}

# ============================================================
# M1 - TEASER "SE VIENE EL MUNDIAL 2026"
# ============================================================
$cv = New-Canvas; $bmp = $cv[0]; $g = $cv[1]
Glow-Disc $g 540 760 360 $C.Blue 120
Draw-Rays $g 540 760 28 520 28 $C.Magenta
Draw-Rays $g 540 760 28 460 22 $C.Purple
Draw-Frame $g $C.Neon
Draw-TopLogo $g
Draw-Text $g "SE VIENE EL" $Safe 200 ($W - 128) 110 (FontC $Head 96 ([System.Drawing.FontStyle]::Bold)) $C.White "Center" $true
Draw-Text $g "MUNDIAL 2026" $Safe 300 ($W - 128) 130 (FontC $Head 124 ([System.Drawing.FontStyle]::Bold)) $C.Gold "Center" $true
Glow-Disc $g 540 770 150 $C.Gold 90
Draw-Trophy $g 455 640 1.65
Draw-Text $g "POLLA MUNDIALISTA + SURVIVOR" $Safe 1006 ($W - 128) 56 (FontC $Head 48 ([System.Drawing.FontStyle]::Bold)) $C.Neon "Center" $true
Draw-Text $g "Premio real. Contra tus panas." $Safe 1068 ($W - 128) 44 (FontC $Body 34) $C.White "Center" $true
Fill-Round $g $Safe 1135 ($W - 128) 96 24 (Brush $C.Neon)
Draw-Text $g "birrea2play.com" $Safe 1155 ($W - 128) 60 (FontC $Head 56 ([System.Drawing.FontStyle]::Bold)) $C.Bg "Center"
Draw-Text $g "+18  -  pool entre amigos" $Safe 1252 ($W - 128) 34 (FontC $BodyR 22) $C.Gray "Center"
Save-Slide $bmp $g "b2p_mundial_01_teaser.png"

# ============================================================
# M2 - LA POLLA
# ============================================================
$cv = New-Canvas; $bmp = $cv[0]; $g = $cv[1]
Glow-Disc $g 760 540 300 $C.Magenta 90
Draw-Bracket $g 720 470 120 $C.Neon
Draw-Frame $g $C.Magenta
Draw-TopLogo $g
Draw-Text $g "POLLA" $Safe 175 ($W - 128) 130 (FontC $Head 132 ([System.Drawing.FontStyle]::Bold)) $C.White "Near" $true
Draw-Text $g "MUNDIALISTA" $Safe 300 ($W - 128) 120 (FontC $Head 124 ([System.Drawing.FontStyle]::Bold)) $C.Magenta "Near" $true
$items = @("Predeci 72 partidos + bracket", "Sumas puntos por acierto", "Top 3 se reparten el pozo")
for ($i = 0; $i -lt $items.Count; $i++) {
  $yy = 520 + $i * 110
  Fill-Round $g $Safe $yy 690 88 18 (Brush $C.Card)
  Draw-Check $g ($Safe + 50) ($yy + 44) 36 $C.Neon
  Draw-Text $g $items[$i] ($Safe + 100) ($yy + 22) 580 50 (FontC $Body 32) $C.White
}
Fill-Round $g $Safe 900 ($W - 128) 150 22 (Brush $C.Card2)
Draw-Text $g "POZO ACUMULADO" ($Safe + 40) 925 400 36 (FontC $Body 26) $C.Gray
Draw-Text $g "crece con cada inscrito" ($Safe + 40) 990 460 40 (FontC $BodyR 28) $C.White
Draw-Text $g "$" 760 915 180 130 (FontC $Head 120 ([System.Drawing.FontStyle]::Bold)) $C.Neon "Center"
Fill-Round $g $Safe 1085 ($W - 128) 92 22 (Brush $C.Neon)
Draw-Text $g "Inscribite en birrea2play.com" $Safe 1108 ($W - 128) 50 (FontC $Head 46 ([System.Drawing.FontStyle]::Bold)) $C.Bg "Center"
Draw-Text $g "+18  -  pool entre amigos, no es apuesta regulada" $Safe 1255 ($W - 128) 32 (FontC $BodyR 21) $C.Gray "Center"
Save-Slide $bmp $g "b2p_mundial_02_polla.png"

# ============================================================
# M3 - SURVIVOR
# ============================================================
$cv = New-Canvas; $bmp = $cv[0]; $g = $cv[1]
Glow-Disc $g 540 560 320 $C.Red 110
Draw-Rays $g 540 560 24 480 22 $C.Red
Draw-Frame $g $C.Red
Draw-TopLogo $g
Draw-Text $g "SURVIVOR" $Safe 185 ($W - 128) 150 (FontC $Head 168 ([System.Drawing.FontStyle]::Bold)) $C.White "Center" $true
Draw-Heart $g 360 600 130 $C.Red
Draw-Heart $g 540 600 130 $C.Red
Draw-Heart $g 720 600 130 $C.RedLt 110
Draw-Text $g "1 pick por jornada" $Safe 800 ($W - 128) 56 (FontC $Head 56 ([System.Drawing.FontStyle]::Bold)) $C.White "Center" $true
Draw-Text $g "3 vidas. Si tu equipo no gana, perdes una." $Safe 868 ($W - 128) 44 (FontC $Body 32) $C.Gray "Center"
Draw-Text $g "EL ULTIMO VIVO" $Safe 945 ($W - 128) 70 (FontC $Head 72 ([System.Drawing.FontStyle]::Bold)) $C.Red "Center" $true
Draw-Text $g "SE LLEVA EL POZO" $Safe 1015 ($W - 128) 70 (FontC $Head 72 ([System.Drawing.FontStyle]::Bold)) $C.Neon "Center" $true
Fill-Round $g $Safe 1120 ($W - 128) 92 22 (Brush $C.Neon)
Draw-Text $g "Jugá en birrea2play.com" $Safe 1143 ($W - 128) 50 (FontC $Head 46 ([System.Drawing.FontStyle]::Bold)) $C.Bg "Center"
Draw-Text $g "+18  -  pool entre amigos" $Safe 1252 ($W - 128) 32 (FontC $BodyR 22) $C.Gray "Center"
Save-Slide $bmp $g "b2p_mundial_03_survivor.png"

# ============================================================
# M4 - COUNTDOWN / CIERRE 11-JUN
# ============================================================
$cv = New-Canvas; $bmp = $cv[0]; $g = $cv[1]
Draw-Rays $g 540 540 30 560 18 $C.Neon
Draw-Frame $g $C.Neon
Draw-TopLogo $g
Draw-Text $g "ULTIMOS DIAS" $Safe 200 ($W - 128) 80 (FontC $Head 78 ([System.Drawing.FontStyle]::Bold)) $C.Magenta "Center" $true
Draw-Text $g "PARA INSCRIBIRTE" $Safe 280 ($W - 128) 90 (FontC $Head 92 ([System.Drawing.FontStyle]::Bold)) $C.White "Center" $true
$labels = @("DD", "HH", "MM")
for ($i = 0; $i -lt 3; $i++) {
  $bx = 120 + $i * 290
  Fill-Round $g $bx 470 250 250 24 (Brush $C.Card)
  Stroke-Round $g $bx 470 250 250 24 (APen 220 $C.Neon 4)
  Draw-Text $g "00" $bx 505 250 150 (FontC $Head 150 ([System.Drawing.FontStyle]::Bold)) $C.Neon "Center"
  Draw-Text $g $labels[$i] $bx 660 250 40 (FontC $Body 30) $C.Gray "Center"
}
Draw-Text $g "CIERRA EL 11 DE JUNIO" $Safe 800 ($W - 128) 70 (FontC $Head 72 ([System.Drawing.FontStyle]::Bold)) $C.White "Center" $true
Draw-Text $g "10:00 AM hora Panama" $Safe 875 ($W - 128) 46 (FontC $Body 34) $C.Gold "Center"
Draw-Text $g "Despues no entra nadie mas al pozo." $Safe 935 ($W - 128) 44 (FontC $BodyR 30) $C.Gray "Center"
Fill-Round $g $Safe 1040 ($W - 128) 100 24 (Brush $C.Neon)
Draw-Text $g "Inscribite YA en birrea2play.com" $Safe 1065 ($W - 128) 54 (FontC $Head 50 ([System.Drawing.FontStyle]::Bold)) $C.Bg "Center"
Draw-Ball $g 540 1230 60
Save-Slide $bmp $g "b2p_mundial_04_countdown.png"

# ============================================================
# M5 - PREMIO REAL / POZO
# ============================================================
$cv = New-Canvas; $bmp = $cv[0]; $g = $cv[1]
Glow-Disc $g 540 720 380 $C.Gold 70
Draw-Rays $g 540 720 32 520 26 $C.Neon
Draw-Frame $g $C.Gold
Draw-TopLogo $g
Draw-Text $g "PREMIO REAL" $Safe 195 ($W - 128) 130 (FontC $Head 132 ([System.Drawing.FontStyle]::Bold)) $C.Gold "Center" $true
Draw-Text $g "El pozo crece con cada inscrito" $Safe 330 ($W - 128) 50 (FontC $Body 36) $C.White "Center" $true
# confeti dorado
$confTriX = @(180, 320, 470, 640, 780, 900, 250, 720, 540)
$confTriY = @(560, 470, 540, 480, 560, 520, 900, 920, 470)
for ($i = 0; $i -lt $confTriX.Count; $i++) {
  $cb = ABrush 230 $C.Gold
  $g.FillEllipse($cb, [single]$confTriX[$i], [single]$confTriY[$i], 16, 16)
  $cb.Dispose()
}
Draw-Trophy $g 450 600 1.8
Fill-Round $g $Safe 980 ($W - 128) 150 22 (Brush $C.Card)
Draw-Text $g "Top 3 se reparten: 60% / 25% / 15%" ($Safe + 40) 1005 ($W - 200) 44 (FontC $Body 30) $C.White
Draw-Text $g "Pago por Yappy.  +18, pool entre amigos." ($Safe + 40) 1062 ($W - 200) 40 (FontC $BodyR 27) $C.Gray
Fill-Round $g $Safe 1160 ($W - 128) 96 24 (Brush $C.Neon)
Draw-Text $g "birrea2play.com" $Safe 1182 ($W - 128) 56 (FontC $Head 54 ([System.Drawing.FontStyle]::Bold)) $C.Bg "Center"
Save-Slide $bmp $g "b2p_mundial_05_pozo.png"

Write-Host "LISTO: 5 flyers Mundial en $OutDir"
