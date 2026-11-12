import { descriptionHtml } from "./description";
import { PH, T } from "./i18n";
import {
  AGENTS,
  buildPrompt,
  KINDS,
  LAYOUTS,
  PLACES,
  type PromptState,
  PURPOSES,
  TONES,
} from "./prompt";
import { sampleSource } from "./source";
import { loadData, type SiteData } from "./types";

const ICON = {
  system:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
  light:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>',
  dark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="14" height="14" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>',
  check:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
};
const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element: ${id}`);
  return el;
};
const esc = (s: unknown) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c,
  );
const lines = (s: string) =>
  s
    .split(/\n+/)
    .map((x) => x.trim())
    .filter(Boolean);
const store = {
  get(k: string, d: string) {
    try {
      return localStorage.getItem(k) ?? d;
    } catch (e) {
      return d;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch (e) {}
  },
};

/* ---------- UI strings ---------- */
/* ---------- state ---------- */
const state: PromptState = {
  ui: store.get("sumi-ui-lang", "en") === "ja" ? "ja" : "en",
  theme: store.get("sumi-figure-theme", "paper"),
  palette: store.get("sumi-figure-palette", ""),
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
const t = <K extends keyof typeof T.en>(k: K): (typeof T.en)[K] => T[state.ui][k];
let DATA: SiteData;

async function copyText(text: string, el: HTMLElement, labelKey: "copy") {
  try {
    await navigator.clipboard.writeText(text);
    el.innerHTML = `${ICON.check}${t("copied")}`;
  } catch (e) {
    const input = document.createElement("textarea");
    input.value = text;
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.append(input);
    input.select();
    try {
      if (!document.execCommand("copy")) throw new Error();
      el.innerHTML = `${ICON.check}${t("copied")}`;
    } catch {
      el.textContent = t("copyFail");
    } finally {
      input.remove();
    }
  }
  setTimeout(() => {
    el.innerHTML = `${ICON.copy}${t(labelKey)}`;
  }, 1600);
}

/* ---------- site light/dark ---------- */
const ORDER = ["system", "light", "dark"] as const;
type SitePref = (typeof ORDER)[number];
const savedPref = store.get("sumi-site-theme", "system");
let sitePref: SitePref = ORDER.find((x) => x === savedPref) ?? "system";
function applySiteTheme() {
  if (sitePref === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", sitePref);
  const names = t("siteTheme"),
    next = ORDER[(ORDER.indexOf(sitePref) + 1) % 3] ?? "system";
  const b = $("site-theme");
  b.innerHTML = ICON[sitePref];
  b.title = names[sitePref];
  b.setAttribute("aria-label", t("themeLabel")(names[sitePref], names[next]));
}
$("site-theme").onclick = () => {
  sitePref = ORDER[(ORDER.indexOf(sitePref) + 1) % 3] ?? "system";
  store.set("sumi-site-theme", sitePref);
  applySiteTheme();
};

/* ---------- figure theme + palette (bundles) ---------- */
function renderFigbar() {
  if (!$("sumi-theme").children.length) {
    $("sumi-theme").innerHTML = DATA.themes
      .map(
        (x) =>
          `<button type="button" data-t="${x}" aria-pressed="${state.theme === x}">${x}</button>`,
      )
      .join("");
    $("sumi-palette").innerHTML = [{ id: "", colors: [] }, ...DATA.palettes]
      .map(
        (p) =>
          `<button type="button" data-p="${p.id}" aria-pressed="${state.palette === p.id}">${p.colors.length ? `<span class="sw" aria-hidden="true">${p.colors.map((c) => `<i style="background:${c}"></i>`).join("")}</span>` : ""}${p.id || t("none")}</button>`,
      )
      .join("");
  }
  for (const b of $("sumi-theme").querySelectorAll<HTMLElement>("button"))
    b.setAttribute("aria-pressed", String(b.dataset.t === state.theme));
  for (const b of $("sumi-palette").querySelectorAll<HTMLElement>("button")) {
    b.setAttribute("aria-pressed", String(b.dataset.p === state.palette));
    if (b.dataset.p === "") b.textContent = t("none");
  }
  $("sumi-theme").setAttribute("aria-label", t("theme"));
  $("sumi-palette").setAttribute("aria-label", t("palette"));
}
$("sumi-theme").addEventListener("click", (e) => {
  const b = e.target instanceof Element ? e.target.closest("button") : null;
  if (!b || b.dataset.t === undefined) return;
  state.theme = b.dataset.t;
  store.set("sumi-figure-theme", state.theme);
  figureChanged();
});
$("sumi-palette").addEventListener("click", (e) => {
  const b = e.target instanceof Element ? e.target.closest("button") : null;
  if (!b || b.dataset.p === undefined) return;
  state.palette = b.dataset.p;
  store.set("sumi-figure-palette", state.palette);
  figureChanged();
});
async function figureChanged() {
  renderFigbar();
  renderComposer();
  for (const el of document.querySelectorAll<HTMLElement>(".item pre")) {
    const key = el.closest<HTMLElement>(".item")?.dataset.key;
    if (key) el.innerHTML = highlightYaml(yamlOfKey(key));
  }
  for (const el of document.querySelectorAll<HTMLElement>(".item")) {
    const img = el.querySelector("img");
    const item = el.dataset.key ? ITEMS.get(el.dataset.key) : undefined;
    if (!img || !item) continue;
    img.src = `./figures/${state.theme}/${state.palette || "base"}/${item.slug}.svg`;
    img.alt = `${el.dataset.title} (${state.theme}${state.palette ? `, ${state.palette}` : ""})`;
  }
}

/* ---------- YAML ---------- */
function highlightYaml(y: string, marks = true) {
  return y
    .replace(/\n$/, "")
    .split("\n")
    .map((l) => {
      if (/^\s*#/.test(l)) return `<span class="c">${esc(l)}</span>`;
      const m = l.match(/^(\s*-?\s*)([A-Za-z][\w-]*)(:)(.*)$/);
      let out = m
        ? `${esc(m[1])}<span class="k">${esc(m[2])}</span>${esc(m[3])}${esc(m[4])}`
        : esc(l);
      if (marks && /^ {2}(theme|profile): |^ {4}palette: |^ {2}themeOverrides:$/.test(l))
        out = `<span class="hl">${out}</span>`;
      return out;
    })
    .join("\n");
}
function viewer(key: string, title: string, extraClass = "") {
  return `
    <div class="view" data-view-of="${key}">
      <div class="view-bar">
        <div class="tg" role="group" aria-label="${esc(title)}">
          <button type="button" data-view="preview" aria-pressed="true">${t("preview")}</button>
          <button type="button" data-view="code" aria-pressed="false">${t("code")}</button>
        </div>
        <button type="button" class="copy-sm" data-copy="${key}">${ICON.copy}${t("copy")}</button>
      </div>
      <div class="stage ${extraClass}"><img alt="${esc(title)}" loading="lazy"></div>
      <pre hidden></pre>
    </div>`;
}
document.addEventListener("click", (e) => {
  const target = e.target instanceof Element ? e.target : null;
  const v = target?.closest<HTMLElement>("[data-view]");
  if (v) {
    const box = v.closest(".view");
    const code = v.dataset.view === "code";
    const stage = box?.querySelector<HTMLElement>(".stage");
    const pre = box?.querySelector("pre");
    if (!box || !stage || !pre) return;
    stage.hidden = code;
    pre.hidden = !code;
    for (const b of box.querySelectorAll("[data-view]"))
      b.setAttribute("aria-pressed", String(b === v));
    return;
  }
  const c = target?.closest<HTMLElement>("[data-copy]");
  if (c?.dataset.copy) copyText(yamlOfKey(c.dataset.copy), c, "copy");
});

/* ---------- home (README) ---------- */
function renderHome() {
  if (!DATA) return;
  $("page-home").innerHTML = DATA.home[state.ui];
  for (const pre of $("page-home").querySelectorAll("pre")) {
    const wrap = document.createElement("div");
    wrap.className = "readme-code";
    pre.before(wrap);
    wrap.append(pre);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "copy-sm";
    button.innerHTML = `${ICON.copy}${t("copy")}`;
    button.onclick = () => copyText(pre.textContent ?? "", button, "copy");
    wrap.append(button);
  }
}

/* ---------- examples ---------- */
function renderExamples() {
  const fig = (x: SiteData["examples"][number]) => `
    <li class="fig">
      <div class="cap">
        <h3>${esc(x.title)}</h3>
        ${x.paperUrl ? `<a class="ext" href="${x.paperUrl}" target="_blank" rel="noreferrer">${t("original")}</a>` : ""}
      </div>
      ${viewer(`e-${x.slug}`, x.title, "fixed")}
    </li>`;
  const repro = DATA.examples.filter((x) => x.paperUrl),
    generic = DATA.examples.filter((x) => !x.paperUrl);
  $("example-list").innerHTML = `
    <div class="ex-group" style="margin-top:36px"><h3 class="label">${t("reproductions")} · ${repro.length}</h3><ul class="figs">${repro.map(fig).join("")}</ul></div>
    <div class="ex-group"><h3 class="label">${t("generic")} · ${generic.length}</h3><ul class="figs">${generic.map(fig).join("")}</ul></div>`;
  for (const x of DATA.examples) {
    const box = document.querySelector(`[data-view-of="e-${x.slug}"]`);
    const img = box?.querySelector("img");
    const pre = box?.querySelector("pre");
    if (!img || !pre) continue;
    img.src = `./examples/${x.slug}.svg`;
    pre.innerHTML = highlightYaml(x.source, false);
  }
}

/* ---------- components ---------- */
const GROUPS: [string, string[]][] = [
  [
    "Shapes",
    [
      "box",
      "square",
      "circle",
      "ellipse",
      "diamond",
      "hexagon",
      "parallelogram",
      "cylinder",
      "document",
      "trapezoid",
      "bowtie",
      "stack",
    ],
  ],
  ["Text & notes", ["label", "bubble", "bracket", "legend", "separator"]],
  ["Flow marks", ["block-arrow", "triangle-arrow", "chevron", "operator", "junction"]],
  ["Data", ["tokens", "matrix", "waveform", "image", "html"]],
  ["Groups", ["container"]],
  ["Edges", ["arrow", "line", "double-arrow", "zoom"]],
];
type ComponentItem = {
  key: string;
  type: "component";
  slug: string;
  c: SiteData["components"][number];
  title: string;
};
type FeatureItem = {
  key: string;
  type: "feature";
  slug: string;
  f: SiteData["options"][number];
  title: string;
};
type Item = ComponentItem | FeatureItem;
function itemList(): [string, Item[]][] {
  const comp = new Map(DATA.components.map((c) => [c.id.replace("sumi/", ""), c]));
  const C = (i: string): ComponentItem => {
    const c = comp.get(i);
    if (!c) throw new Error(`Missing component: ${i}`);
    return {
      key: `c-${c.slug}`,
      type: "component",
      slug: c.slug,
      c,
      title: c.id,
    };
  };
  const groups: [string, Item[]][] = GROUPS.map(([name, ids]) => [
    name,
    ids.filter((i) => comp.has(i)).map(C),
  ]);
  const listed = new Set(GROUPS.flatMap((g) => g[1]));
  const rest = [...comp.keys()].filter((k) => !listed.has(k));
  if (rest.length) groups.push(["Other", rest.map(C)]);
  groups.push([
    "Options",
    DATA.options.map((f) => ({
      key: `f-${f.slug}`,
      type: "feature",
      slug: f.slug,
      f,
      title: f.title,
    })),
  ]);
  return groups;
}
let ITEMS = new Map<string, Item>();
function yamlOfKey(key: string): string {
  if (key.startsWith("e-")) return DATA.examples.find((x) => `e-${x.slug}` === key)?.source ?? "";
  const it = ITEMS.get(key);
  if (!it) throw new Error(`Missing item: ${key}`);
  const src = it.type === "component" ? it.c : it.f;
  const profile = src.profiles[state.theme];
  if (!profile) throw new Error(`Missing profile for theme: ${state.theme}`);
  return sampleSource(src.source, state.theme, profile, state.palette || undefined);
}
function renderLibrary() {
  const groups = itemList();
  ITEMS = new Map(groups.flatMap(([, its]) => its).map((it) => [it.key, it]));
  $("side").innerHTML = groups
    .map(
      ([name, its]) =>
        `<div><span class="label">${t("groups")[[...GROUPS.map(([group]) => group), "Other", "Options"].indexOf(name)] ?? name}</span><ul>${its.map((it) => `<li><button type="button" data-go="${it.key}">${esc(it.type === "component" ? it.c.id.replace("sumi/", "") : it.title)}</button></li>`).join("")}</ul></div>`,
    )
    .join("");
  $("items").innerHTML = [...ITEMS.values()]
    .map((it) => {
      const desc = it.type === "component" ? it.c.description : it.f.description;
      const schema = (it.type === "component" ? it.c.props : {}) as {
        properties?: Record<
          string,
          { enum?: unknown[]; type?: string | string[]; description?: string }
        >;
        required?: string[];
      };
      const props = Object.entries(schema.properties || {}).map(([name, p]) => ({
        name,
        type: p.enum
          ? p.enum.map((v) => JSON.stringify(v)).join(" | ")
          : Array.isArray(p.type)
            ? p.type.join(" | ")
            : p.type || "any",
        required: (schema.required || []).includes(name),
        description: p.description || "",
      }));
      const specs =
        it.type === "component"
          ? `
      <div class="specs">
        <div class="row"><span class="label">${t("kind")}</span><code>${esc(it.c.kind)}</code></div>
        <div class="row"><span class="label">${t("variants")}</span><code>${esc(it.c.variants.join(" · "))}</code></div>
        ${props.length ? `<details class="more"><summary>${t("props")} ${props.length}</summary><div class="props-wrap"><table class="props"><tbody>${props.map((p) => `<tr><td>${esc(p.name)}${p.required === true ? " *" : ""}</td><td>${esc(p.type)}</td><td>${esc(p.description)}</td></tr>`).join("")}</tbody></table></div></details>` : ""}
      </div>`
          : "";
      return `
      <article class="item" id="${it.key}" data-key="${it.key}" data-title="${esc(it.title)}">
        <div class="item-head"><h3>${esc(it.title)}</h3>${it.type === "feature" ? `<span class="meta">${t("option")}</span>` : ""}</div>
        <p>${descriptionHtml(desc)}</p>
        ${viewer(it.key, it.title)}
        ${it.type === "component" && it.c.id === "sumi/image" ? `<p class="meta">${t("sampleAssets")} <a href="./sample-assets/gradient.png" download>gradient.png</a>, <a href="./sample-assets/shapes.svg" download>shapes.svg</a></p>` : ""}
        ${specs}
      </article>`;
    })
    .join("");
  for (const el of document.querySelectorAll(".item")) spy.observe(el);
}
function go(key: string) {
  document.getElementById(key)?.scrollIntoView({
    behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    block: "start",
  });
}
$("side").addEventListener("click", (e) => {
  const b = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-go]") : null;
  if (b?.dataset.go) go(b.dataset.go);
});
const spy = new IntersectionObserver(
  (entries) => {
    for (const en of entries)
      if (en.isIntersecting)
        for (const b of $("side").querySelectorAll<HTMLElement>("[data-go]"))
          b.setAttribute("aria-current", String(b.dataset.go === en.target.id));
  },
  { rootMargin: "0px 0px -70% 0px" },
);

/* ---------- prompt ---------- */
function seg<
  K extends "purpose" | "kind" | "place" | "layout" | "agent",
  I extends { id: PromptState[K] },
>(el: HTMLElement, items: readonly I[], key: K, inner: (item: I) => string) {
  if (!el.children.length || el.dataset.lang !== state.ui) {
    el.dataset.lang = state.ui;
    el.innerHTML = items
      .map(
        (it) =>
          `<button type="button" data-v="${it.id}" aria-pressed="${state[key] === it.id}">${inner(it)}</button>`,
      )
      .join("");
  }
  for (const button of el.querySelectorAll<HTMLElement>("button"))
    button.setAttribute("aria-pressed", String(button.dataset.v === state[key]));
  el.onclick = (e) => {
    const b = e.target instanceof Element ? e.target.closest("button") : null;
    const selected = items.find((item) => item.id === b?.dataset.v);
    if (!selected) return;
    state[key] = selected.id;
    renderComposer();
  };
}
function renderComposer() {
  const L = state.ui;
  seg($("purpose"), PURPOSES, "purpose", (it) => it[L]);
  seg($("kind"), KINDS, "kind", (it) => it[L]);
  seg($("place"), PLACES, "place", (it) => `${it[L]}<span class="sub">${it.sub}</span>`);
  seg(
    $("layout"),
    LAYOUTS,
    "layout",
    (it) =>
      `${it.svg ? `<svg viewBox="0 0 22 12" aria-hidden="true">${it.svg}</svg>` : ""}${it[L]}`,
  );
  seg($("agent"), AGENTS, "agent", (it) => it[L]);
  $("purpose-custom").hidden = state.purpose !== "custom";
  $("kind-custom").hidden = state.kind !== "custom";
  $("style-hint").textContent = t("styleHint")(state.theme, state.palette);
  $("tones").innerHTML = state.tones
    .map(
      (x, i) => `
    <div class="tone">
      <input type="text" id="tone-m-${i}" data-i="${i}" data-f="0" value="${esc(x[0])}" placeholder="${esc(t("toneMeaning"))}" aria-label="${esc(t("toneMeaning"))}">
      <select id="tone-t-${i}" data-i="${i}" data-f="1" aria-label="${esc(t("toneColor")(i + 1))}">${TONES.map((k) => `<option ${x[1] === k ? "selected" : ""}>${k}</option>`).join("")}</select>
      <button type="button" class="x" data-del="${i}" aria-label="${t("remove")}">×</button>
    </div>`,
    )
    .join("");
  renderPrompt();
}
$("tones").addEventListener("input", (e) => {
  const el = e.target;
  if (
    !(el instanceof HTMLInputElement || el instanceof HTMLSelectElement) ||
    el.dataset.i === undefined
  )
    return;
  const tone = state.tones[+el.dataset.i];
  if (!tone || (el.dataset.f !== "0" && el.dataset.f !== "1")) return;
  tone[+el.dataset.f as 0 | 1] = el.value;
  renderPrompt();
});
$("tones").addEventListener("click", (e) => {
  const b = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-del]") : null;
  if (!b || b.dataset.del === undefined) return;
  state.tones.splice(+b.dataset.del, 1);
  renderComposer();
});
$("add-tone").onclick = () => {
  const used = new Set(state.tones.map((x) => x[1]));
  state.tones.push(["", TONES.find((k) => !used.has(k)) || "gray"]);
  renderComposer();
};
$("purpose-custom").addEventListener("input", (e) => {
  if (!(e.target instanceof HTMLInputElement)) return;
  state.purposeText = e.target.value;
  renderPrompt();
});
$("kind-custom").addEventListener("input", (e) => {
  if (!(e.target instanceof HTMLInputElement)) return;
  state.kindText = e.target.value;
  renderPrompt();
});
for (const k of ["refs", "target", "figid", "content", "maxh", "layoutnote", "extra"] as const)
  $(k).addEventListener("input", (e) => {
    if (!(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) return;
    state[k] = e.target.value;
    renderPrompt();
  });
$("labellang").addEventListener("input", (e) => {
  if (!(e.target instanceof HTMLSelectElement)) return;
  state.labellang = e.target.value === "ja" ? "ja" : "en";
  renderPrompt();
});

function renderPrompt() {
  const text = buildPrompt(state);
  $("prompt-output").innerHTML = text
    .split("\n")
    .map((l) =>
      l.startsWith("## ")
        ? `<span class="h">${esc(l)}</span>`
        : l.startsWith("- ")
          ? `<span class="d">-</span>${esc(l.slice(1))}`
          : esc(l),
    )
    .join("\n");
  const missing = [];
  if (!lines(state.refs).length && !state.content.trim() && state.purpose !== "improve")
    missing.push(t("needSource"));
  if (state.purpose === "reproduce" && !state.target.trim()) missing.push(t("needTarget"));
  if (state.purpose === "custom" && !state.purposeText.trim()) missing.push(t("needGoal"));
  if (state.kind === "custom" && !state.kindText.trim()) missing.push(t("needKind"));
  const n = state.ui === "ja" ? text.length : text.split(/\s+/).length;
  $("status").innerHTML =
    `<span>${t("chars")(n)}</span>` +
    (missing.length
      ? `<span class="miss">${t("missing")}: ${missing.join(", ")}</span>`
      : `<span>${t("ready")}</span>`);
}
$("copy").onclick = () => copyText(buildPrompt(state), $("copy"), "copy");

/* ---------- language ---------- */
function applyLang() {
  document.documentElement.lang = state.ui;
  for (const b of $("ui-lang").querySelectorAll("button"))
    b.setAttribute("aria-pressed", String(b.dataset.l === state.ui));
  for (const el of document.querySelectorAll<HTMLElement>("[data-i18n]")) {
    const key = el.dataset.i18n;
    if (key && key in T.en) {
      const value = t(key as keyof typeof T.en);
      if (typeof value === "string") el.textContent = value;
    }
  }
  for (const [k, v] of Object.entries(PH[state.ui])) {
    const el = $(k);
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.placeholder = v;
  }
  $("purpose-custom").setAttribute("aria-label", t("customGoal"));
  $("kind-custom").setAttribute("aria-label", t("customFigure"));
  $("labellang").innerHTML =
    `<option value="en">${t("langEn")}</option><option value="ja">${t("langJa")}</option>`;
  const labelLang = $("labellang");
  if (labelLang instanceof HTMLSelectElement) labelLang.value = state.labellang;
  $("add-tone").textContent = t("addTone");
  $("copy").innerHTML = `${ICON.copy}${t("copy")}`;
  applySiteTheme();
  renderHome();
  if (DATA) {
    renderFigbar();
    renderExamples();
    renderLibrary();
    figureChanged();
  }
  renderComposer();
}
$("ui-lang").addEventListener("click", (e) => {
  const b = e.target instanceof Element ? e.target.closest("button") : null;
  if (!b || (b.dataset.l !== "en" && b.dataset.l !== "ja")) return;
  state.ui = b.dataset.l;
  store.set("sumi-ui-lang", state.ui);
  applyLang();
});

/* ---------- routing ---------- */
const PAGES = ["home", "examples", "components", "prompt"];
function route() {
  const page = PAGES.includes(location.hash.slice(1)) ? location.hash.slice(1) : "home";
  for (const p of PAGES) {
    $(`page-${p}`).hidden = p !== page;
    if (p === page && p !== "home") $(`nav-${p}`).setAttribute("aria-current", "page");
    else $(`nav-${p}`).removeAttribute("aria-current");
  }
  $("figbar").hidden = page === "home" || page === "examples";
}
window.addEventListener("hashchange", route);

route();
applyLang();
loadData()
  .then((d) => {
    DATA = d;
    if (!d.themes.includes(state.theme)) state.theme = d.themes[0] ?? "paper";
    if (state.palette && !d.palettes.some((p) => p.id === state.palette)) state.palette = "";
    $("ver").textContent = `v${d.version}`;
    applyLang();
  })
  .catch(() => {
    $("example-list").innerHTML = `<p class="lead">${t("loadFail")}</p>`;
  });
