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
    enN: "system architecture diagram",
    enD: "services, clients and data stores, and how they connect",
    jaD: "サービス・クライアント・データストアと、そのつながり",
  },
  {
    id: "pipeline",
    en: "Process or pipeline",
    ja: "処理・パイプライン",
    enN: "pipeline diagram",
    enD: "the steps from input to output",
    jaD: "入力から出力までの手順",
  },
  {
    id: "flow",
    en: "Flowchart",
    ja: "フローチャート",
    enN: "flowchart",
    enD: "decisions and their branches, and loops where the process has them",
    jaD: "判断とその分岐（処理にあればループも）",
  },
  {
    id: "concept",
    en: "Concept map",
    ja: "概念図",
    enN: "concept map",
    enD: "concepts and how they relate",
    jaD: "概念とその関係",
  },
  {
    id: "overview",
    en: "Overview in panels",
    ja: "パネル構成の概要図",
    enN: "overview figure in panels",
    enD: "the whole picture as panels, one per stage or aspect",
    jaD: "段階や観点ごとのパネルを並べた全体像",
  },
  {
    id: "arch",
    en: "Model architecture",
    ja: "モデル構成図",
    enN: "model architecture diagram",
    enD: "layers and blocks, and how data flows through them",
    jaD: "層やブロックの構成と、データの流れ",
  },
  { id: "custom", en: "Describe it…", ja: "自由に書く…", enN: "", enD: "", jaD: "" },
] as const;

