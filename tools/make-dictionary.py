#!/usr/bin/env python3
# Copyright (c) 2026 webOS Phoenix contributors
# SPDX-License-Identifier: Apache-2.0
#
# The Assistant's offline dictionary ("define serendipity", "what does
# ephemeral mean": apps/assistant/service lib/commands-facts.js), made from
# Princeton WordNet 3.0 (its licence: apps/assistant/service/data/
# WORDNET-LICENSE, docs/LEGAL.md):
#
#   tools/make-dictionary.py WORDNET_DICT_DIR
#     (the dict/ folder of WordNet-3.0.tar.gz,
#      https://wordnetcode.princeton.edu/3.0/WordNet-3.0.tar.gz,
#      SHA-256 below) -> apps/assistant/service/data/dictionary.json
#
# Kept small (about 2 MB): the words people use, those WordNet's sense
# counts saw in its tagged texts (index.* tagsense_cnt > 0), single words
# only, each with its commonest senses (at most MAX_SENSES, those seen first)
# and their definitions without the examples; and the irregular forms of
# those words (*.exc: "ran" -> "run"). The file:
#
#   {"source": ..., "words": {word: [[pos, definition], ...]},
#    "forms": {form: word}}
#
# pos: n, v, a (adjective), r (adverb).

import hashlib
import json
import os
import re
import sys

SHA256 = "640db279c949a88f61f851dd54ebbb22d003f8b90b85267042ef85a3781d3a52"   # WordNet-3.0.tar.gz
MAX_SENSES = 2
TAXON = re.compile(r"\b(?:genus|family|order|suborder|class|subclass|phylum|division|subfamily|superfamily) (?:of|comprising|including|containing|coextensive)\b|^(?:a |the |any |small |large |monotypic |type )*(?:genus|family)\b")
POS = {"noun": "n", "verb": "v", "adj": "a", "adv": "r"}
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "apps", "assistant", "service", "data", "dictionary.json")


def synset(data, offset):
    """(definition, lexical file number, an instance: a person or a place)."""
    data.seek(offset)
    line = data.readline().decode("utf-8")
    head, _, text = line.partition(" | ")
    f = head.split()
    lexfile = int(f[1])
    # The pointers: after the words ("w_cnt" pairs), "p_cnt" of four fields each.
    w_cnt = int(f[3], 16)
    p_at = 4 + 2 * w_cnt
    p_cnt = int(f[p_at])
    pointers = [f[p_at + 1 + 4 * i] for i in range(p_cnt)]
    # The definition, not the examples ('...; "an example"').
    parts = [p.strip() for p in text.strip().split(";")]
    keep = [p for p in parts if p and not p.startswith('"')]
    return "; ".join(keep[:2]).strip(), lexfile, "@i" in pointers


def main(d):
    words, forms = {}, {}
    for name, pos in POS.items():
        with open(os.path.join(d, "index." + name), encoding="utf-8") as idx, open(os.path.join(d, "data." + name), "rb") as data:
            for line in idx:
                if line.startswith("  "):
                    continue        # the licence at the top
                f = line.split()
                lemma, p_cnt = f[0], int(f[3])
                tagged = int(f[5 + p_cnt])
                if "_" in lemma or not lemma.isalpha():
                    continue
                # A word seen in the tagged texts: its commonest senses; any other: its first.
                offsets = [int(o) for o in f[6 + p_cnt:]][:MAX_SENSES if tagged > 0 else 1]
                got = [synset(data, o) for o in offsets]
                # Not people and places (instances: Wikipedia's, not a dictionary's),
                # and, of the words not in the tagged texts, not the taxonomy's
                # Latin names ("a genus of ...") nor the plants (noun.plant, 20).
                got = [g for g in got if g[0] and not g[2]]
                if tagged <= 0 and got and (TAXON.search(got[0][0]) or (pos == "n" and got[0][1] == 20)):
                    continue
                if got:
                    words.setdefault(lemma, []).append((tagged, [[pos, g[0]] for g in got]))
        with open(os.path.join(d, name + ".exc"), encoding="utf-8") as exc:
            for line in exc:
                f = line.split()
                if len(f) >= 2 and f[1] in words and f[0] not in words and f[0].isalpha():
                    forms[f[0]] = f[1]
    # At most MAX_SENSES in all: the part of speech seen most in the tagged
    # texts first ("ephemeral" the adjective before the noun), each's senses
    # as WordNet ranks them.
    for w in words:
        groups = sorted(words[w], key=lambda g: -g[0])
        words[w] = [s for g in groups for s in g[1]][:MAX_SENSES]
    out = {"source": "Princeton WordNet 3.0 (WordNet 3.0 Copyright 2006 by Princeton University; licence: WORDNET-LICENSE), "
                     "made by tools/make-dictionary.py", "words": words, "forms": forms}
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
        fh.write("\n")
    print("%d words, %d forms -> %s (%d bytes)" % (len(words), len(forms), os.path.relpath(OUT), os.path.getsize(OUT)))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__ or "usage: make-dictionary.py WORDNET_DICT_DIR")
    main(sys.argv[1])
