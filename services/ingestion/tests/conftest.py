"""Make the package importable when running the tests from source, under either
pytest or ``python -m unittest``.
"""

import pathlib
import sys

SRC = pathlib.Path(__file__).resolve().parents[1] / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))
