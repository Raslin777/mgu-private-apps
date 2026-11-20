"""Build HUD Blindspot with the pinned MIT app kit, without BMW's SDK."""
from pathlib import Path
import argparse
import json
import shutil
import subprocess
import sys
import tarfile

ROOT = Path(__file__).resolve().parents[1]
APP = 'hud_blindspot'
REVISION = '2c6cfdfaa6902f1b469c3784508fadae12b577eb'

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--kit', type=Path, default=ROOT / '.cache' / 'idrive-kit')
    args = parser.parse_args()
    kit = args.kit.resolve()
    if not kit.exists():
        local = [ROOT.parent / name / '.cache' / 'idrive-kit' for name in ('Ai-Coder', 'Camera-Cluster')]
        origin = next((str(p) for p in local if p.exists()), 'https://github.com/cauliflowermossgrape/idrive7-apps.git')
        kit.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(['git', 'clone', '--no-checkout', origin, str(kit)], check=True)
        subprocess.run(['git', '-C', str(kit), 'checkout', '--detach', REVISION], check=True)
    revision = subprocess.check_output(['git', '-C', str(kit), 'rev-parse', 'HEAD'], text=True).strip()
    if revision != REVISION:
        raise SystemExit('Unexpected app kit revision: ' + revision)
    for target in (kit / 'apps' / APP, kit / 'dist' / APP):
        if target.is_symlink() or not target.resolve().is_relative_to(kit):
            raise SystemExit('Build cleanup would leave the kit: ' + str(target))
        shutil.rmtree(target, ignore_errors=True)
    shutil.copytree(ROOT / 'apps' / APP, kit / 'apps' / APP)
    sys.path.insert(0, str(kit / 'kit' / 'tools'))
    source = (kit / 'kit' / 'tools' / 'build.py').read_text(encoding='utf-8')
    start = source.index('    if not preview_only and not all(')
    end = source.index('    adir =', start)
    source = source[:start] + source[end:]
    for line in (
        "    os.makedirs(os.path.join(src, 'node_modules', 'oap-sdk'))\n",
        "    shutil.copy(os.path.join(SDK, 'index.js'), os.path.join(src, 'node_modules', 'oap-sdk', 'index.js'))\n",
        "    shutil.copy(os.path.join(SDK, 'package.json'), os.path.join(src, 'node_modules', 'oap-sdk', 'package.json'))\n",
    ):
        if source.count(line) != 1:
            raise SystemExit('Pinned builder SDK stanza changed')
        source = source.replace(line, '', 1)
    module = {'__file__': str(kit / 'kit' / 'tools' / 'build.py'), '__name__': 'hud_builder'}
    exec(compile(source, module['__file__'], 'exec'), module)
    module['build'](APP)
    stage = kit / 'dist' / APP / 'source'
    package_file = stage / 'package.json'
    package = json.loads(package_file.read_text(encoding='utf-8'))
    package['mguHmi'] = ['ID7']
    package['requires'] = {'cluster-render': '0.6.7'}
    package_file.write_text(json.dumps(package, indent=2) + '\n', encoding='utf-8')
    shutil.copy2(ROOT / 'NOTICE.md', stage / 'NOTICE.md')
    shutil.copy2(ROOT / 'LICENSE', stage / 'LICENSE')
    shutil.copy2(ROOT / 'LICENSES' / 'MIT-app-kit.txt', stage / 'LICENSE-app-kit')
    shutil.copytree(ROOT / 'LICENSES', stage / 'LICENSES')
    for path in (stage / 'javascript').glob('*.js'):
        subprocess.run(['node', '--check', str(path)], check=True)
    if (stage / 'node_modules' / 'oap-sdk').exists():
        raise SystemExit('BMW SDK must not be bundled')
    output = ROOT / 'dist'
    output.mkdir(exist_ok=True)
    asset = output / (APP + '@' + package['version'] + '.tgz')
    with tarfile.open(asset, 'w:gz') as archive:
        archive.add(stage, arcname='package')
    print('SDK-free, not car-tested: ' + str(asset))

if __name__ == '__main__':
    main()
