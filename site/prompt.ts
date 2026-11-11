/** The prompt composer's choices and deterministic instruction generation. */
export const PURPOSES = [
  { id: "explain", en: "Draw from sources or notes", ja: "資料やメモから描く" },
  { id: "reproduce", en: "Recreate an existing figure", ja: "既存の図を作り直す" },
  { id: "improve", en: "Improve a .sumi.yaml", ja: "既存の .sumi.yaml を直す" },
  { id: "custom", en: "Describe it…", ja: "自由に書く…" },
] as const;

export const KINDS = [
  {
    id: "system",
    en: "System architecture",
    ja: "システム構成図",
    enD: "services, clients and data stores, and how they connect",
    jaD: "サービス・クライアント・データストアと、そのつながり",
  },
  {
    id: "pipeline",
    en: "Process or pipeline",
    ja: "処理・パイプライン",
    enD: "the steps from input to output",
    jaD: "入力から出力までの手順",
  },
  {
    id: "flow",
    en: "Flowchart",
    ja: "フローチャート",
    enD: "decisions, branches and loops",
    jaD: "判断の分岐とループ",
  },
  {
    id: "concept",
    en: "Concept map",
    ja: "概念図",
    enD: "concepts and how they relate",
    jaD: "概念とその関係",
  },
  {
    id: "overview",
    en: "Overview in panels",
    ja: "パネル構成の概要図",
    enD: "the whole picture as panels, one per stage or aspect",
    jaD: "段階や観点ごとのパネルを並べた全体像",
  },
  {
    id: "arch",
    en: "Model architecture",
    ja: "モデル構成図",
    enD: "layers and blocks, and how data flows through them",
    jaD: "層やブロックの構成と、データの流れ",
  },
  { id: "custom", en: "Describe it…", ja: "自由に書く…", enD: "", jaD: "" },
] as const;

export const PLACES = [
  {
    id: "readme",
    en: "Docs or README",
    ja: "ドキュメント・README",
    w: 180,
    sub: "180mm",
    profile: "paper-double",
    enP: "a README or documentation page",
    jaP: "README やドキュメント",
  },
  {
    id: "presentation-16x9",
    en: "Slide",
    ja: "スライド",
    w: 338.7,
    sub: "16:9",
    profile: "presentation-16x9",
    enP: "a 16:9 slide",
    jaP: "16:9 のスライド",
  },
  {
    id: "paper-single",
    en: "Paper, one column",
    ja: "論文 1 段",
    w: 88,
    sub: "88mm",
    profile: "paper-single",
    enP: "one column of a two-column paper",
    jaP: "2 段組論文の 1 段",
  },
  {
    id: "paper-double",
    en: "Paper, full width",
    ja: "論文 全幅",
    w: 180,
    sub: "180mm",
    profile: "paper-double",
    enP: "the full width of a two-column paper",
    jaP: "2 段組論文の全幅",
  },
] as const;
export const LAYOUTS = [
  { id: "auto", en: "Your choice", ja: "おまかせ", svg: "" },
  {
    id: "lr",
    en: "Left to right",
    ja: "左 → 右",
    svg: '<rect x="1" y="3" width="5" height="6"/><rect x="16" y="3" width="5" height="6"/><path d="M7 6h8"/>',
  },
  {
    id: "tb",
    en: "Top to bottom",
    ja: "上 → 下",
    svg: '<rect x="6" y="1" width="10" height="3"/><rect x="6" y="8" width="10" height="3"/>',
  },
  {
    id: "panels",
    en: "Panels side by side",
    ja: "パネル横並び",
    svg: '<rect x="1" y="1" width="5.5" height="10"/><rect x="8.25" y="1" width="5.5" height="10"/><rect x="15.5" y="1" width="5.5" height="10"/>',
  },
  {
    id: "grid",
    en: "Grid",
    ja: "グリッド",
    svg: '<rect x="4" y="1" width="6" height="4"/><rect x="12" y="1" width="6" height="4"/><rect x="4" y="7" width="6" height="4"/><rect x="12" y="7" width="6" height="4"/>',
  },
] as const;
export const TONES = [
  "blue",
  "green",
  "yellow",
  "orange",
  "red",
  "purple",
  "pink",
  "gray",
] as const;
export const AGENTS = [
  { id: "claude", en: "Claude Code (Sumi Skill)", ja: "Claude Code（Sumi Skill）" },
  { id: "other", en: "Another agent", ja: "その他のエージェント" },
] as const;

