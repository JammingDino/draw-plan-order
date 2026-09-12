"""Copy the web app into dist/ for the Tauri build.

Kept explicit rather than pointing Tauri at the project root so the bundle
never picks up src-tauri/, target/ or the tooling.

Run:  python tools/pack.py
"""
import os, shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "dist")

FILES = ["index.html", "manifest.webmanifest"]
DIRS = ["css", "js", "icons", "vendor"]     # vendor/ is pdf.js, bundled so PDFs work offline

if os.path.isdir(DIST):
    shutil.rmtree(DIST)
os.makedirs(DIST)

for f in FILES:
    shutil.copy2(os.path.join(ROOT, f), os.path.join(DIST, f))

for d in DIRS:
    shutil.copytree(os.path.join(ROOT, d), os.path.join(DIST, d))

# The service worker is only useful for the browser/PWA build; inside the
# desktop app the files are already local, and tauri:// cannot register one.
n = sum(len(files) for _, _, files in os.walk(DIST))
print(f"packed {n} files into {DIST}")
