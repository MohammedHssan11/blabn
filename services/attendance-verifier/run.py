"""Launcher for `python -I run.py [--synthetic-test-engine]`.

Isolated mode (-I) ignores PYTHONPATH and user site-packages and does not put this folder on the import
path, so the launcher adds exactly this folder and nothing else.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from verifier.__main__ import main  # noqa: E402

if __name__ == "__main__":
    main()