export interface PromptState {
  ui: "en" | "ja";
  theme: string;
  palette: string;
  purpose: (typeof PURPOSES)[number]["id"];
  refs: string;
  target: string;
  figid: string;
  content: string;
  kind: (typeof KINDS)[number]["id"];
  place: (typeof PLACES)[number]["id"];
  maxh: string;
  purposeText: string;
  kindText: string;
  labellang: "en" | "ja";
  layout: (typeof LAYOUTS)[number]["id"];
  layoutnote: string;
  tones: [string, string][];
  agent: (typeof AGENTS)[number]["id"];
  extra: string;
}

export const DEFAULT_STATE: PromptState = {
  ui: "en",
  theme: "paper",
  palette: "",
  purpose: "explain",
  refs: "",
  target: "",
  figid: "",
  content: "",
  kind: "system",
  place: "readme",
  maxh: "",
  purposeText: "",
  kindText: "",
  labellang: "en",
  layout: "auto",
  layoutnote: "",
  tones: [],
  agent: "claude",
  extra: "",
};

const lines = (s: string) =>
  s
    .split(/\n+/)
    .map((x) => x.trim())
    .filter(Boolean);

export function buildPrompt(s: PromptState): string {
  const J = s.ui === "ja";
  const kind = KINDS.find((k) => k.id === s.kind) ?? KINDS[0];
  const place = PLACES.find((p) => p.id === s.place) ?? PLACES[0];
  const refs = lines(s.refs);
  const id = s.figid.trim() || "figure";
  const theme = s.place === "presentation-16x9" && s.theme !== "slides" ? "slides" : s.theme;
  const out: string[] = [];
  const H = (x: string) => out.push("", `## ${x}`);
  if (s.agent === "claude")
    out.push(
      J
        ? "Sumi Skill（/sumi）を使って、次の図を *.sumi.yaml で作り、SVG にレンダリングしてください。"
        : "Use the Sumi Skill (/sumi) to build the following figure as a *.sumi.yaml file and render it to SVG.",
    );
  else
    out.push(
      J
        ? "Sumi CLI（https://github.com/nishide-dev/sumi-diagram）で次の図を作ってください。最初に skills/sumi/SKILL.md を読み、その手順（catalog → YAML → fmt → lint → render）に従ってください。"
        : "Build the following figure with the Sumi CLI (https://github.com/nishide-dev/sumi-diagram). Read skills/sumi/SKILL.md first and follow its workflow (catalog → YAML → fmt → lint → render).",
    );
  H(J ? "目的" : "Goal");
  if (s.purpose === "reproduce")
    out.push(
      J
        ? `${s.target ? `${s.target} の図` : "既存の図"}を、構成・ラベル・色の対応を保って作り直す。`
        : `Recreate ${s.target || "the existing figure"}, keeping its structure, labels and colour coding.`,
    );
  else if (s.purpose === "improve")
    out.push(
      J
        ? `既存の ${id}.sumi.yaml を、内容を変えずに見やすく直す。`
        : `Improve the existing ${id}.sumi.yaml for readability without changing its content.`,
    );
  else if (s.purpose === "custom")
    out.push(s.purposeText.trim() || (J ? "（目的を書いてください）" : "(describe the goal)"));
  else if (s.kind === "custom")
    out.push(
      J
        ? `${s.target ? `${s.target} の内容を表す` : ""}図を作る。`
        : `Make a figure${s.target ? ` of ${s.target}` : ""}.`,
    );
  else
    out.push(
      J
        ? `${s.target ? `${s.target} の内容を表す` : ""}${kind.ja}を作る。`
        : `Make a ${kind.en.toLowerCase()}${s.target ? ` of ${s.target}` : ""}.`,
    );
  if (refs.length || s.content.trim()) {
    H(J ? "内容" : "Content");
    for (const r of refs) out.push(`- ${J ? "参考資料" : "Source"}: ${r}`);
    if (s.content.trim()) out.push(`- ${J ? "メモ" : "Notes"}: ${s.content.trim()}`);
    out.push(
      J
        ? "ラベル・接続・数値は参考資料とメモから取り、書かれていないものは作らないでください。曖昧な点は描く前に質問してください。"
        : "Take labels, connections and numbers from the sources and notes only; do not invent anything. Ask before drawing if something is ambiguous.",
    );
  }
  H(J ? "図の種類" : "Figure type");
  if (s.kind === "custom")
    out.push(
      s.kindText.trim() || (J ? "（図の種類を書いてください）" : "(describe the kind of figure)"),
    );
  else out.push(J ? `${kind.ja}: ${kind.jaD}。` : `${kind.en}: ${kind.enD}.`);
  H(J ? "配置先" : "Placement");
  out.push(
    J
      ? `${place.jaP}（profile: ${place.profile}、幅 ${place.w}mm 以内）。`
      : `${place.enP[0]?.toUpperCase()}${place.enP.slice(1)} (profile: ${place.profile}, at most ${place.w}mm wide).`,
  );
  if (String(s.maxh).trim())
    out.push(
      J
        ? `高さは ${s.maxh}mm 以内（figure.target.height に設定）。`
        : `Keep it within ${s.maxh}mm tall (set figure.target.height).`,
    );
  out.push(
    J
      ? `図中のラベルは${s.labellang === "ja" ? "日本語" : "英語"}。`
      : `Write the labels in ${s.labellang === "ja" ? "Japanese" : "English"}.`,
  );
  H(J ? "レイアウト" : "Layout");
  const LT = {
    auto: [
      "レイアウトは任せます。流れやつながりの図なら auto、整列したブロック図なら structured を選んでください。",
      "Choose the layout: auto for flows and connected graphs, structured for aligned block diagrams.",
    ],
    lr: ["左から右へ流れる配置。", "Flow from left to right."],
    tb: ["上から下へ流れる配置。", "Flow from top to bottom."],
    panels: [
      "structured レイアウトで、パネルを横に並べる（arrange: row）。パネルの高さは揃える。",
      "Use the structured layout with panels side by side (arrange: row), equal in height.",
    ],
    grid: [
      "structured レイアウトのグリッド（arrange: grid）。",
      "Use a structured grid (arrange: grid).",
    ],
  }[s.layout];
  out.push(LT[J ? 0 : 1] ?? "");
  if (s.layoutnote.trim()) out.push(`${J ? "補足" : "Also"}: ${s.layoutnote.trim()}`);
  H(J ? "見た目" : "Style");
  out.push(
    J
      ? `テーマ: ${theme}${theme !== s.theme ? `（スライドなので ${s.theme} から変更）` : ""}`
      : `Theme: ${theme}${theme !== s.theme ? ` (switched from ${s.theme} for a slide)` : ""}`,
  );
  if (s.palette)
    out.push(
      J
        ? `パレット: ${s.palette}（figure.themeOverrides.palette）`
        : `Palette: ${s.palette} (figure.themeOverrides.palette)`,
    );
  const tones = s.tones.filter((x) => x[0].trim());
  if (tones.length) {
    out.push(J ? "色の意味（tone）:" : "Colour meaning (tone):");
    for (const [m, x] of tones) out.push(`- ${m.trim()} → ${x}`);
  }
  out.push(
    s.purpose === "reproduce"
      ? J
        ? "色は元の図から取り、themeOverrides と tone に書いて固定してください。"
        : "Take the colours from the original and pin them in themeOverrides and node tones."
      : J
        ? "色は意味のある区別にだけ使う（2〜3 色＋アクセント 1 色まで）。"
        : "Use colour only for meaning (at most 2–3 hues plus one accent).",
  );
  if (s.extra.trim()) {
    H(J ? "その他" : "Other");
    out.push(s.extra.trim());
  }
  H(J ? "仕上げ" : "Finish");
  out.push(
    J
      ? "- fmt → lint → render を通し、残った警告は直すか理由を報告する"
      : "- Run fmt → lint → render; fix the remaining warnings or explain why they stay",
  );
  out.push(
    J
      ? "- レンダリングした SVG を見て、ラベルの重なりや曲がった矢印がないか確認する"
      : "- Look at the rendered SVG for overlapping labels and bent arrows",
  );
  if (s.purpose === "reproduce")
    out.push(
      J
        ? "- 元の図と並べて比べ、違いを一覧にする"
        : "- Compare it side by side with the original and list the differences",
    );
  out.push(J ? `- 出力: ${id}.sumi.yaml と ${id}.svg` : `- Output: ${id}.sumi.yaml and ${id}.svg`);
  return out.join("\n");
}
