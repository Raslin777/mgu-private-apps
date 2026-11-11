"""Pack the root helper as an MGU Store tool artifact.

Layout follows mgu-store deploy/README.md, "Artifacts": component.json at the
root, files/<path>, units/<name>, members owned 0:0. The Store's own packer
(`deploy/hu artifact native/mgu-ai-root --out dist`) is the reference; this
script exists so the build needs no checkout of the Store. Not car-tested.
"""
from pathlib import Path
import gzip
import hashlib
import io
import json
import tarfile

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'native' / 'mgu-ai-root'
MTIME = 1700000000
KEEP = ('id', 'kind', 'version', 'title', 'description', 'mguHmi', 'optional',
        'uninstallable', 'requires', 'enable', 'recmgr', 'restart')


def add(archive, name, content, mode):
    item = tarfile.TarInfo(name)
    item.size = len(content)
    item.mode = mode
    item.mtime = MTIME
    item.uid = item.gid = 0
    item.uname = item.gname = ''
    archive.addfile(item, io.BytesIO(content))


def main():
    source = json.loads((SOURCE / 'component.json').read_text(encoding='utf-8'))
    manifest = {key: source[key] for key in KEEP if key in source}
    members = []
    manifest['files'] = []
    for entry in source['files']:
        # Shell scripts and units must reach the head unit with Unix line endings.
        content = (SOURCE / entry['from']).resolve().read_bytes().replace(b'\r\n', b'\n')
        manifest['files'].append({'path': entry['path'], 'mode': entry['mode'],
                                  'sha256': hashlib.sha256(content).hexdigest()})
        members.append(('files/' + entry['path'], content, int(entry['mode'], 8)))
    manifest['units'] = []
    for unit in source['units']:
        content = (SOURCE / unit['from']).read_bytes().replace(b'\r\n', b'\n')
        manifest['units'].append({'name': unit['name']})
        members.append(('units/' + unit['name'], content, 0o644))
    members.append(('component.json', (json.dumps(manifest, indent=2) + '\n').encode(), 0o644))
    output = ROOT / 'dist'
    output.mkdir(exist_ok=True)
    target = output / f"{source['id']}@{source['version']}.tgz"
    with target.open('wb') as raw, gzip.GzipFile(fileobj=raw, mode='wb', mtime=MTIME) as zipped, \
            tarfile.open(fileobj=zipped, mode='w') as archive:
        for name, content, mode in sorted(members):
            add(archive, name, content, mode)
    print(target)


if __name__ == '__main__':
    main()
