"""Run by envManager.ts after an install: proves a layer's packages load and
reports what was installed. Prints one JSON line.

    python -I verify_env.py <import,names> <distribution,names>

The first list is imported (a failure exits non-zero with the traceback);
the second is looked up in the installed metadata for the version report.
"""

import importlib
import json
import sys
from importlib import metadata


def _names(arg: str) -> list:
    return [n.strip() for n in arg.split(",") if n.strip()]


imports = _names(sys.argv[1]) if len(sys.argv) > 1 else ["numpy", "scipy", "matplotlib", "pytest"]
dists = _names(sys.argv[2]) if len(sys.argv) > 2 else imports

for name in imports:
    importlib.import_module(name)

versions = {}
for name in dists:
    try:
        versions[name] = metadata.version(name)
    except Exception:
        pass
print(json.dumps({"python": ".".join(map(str, sys.version_info[:3])), "packages": versions}))
