# #664 規則の一覧を読み込み時でなく初めて使うときに作る

- **背景**: 幾何の規則と `lint/config` は互いに import している。`lint/config` は全規則の一覧（既定の設定）を持ち、試し配置で直す規則（`dead-space`・`content-band`・`relocatable` など）は `lint/geometry/trial.ts`・`placement-drift.ts` から、試した図を全規則で lint するためにその既定の設定を使う。一覧 `BUILTIN_GEOMETRY_RULES`・`ALL_LINT_RULES` は読み込み時に配列を作っていたので、`lint/geometry`（index）や規則のモジュールを最初に import すると、まだ定義されていない規則を読んで「Cannot access 'deadSpace' / 'BUILTIN_GEOMETRY_RULES' before initialization」で落ちた。全体のテストでは別のファイルが先に `lint/config` を読み込むので通り、ファイル単独では落ちた（src/lint と src/render の 132 ファイル中 27）。
- **決定**: 一覧を関数にし、初めて呼ばれたときに作って凍結し、以後は同じ配列を返す。`builtinGeometryRules()`（`lint/geometry/rules.ts`）と `allLintRules()`（`lint/config.ts`）。`resolveLintConfig()` の既定値は呼び出し時に `allLintRules()` を使う。読み込み時に循環の中の値を読まないので、どのモジュールから読み込んでも落ちない。回避のために `import "../config";` を先頭に置いていたテストから、その行を外した。`src/lint/load-order.test.ts` が src/lint と src/render の各モジュールを新しいプロセスで最初に import し、再発を検査する。
- **採らなかった案**: import の循環そのものを断つこと。試し配置で直す規則は、試した図を全規則で lint する（自分自身を含む）ので、規則と規則の一覧は実行時に互いを必要とする。断つには既定の設定を外から注入する必要があり、注入されないまま規則を直接呼ぶテストや経路で振る舞いが変わる。
- **互換性**: 出力は変わらない（`bun run gallery:check`）。`BUILTIN_GEOMETRY_RULES`・`ALL_LINT_RULES` の定数は関数に置き換わる（内部の API）。
