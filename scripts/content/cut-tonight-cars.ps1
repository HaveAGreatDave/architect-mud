# Cut the Tonight Show poster's two flying cars out of their sky, as PNGs with a transparent
# background, for the animated title card (scripts/content/build-tonight-card.mjs flies them).
#
#   powershell -ExecutionPolicy Bypass -File scripts/content/cut-tonight-cars.ps1 <poster.jpg>
#
# The poster is the JPEG embedded in data/scripts/Tonight_Show.bsm's tonight_show_logo asset.
# Writes data/scripts/tonight-card/car-l.png and car-r.png. Windows only (System.Drawing); the
# PNGs are committed, so this only needs running again if the poster or a box changes.
#
# The cut: the sky is the median colour of the box's border, and a pixel's opacity rises with
# its distance from that colour, so the cars' dark outlines and lit panels stay and the flat
# navy round them goes. Then specks of JPEG noise with too little car round them are dropped.
param([Parameter(Mandatory = $true)][string]$Poster)

Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Collections.Generic;
public static class CarCut {
  public static void Cut(Bitmap src, int bx, int by, int bw, int bh, string outPath) {
    var r = new int[bw * bh]; var g = new int[bw * bh]; var b = new int[bw * bh];
    for (int j = 0; j < bh; j++) for (int i = 0; i < bw; i++) {
      var c = src.GetPixel(bx + i, by + j); int k = j * bw + i; r[k] = c.R; g[k] = c.G; b[k] = c.B;
    }
    var br = new List<int>(); var bg = new List<int>(); var bb = new List<int>();
    for (int i = 0; i < bw; i++) foreach (int j in new[] { 0, bh - 1 }) { int k = j * bw + i; br.Add(r[k]); bg.Add(g[k]); bb.Add(b[k]); }
    for (int j = 0; j < bh; j++) foreach (int i in new[] { 0, bw - 1 }) { int k = j * bw + i; br.Add(r[k]); bg.Add(g[k]); bb.Add(b[k]); }
    br.Sort(); bg.Sort(); bb.Sort();
    int mr = br[br.Count / 2], mg = bg[bg.Count / 2], mb = bb[bb.Count / 2];
    var a = new double[bw * bh];
    for (int k = 0; k < bw * bh; k++) {
      double d = Math.Sqrt((r[k] - mr) * (r[k] - mr) + (g[k] - mg) * (g[k] - mg) + (b[k] - mb) * (b[k] - mb));
      a[k] = Math.Max(0, Math.Min(1, (d - 18) / 24.0));
    }
    // drop the specks first
    var keep = new double[bw * bh];
    for (int j = 0; j < bh; j++) for (int i = 0; i < bw; i++) {
      double s = 0;
      for (int dj = -2; dj <= 2; dj++) for (int di = -2; di <= 2; di++) {
        int ii = i + di, jj = j + dj;
        if (ii >= 0 && jj >= 0 && ii < bw && jj < bh) s += a[jj * bw + ii];
      }
      int k0 = j * bw + i;
      keep[k0] = s < 6 ? 0 : a[k0];
    }
    // SOLID INSIDE. A car's dark navy panels are close to the sky's colour, so the key fades
    // them and whatever flies behind shows through. The sky is what's reachable from the box's
    // edge through near-clear pixels; anything it can't reach is inside the outline, and opaque.
    var outside = new bool[bw * bh];
    var q = new Queue<int>();
    for (int i = 0; i < bw; i++) { q.Enqueue(i); q.Enqueue((bh - 1) * bw + i); }
    for (int j = 0; j < bh; j++) { q.Enqueue(j * bw); q.Enqueue(j * bw + bw - 1); }
    while (q.Count > 0) {
      int k1 = q.Dequeue();
      if (outside[k1] || keep[k1] >= 0.5) continue;
      outside[k1] = true;
      int x1 = k1 % bw, y1 = k1 / bw;
      if (x1 > 0) q.Enqueue(k1 - 1); if (x1 < bw - 1) q.Enqueue(k1 + 1);
      if (y1 > 0) q.Enqueue(k1 - bw); if (y1 < bh - 1) q.Enqueue(k1 + bw);
    }
    var outBmp = new Bitmap(bw, bh, PixelFormat.Format32bppArgb);
    for (int j = 0; j < bh; j++) for (int i = 0; i < bw; i++) {
      int k = j * bw + i;
      int alpha = outside[k] ? (int)Math.Round(keep[k] * 255) : 255;
      outBmp.SetPixel(i, j, Color.FromArgb(alpha, r[k], g[k], b[k]));
    }
    outBmp.Save(outPath, ImageFormat.Png);
  }
}
"@ -ReferencedAssemblies System.Drawing

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$out = Join-Path $root 'data/scripts/tonight-card'
New-Item -ItemType Directory -Force $out | Out-Null
$bmp = New-Object System.Drawing.Bitmap((Resolve-Path $Poster).Path)
# The boxes must match CARS in build-tonight-card.mjs.
[CarCut]::Cut($bmp, 440, 22, 78, 48, (Join-Path $out 'car-l.png'))
[CarCut]::Cut($bmp, 583, 28, 122, 64, (Join-Path $out 'car-r.png'))
$bmp.Dispose()
Write-Output "wrote $out/car-l.png and car-r.png"
