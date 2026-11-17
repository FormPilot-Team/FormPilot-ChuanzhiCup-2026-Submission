"""Original geometric FormPilot display assets, created 2026-11-17.

All shapes and motion below are authored mathematical definitions. No source images,
pose tracks, traced silhouettes, patient records, or model output are read. The old
inventory supplies only file names and dimensions for interface compatibility.
Chinese text uses an installed Windows font for rasterization; font files are not
copied or distributed. This is a later publication-remediation overlay, not a claim
that these assets appeared in the original historical development commits.
"""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
import subprocess
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import imageio_ffmpeg

ROOT = Path(__file__).resolve().parent
BASE = ROOT / 'files'
COMPATIBILITY = ROOT / 'COMPATIBILITY_MANIFEST.json'
FONT = Path(r'C:\Windows\Fonts\msyh.ttc')
FONT_BOLD = Path(r'C:\Windows\Fonts\msyhbd.ttc')
S = 2

def font(size, bold=False):
    return ImageFont.truetype(str(FONT_BOLD if bold else FONT), round(size * S))

def gradient(size, top, bottom):
    w,h = size
    t = np.linspace(0,1,h*S)[:,None,None]
    a=np.array(top)[None,None,:]*(1-t)+np.array(bottom)[None,None,:]*t
    return Image.fromarray(np.repeat(a.astype('uint8'),w*S,axis=1),'RGB').convert('RGBA')

def line(draw, pts, color, width):
    p=[(round(x*S),round(y*S)) for x,y in pts]
    draw.line(p,fill=color,width=round(width*S),joint='curve')
    r=width*S/2
    for x,y in p:
        draw.ellipse((int(x-r),int(y-r),int(x+r),int(y+r)),fill=color)

def ellipse(draw, box, fill, outline=None, width=1):
    draw.ellipse(tuple(round(v*S) for v in box),fill=fill,outline=outline,width=round(width*S))

def polygon(draw, pts, fill):
    draw.polygon([(round(x*S),round(y*S)) for x,y in pts],fill=fill)

def text(draw, xy, value, size, color, bold=False):
    draw.text(tuple(round(v*S) for v in xy),value,font=font(size,bold),fill=color,stroke_width=0)

def finish(im,size):
    return im.resize(size,Image.Resampling.LANCZOS)

def person(draw, cx,cy,scale, pose, ink=(30,88,79,255), accent=(249,169,107,255)):
    # Hand-authored normalized illustration poses; never read measured pose data.
    poses={
      'up': {'a':[(-.10,-.20),(-.34,-.46),(-.17,-.70)],'b':[(.10,-.20),(.34,-.46),(.17,-.70)],'legs':[(-.05,.22),(-.21,.59),(.07,.22),(.25,.59)]},
      'flow': {'a':[(-.10,-.20),(-.36,-.10),(-.49,-.25)],'b':[(.10,-.20),(.29,-.37),(.47,-.31)],'legs':[(-.06,.22),(-.35,.56),(.08,.22),(.31,.49)]},
      'wings': {'a':[(-.10,-.20),(-.35,-.41),(-.52,-.57)],'b':[(.10,-.20),(.34,-.41),(.52,-.57)],'legs':[(-.04,.22),(-.14,.60),(.07,.22),(.38,.35)]},
      'stretch': {'a':[(-.10,-.20),(-.29,-.44),(-.42,-.64)],'b':[(.10,-.20),(.36,-.22),(.51,-.05)],'legs':[(-.05,.22),(-.22,.59),(.07,.22),(.26,.59)]},
      'workshop': {'a':[(-.10,-.20),(-.34,-.42),(-.48,-.26)],'b':[(.10,-.20),(.37,-.10),(.51,-.25)],'legs':[(-.05,.22),(-.30,.55),(.08,.22),(.23,.58)]},
    }
    p=poses[pose]
    cv=lambda pt:(cx+pt[0]*scale,cy+pt[1]*scale)
    # A broad stylized tunic and tapered limbs avoid likeness or copied anatomy.
    polygon(draw,[cv((-.13,-.24)),cv((.13,-.24)),cv((.15,.24)),cv((-.15,.24))],ink)
    for arm in [p['a'],p['b']]: line(draw,[cv(v) for v in arm],ink,.082*scale)
    legs=p['legs']
    line(draw,[cv(legs[0]),cv(legs[1])],ink,.10*scale)
    line(draw,[cv(legs[2]),cv(legs[3])],ink,.10*scale)
    x,y=cv((0,-.43));r=.105*scale
    ellipse(draw,(x-r,y-r,x+r,y+r),ink)
    line(draw,[cv((0,-.32)),cv((0,-.22))],ink,.055*scale)
    for xy in [p['a'][-1],p['b'][-1]]:
        x,y=cv(xy);ellipse(draw,(x-.023*scale,y-.023*scale,x+.023*scale,y+.023*scale),accent)

