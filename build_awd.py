"""Build the SDK-free AWD Diagnostic release asset with the pinned iDrive 7 kit."""

from pathlib import Path
import shutil
import subprocess
import sys
import tempfile


ROOT = Path(__file__).resolve().parent
KIT = "https://github.com/cauliflowermossgrape/idrive7-apps.git"
REVISION = "f5e4b8daa6c930f83a93fd6d6a158ab08c00c748"
APP = "awd_diag"


def build(kit):
    subprocess.run(["git", "init", "--quiet", kit], check=True)
    subprocess.run(["git", "-C", kit, "fetch", "--quiet", "--depth=1", KIT, REVISION], check=True)
    subprocess.run(["git", "-C", kit, "checkout", "--quiet", "--detach", "FETCH_HEAD"], check=True)
    shutil.copytree(ROOT / "apps" / APP, kit / "apps" / APP)
    builder = kit / "kit/tools/build.py"
    code = builder.read_text(encoding="utf-8")
    start = code.index("    if not preview_only and not all(")
    end = code.index("    adir =", start)
    code = code[:start] + code[end:]
    sdk_lines = (
        "    os.makedirs(os.path.join(src, 'node_modules', 'oap-sdk'))\n",
        "    shutil.copy(os.path.join(SDK, 'index.js'), os.path.join(src, 'node_modules', 'oap-sdk', 'index.js'))\n",
        "    shutil.copy(os.path.join(SDK, 'package.json'), os.path.join(src, 'node_modules', 'oap-sdk', 'package.json'))\n",
    )
    for line in sdk_lines:
        if code.count(line) != 1:
            raise RuntimeError("Unexpected SDK stanza in the pinned kit")
        code = code.replace(line, "", 1)
    code = code.replace("    # --- archives ---",
                        "    shutil.copyfile(os.path.join(ROOT, 'LICENSE'), os.path.join(src, 'LICENSE'))\n"
                        "    # --- archives ---", 1)
    builder.write_text(code, encoding="utf-8")
    subprocess.run([sys.executable, builder, APP], check=True)
    javascript = kit / "dist" / APP / "source" / "javascript"
    subprocess.run(["node", "--check", javascript / "app.js"], check=True)
    subprocess.run(["node", ROOT / "tests" / "awd.cjs", javascript], check=True)


if __name__ == "__main__":
    output = ROOT / "dist"
    output.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="mgu-awd-kit-") as temp:
        kit = Path(temp)
        build(kit)
        asset, = (kit / "dist").glob(f"{APP}@*.tgz")
        print(shutil.copy2(asset, output))
