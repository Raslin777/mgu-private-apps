"""Pack the Camera Cluster feed as an MGU Store tool artifact.

Layout follows mgu-store deploy/README.md, "Artifacts": component.json at the
root, files/<path>, units/<name>, members owned 0:0. Not car-tested.

The decoder program is not built here. It is the unmodified GPL-3.0 binary
from the Waze on cluster release named in component.json "upstream", read from
that release's .tgz after its size and SHA-256 are checked:

    python tools/package-feed.py                       # uses .cache/<asset>
    python tools/package-feed.py --upstream <file>     # a copy you downloaded
    python tools/package-feed.py --fetch               # download it from GitHub first
"""
from pathlib import Path
import argparse
import gzip
import hashlib
import io
import json
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'native' / 'camera-cluster-feed'
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


def release_url(upstream):
    return upstream['repository'] + '/releases/download/' + upstream['tag'] + '/' + upstream['asset']


def read_upstream(file, upstream):
    """The members named in upstream["take"], from a verified release archive."""
    data = Path(file).read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    if len(data) != upstream['size'] or digest != upstream['sha256']:
        raise SystemExit('Not the pinned release file: ' + str(file) + '\n  expected ' + str(upstream['size']) +
                         ' bytes, sha256 ' + upstream['sha256'] + '\n  found    ' + str(len(data)) + ' bytes, sha256 ' + digest)
    taken = {}
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
        for entry in upstream['take']:
            member = archive.getmember(entry['from'])
            if not member.isreg():
                raise SystemExit('Not a regular file in the release: ' + entry['from'])
            taken[entry['path']] = archive.extractfile(member).read()
    if not taken['waze-on-cluster'].startswith(b'\x7fELF'):
        raise SystemExit('The release\'s waze-on-cluster is not a Linux program')
    return taken


def build(upstream_file, output):
    source = json.loads((SOURCE / 'component.json').read_text(encoding='utf-8'))
    upstream = source['upstream']
    manifest = {key: source[key] for key in KEEP if key in source}
    members = []
    manifest['files'] = []
    taken = read_upstream(upstream_file, upstream)
    for entry in upstream['take']:
        content = taken[entry['path']]
        manifest['files'].append({'path': entry['path'], 'mode': entry['mode'],
                                  'sha256': hashlib.sha256(content).hexdigest()})
        members.append(('files/' + entry['path'], content, int(entry['mode'], 8)))
    for entry in source['files']:
        # Settings and units must reach the head unit with Unix line endings.
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
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    target = output / f"{source['id']}@{source['version']}.tgz"
    with target.open('wb') as raw, gzip.GzipFile(fileobj=raw, mode='wb', mtime=MTIME) as zipped, \
            tarfile.open(fileobj=zipped, mode='w') as archive:
        for name, content, mode in sorted(members):
            add(archive, name, content, mode)
    return target


def main():
    upstream = json.loads((SOURCE / 'component.json').read_text(encoding='utf-8'))['upstream']
    cached = ROOT / '.cache' / upstream['asset']
    parser = argparse.ArgumentParser()
    parser.add_argument('--upstream', type=Path, default=cached, help='the pinned Waze on cluster release .tgz')
    parser.add_argument('--fetch', action='store_true', help='download the pinned release file from GitHub first')
    parser.add_argument('--out', type=Path, default=ROOT / 'dist')
    args = parser.parse_args()
    if args.fetch and not args.upstream.exists():
        args.upstream.parent.mkdir(parents=True, exist_ok=True)
        print('Downloading ' + release_url(upstream))
        with urllib.request.urlopen(release_url(upstream)) as reply:
            args.upstream.write_bytes(reply.read())
    if not args.upstream.exists():
        raise SystemExit('The decoder program is not here: ' + str(args.upstream) + '\n'
                         'It is the GPL-3.0 binary from ' + release_url(upstream) + '\n'
                         '(' + str(upstream['size']) + ' bytes). Run again with --fetch to download it, '
                         'or with --upstream <file> for a copy you already have.')
    print(build(args.upstream, args.out))


if __name__ == '__main__':
    main()
