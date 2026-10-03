$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System; using System.Drawing; using System.Drawing.Imaging; using System.Drawing.Drawing2D; using System.Collections.Generic;
public static class StationArt {
 static bool Smooth(Bitmap b,int x,int y){Color c=b.GetPixel(x,y);for(int dy=-1;dy<=1;dy++)for(int dx=-1;dx<=1;dx++){int nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=b.Width||ny>=b.Height)continue;Color n=b.GetPixel(nx,ny);if(Math.Max(Math.Abs(c.R-n.R),Math.Max(Math.Abs(c.G-n.G),Math.Abs(c.B-n.B)))>32)return false;}return true;}
 public static void Extract(string source,string target,int x,int y,int width,int height,int outWidth,int outHeight,bool floor) {
  using(var master=new Bitmap(source)) using(var crop=master.Clone(new Rectangle(x,y,width,height),PixelFormat.Format32bppArgb)) {
   if(!floor){var seen=new bool[width*height];var queue=new Queue<int>();for(int a=0;a<width;a++){queue.Enqueue(a);queue.Enqueue((height-1)*width+a);}for(int b=0;b<height;b++){queue.Enqueue(b*width);queue.Enqueue(b*width+width-1);}while(queue.Count>0){int at=queue.Dequeue();if(seen[at])continue;seen[at]=true;int px=at%width,py=at/width;Color color=crop.GetPixel(px,py);int[] neighbors={px>0?at-1:-1,px<width-1?at+1:-1,py>0?at-width:-1,py<height-1?at+width:-1};foreach(int next in neighbors){if(next<0||seen[next])continue;Color n=crop.GetPixel(next%width,next/width);int delta=Math.Max(Math.Abs(color.R-n.R),Math.Max(Math.Abs(color.G-n.G),Math.Abs(color.B-n.B)));if(delta<=10&&Smooth(crop,next%width,next/width))queue.Enqueue(next);}}for(int a=0;a<seen.Length;a++)if(seen[a])crop.SetPixel(a%width,a/width,Color.Transparent);}
   int left=0,top=0,right=width,bottom=height;
   if(!floor){left=width;top=height;right=0;bottom=0;for(int py=0;py<height;py++)for(int px=0;px<width;px++)if(crop.GetPixel(px,py).A>0){left=Math.Min(left,px);top=Math.Min(top,py);right=Math.Max(right,px+1);bottom=Math.Max(bottom,py+1);}if(right<=left||bottom<=top)throw new Exception("Empty extraction: "+target);}
   using(var output=new Bitmap(outWidth,outHeight,PixelFormat.Format32bppArgb))using(var g=Graphics.FromImage(output)) {
    g.InterpolationMode=InterpolationMode.NearestNeighbor;g.PixelOffsetMode=PixelOffsetMode.Half;
    if(floor){using(var clip=new GraphicsPath()){clip.AddPolygon(new Point[]{new Point(outWidth/2,0),new Point(outWidth,outHeight/2),new Point(outWidth/2,outHeight),new Point(0,outHeight/2)});g.SetClip(clip);}g.DrawImage(crop,new Rectangle(0,0,outWidth,outHeight),new Rectangle(0,0,width,height),GraphicsUnit.Pixel);}
    else {double scale=Math.Min((double)outWidth/(right-left),(double)outHeight/(bottom-top));int w=(int)Math.Round((right-left)*scale),h=(int)Math.Round((bottom-top)*scale);g.DrawImage(crop,new Rectangle((outWidth-w)/2,outHeight-h,w,h),new Rectangle(left,top,right-left,bottom-top),GraphicsUnit.Pixel);}
    output.Save(target,ImageFormat.Png);
   }
  }
 }
}
'@
$root = Join-Path $PSScriptRoot '../public/assets/station'
$output = Join-Path $root 'derived'
New-Item -ItemType Directory -Force -Path $output | Out-Null
$manifest = [ordered]@{version=1; tileWidth=64; tileHeight=32; sprites=[ordered]@{}}
function Slice($id,$file,$x,$y,$w,$h,$ow,$oh,$floor=$false){
 [StationArt]::Extract((Join-Path $root $file),(Join-Path $output "$id.png"),$x,$y,$w,$h,$ow,$oh,$floor)
 $manifest.sprites[$id]=@{url="/assets/station/derived/$id.png";width=$ow;height=$oh}
}
for($i=0;$i -lt 8;$i++){Slice "floor-$i" 'rooms/hq-room-construction-kit-v1.png' (20+$i*190) 20 174 88 64 32 $true}
Slice 'wall' 'rooms/hq-room-construction-kit-v1.png' 22 125 196 186 64 76
Slice 'column' 'rooms/hq-room-construction-kit-v1.png' 517 440 67 112 24 48
for($i=0;$i -lt 6;$i++){Slice "bay-$i" 'bays/hq-bays-workstations-v1.png' ($i*256) 140 256 292 112 120}
$ys=@(32,176,322,467,612,758,902)
$xs=@(21,268,412,482,591,670,744)
for($row=0;$row -lt 7;$row++){for($frame=0;$frame -lt 7;$frame++){Slice "crew-$row-$frame" 'crew/hq-crew-spritesheet-v1.png' $xs[$frame] $ys[$row] 72 109 32 48}}
for($row=0;$row -lt 2;$row++){for($col=0;$col -lt 4;$col++){Slice "overlord-$($row*4+$col)" 'overlord/hq-overlord-selection-v1.png' ($col*384+20) ($row*460+90) 345 400 64 88}}
for($row=0;$row -lt 3;$row++){for($col=0;$col -lt 6;$col++){Slice "gear-$($row*6+$col)" 'gear/hq-gear-spritesheet-v1.png' ($col*256) ($row*340+10) 256 315 64 80}}
for($i=0;$i -lt 6;$i++){Slice "machine-$i" 'workflows/hq-workflow-machinery-animated-v1.png' ($i*132+12) 390 128 150 64 64}
Slice 'belt' 'workflows/hq-workflow-machinery-animated-v1.png' 8 36 112 106 64 48
Slice 'crate' 'workflows/hq-workflow-machinery-animated-v1.png' 748 749 92 70 24 26
Slice 'comms' 'stations/hq-comms-models-channels-v1.png' 0 480 300 275 96 104
Slice 'models' 'stations/hq-comms-models-channels-v1.png' 630 120 245 320 80 104
Slice 'channels' 'stations/hq-comms-models-channels-v1.png' 1160 120 325 320 80 104
Slice 'logo' 'branding/hqoverlord-logo-master-v1.png' 135 30 1260 310 420 104
Slice 'lamp' 'props/hq-props-environment-v1.png' 0 24 115 125 24 40
$manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $output 'manifest.json') -Encoding utf8
Write-Output "Prepared $($manifest.sprites.Count) sprites. Masters preserved."
