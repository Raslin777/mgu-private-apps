"""Build the SDK-free ID7 app package. MGU Store supplies the owner's BMW SDK."""
from pathlib import Path
import argparse
import json
import shutil
import subprocess
import sys
import tarfile

ROOT = Path(__file__).resolve().parents[1]
KIT = ROOT / '.cache' / 'idrive-kit'
REVISION = '2c6cfdfaa6902f1b469c3784508fadae12b577eb'
APP = 'camera_cluster'
FEED = ROOT / 'native' / 'camera-cluster-feed' / 'component.json'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--kit', type=Path, default=KIT)
    parser.add_argument('--out', type=Path, default=ROOT / 'dist')
    args = parser.parse_args()
    kit = args.kit.resolve()
    if not kit.exists():
        subprocess.run(['git', 'clone', '--no-checkout',
                        'https://github.com/cauliflowermossgrape/idrive7-apps.git', str(kit)], check=True)
        subprocess.run(['git', '-C', str(kit), 'checkout', '--detach', REVISION], check=True)
    head = subprocess.check_output(['git', '-C', str(kit), 'rev-parse', 'HEAD'], text=True).strip()
    if head != REVISION:
        raise SystemExit('App kit revision mismatch; expected ' + REVISION)
    target = kit / 'apps' / APP
    # Start clean so files removed from the app are not packaged from an earlier build.
    for cleanup in (target, kit / 'dist' / APP):
        if not cleanup.resolve().is_relative_to(kit) or cleanup.is_symlink():
            raise SystemExit('Build cleanup would leave the app kit: ' + str(cleanup))
    shutil.rmtree(target, ignore_errors=True)
    shutil.rmtree(kit / 'dist' / APP, ignore_errors=True)
    target.mkdir()
    for source in (ROOT / 'apps' / APP).iterdir():
        if source.is_file():
            shutil.copy2(source, target / source.name)
    sys.path.insert(0, str(kit / 'kit' / 'tools'))
    source = (kit / 'kit' / 'tools' / 'build.py').read_text(encoding='utf-8')
    # The pinned builder insists on BMW's SDK and copies it in. Take both out:
    # the Store adds the SDK on the head unit.
    start = source.index('    if not preview_only and not all(')
    end = source.index('    adir =', start)
    source = source[:start] + source[end:]
    for line in (
        "    os.makedirs(os.path.join(src, 'node_modules', 'oap-sdk'))\n",
        "    shutil.copy(os.path.join(SDK, 'index.js'), os.path.join(src, 'node_modules', 'oap-sdk', 'index.js'))\n",
        "    shutil.copy(os.path.join(SDK, 'package.json'), os.path.join(src, 'node_modules', 'oap-sdk', 'package.json'))\n",
    ):
        if source.count(line) != 1:
            raise SystemExit('Pinned builder has an unexpected SDK stanza')
        source = source.replace(line, '', 1)
    module = {'__file__': str(kit / 'kit' / 'tools' / 'build.py'), '__name__': 'mgu_builder'}
    exec(compile(source, module['__file__'], 'exec'), module)
    module['build'](APP)
    stage = kit / 'dist' / APP / 'source'
    package_file = stage / 'package.json'
    package = json.loads(package_file.read_text(encoding='utf-8'))
    feed = json.loads(FEED.read_text(encoding='utf-8'))
    # The app is useless without the feed tool, so the Store installs both.
    package.update(mguHmi=['ID7'], requires={feed['id']: feed['version']})
    package_file.write_text(json.dumps(package, indent=2) + '\n', encoding='utf-8')
    shutil.copy2(kit / 'LICENSE', stage / 'LICENSE-app-kit')
    shutil.copy2(ROOT / 'NOTICE.md', stage / 'NOTICE.md')
    for path in (stage / 'javascript').glob('*.js'):
        subprocess.run(['node', '--check', str(path)], check=True)
    if (stage / 'node_modules' / 'oap-sdk').exists():
        raise SystemExit('SDK must not be packaged')
    output = args.out.resolve()
    output.mkdir(parents=True, exist_ok=True)
    asset = output / (APP + '@' + package['version'] + '.tgz')
    with tarfile.open(asset, 'w:gz') as archive:
        archive.add(stage, arcname='package')
    print('ID7 prototype (not car-tested): ' + str(asset))


if __name__ == '__main__':
    main()
