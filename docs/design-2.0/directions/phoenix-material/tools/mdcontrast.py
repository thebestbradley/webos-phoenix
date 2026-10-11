import re
from contrast_lib import cr, mix
import os
css=open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'palettes.css')).read()
blocks=re.findall(r'html\[data-wall="([\w-]+)"\]\[data-theme="(\w+)"\] \{(.*?)\}', css, re.S)
pairs=[('on-surface','surface'),('on-surface-variant','surface-container'),('on-surface-variant','surface-container-highest'),('primary','surface-container'),('primary','surface'),
       ('on-primary','primary'),('on-primary-container','primary-container'),('on-secondary-container','secondary-container'),('on-secondary','secondary'),('on-tertiary-container','tertiary-container'),
       ('acc-sms','surface'),('acc-jabber','surface'),('acc-jabber-on-container','acc-jabber-container'),('acc-sms-on-container','acc-sms-container'),('acc-family-on-container','acc-family-container'),('error','surface')]
worst={}
for wall,theme,body in blocks:
    v=dict(re.findall(r'--(?:md-)?([\w-]+): (#[0-9a-f]{6})', body))
    out=[]
    for a,b in pairs:
        r=cr(v[a],v[b]); out.append(f'{a}/{b} {r:.1f}')
        worst[(a,b)]=min(worst.get((a,b),99),r)
    # the app menu tab: on-primary-container on 78% primary-container over the dark glass
    tab=mix(v['primary-container'],.90,'#05090b'); r=cr(v['on-primary-container'],tab); out.append(f'tab {r:.1f}'); worst[('tab','')]=min(worst.get(('tab',''),99),r)
    print(wall,theme,'; '.join(out))
print('\nworst across wallpapers and themes:')
for k,r in worst.items(): print(f'  {k[0]} on {k[1]}: {r:.2f}')
