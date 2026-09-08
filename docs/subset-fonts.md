# Font subsetting pipeline

This document captures the one-off pipeline used to generate the
WOFF2 font files in `app/fonts/`. Run it again if you need to refresh
from upstream IBM Plex / Space Grotesk releases.

## What we ship vs. what's upstream

| Font | Upstream | Shipped | Reduction |
|---|---|---|---|
| IBM Plex Sans (regular) | 532 KB TTF, wght 100-700 + wdth 85-100 | 58 KB WOFF2, wght 400-700, wdth pinned | 89% |
| IBM Plex Sans (italic) | 594 KB TTF, same axes | **dropped** | 100% |
| Space Grotesk | 134 KB TTF, wght 300-700 | 40 KB WOFF2, wght 400-700 | 70% |
| JetBrains Mono | 285 KB TTF, wght 100-800 | 40 KB WOFF2, wght 400-600 | 86% |

JetBrains Mono was added here on 2026-09-07. Until then it was the one face
loaded with `next/font/google`, which made `fonts.googleapis.com` a hard
dependency of `next build` — a fetch failure there ends the build, and so a
production deploy, rather than degrading the page. It bought nothing:
`next/font/google` downloads at build time and serves from our own origin
anyway, which is what `next/font/local` does without the round trip. Pinned by
`__tests__/design-canary.test.ts` so it cannot come back unnoticed.

Italic is dropped because:

1. The italic file alone was larger than both subset regulars combined.
2. Italic is rare in the UI (occasional `<em>` in announcements).
3. Browsers synthesize italic by skewing the regular font ~12° — visually
   indistinguishable from real italic for body text at this size.

## Pipeline

Requires `fonttools` and `brotli` (Python):

```bash
pip3 install --user fonttools brotli
export PATH="$HOME/Library/Python/3.9/bin:$PATH"   # or wherever pip put them
```

The Unicode subset covers Latin + Latin-1 Supplement + Latin Extended A/B
plus typographic punctuation, currency symbols, and ligature characters —
enough for any Western European name and the symbols used in `messages/*.json`.
Chinese characters in `zh-CN` locale render via system fonts (intentional).

```bash
UNICODES="U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0100-024F,U+0259,U+1E00-1EFF,U+2000-206F,U+2074,U+20A0-20CF,U+2113,U+2122,U+FEFF,U+FFFD"

# IBM Plex Sans — pin wdth axis, limit wght range, then subset + woff2
fonttools varLib.instancer SOURCE/IBMPlexSans-VariableFont_wdth_wght.ttf \
  wdth=100 wght=400:700 \
  -o /tmp/IBMPlex-axis-trim.ttf

pyftsubset /tmp/IBMPlex-axis-trim.ttf \
  --output-file=app/fonts/IBMPlexSans-Subset.woff2 \
  --flavor=woff2 \
  --unicodes="$UNICODES" \
  --layout-features='*' \
  --name-IDs='*'

# Space Grotesk — only wght axis, limit range, then subset + woff2
fonttools varLib.instancer SOURCE/SpaceGrotesk-VariableFont_wght.ttf \
  wght=400:700 \
  -o /tmp/SpaceGrotesk-axis-trim.ttf

pyftsubset /tmp/SpaceGrotesk-axis-trim.ttf \
  --output-file=app/fonts/SpaceGrotesk-Subset.woff2 \
  --flavor=woff2 \
  --unicodes="$UNICODES" \
  --layout-features='*' \
  --name-IDs='*'

# JetBrains Mono — only wght axis, limit to the 400–600 the UI asks for
fonttools varLib.instancer 'SOURCE/JetBrainsMono[wght].ttf' \
  wght=400:600 \
  -o /tmp/JetBrainsMono-axis-trim.ttf

pyftsubset /tmp/JetBrainsMono-axis-trim.ttf \
  --output-file=app/fonts/JetBrainsMono-Subset.woff2 \
  --flavor=woff2 \
  --unicodes="$UNICODES" \
  --layout-features='*' \
  --name-IDs='*'
```

If `pyftsubset` / `fonttools` are not on PATH, the same tools run as modules
off any Python with fontTools installed — `python3 -m fontTools.subset` and
`python3 -m fontTools.varLib.instancer` take identical arguments. That is how
the JetBrains Mono file in this repo was generated.

`--layout-features='*'` keeps OpenType features (kerning, ligatures, fractions).
`--name-IDs='*'` keeps the font's name records so `next/font/local` and
DevTools can identify it correctly.

## Source files

Upstream variable fonts are NOT checked into this repo. If you need to
refresh:

- IBM Plex Sans: https://github.com/IBM/plex-sans/releases (look for
  `IBMPlexSans-VariableFont_wdth,wght.ttf`)
- Space Grotesk: https://github.com/floriankarsten/space-grotesk/releases
  (look for `SpaceGrotesk-VariableFont_wght.ttf`)
- JetBrains Mono: https://github.com/JetBrains/JetBrainsMono/releases (look for
  `fonts/variable/JetBrainsMono[wght].ttf` inside the release zip)

Drop them in any working directory, run the commands above with that
working dir as `SOURCE/`, and the new WOFF2 files land in `app/fonts/`.
