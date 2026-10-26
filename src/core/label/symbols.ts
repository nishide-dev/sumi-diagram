/**
 * The commands and characters of label math (#93, design doc §6.24), with
 * their TeX math class, which decides the spacing around them.
 */

/** TeX's atom classes (The TeXbook, ch. 17), without op and inner: large operators are drawn as ordinary symbols. */
export type MathClass = "ord" | "bin" | "rel" | "open" | "close" | "punct";

export interface MathSymbol {
  readonly char: string;
  readonly cls: MathClass;
  /** Drawn italic by default (math variables: Latin letters and lowercase Greek, as TeX does). */
  readonly italic?: true;
  /** A Greek letter: `\mathit` makes it italic, `\mathrm` upright. */
  readonly greek?: true;
}

const lowerGreek: Record<string, string> = {
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  epsilon: "ϵ",
  varepsilon: "ε",
  zeta: "ζ",
  eta: "η",
  theta: "θ",
  vartheta: "ϑ",
  iota: "ι",
  kappa: "κ",
  lambda: "λ",
  mu: "μ",
  nu: "ν",
  xi: "ξ",
  pi: "π",
  varpi: "ϖ",
  rho: "ρ",
  varrho: "ϱ",
  sigma: "σ",
  varsigma: "ς",
  tau: "τ",
  upsilon: "υ",
  phi: "ϕ",
  varphi: "φ",
  chi: "χ",
  psi: "ψ",
  omega: "ω",
};

const upperGreek: Record<string, string> = {
  Gamma: "Γ",
  Delta: "Δ",
  Theta: "Θ",
  Lambda: "Λ",
  Xi: "Ξ",
  Pi: "Π",
  Sigma: "Σ",
  Upsilon: "Υ",
  Phi: "Φ",
  Psi: "Ψ",
  Omega: "Ω",
};

const binary: Record<string, string> = {
  times: "×",
  cdot: "⋅",
  pm: "±",
  mp: "∓",
  div: "÷",
  oplus: "⊕",
  ominus: "⊖",
  otimes: "⊗",
  odot: "⊙",
  circ: "∘",
  ast: "∗",
  star: "⋆",
  bullet: "∙",
  cup: "∪",
  cap: "∩",
  setminus: "∖",
  wedge: "∧",
  land: "∧",
  vee: "∨",
  lor: "∨",
};

const relation: Record<string, string> = {
  sim: "∼",
  simeq: "≃",
  approx: "≈",
  cong: "≅",
  equiv: "≡",
  neq: "≠",
  ne: "≠",
  leq: "≤",
  le: "≤",
  geq: "≥",
  ge: "≥",
  ll: "≪",
  gg: "≫",
  propto: "∝",
  in: "∈",
  notin: "∉",
  ni: "∋",
  subset: "⊂",
  subseteq: "⊆",
  supset: "⊃",
  supseteq: "⊇",
  to: "→",
  rightarrow: "→",
  leftarrow: "←",
  gets: "←",
  leftrightarrow: "↔",
  Rightarrow: "⇒",
  Leftarrow: "⇐",
  Leftrightarrow: "⇔",
  mapsto: "↦",
  perp: "⊥",
  mid: "∣",
  parallel: "∥",
};

const ordinary: Record<string, string> = {
  infty: "∞",
  partial: "∂",
  nabla: "∇",
  forall: "∀",
  exists: "∃",
  emptyset: "∅",
  varnothing: "∅",
  neg: "¬",
  lnot: "¬",
  prime: "′",
  ell: "ℓ",
  hbar: "ℏ",
  dots: "…",
  ldots: "…",
  cdots: "⋯",
  vdots: "⋮",
  ddots: "⋱",
  angle: "∠",
  top: "⊤",
  bot: "⊥",
  sum: "∑",
  prod: "∏",
  coprod: "∐",
  int: "∫",
  oint: "∮",
  bigcup: "⋃",
  bigcap: "⋂",
  vert: "|",
  Vert: "‖",
  "|": "‖",
  $: "$",
  "%": "%",
  "&": "&",
  "#": "#",
  _: "_",
};

