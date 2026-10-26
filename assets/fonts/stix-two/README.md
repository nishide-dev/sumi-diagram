# STIX Two math fonts (slots `math` / `mathItalic` of `sumi/biz-ud-gothic`)

Math and Latin/Greek fonts for label math (`$...$`, #93) in structured figures. Static TrueType fonts licensed under the SIL Open Font License 1.1 ([OFL.txt](OFL.txt)).

| Slot | File | Size (bytes) | SHA-256 |
| --- | --- | --- | --- |
| `math` | `STIXTwoMath-Regular.ttf` | 1518116 | `2e0331951fd61efb60e4247db7e1b6b7f516f224987d6290c1d45437809a0977` |
| `mathItalic` | `STIXTwoText-Italic.ttf` | 424488 | `e9775b729e127624153e8a9c4518b412afb1f732cb7c501f5122527550859771` |
| — | `OFL.txt` | 4882 | `bec17cee6412788db45fd2644b301afbc99cc5d372ddd3345dc4a7bfdefb9f04` |

- `math` (STIX Two Math) draws upright math: digits, operators, relations, arrows, upright Greek capitals, `\mathrm`, and characters the label font lacks (subscript and superscript digits, `∼`, `⋯`, mathematical italic letters).
- `mathItalic` (STIX Two Text Italic) draws math variables: Latin letters and lowercase Greek, as TeX sets them.
- Both are used only by the structured layout engine; D2 (`auto`) never receives them.

## Source

- Upstream: <https://github.com/stipub/stixfonts>, release **v2.13** (tag commit `37308d44583ef882dc8b544aaa2e80ac8c406ebf`, font revision 2.13), files from `fonts/static_ttf/`
- License text: <https://github.com/stipub/stixfonts/blob/v2.13/OFL.txt> (Reserved Font Name "TM Math" for the MicroPress portions; "STIX Fonts" is a trademark of the IEEE)

Do not modify the font files; replace them only together with this README and the font set definition in `src/core/theme/fonts.ts`. Rendered SVGs embed TrueType subsets of the glyphs a figure uses (keeping the `name` table with the copyright and license), as documents embed fonts; Sumi distributes the font files themselves unmodified.
