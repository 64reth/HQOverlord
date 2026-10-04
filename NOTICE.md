# Third-party notices & credits

StarNet bundles a library of **pure-prompt skill recipes** (`sidecar/skills/library/*.md`).
Many are adaptations of MIT-licensed community skills. This file preserves the attribution
and license notices for that upstream work, as the MIT License requires. The recipe text in
the app is condensed and re-voiced for StarNet's workstation model, but the underlying ideas
and, in places, close paraphrases originate with the authors credited below.

Several recipes reached StarNet through the open-source **Hermes agent project**
(© 2025 Nous Research, MIT) — the harness StarNet's backend was in part ported from — which
had itself collected them from the community authors listed here. Credit is given to the
original authors wherever one is known.

## Community skills (original author credited)

| Recipe | Original author / source | License |
| --- | --- | --- |
| `adversarial-ux-test` | Omni @ Comelse — *adversarial-ux-test* | MIT |
| `architecture-diagram` | Cocoon AI — [architecture-diagram-generator](https://github.com/Cocoon-AI/architecture-diagram-generator) | MIT |
| `ascii-art` | 0xbyt4 — *ascii-art* | MIT |
| `concept-diagrams` | v1k22 — *concept-diagrams* | MIT |
| `creative-ideation` | SHL0MS — *creative-ideation* | MIT |
| `decision-1-3-1` | Willard Moore — *one-three-one-rule* | MIT |
| `humanizer` | Siqi Chen (@blader) — [blader/humanizer](https://github.com/blader/humanizer); based on *Wikipedia: Signs of AI writing* | MIT |
| `meme-generation` | adanaleycio — *meme-generation* | MIT |
| `osint-public-records` | ShinMegamiBoson — *OpenPlanter* | MIT |
| `plan` | [obra/superpowers](https://github.com/obra/superpowers) | MIT |
| `popular-web-designs` | Teknium — design systems via *VoltAgent/awesome-design-md* | MIT |
| `requesting-code-review` | [obra/superpowers](https://github.com/obra/superpowers) + MorAlekss | MIT |
| `research-paper-writing` | Orchestra Research — *research-paper-writing* | MIT |
| `spike` | gsd-build — *get-shit-done* | MIT |
| `systematic-debugging` | [obra/superpowers](https://github.com/obra/superpowers) | MIT |
| `test-driven-development` | [obra/superpowers](https://github.com/obra/superpowers) | MIT |
| `ui-sketch` | gsd-build — *get-shit-done* | MIT |

## Ported from the Hermes agent project (© 2025 Nous Research, MIT)

These recipes were adapted from skills in the Hermes project's own library. Original
copyright holder: **Nous Research**.

`arxiv-research`, `code-review`, `codebase-inspection`, `domain-intel`, `excalidraw`,
`node-inspect-debugger`, `p5js-sketch`, `pdf-document-extraction` (from *ocr-and-documents*),
`python-debugger`, `simplify-code`, `web-research`.

## Authored for StarNet

These recipes were written for StarNet and carry no distinct external upstream. (They were
previously bylined "Hermes Agent" by convention; that byline has been removed.)

`adversarial-review-pass`, `announcement-kit`, `digest-composer`, `feed-watch`,
`ledger-upkeep`, `price-watch`, `security-sweep`, `source-triangulation`, `study-plan`,
`translation-pass`.

## Bundled fonts

StarNet ships the **VT323** typeface locally (`frontend/assets/fonts/vt323.woff2`) so the
CRT terminal look renders on an offline / air-gapped first boot without depending on Google
Fonts. VT323 is provided under the **SIL Open Font License, Version 1.1**.

- **Font:** VT323
- **Copyright:** © 2011 The VT323 Project Authors (peter.hull@oikoi.com)
- **License:** SIL Open Font License 1.1 — <https://openfontlicense.org>

The OFL permits bundling and redistribution of the font (including in an application) provided
the copyright and license notice above are preserved and the font itself is not sold on its
own. The full license text is available at the URL above; its permission notice reads, in
part:

```
This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
https://openfontlicense.org

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining a copy of the Font
Software, to use, study, copy, merge, embed, modify, redistribute, and sell modified and
unmodified copies of the Font Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components, in Original or Modified
   Versions, may be sold by itself.
2) Original or Modified Versions of the Font Software may be bundled, redistributed and/or
   sold with any software, provided that each copy contains the above copyright notice and
   this license. These can be included either as stand-alone text files, human-readable
   headers or in the appropriate machine-readable metadata fields within text or binary
   files as long as those fields can be easily viewed by the user.

THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
PURPOSE AND NONINFRINGEMENT OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT.
```

## MIT License

All third-party components listed above are provided under the MIT License. Copyright is held
by the respective authors named above (and, for the Hermes-derived recipes, © 2025 Nous
Research). The MIT permission notice is reproduced once here as it applies to all of them:

```
Permission is hereby granted, free of charge, to any person obtaining a copy of this
software and associated documentation files (the "Software"), to deal in the Software
without restriction, including without limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons
to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE
FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

## Bundled Ogg/Opus decoder

StarNet uses [`ogg-opus-decoder`](https://github.com/eshaz/wasm-audio-decoders/tree/main/src/ogg-opus-decoder)
(Copyright Ethan Halsall, MIT) to decode Telegram voice notes for the local speech-recognition engine. Its
transitive [`codec-parser`](https://github.com/eshaz/codec-parser) component is provided under the GNU Lesser
General Public License v3.0 or later. The unmodified packages, their license files, and their corresponding
source locations are preserved in the bundled `node_modules` tree.

## StarNet's own name and artwork

The credits above cover third-party work bundled with StarNet. StarNet's own code is released
under the MIT License (see `LICENSE`) and may be forked, modified, and redistributed, including
commercially.

That license covers the code only. The **StarNet** name, the logo, the station artwork and
sprites, and the rest of the project's brand identity are owned by Andrew Sims and are not
licensed with the code. No trademark or other brand right is granted, expressly or by
implication. A fork or derivative must ship under its own name, logo, and artwork, and must not
present itself as StarNet or as endorsed by it.
