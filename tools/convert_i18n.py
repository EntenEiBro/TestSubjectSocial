"""Convert the web version's language packs to JSON for the Godot project.

Usage:  python tools/convert_i18n.py

Reads  Test Subject Social/game/src/i18n/lang/<code>.js and catalog.js
Writes godot/i18n/<code>.json  {"strings": {...}, "patterns": {...}}
       godot/i18n/patterns.json [{"id", "re"}]  (HUD message patterns, in match order)
       godot/i18n/en.json       {"strings": {}} (English is the key language)
"""
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "Test Subject Social", "game", "src", "i18n")
OUT = os.path.join(ROOT, "godot", "i18n")


def js_string(src, i):
    """Parse a JS string literal starting at src[i] (quote char). Returns (value, next index)."""
    q = src[i]
    i += 1
    out = []
    while src[i] != q:
        c = src[i]
        if c == "\\":
            n = src[i + 1]
            if n == "n":
                out.append("\n")
            elif n == "t":
                out.append("\t")
            elif n == "u":
                out.append(chr(int(src[i + 2:i + 6], 16)))
                i += 4
            else:
                out.append(n)
            i += 2
            continue
        out.append(c)
        i += 1
    return "".join(out), i + 1


def parse_pack(path):
    src = open(path, encoding="utf-8-sig").read()
    data = {"strings": {}, "patterns": {}}
    section = None
    i = 0
    while i < len(src):
        c = src[i]
        if src.startswith("strings:", i):
            section = "strings"; i += 8; continue
        if src.startswith("patterns:", i):
            section = "patterns"; i += 9; continue
        if src.startswith("//", i):
            i = src.index("\n", i); continue
        if section and c in "'\"":
            key, i = js_string(src, i)
            m = re.compile(r"\s*:\s*").match(src, i)
            if not m:
                continue
            i = m.end()
            if src[i] in "'\"":
                val, i = js_string(src, i)
                data[section][key] = val
            continue
        if section == "patterns" and (c.isalpha() or c == "_"):
            m = re.compile(r"([A-Za-z_][A-Za-z0-9_]*)\s*:\s*").match(src, i)
            if m and src[m.end()] in "'\"":
                val, i = js_string(src, m.end())
                data["patterns"][m.group(1)] = val
                continue
        i += 1
    return data


def parse_patterns():
    src = open(os.path.join(SRC, "catalog.js"), encoding="utf-8").read()
    out = []
    for m in re.finditer(r"\{\s*id:\s*'([A-Za-z0-9_]+)',\s*re:\s*/(.+?)/,\s*example", src):
        out.append({"id": m.group(1), "re": m.group(2).replace("\\/", "/")})
    return out


def main():
    os.makedirs(OUT, exist_ok=True)
    for f in sorted(os.listdir(os.path.join(SRC, "lang"))):
        code = f[:-3]
        data = parse_pack(os.path.join(SRC, "lang", f))
        with open(os.path.join(OUT, code + ".json"), "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=0, sort_keys=True)
        print(code, len(data["strings"]), "strings,", len(data["patterns"]), "patterns")
    pats = parse_patterns()
    with open(os.path.join(OUT, "patterns.json"), "w", encoding="utf-8") as fh:
        json.dump(pats, fh, ensure_ascii=False, indent=0)
    with open(os.path.join(OUT, "en.json"), "w", encoding="utf-8") as fh:
        json.dump({"strings": {}, "patterns": {}}, fh)
    print(len(pats), "HUD patterns")


if __name__ == "__main__":
    main()
