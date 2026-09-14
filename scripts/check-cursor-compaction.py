#!/usr/bin/env python3
"""Verify the installed adapter or a known baseline before manual patching.

Read-only. Unknown versions or locally changed files require review, never overwrite.
Run on Mac or inside WSL; use the package actually selected by Pi settings.packages.
"""
import argparse
import hashlib
import json
from pathlib import Path

ASSETS = Path(__file__).resolve().parents[1] / "maintenance/pi-cursor-sdk"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def check_assets(root=ASSETS):
    manifest = json.loads((root / "manifest.json").read_text())
    for spec in manifest.values():
        for name, expected in spec["assets"].items():
            if digest(root / name) != expected:
                raise ValueError(f"Recovery asset changed: {name}; review and refresh manifest")
    return manifest


def check_package(package, manifest, state="after"):
    metadata = json.loads((package / "package.json").read_text())
    version = metadata.get("version")
    if metadata.get("name") != "pi-cursor-sdk" or version not in manifest:
        raise ValueError(f"Unreviewed adapter {metadata.get('name')} {version}; do not apply old patches")
    spec = manifest[version]
    entries = metadata.get("pi", {}).get("extensions", [])
    if [entry.removeprefix("./") for entry in entries] != [spec["entry"]]:
        raise ValueError(f"Unexpected Pi loader entry: {entries}; expected {spec['entry']}")
    if not (package / spec["entry"]).is_file():
        raise ValueError(f"Missing loader entry: {spec['entry']}")
    for name, hashes in spec["files"].items():
        if digest(package / name) != hashes[state]:
            raise ValueError(f"{version} {name} does not match reviewed {state} state")
    return version


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package", type=Path)
    parser.add_argument("--baseline", action="store_true", help="Require the exact unpatched baseline before patch --dry-run")
    args = parser.parse_args()
    try:
        manifest = check_assets()
        if args.baseline and args.package is None:
            parser.error("--baseline requires --package")
        if args.package:
            version = check_package(args.package, manifest, "before" if args.baseline else "after")
            print(f"PASS: pi-cursor-sdk {version}, {'baseline only (not release-ready)' if args.baseline else 'source and manifest-loaded runtime fixed'}")
        else:
            print("PASS: recovery patches and version-specific tests intact (installed runtime not checked)")
    except (ValueError, OSError, KeyError) as error:
        parser.exit(1, f"FAIL: {error}\n")


if __name__ == "__main__":
    main()