def routine(name,size):
    specs={
      'badanjin.jpg':('八段锦','舒展 · 呼吸 · 协调','up',(232,241,226),(208,230,211)),
      'taichi.jpg':('太极拳','流动 · 平衡 · 专注','flow',(227,239,244),(198,222,228)),
      'wuxinqi.jpg':('五禽戏','灵活 · 节奏 · 活力','wings',(244,237,216),(223,229,193)),
      'yijinjing.jpg':('易筋经','伸展 · 稳定 · 控制','stretch',(235,230,242),(215,215,233)),
    }
    title,subtitle,pose,top,bottom=specs[name];w,h=size
    im=gradient(size,top,bottom);d=ImageDraw.Draw(im)
    ell=(w*.19,h*.20,w*1.04,h*.99)
    ellipse(d,ell,(255,255,255,130))
    ellipse(d,(w*.28,h*.70,w*.87,h*.82),(79,118,104,28))
    # Landscape abstraction is entirely mathematical.
    polygon(d,[(0,h*.90),(w*.30,h*.80),(w*.58,h*.90),(w,h*.74),(w,h),(0,h)],(*bottom,255))
    # Accent path communicates movement without claiming measured trajectory.
    box=tuple(round(v*S) for v in (w*.22,h*.22,w*.87,h*.81))
    d.arc(box,start=200,end=315,fill=(255,255,255,220),width=max(3,round(w*.006*S)))
    scale=min(w*.72,h*.72)
    person(d,w*.55,h*.53,scale,pose)
    fs=min(w*.085,h*.09)
    text(d,(w*.065,h*.055),title,fs,(28,65,60,255),True)
    text(d,(w*.068,h*.055+fs*1.45),subtitle,fs*.29,(67,102,95,255))
    text(d,(w*.068,h*.93),'FORMPILOT',max(10,w*.019),(67,102,95,220),True)
    return finish(im,size)

def forest_base(size):
    w,h=size;im=gradient(size,(220,237,224),(165,199,166));d=ImageDraw.Draw(im)
    # Distinct parallax layers, generated from fixed geometry rather than images.
    polygon(d,[(0,h*.59),(w*.17,h*.34),(w*.38,h*.56),(w*.64,h*.31),(w,h*.55),(w,h),(0,h)],(144,181,155,255))
    polygon(d,[(0,h*.78),(w*.24,h*.58),(w*.49,h*.74),(w*.74,h*.47),(w,h*.69),(w,h),(0,h)],(98,150,121,255))
    for x,y,r in [(w*.06,h*.42,h*.24),(w*.92,h*.36,h*.25),(w*.79,h*.16,h*.15)]:
        line(d,[(x,y),(x,h*.94)],(55,101,80,255),r*.16)
        ellipse(d,(x-r,y-r,x+r,y+r),(64,119,88,255))
    return im

def apple(d,x,y,r):
    ellipse(d,(x-r,y-r*.85,x+r,y+r),(215,86,67,255))
    line(d,[(x,y-r*.72),(x+r*.12,y-r*1.32)],(82,88,51,255),r*.13)
    ellipse(d,(x+r*.08,y-r*1.25,x+r*.85,y-r*.77),(100,145,77,255))
    ellipse(d,(x-r*.58,y-r*.48,x-r*.29,y-r*.20),(248,170,133,255))

