"""Helpers for querying the local cell cache written by extract_workbooks.py.

The cache lives outside the repository (scratch directory passed as the
PHASE1_CACHE environment variable). Each entry is (formula|None, cached value,
number format).
"""
from __future__ import annotations

import os
import pickle
import re
from functools import lru_cache

from openpyxl.utils import column_index_from_string, get_column_letter

CACHE = os.environ.get("PHASE1_CACHE", "")


@lru_cache(maxsize=None)
def load(sid: str) -> dict:
    with open(os.path.join(CACHE, "cells", f"{sid}.pkl"), "rb") as fh:
        return pickle.load(fh)


def cell(sid: str, sheet: str, ref: str):
    return load(sid).get(sheet, {}).get(ref, (None, None, None))


def val(sid, sheet, ref):
    return cell(sid, sheet, ref)[1]


def formula(sid, sheet, ref):
    return cell(sid, sheet, ref)[0]


def split(ref: str):
    m = re.fullmatch(r"([A-Z]+)(\d+)", ref)
    return column_index_from_string(m.group(1)), int(m.group(2))


def dump(sid, sheet, rng, show_formula=True, width=40):
    a, b = rng.split(":")
    c1, r1 = split(a)
    c2, r2 = split(b)
    data = load(sid).get(sheet, {})
    for r in range(r1, r2 + 1):
        parts = []
        for c in range(c1, c2 + 1):
            ref = f"{get_column_letter(c)}{r}"
            if ref in data:
                f, v, _ = data[ref]
                s = f"{ref}={v!r}"
                if show_formula and f:
                    s += f" [{str(f)[:width]}]"
                parts.append(s)
        if parts:
            print(" | ".join(parts))