const opening: Record<string, string> = {
  langle: "⟨",
  lceil: "⌈",
  lfloor: "⌊",
  lbrace: "{",
  "{": "{",
};

const closing: Record<string, string> = {
  rangle: "⟩",
  rceil: "⌉",
  rfloor: "⌋",
  rbrace: "}",
  "}": "}",
};

function table(entries: Record<string, string>, symbol: Omit<MathSymbol, "char">) {
  return Object.entries(entries).map(([name, char]) => [name, { char, ...symbol }] as const);
}

/** Symbol commands by name (without the backslash). */
export const SYMBOL_COMMANDS: ReadonlyMap<string, MathSymbol> = new Map([
  ...table(lowerGreek, { cls: "ord", italic: true, greek: true }),
  ...table(upperGreek, { cls: "ord", greek: true }),
  ...table(binary, { cls: "bin" }),
  ...table(relation, { cls: "rel" }),
  ...table(ordinary, { cls: "ord" }),
  ...table(opening, { cls: "open" }),
  ...table(closing, { cls: "close" }),
]);

/** Function names drawn upright (`\log` → log), like TeX's `\operatorname`. */
export const FUNCTION_COMMANDS: ReadonlySet<string> = new Set([
  "arg",
  "cos",
  "cosh",
  "det",
  "dim",
  "exp",
  "inf",
  "ker",
  "lim",
  "ln",
  "log",
  "max",
  "min",
  "Pr",
  "sin",
  "sinh",
  "sup",
  "tan",
  "tanh",
]);

/** Explicit spaces: drawn as these (non-collapsing) space characters. */
export const SPACE_COMMANDS: ReadonlyMap<string, string> = new Map([
  [",", " "], // thin space (TeX 3mu)
  [":", " "], // four-per-em space (medium, TeX 4mu)
  [">", " "],
  [";", " "], // three-per-em space (thick, TeX 5mu)
  [" ", " "], // no-break space (TeX's control space)
  ["quad", " "], // em space
  ["qquad", "  "],
]);

/** The automatic spaces around binary operators (medium) and relations (thick). */
export const MEDIUM_SPACE = " ";
export const THICK_SPACE = " ";

/** ASCII characters with a meaning in math: their class and the character drawn. */
export const ASCII_SYMBOLS: ReadonlyMap<string, MathSymbol> = new Map<string, MathSymbol>([
  ["+", { char: "+", cls: "bin" }],
  ["-", { char: "−", cls: "bin" }], // U+2212 MINUS SIGN, as TeX draws it
  ["*", { char: "∗", cls: "bin" }],
  ["=", { char: "=", cls: "rel" }],
  ["<", { char: "<", cls: "rel" }],
  [">", { char: ">", cls: "rel" }],
  [":", { char: ":", cls: "rel" }],
  [",", { char: ",", cls: "punct" }],
  [";", { char: ";", cls: "punct" }],
  ["(", { char: "(", cls: "open" }],
  ["[", { char: "[", cls: "open" }],
  [")", { char: ")", cls: "close" }],
  ["]", { char: "]", cls: "close" }],
  [".", { char: ".", cls: "ord" }],
  ["/", { char: "/", cls: "ord" }],
  ["|", { char: "|", cls: "ord" }],
  ["!", { char: "!", cls: "close" }],
  ["?", { char: "?", cls: "close" }],
  ["'", { char: "′", cls: "ord" }], // a prime, as in x'
]);

/**
 * Non-ASCII characters typed directly in math: every character a command
 * stands for, with the command's class (so `$γ_1$` = `$\gamma_1$`).
 */
export const UNICODE_SYMBOLS: ReadonlyMap<string, MathSymbol> = new Map(
  [...SYMBOL_COMMANDS.values(), ...ASCII_SYMBOLS.values()]
    .filter((symbol) => symbol.char.codePointAt(0) !== undefined && symbol.char > "\u007f")
    .map((symbol) => [symbol.char, symbol]),
);