def game(name,size):
    w,h=size
    if name=='apple-app-icon.jpg':
        im=gradient(size,(239,246,224),(179,213,163));d=ImageDraw.Draw(im);apple(d,w*.5,h*.53,w*.27);return finish(im,size)
    if name=='bubble-background.jpg':
        im=gradient(size,(228,243,232),(199,225,212));d=ImageDraw.Draw(im)
        for i in range(18):
            x=w*((i*.381966)%1);y=h*((i*.618034+.15)%1);r=h*(.025+.015*(i%4))
            ellipse(d,(x-r,y-r,x+r,y+r),(250,255,252,95),(151,194,170,100),1)
        return finish(im,size)
    im=forest_base(size);d=ImageDraw.Draw(im)
    if name=='apple-orchard.jpg':
        x,y=w*.48,h*.46
        line(d,[(x,h*.85),(x,y)],(119,91,61,255),w*.065)
        for dx,dy,r in [(-.13,0,.23),(.10,-.05,.23),(-.01,-.17,.22)]:ellipse(d,(x+w*dx-h*r,y+h*dy-h*r,x+w*dx+h*r,y+h*dy+h*r),(73,130,84,255))
        for dx,dy in [(-.13,-.03),(.08,-.14),(.17,.03),(-.01,.12),(-.01,-.29)]:apple(d,x+w*dx,y+h*dy,h*.043)
        polygon(d,[(w*.69,h*.72),(w*.88,h*.72),(w*.85,h*.92),(w*.72,h*.92)],(197,149,93,255))
        d.arc(tuple(round(v*S) for v in (w*.72,h*.62,w*.86,h*.88)),180,360,fill=(139,105,65,255),width=round(h*.025*S))
        for xx in [.75,.79,.83]:line(d,[(w*xx,h*.75),(w*xx,h*.88)],(153,111,69,220),h*.006)
        apple(d,w*.77,h*.73,h*.036);apple(d,w*.82,h*.72,h*.034)
    elif name=='forest-boating.jpg':
        polygon(d,[(0,h*.55),(w,h*.55),(w,h),(0,h)],(126,184,184,255))
        for i in range(9):
            yy=h*(.61+i*.043);xx=w*((i*.217)%1)
            line(d,[(xx,yy),(min(w,xx+w*.21),yy)],(193,225,214,180),h*.006)
        polygon(d,[(w*.23,h*.65),(w*.78,h*.65),(w*.65,h*.85),(w*.34,h*.85)],(164,108,68,255))
        line(d,[(w*.27,h*.65),(w*.75,h*.65)],(226,179,119,255),h*.025)
        ellipse(d,(w*.31,h*.66,w*.70,h*.74),(77,96,78,255))
        line(d,[(w*.45,h*.62),(w*.18,h*.89)],(219,179,119,255),h*.025)
        line(d,[(w*.61,h*.61),(w*.85,h*.87)],(219,179,119,255),h*.025)
        line(d,[(w*.18,h*.87),(w*.12,h*.94)],(226,183,118,255),h*.070)
        line(d,[(w*.83,h*.84),(w*.89,h*.91)],(226,183,118,255),h*.070)
        # Two curved arrows show alternating strokes, not a fabricated human demo.
        for xx in [w*.18,w*.78]:
            d.arc(tuple(round(v*S) for v in (xx-w*.05,h*.62,xx+w*.08,h*.85)),200,330,fill=(242,246,225,235),width=round(h*.009*S))
    elif name=='forest-archery.jpg':
        cx,cy=w*.69,h*.50
        line(d,[(cx,h*.68),(cx-w*.06,h*.92)],(100,79,54,255),h*.03)
        line(d,[(cx,h*.68),(cx+w*.08,h*.92)],(100,79,54,255),h*.03)
        for r,col in [(h*.24,(235,225,193,255)),(h*.18,(160,184,133,255)),(h*.12,(239,213,151,255)),(h*.06,(205,111,77,255))]:ellipse(d,(cx-r,cy-r,cx+r,cy+r),col)
        # Original bow symbol with string and arrow points toward target.
        d.arc(tuple(round(v*S) for v in (w*.10,h*.18,w*.43,h*.87)),270,450,fill=(183,130,77,255),width=round(h*.03*S))
        line(d,[(w*.265,h*.18),(w*.265,h*.87)],(244,236,200,255),h*.006)
        line(d,[(w*.17,h*.53),(w*.57,h*.53)],(242,231,190,255),h*.013)
        polygon(d,[(w*.58,h*.53),(w*.54,h*.50),(w*.54,h*.56)],(242,231,190,255))
    return finish(im,size)

