# Inter Latin fonts (slots `latin` / `latinBold` of `sumi/inter-biz-ud-gothic`)

Latin fonts for the text of labels in structured figures (#172). Static TrueType fonts licensed under the SIL Open Font License 1.1 ([OFL.txt](OFL.txt)).

| Slot | File | Size (bytes) | SHA-256 |
| --- | --- | --- | --- |
| `latin` | `Inter-Regular.ttf` | 411640 | `40d692fce188e4471e2b3cba937be967878f631ad3ebbbdcd587687c7ebe0c82` |
| `latinBold` | `Inter-Bold.ttf` | 420428 | `288316099b1e0a47a4716d159098005eef7c0066921f34e3200393dbdb01947f` |
| — | `OFL.txt` | 4380 | `262481e844521b326f5ecd053e59b98c8b2da78c8ee1bdbb6e8174305e54935a` |

- `latin` draws every character of regular label text that Inter has (Latin, Greek, Cyrillic, digits, punctuation, arrows, …); `latinBold` the same for bold text. Characters Inter lacks (Japanese) are drawn with the font set's `regular` / `bold` (BIZ UDPGothic). Mono text keeps BIZ UDGothic.
- Both are used only by the structured layout engine; D2 (`auto`) never receives them. Only the font set `sumi/inter-biz-ud-gothic` has these slots; the default `sumi/biz-ud-gothic` does not.

## Source

- Upstream: <https://github.com/rsms/inter>, release **v4.1** (tag commit `e3a3d4c57d5ecc01453a575621882a384c1995a3`, font version 4.1)
- Archive: <https://github.com/rsms/inter/releases/download/v4.1/Inter-4.1.zip> (SHA-256 `9883fdd4a49d4fb66bd8177ba6625ef9a64aa45899767dde3d36aa425756b11e`), files from `extras/ttf/`; `OFL.txt` is the archive's `LICENSE.txt`
- License text: <https://github.com/rsms/inter/blob/v4.1/LICENSE.txt> (no Reserved Font Name)

Do not modify the font files; replace them only together with this README and the font set definition in `src/core/theme/fonts.ts`. Rendered SVGs embed TrueType subsets of the glyphs a figure uses (keeping the `name` table with the copyright and license), as documents embed fonts; Sumi distributes the font files themselves unmodified.
