import sys
def lin(c):
    c=c/255; return c/12.92 if c<=0.04045 else ((c+0.055)/1.055)**2.4
def L(h):
    h=h.lstrip('#'); r,g,b=[int(h[i:i+2],16) for i in (0,2,4)]
    return 0.2126*lin(r)+0.7152*lin(g)+0.0722*lin(b)
def cr(a,b):
    la,lb=L(a),L(b); hi,lo=max(la,lb),min(la,lb); return (hi+0.05)/(lo+0.05)
def mix(fg,alpha,bg):
    f=[int(fg.lstrip('#')[i:i+2],16) for i in (0,2,4)]; b=[int(bg.lstrip('#')[i:i+2],16) for i in (0,2,4)]
    return '#%02x%02x%02x'%tuple(round(f[i]*alpha+b[i]*(1-alpha)) for i in range(3))
pairs=[l.split() for l in sys.stdin if l.strip() and not l.startswith('#')]
for p in pairs:
    name,a,b=p[0],p[1],p[2]
    print(f'{name:38s} {a} on {b}: {cr(a,b):5.2f}')