export const PLACES = [
  {
    id: "readme",
    en: "Docs or README",
    ja: "ドキュメント・README",
    w: 200,
    h: 150,
    sub: "200mm",
    profile: "screen-doc",
    enP: "a README or documentation page",
    jaP: "README やドキュメント",
  },
  {
    id: "presentation-16x9",
    en: "Slide",
    ja: "スライド",
    w: 338.7,
    h: 190.5,
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
    h: 220,
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
    h: 220,
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

/** Themes whose tones are gray steps rather than hues (figure-format.md, Tones and variants). */
const GRAY_THEMES = ["minimal", "academic", "slides"];

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
  const target = s.target.trim();
  const out: string[] = [];
  const H = (x: string) => out.push("", `## ${x}`);
  if (s.agent === "claude")
    out.push(
      J
        ? "Sumi Skill（/sumi）を使って、次の図を *.sumi.yaml で作り、SVG にレンダリングしてください。手順は Skill に従い、このプロンプトは図の要件だけを書いています。"
        : "Use the Sumi Skill (/sumi) to build the following figure as a *.sumi.yaml file and render it to SVG. Follow the Skill's workflow; this prompt gives only the figure's requirements.",
    );
  else
    out.push(
      J
        ? "Sumi CLI（https://github.com/nishide-dev/sumi-diagram）で次の図を作ってください。最初に skills/sumi/SKILL.md を読み、その手順（catalog → YAML → fmt → lint → render → プレビュー）に従ってください。"
        : "Build the following figure with the Sumi CLI (https://github.com/nishide-dev/sumi-diagram). Read skills/sumi/SKILL.md first and follow its workflow (catalog → YAML → fmt → lint → render → preview).",
    );
  H(J ? "目的" : "Goal");
  if (s.purpose === "reproduce")
    out.push(
      J
        ? `${target ? `${target} の図` : "既存の図"}を、構成・ラベル・色の対応を保って作り直す。`
        : `Recreate ${target || "the existing figure"}, keeping its structure, labels and colour coding.`,
    );
  else if (s.purpose === "improve")
    out.push(
      J
        ? `既存の ${id}.sumi.yaml を、内容を変えずに見やすく直す。`
        : `Improve the existing ${id}.sumi.yaml for readability without changing its content.`,
    );
  else if (s.purpose === "custom")
    out.push(s.purposeText.trim() || (J ? "（目的を書いてください）" : "(describe the goal)"));
  else {
    const noun = s.kind === "custom" ? "figure" : kind.enN;
    out.push(
      J
        ? `${target ? `${target}を表す` : ""}${s.kind === "custom" ? "図" : kind.ja}を作る。`
        : `Make ${/^[aeiou]/.test(noun) ? "an" : "a"} ${noun}${target ? ` of ${target}` : ""}.`,
    );
  }
  if (refs.length || s.content.trim()) {
    H(J ? "内容" : "Content");
    for (const r of refs) out.push(`- ${J ? "参考資料" : "Source"}: ${r}`);
    if (s.content.trim()) out.push(`- ${J ? "メモ" : "Notes"}: ${s.content.trim()}`);
    const notes = Boolean(s.content.trim());
    // Name only the inputs that were given, so no rule asks for evidence from an absent one.
    const from = J
      ? [refs.length && "参考資料", notes && "メモ"].filter(Boolean).join("と")
      : `the ${[refs.length && "sources", notes && "notes"].filter(Boolean).join(" and ")}`;
    out.push(
      J
        ? `要素・接続・数値などの事実は${from}だけから取り、書かれていないものは足さないでください。配置・グループ分け・ラベルの短縮などの見せ方は任せます。矢印は接続なので、段階どうしを結ぶのは${from}が順につながる手順として書いているときだけにし、それ以外で結んだときは仮定として報告してください。曖昧な点は描く前に一度だけ質問し、答えが得られないときは最も素直な解釈で進めて、その仮定を報告してください。`
        : `Take the facts (elements, connections, labels and numbers) from ${from} only; add none that are not there. Presentation is yours: layout, grouping and shortened labels. An arrow is a connection: join stages only where ${from} give them as consecutive steps, and list any other arrow you draw as an assumption. If something is ambiguous, ask once before drawing; if no one can answer, take the simplest reading and list the assumptions in your report.`,
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
      ? `${place.jaP}（profile: ${place.profile}、幅 ${place.w}mm・高さ ${place.h}mm 以内）。`
      : `${place.enP[0]?.toUpperCase()}${place.enP.slice(1)} (profile: ${place.profile}, at most ${place.w}mm wide and ${place.h}mm tall).`,
  );
  const maxh = Number(String(s.maxh).trim());
  // A budget above the profile's own limit adds nothing: the profile's height applies.
  if (maxh > 0 && maxh < place.h)
    out.push(
      J
        ? `高さは ${maxh}mm 以内（figure.target.height に設定）。`
        : `Keep it within ${maxh}mm tall (set figure.target.height).`,
    );
  const wide = place.profile === "screen-doc" || place.profile === "presentation-16x9";
  if (wide) {
    if (s.theme !== "slides")
      out.push(
        J
          ? `文字の大きさ: figure.themeOverrides.textScale を、sumi catalog --json にあるテーマの textScaleFor.${place.profile} の値にする（小さく描いて拡大しない）。`
          : `Text size: set figure.themeOverrides.textScale to the theme's textScaleFor.${place.profile} from sumi catalog --json (do not draw small and enlarge).`,
      );
    out.push(
      J
        ? "細長い縦の図より、幅を使った横長の形にする。"
        : "Prefer a landscape shape that uses the width over a tall, narrow one.",
    );
  } else if (!(maxh > 0 && maxh < place.h))
    out.push(
      J
        ? "高さは内容に必要な分だけにする。縦に長くなる一続きの流れは、段や列に折り返す。"
        : "Keep it no taller than the content needs; fold a long chain that grows tall into rows or columns.",
    );
  out.push(
    J
      ? `図中のラベルは${s.labellang === "ja" ? "日本語" : "英語"}。`
      : `Write the labels in ${s.labellang === "ja" ? "Japanese" : "English"}.`,
  );
  H(J ? "レイアウト" : "Layout");
  const LT = {
    auto: [
      "レイアウトは Skill の手順で決める。layouts の索引から最も近いベースレイアウトを選んで名前を報告し（合うものがなければそう書き、最も近い作例を挙げる）、流れやつながりの図なら auto、整列したブロックやパネルなら structured にする。auto がページに収まらなければ structured で段に折り返す。",
      "Choose the layout as the Skill says: start from the closest base layout in its layouts index and name it (if none fits, say so and name the closest example); auto for flows and connected graphs, structured for aligned blocks and panels. If auto does not fit the page, fold the flow into rows with structured.",
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
  out.push(J ? `テーマ: ${s.theme}` : `Theme: ${s.theme}`);
  if (s.palette)
    out.push(
      J
        ? `パレット: ${s.palette}（figure.themeOverrides.palette）`
        : `Palette: ${s.palette} (figure.themeOverrides.palette)`,
    );
  const tones = s.tones.filter((x) => x[0].trim());
  if (tones.length) {
    out.push(
      J
        ? "色の意味（tone。その種類のノードとグループすべてに付ける）:"
        : "Colour meaning (tone; give it to every node and group of that kind):",
    );
    for (const [m, x] of tones) out.push(`- ${m.trim()} → ${x}`);
    if (GRAY_THEMES.includes(s.theme) && !s.palette)
      out.push(
        J
          ? `${s.theme} は tone を灰色の濃淡で描くので、色は明るさでしか区別されない。`
          : `${s.theme} draws tones as shades of gray, so they differ only in lightness.`,
      );
  }
  out.push(
    s.purpose === "reproduce"
      ? J
        ? "色は元の図から取り、themeOverrides と tone に書いて固定してください。"
        : "Take the colours from the original and pin them in themeOverrides and node tones."
      : tones.length
        ? J
          ? "これ以外はテーマの既定の色のままにする。"
          : "Leave everything else in the theme's default colours."
        : J
          ? "色は意味のある区別にだけ使う（2〜3 色＋アクセント 1 色まで。テーマの既定色だけで足りるなら色を足さない）。"
          : "Use colour only for meaning (at most 2–3 hues plus one accent; none if the theme's defaults suffice).",
  );
  if (s.extra.trim()) {
    H(J ? "その他" : "Other");
    out.push(s.extra.trim());
  }
  H(J ? "仕上げ" : "Finish");
  out.push(
    J
      ? "- fmt → lint → render を通し、エラーはすべて直す。警告は直すか、残す理由を報告する"
      : "- Run fmt → lint → render; resolve every error, and fix the warnings or explain why they stay",
  );
  out.push(
    J
      ? "- Skill の scripts/preview で PNG にして見る。内容の要素・ラベル・矢印の向きがそろっているか、ラベルが線や他のラベルに重なっていないか、大きく遠回りする線がないかを確かめる"
      : "- Preview it as a PNG with the Skill's scripts/preview: check that every element, label and arrow of the content is there and points the right way, that no label overlaps a line or another label, and that no edge takes a long detour",
  );
  if (s.purpose === "reproduce")
    out.push(
      J
        ? "- 元の図と並べて比べ、違いを一覧にする"
        : "- Compare it side by side with the original and list the differences",
    );
  out.push(
    J
      ? `- 出力: 作業ディレクトリに ${id}.sumi.yaml と ${id}.svg。使ったベースレイアウト、大きさ、残った診断、置いた仮定を報告する`
      : `- Output: ${id}.sumi.yaml and ${id}.svg in the working directory; report the base layout used, the size, the remaining diagnostics and any assumptions`,
  );
  return out.join("\n");
}
