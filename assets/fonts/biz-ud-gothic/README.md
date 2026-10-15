# BIZ UDGothic font set (`sumi/biz-ud-gothic`)

Built-in font set used by the built-in themes. Static TrueType fonts with Latin and Japanese (JIS X 0213) coverage, licensed under the SIL Open Font License 1.1 ([OFL.txt](OFL.txt)).

| Slot | File | Size (bytes) | SHA-256 |
| --- | --- | --- | --- |
| `regular` | `BIZUDPGothic-Regular.ttf` | 4669688 | `5050778170c19fde190eb7ac7b3c5285bbf917d2cb0bdf184d89b6e4b6207d96` |
| `bold` | `BIZUDPGothic-Bold.ttf` | 4640596 | `4372c4325944342bdd5efa489ff6204b273953c384ad3d8b4625fb58aaec5a1e` |
| `mono` | `BIZUDGothic-Regular.ttf` | 4667380 | `031b7e944e42528927e141d097bff50b554de67c906513cb0737180e9ba0f2a9` |
| — | `OFL.txt` | 4408 | `e753d7155d53c747d037a445e584c8ecfca6dd79846db610417e282a736b28bc` |

- `regular` / `bold` are the proportional family (BIZ UDPGothic); `mono` is the fixed-width family (BIZ UDGothic), whose Latin glyphs are half-width.
- There is no `italic` slot: the family has no italic. Themes that set `italic: true` fail with `theme/missing-font`.

## Source

- Upstream: <https://github.com/googlefonts/morisawa-biz-ud-gothic>, release **v1.051** (font version 1.051)
- Archive: <https://github.com/googlefonts/morisawa-biz-ud-gothic/releases/download/v1.051/morisawa-biz-ud-gothic-fonts.zip> (SHA-256 `0b639f526609affe753d5c18d36a65dd68134fbe9b530b4d055a54f51158b0a7`), files from `fonts/ttf/`
- License text: <https://raw.githubusercontent.com/googlefonts/morisawa-biz-ud-gothic/v1.051/OFL.txt>
- The BIZ UDPGothic files are byte-identical to `ofl/bizudpgothic/` in [google/fonts](https://github.com/google/fonts). (google/fonts ships BIZ UDGothic from the earlier v1.05 release, so `ofl/bizudgothic/` differs from the v1.051 file used here.)

Do not modify the font files; replace them only together with this README and the font set definition in `src/core/theme/fonts.ts`.