def workshop(size,transparent):
    w,h=size
    im=Image.new('RGBA',(w*S,h*S),(0,0,0,0) if transparent else (235,244,236,255));d=ImageDraw.Draw(im)
    person(d,w*.50,h*.49,min(w,h)*.64,'workshop',(39,105,91,255),(242,169,104,255))
    for x,y in [(w*.20,h*.28),(w*.82,h*.35),(w*.69,h*.79)]:
        ellipse(d,(x-w*.018,y-w*.018,x+w*.018,y+w*.018),(242,169,104,255))
    return finish(im,size)

def mute(size,transparent):
    w,h=size
    im=Image.new('RGBA',(w*S,h*S),(0,0,0,0) if transparent else (234,243,236,255));d=ImageDraw.Draw(im)
    z=min(w,h);cx=w*.45;cy=h*.50
    polygon(d,[(cx-z*.22,cy-z*.10),(cx-z*.09,cy-z*.10),(cx+z*.08,cy-z*.23),(cx+z*.08,cy+z*.23),(cx-z*.09,cy+z*.10),(cx-z*.22,cy+z*.10)],(38,100,84,255))
    line(d,[(cx+z*.20,cy-z*.12),(cx+z*.39,cy+z*.12)],(38,100,84,255),z*.055)
    line(d,[(cx+z*.39,cy-z*.12),(cx+z*.20,cy+z*.12)],(38,100,84,255),z*.055)
    return finish(im,size)

def orb_frame(t,size=640):
    y,x=np.mgrid[:size,:size].astype(np.float32);x=(x-size*.5)/(size*.5);y=(y-size*.5)/(size*.5)
    r=np.sqrt(x*x+y*y);angle=np.arctan2(y,x);phase=2*math.pi*t
    edge=.68+.028*np.sin(angle*4+phase)+.015*np.cos(angle*7-phase)
    inside=r<=edge
    z=np.sqrt(np.clip(1-(r/(edge+1e-6))**2,0,1))
    wave=(np.sin(angle*3+z*10-phase)*.5+.5)
    rgb=np.zeros((size,size,4),dtype=np.float32)
    rgb[:,:,0]=80+100*wave+50*z
    rgb[:,:,1]=145+75*z+20*np.sin(angle+phase)
    rgb[:,:,2]=155+72*wave+25*z
    alpha=np.where(inside,235+20*z,np.clip(np.exp(-((r-edge)*19)**2)*65,0,65))
    alpha[r>.88]=0
    rgb[:,:,3]=alpha
    im=Image.fromarray(np.uint8(np.clip(rgb,0,255)),'RGBA')
    d=ImageDraw.Draw(im,'RGBA')
    # Original orbital filaments sampled from analytic trigonometric curves.
    for j in range(5):
        pts=[]
        for q in range(221):
            a=q/220*math.tau
            px=.31*math.cos(a+phase*.12+j*.38)
            py=.31*math.sin(a+phase*.12+j*.38)*(.22+j*.12)
            rotation=j*.51+phase*.08
            xx=px*math.cos(rotation)-py*math.sin(rotation)
            yy=px*math.sin(rotation)+py*math.cos(rotation)
            pts.append((size*(.5+xx),size*(.5+yy)))
        d.line(pts,fill=(223,251,241,90+j*18),width=2)
    for j in range(28):
        a=j*2.399963+phase*.15;rr=.26+.09*math.sin(j*1.71+phase)
        xx=size*(.5+rr*math.cos(a));yy=size*(.5+rr*math.sin(a));rad=1.2+(j%3)*.6
        d.ellipse((xx-rad,yy-rad,xx+rad,yy+rad),fill=(229,254,244,200))
    return im

def save(im,dest,format):
    dest.parent.mkdir(parents=True,exist_ok=True)
    if format=='JPEG':im.convert('RGB').save(dest,quality=94,subsampling=0,optimize=True)
    else:im.save(dest,format='PNG',optimize=True)

