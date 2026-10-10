"""Collect every translatable English string into one catalogue.

Usage:  python tools/extract_strings.py

Scans the game's JavaScript for:
  - t('...') / t("...") calls                (menus, screens, HUD labels)
  - minigame meta: title / tagline / category / objective / rules / control labels
  - commendation titles + descriptions, outfit names, resolution + device labels
  - orientation / conclusion lines (flow.js)
  - HUD_PHRASES and HUD_PATTERNS from i18n/catalog.js

and writes 'Test Subject Social/game/src/i18n/en-catalog.json':
  { "strings": [...English keys...],
    "patterns": [{"id", "regex", "example"}, ...] }

Translators produce lang/<code>.js with a translation for every key and a
template for every pattern id (see i18n.js).
"""
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "Test Subject Social", "game", "src")
OUT = os.path.join(SRC, "i18n", "en-catalog.json")

STR = r"""(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")"""   # one JS string literal (group 1 or 2)


def literals(pattern, text):
    for m in re.finditer(pattern, text):
        yield (m.group(1) if m.group(1) is not None else m.group(2)).replace("\\'", "'").replace('\\"', '"')


def read(*parts):
    with open(os.path.join(SRC, *parts), encoding="utf-8-sig") as f:
        return f.read()


def main():
    keys = []

    def add(s):
        if s and s not in keys and not s.startswith(("http", "#")):
            keys.append(s)

    # 1) t('...') calls everywhere (skip the language packs themselves)
    for folder, _, files in os.walk(SRC):
        if os.path.basename(folder) == "lang":
            continue
        for name in sorted(files):
            if name.endswith(".js"):
                with open(os.path.join(folder, name), encoding="utf-8-sig") as f:
                    text = f.read()
                # t('...') and tp('...') (translate + button prompts)
                for s in literals(r"\btp?\(\s*" + STR, text):
                    add(s)
                # pick('touch wording', 'button wording') — both arguments
                for m in re.finditer(r"\bpick\(\s*" + STR + r"\s*,\s*" + STR, text):
                    for g in (m.group(1), m.group(2), m.group(3), m.group(4)):
                        if g is not None:
                            add(g.replace("\\'", "'").replace('\\"', '"'))

    # 2) minigame meta
    for name in sorted(os.listdir(os.path.join(SRC, "minigames"))):
        if not name.endswith(".js") or name in ("index.js", "base.js"):
            continue
        text = read("minigames", name)
        meta = re.search(r"static meta = \{(.*?)\n  \};", text, re.S)
        if not meta:
            continue
        block = meta.group(1)
        for field in ("title", "tagline", "category", "objective"):
            for s in literals(field + r":\s*" + STR, block):
                add(s)
        rules = re.search(r"rules:\s*\[(.*?)\]", block, re.S)
        if rules:
            for s in literals(STR, rules.group(1)):
                add(s)
        for s in literals(r"label:\s*" + STR, block):
            add(s)

    # 3) data tables shown in the UI
    for s in literals(r"(?:title|desc):\s*" + STR, read("game", "achievements.js")):
        add(s)
    chars = read("core", "characters.js")
    for s in literals(r"name:\s*" + STR, chars):
        add(s)
    for arr in ("HATS", "FACES"):
        body = re.search(arr + r" = \[(.*?)\];", chars, re.S).group(1)
        for s in literals(STR, body):
            add(s)
    for s in literals(r"label:\s*" + STR, read("core", "engine.js")):
        add(s)
    for s in literals(r"name:\s*" + STR, read("core", "input.js")):
        add(s)
    for s in ("Online", "ORIENTATION", "CONCLUSION", "STANDINGS", "BOT"):
        add(s)

    # 4) monologue lines
    flow = read("game", "flow.js")
    for arr in ("INTRO_LINES", "OUTRO_LINES"):
        body = re.search(arr + r" = \[(.*?)\];", flow, re.S).group(1)
        for s in literals(STR, body):
            add(s)

    # 5) HUD phrases + patterns
    cat = read("i18n", "catalog.js")
    for arr in ("UI_DYNAMIC", "HUD_PHRASES"):
        body = re.search(arr + r" = \[(.*?)\];", cat, re.S).group(1)
        for s in literals(STR, re.sub(r"//[^\n]*", "", body)):
            add(s)
    patterns = []
    for m in re.finditer(r"\{ id: '(\w+)', re: /(.*?)/, example: " + STR + r" \}", cat):
        patterns.append({"id": m.group(1), "regex": m.group(2), "example": m.group(3) if m.group(3) is not None else m.group(4)})

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"strings": keys, "patterns": patterns}, f, ensure_ascii=False, indent=1)
    print(f"{len(keys)} strings, {len(patterns)} patterns -> {os.path.relpath(OUT, ROOT)}")


if __name__ == "__main__":
    main()
