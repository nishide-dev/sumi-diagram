# #597 `sumi update` と更新の通知

- **背景**: 新しい版が出ても、CLI の更新は install.sh の再実行、Skill の更新は `npx skills update` で、どちらも新しい版の存在を知らせる仕組みがなかった。
- **決定**:
  - **`sumi update`**（`src/core/update.ts`、`src/cli/commands/update.ts`）。install.sh と同じ `SUMI_LATEST_URL` / `SUMI_DOWNLOAD_BASE`（URL・絶対パス・`file://`）で最新版を解決し、`sumi-<版>-<target>.tar.gz` と `SHA256SUMS` を取得して検証する。`SUMI_HOME` 内の `.sumi-update.*` に展開し、新しい `bin/sumi --version` が期待の版を返すことを確かめてから、ディレクトリを `rename()` で所定の位置へ移し、`SUMI_BIN_DIR/sumi` のリンクを「一時リンクを作って `rename()` で置き換える」1 回の原子的操作で切り替える。切り替え前の失敗・中断は旧版を一切変えない（置いたディレクトリも巻き戻す）。強制終了で残った `.sumi-update.*` は次回の更新が 1 時間後から掃除する。切り替え後に旧版のディレクトリを削除する（リンクが切り替わった場合のみ）。
  - **対象の判定**: 実行中の `process.execPath` を `realpath` し、`<home>/sumi-<版>-<target>/bin/sumi` の形で、target が実行中の OS/CPU と一致し、`SUMI_HOME` があればそれが `<home>` と一致する場合だけ扱う。それ以外はインストーラーのコマンドを示して何も変えない（終了コード 2）。bin のリンクが実行中の版を指さない場合は、新しい版を入れるがリンクと旧版には触れず、その旨を表示する。
  - **終了コード**: `update` は 0（更新済み・最新）/ 2（拒否・失敗）。`--check` は 0（最新）/ 1（更新あり）/ 2（確認の失敗）。1 を「問題あり」と同じ意味に揃え、失敗は他のコマンドと同じ 2。診断は `sumi: error[update/<code>]: …` と `hint:` の 2 行で、コードは Diagnostic の `<stage>/<rule>` に合わせる（`update/checksum-mismatch` など）。
  - **`--version <x>`**: 古い版も指定でき、ダウングレードにも使える（表示は Downgrading）。commander はプログラムの `--version` をサブコマンドの後でも先に消費するため、`execute()` で `update` の後ろの `--version` を内部の `--target-version` に読み替える。
  - **通知**: `sumi doctor` だけが確認する（`render` などは何もしない）。キャッシュは `$XDG_CACHE_HOME/sumi/update-check.json`（既定 `~/.cache/sumi`、時刻と最新版）で、1 日以内は通信しない。タイムアウト 2 秒、失敗は黙って 1 時間後に再試行する。`CI` 設定時、`SUMI_NO_UPDATE_CHECK=1`、`--no-update-check`、ソースからの実行では確認しない（ソースの実行は `sumi update` の対象外で、テストが外部へ通信しないことも保証する）。表示は 1 行 `Sumi X is available (you have Y): run \`sumi update\``。`--json` には確認した場合のみ `update` を足す（同じ JSON の版のまま、フィールドの追加のみ）。
  - **Skill の版**: `skills/sumi/SKILL.md` の frontmatter `metadata.version`（Agent Skills の仕様が任意のキーを許す `metadata` を使う）に `package.json` と同じ版を持たせ、手順 2 が `sumi doctor --skill-version <版>` を実行する。Skill が古ければ `npx skills update sumi`、CLI が古ければ `sumi update` を示す。`src/cli/skill.test.ts` が `package.json` との一致を検査し、リリース手順（CONTRIBUTING）が同時に上げる項目に加えた。エージェントには、案内を 1 文で伝え、更新を自分では実行しないよう書いた。
- **採らなかった案**:
  - 起動時に毎回確認する: 通常コマンドの出力と遅延に影響し、パイプでの利用を壊すため。
  - `rm` してから展開する、または実行中のバイナリを上書きする: 失敗時に旧版が壊れるため。
  - 新しい版を入れたあと旧版を残す: install.sh の挙動だが、`update` を繰り返すとディレクトリが増えるため削除する（ダウングレードは `--version` で戻せる）。
  - tar の展開を JS で実装する: 依存を増やさず `tar`（install.sh も必須としている）を使う。展開前に `tar -tzf` で `..`・絶対パス・想定外のトップを拒否する。
- **互換性**: 図の出力は変わらない。`doctor --json` は確認した場合・`--skill-version` を渡した場合だけフィールドが増える。`sumi update` 以外の既存コマンドの引数は変わらない。
