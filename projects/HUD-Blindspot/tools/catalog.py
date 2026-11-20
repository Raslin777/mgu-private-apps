"""Write the release catalog and checksums for the already-built app."""
from pathlib import Path
from urllib.parse import quote
import argparse
import hashlib
import json

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--base-url', required=True)
args = parser.parse_args()
if not args.base_url.startswith('https://'):
    raise SystemExit('HTTPS release base URL required')
manifest = json.loads((ROOT / 'apps' / 'hud_blindspot' / 'app.json').read_text())
version = manifest['version']
dist = ROOT / 'dist'
asset = dist / ('hud_blindspot@' + version + '.tgz')
digest = hashlib.sha256(asset.read_bytes()).hexdigest()
catalog = {'schema': 2, 'components': [{
    'id': 'hud_blindspot', 'kind': 'app', 'version': version,
    'title': 'HUD Blindspot (prototype)', 'mguHmi': ['ID7'], 'uninstallable': True,
    'requires': {'cluster-render': '0.6.7'},
    'artifact': {'name': asset.name, 'url': args.base_url.rstrip('/') + '/' + quote(asset.name, safe=''),
                 'size': asset.stat().st_size, 'sha256': digest}
}]}
target = dist / 'catalog.json'
target.write_text(json.dumps(catalog, indent=2) + '\n', encoding='utf-8')
(dist / 'SHA256SUMS.txt').write_text(digest + '  ' + asset.name + '\n' +
    hashlib.sha256(target.read_bytes()).hexdigest() + '  catalog.json\n', encoding='utf-8')
print(target)
