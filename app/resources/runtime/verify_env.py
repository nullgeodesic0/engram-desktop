"""Run by envManager.ts after an install: proves the core packages import and
reports what was installed. Prints one JSON line."""

import json
import sys
from importlib import metadata

import matplotlib  # noqa: F401
import numpy  # noqa: F401
import pymatching  # noqa: F401
import stim  # noqa: F401

versions = {}
for name in ("stim", "sinter", "pymatching", "ldpc", "numpy", "scipy", "matplotlib", "qutip", "pytest"):
    try:
        versions[name] = metadata.version(name)
    except Exception:
        pass
print(json.dumps({"python": ".".join(map(str, sys.version_info[:3])), "packages": versions}))
