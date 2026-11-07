import json, os

MC = 'C:/Users/zht/AppData/Roaming/.minecraft'
OUT = 'G:/ck-web26'
d = json.load(open(os.path.join(MC, 'versions', '26.2', '26.2.json'), encoding='utf-8'))

SEP = os.sep
libs, missing = [], []
for e in d.get('libraries', []):
    dl = e.get('downloads', {})
    art = dl.get('artifact')
    if art:
        p = os.path.join(MC, 'libraries', art['path'].replace('/', SEP)).replace(SEP, '/')
        (libs if os.path.exists(p) else missing).append(p)
    nat = e.get('natives', {}).get('windows')
    if nat:
        name = e['name'].replace('${arch}', 'x86').replace('natives-windows', nat)
        g, a, v = name.split(':', 2)
        p = os.path.join(MC, 'libraries', g.replace('.', '/'), a, v, f'{a}-{v}.jar').replace(SEP, '/')
        if os.path.exists(p):
            libs.append(p)

cp = [f'{OUT}/client-26.2.jar'] + libs
os.makedirs(f'{OUT}/nat', exist_ok=True)
os.makedirs(f'{OUT}/shotdir', exist_ok=True)

args = [
    '-Djava.library.path=G:/ck-web26/nat',
    '-Djna.tmpdir=G:/ck-web26/nat',
    '-Xmx3G',
    '--enable-native-access=ALL-UNNAMED',
    '--add-opens=java.base/java.io=ALL-UNNAMED',
    '-cp', ';'.join(cp),
    'net.minecraft.client.main.Main',
    '--username', 'QoderRef',
    '--version', '26.2',
    '--gameDir', f'{OUT}/shotdir',
    '--assetsDir', f'{MC}/assets',
    '--assetIndex', '32',
    '--uuid', '91567a763f6e493f85715676d567642a',
    '--accessToken', '0',
    '--clientId', '0',
    '--xuid', '0',
    '--versionType', 'release',
    '--width', '1280',
    '--height', '720',
]
with open(f'{OUT}/launch.args', 'w', encoding='utf-8') as f:
    for a in args:
        f.write(('"%s"' % a if ' ' in a or ';' in a else a) + '\n')

print('libs', len(libs), 'missing', len(missing), 'cp_chars', len(';'.join(cp)))
for m in missing[:5]:
    print('  MISSING', m)
