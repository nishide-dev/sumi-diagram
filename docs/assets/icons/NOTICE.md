# Third-party assets

`claudecode.svg` and `codex.svg` are derived from LobeHub Icons (used by the README figure, `../architecture.sumi.yaml`).

- Package: `@lobehub/icons-static-svg` version 1.101.0 (published 2026-10-26), fetched with
  `npm pack --ignore-scripts`; https://github.com/lobehub/lobe-icons
- License: MIT (package.json `"license": "MIT"`). The npm tarball has no LICENSE file, so the
  text below was copied from the upstream repository's LICENSE (master branch).
- Source files: `icons/claudecode-color.svg` and `icons/codex.svg` (and `icons/codex-color.svg` for its gradient colour).
- Modifications:
  - `claudecode.svg`: the path of `claudecode-color.svg` unchanged (fill `#D97757`, viewBox
    0 0 24 24); `<title>` and the root `style`/size attributes removed.
  - `codex.svg`: the path of `codex.svg` with `fill="currentColor"` replaced by `#7A9DFF` (the
    middle stop of `codex-color.svg`'s gradient: Sumi's SVG importer rejects gradients and
    `<defs>`); `<title>` and the root `style`/size attributes removed.
- The marks are the trademarks of their owners (Anthropic: Claude Code; OpenAI: Codex); the MIT
  license covers LobeHub's SVG artwork, not trademark rights.

## LICENSE (lobehub/lobe-icons)

```text
MIT License

Copyright (c) 2023 LobeHub

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
