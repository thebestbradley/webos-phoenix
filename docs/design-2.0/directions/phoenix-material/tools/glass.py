# Worst-case contrast of text on the glass: the wallpaper under the bar, blurred as the CSS does,
# under the glass tint; the brightest (for light text) or darkest (for dark text) point counts.
import numpy as np
from PIL import Image, ImageFilter
W='/home/user/webos-phoenix/apps/settings/public/wallpapers/'
def lin(c):
    c=np.asarray(c,dtype=float)/255; return np.where(c<=0.04045,c/12.92,((c+0.055)/1.055)**2.4)
def lum(rgb): l=lin(rgb); return 0.2126*l[...,0]+0.7152*l[...,1]+0.0722*l[...,2]
def cr(a,b): hi,lo=max(a,b),min(a,b); return (hi+.05)/(lo+.05)
def region(wall, vw, vh, pos_y, box, blur):
    im=Image.open(W+wall+'.jpg').convert('RGB')
    s=max(vw/im.width, vh/im.height); im=im.resize((round(im.width*s), round(im.height*s)))
    x0=(im.width-vw)//2; y0=round((im.height-vh)*pos_y)
    im=im.crop((x0,y0,x0+vw,y0+vh)).filter(ImageFilter.GaussianBlur(blur))
    x,y,w,h=box; return np.asarray(im.crop((x,y,x+w,y+h)),dtype=float)
def report(name, wall, vw, vh, pos_y, box, blur, tint, alpha, text, text_alpha=1.0, light_text=True):
    a=region(wall,vw,vh,pos_y,box,blur)
    comp=np.array(tint)*alpha+a*(1-alpha)
    L=lum(comp); worst=L.max() if light_text else L.min()
    worst_bg=comp.reshape(-1,3)[(L.argmax() if light_text else L.argmin())]
    t=np.array(text)*text_alpha+worst_bg*(1-text_alpha)
    print(f'{name:58s} worst {cr(float(lum(t)), float(worst)):5.2f}:1   typical {cr(float(lum(t)), float(np.median(L))):5.2f}:1')
# Phoenix Material: status bar (white on rgb(4 8 10 / .38), blur 28) and the app menu tab
for wall in ['northern-lights','lily-pads']:
    report(f'Material status bar, phone, {wall}', wall, 446, 994, .5, (60,0,386,34), 28, (4,8,10), .38, (255,255,255))
    report(f'Material status bar, tablet, {wall}', wall, 1280, 800, .5, (160,0,1120,34), 28, (4,8,10), .38, (255,255,255))
    report(f'Material gesture area, phone, {wall}', wall, 446, 994, .5, (0,970,446,24), 28, (4,8,10), .38, (255,255,255))
# Material card view: white status text and the dock over the wallpaper (rgba 255/.12 glass)
report('Material card view Just Type (light): #3c4a40 on 80% #dfebe0', 'northern-lights', 446, 994, .4, (16,48,414,52), 28, (223,235,224), .80, (60,74,64), light_text=False)
report('Material card view notification strip: white on rgb(4 8 10/.42)', 'northern-lights', 446, 994, .4, (0,922,446,48), 28, (4,8,10), .42, (255,255,255))
# Ember: card view on the phoenix wallpaper (Just Type: 70% white on rgb(20 18 20 / .38), blur 12)
report('Ember Just Type placeholder (70% white)', 'phoenix', 446, 994, .62, (18,46,410,50), 12, (20,18,20), .38, (255,255,255), .7)
report('Ember dock glyphs (white)', 'phoenix', 446, 994, .62, (34,854,378,64), 12, (20,18,20), .34, (255,255,255))
report('Ember notification line (90% white, no tint)', 'phoenix', 446, 994, .62, (0,928,446,44), 0, (0,0,0), .0, (255,255,255), .9)
# Ember menus and banners (component sheet stage, 372 wide): light veil, dark text; dark veil, light text
report('Ember light veil: ink #141416 on rgb(250 249 247/.8)', 'phoenix', 372, 868, .4, (10,34,258,250), 14, (250,249,247), .80, (20,20,22), light_text=False)
report('Ember light veil: ink-2 #4c4b51', 'phoenix', 372, 868, .4, (12,600,348,150), 14, (250,249,247), .80, (76,75,81), light_text=False)
report('Ember dark veil: ink #f3f2ef on rgb(12 12 14/.6)', 'phoenix', 372, 868, .4, (12,600,348,150), 14, (12,12,14), .60, (243,242,239))
report('Ember dark veil: ink-2 #a9a7ae', 'phoenix', 372, 868, .4, (12,600,348,150), 14, (12,12,14), .60, (169,167,174))