def main():
    compatibility=json.loads(COMPATIBILITY.read_text(encoding='utf-8'))
    meta=[{'path':r['repository_path'],'width':r['width'],'height':r['height'],'format':r['format']} for r in compatibility if r['format']!='WebM/VP9']
    poster=orb_frame(0)
    for row in meta:
        path=Path(row['path']);name=path.name;size=(row['width'],row['height']);dest=BASE/path
        if name in ['badanjin.jpg','taichi.jpg','wuxinqi.jpg','yijinjing.jpg']:im=routine(name,size)
        elif path.parent.name=='game':im=game(name,size)
        elif name.startswith('workshop-pose'):im=workshop(size,name.endswith('transparent.png'))
        elif name.startswith('mute-icon'):im=mute(size,name=='mute-icon.png')
        elif name=='coach-orb-poster.png':im=poster
        elif name=='coach-orb.jpg':
            im=Image.new('RGBA',size,(232,244,236,255));im.alpha_composite(poster.resize(size,Image.Resampling.LANCZOS))
        elif name=='formpilot-orb-bg.png':
            im=finish(gradient(size,(231,245,235),(201,227,216)),size);bubble=poster.resize((round(size[1]*.85),round(size[1]*.85)),Image.Resampling.LANCZOS)
            im.alpha_composite(bubble,((size[0]-bubble.width)//2,(size[1]-bubble.height)//2));im=im.convert('RGB')
        else:raise ValueError(name)
        assert im.size==size,(name,im.size,size)
        save(im,dest,row['format'])
    video=BASE/'apps/platform/public/web-v1/assets/coach-orb-loop.webm';video.parent.mkdir(parents=True,exist_ok=True)
    ffmpeg=imageio_ffmpeg.get_ffmpeg_exe()
    cmd=[ffmpeg,'-hide_banner','-loglevel','warning','-y','-f','rawvideo','-pixel_format','rgba','-video_size','640x640','-framerate','24','-i','pipe:0','-an','-c:v','libvpx-vp9','-pix_fmt','yuva420p','-b:v','0','-crf','30','-deadline','good','-cpu-used','4','-auto-alt-ref','0','-metadata','title=FormPilot original procedural orb, publication remediation 2026-11-17',str(video)]
    with (ROOT/'ffmpeg-encode.log').open('wb') as log:
        p=subprocess.Popen(cmd,stdin=subprocess.PIPE,stderr=log)
        for frame in range(96):p.stdin.write(orb_frame(frame/96).tobytes())
        p.stdin.close();assert p.wait()==0,'ffmpeg encode failed'
    rights=[{'oid':r['old_blob'],'paths':[r['repository_path']]} for r in compatibility];rows=[]
    for old in rights:
        assert len(old['paths'])==1
        path=old['paths'][0];f=BASE/path;data=f.read_bytes()
        item={'old_blob':old['oid'],'repository_path':path,'replacement_file':str(f),'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data),'created':'2026-11-17','provenance':'Original mathematical/geometric drawing by generate_original_media.py; no original asset pixels or reference pose data used.'}
        item['git_blob']=hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()
        if f.suffix=='.webm':item.update(format='WebM/VP9',width=640,height=640,frame_rate=24,duration_seconds=4,alpha_expected=True)
        else:
            with Image.open(f) as im:
                item.update(format=im.format,width=im.width,height=im.height,mode=im.mode,alpha_extrema=im.getextrema()[-1] if 'A' in im.mode else None)
        rows.append(item)
    assert len(rows)==18 and all(r['old_blob']!=r['git_blob'] for r in rows)
    output={'created':'2026-11-17','purpose':'Later publication-remediation replacement overlay, preserving original historical development metadata with an explicit change map.','third_party_inputs':'No third-party source image/video/pose inputs; installed Windows font used only to render labels; font not distributed.','script_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'ffmpeg':ffmpeg,'assets':rows}
    (ROOT/'REPLACEMENT_MAP.json').write_text(json.dumps(output,ensure_ascii=False,indent=2),encoding='utf-8')
    # A contact sheet is audit evidence only, outside the 18 replacement files.
    thumbs=[]
    for row in rows:
        if row['repository_path'].endswith('.webm'):continue
        f=Path(row['replacement_file']);im=Image.open(f).convert('RGBA');im.thumbnail((280,180))
        tile=Image.new('RGB',(320,220),(249,249,244));tile.paste(im,((320-im.width)//2,5),im);ImageDraw.Draw(tile).text((8,193),f.name,fill=(30,60,50));thumbs.append(tile)
    sheet=Image.new('RGB',(320*4,220*math.ceil(len(thumbs)/4)),(245,245,240))
    for i,tile in enumerate(thumbs):sheet.paste(tile,((i%4)*320,(i//4)*220))
    sheet.save(ROOT/'CONTACT_SHEET.jpg',quality=92)
    print(json.dumps({'assets':len(rows),'total_bytes':sum(r['bytes'] for r in rows),'map':str(ROOT/'REPLACEMENT_MAP.json'),'video':str(video)},indent=2))

if __name__=='__main__':main()
