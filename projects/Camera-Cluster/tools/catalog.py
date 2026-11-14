"""Write a local, unpublished MGU Store catalog for the generated artifacts."""
from pathlib import Path
import argparse
import hashlib
import json
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'dist'


def component(id, version, kind, hmi, title):
    file = OUTPUT / f'{id}@{version}.tgz'
    if not file.exists():
        raise SystemExit('Build first: ' + str(file))
    with file.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    return {
        'id': id, 'kind': kind, 'version': version, 'title': title,
        'mguHmi': hmi, 'uninstallable': True,
        'artifact': {'name': file.name, 'url': file.name,
                     'size': file.stat().st_size, 'sha256': digest},
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--base-url', help='HTTPS directory containing the release artifacts')
    args = parser.parse_args()
    if args.base_url and not args.base_url.startswith('https://'):
        raise SystemExit('--base-url must use HTTPS')
    app_manifest = json.loads((ROOT / 'apps' / 'camera_cluster' / 'app.json').read_text(encoding='utf-8'))
    feed_manifest = json.loads((ROOT / 'native' / 'camera-cluster-feed' / 'component.json').read_text(encoding='utf-8'))
    app = component('camera_cluster', app_manifest['version'], 'app', ['ID7'], 'Camera Cluster (prototype)')
    app['requires'] = {feed_manifest['id']: feed_manifest['version']}
    feed = component(feed_manifest['id'], feed_manifest['version'], 'tool', ['ID7'], 'Camera Cluster feed (not car-tested)')
    feed['requires'] = feed_manifest['requires']
    if args.base_url:
        for item in (app, feed):
            item['artifact']['url'] = args.base_url.rstrip('/') + '/' + quote(item['artifact']['name'], safe='')
    target = OUTPUT / 'catalog.json'
    target.write_text(json.dumps({'schema': 2, 'components': [app, feed]}, indent=2) + '\n', encoding='utf-8')
    print(target)
