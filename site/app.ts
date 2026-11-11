// @ts-nocheck
import { HOME, PH, T } from "./i18n";
import { AGENTS, buildPrompt, KINDS, LAYOUTS, PLACES, PURPOSES, TONES } from "./prompt";
import { sampleSource } from "./source";
import { loadData } from "./types";

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
const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
const lines = (s) =>
  s
    .split(/\n+/)
    .map((x) => x.trim())
    .filter(Boolean);
const store = {
  get(k, d) {
    try {
      return localStorage.getItem(k) ?? d;
    } catch (e) {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch (e) {}
  },
};

/* ---------- UI strings ---------- */
/* ---------- state ---------- */
const state = {
  ui: store.get("sumi-ui-lang", "en"),
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
const t = (k) => T[state.ui][k];
/** @type {import("./types").SiteData | null} */
let DATA = null;

async function copyText(text, el, labelKey) {
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
const ORDER = ["system", "light", "dark"];
let sitePref = store.get("sumi-site-theme", "system");
function applySiteTheme() {
  if (sitePref === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", sitePref);
  const names = t("siteTheme"),
    next = ORDER[(ORDER.indexOf(sitePref) + 1) % 3];
  const b = $("site-theme");
  b.innerHTML = ICON[sitePref];
  b.title = names[sitePref];
  b.setAttribute("aria-label", t("themeLabel")(names[sitePref], names[next]));
}
$("site-theme").onclick = () => {
  sitePref = ORDER[(ORDER.indexOf(sitePref) + 1) % 3];
  store.set("sumi-site-theme", sitePref);
  applySiteTheme();
};

/* ---------- figure theme + palette (bundles) ---------- */
function renderFigbar() {
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
  $("sumi-theme").setAttribute("aria-label", "Theme");
  $("sumi-palette").setAttribute("aria-label", "Palette");
}
$("sumi-theme").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  state.theme = b.dataset.t;
  store.set("sumi-figure-theme", state.theme);
  figureChanged();
});
$("sumi-palette").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  state.palette = b.dataset.p;
  store.set("sumi-figure-palette", state.palette);
  figureChanged();
});
async function figureChanged() {
  renderFigbar();
  renderComposer();
  for (const el of document.querySelectorAll(".item pre"))
    el.innerHTML = highlightYaml(yamlOfKey(el.closest(".item").dataset.key));
  for (const el of document.querySelectorAll(".item")) {
    const img = el.querySelector("img");
    img.src = `./figures/${state.theme}/${state.palette || "base"}/${ITEMS.get(el.dataset.key).slug}.svg`;
    img.alt = `${el.dataset.title} (${state.theme}${state.palette ? `, ${state.palette}` : ""})`;
  }
}

/* ---------- YAML ---------- */
function highlightYaml(y, marks = true) {
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
function viewer(key, title, extraClass = "") {
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
  const v = e.target.closest("[data-view]");
  if (v) {
    const box = v.closest(".view");
    const code = v.dataset.view === "code";
    box.querySelector(".stage").hidden = code;
    box.querySelector("pre").hidden = !code;
    for (const b of box.querySelectorAll("[data-view]"))
      b.setAttribute("aria-pressed", String(b === v));
    return;
  }
  const c = e.target.closest("[data-copy]");
  if (c) copyText(yamlOfKey(c.dataset.copy), c, "copy");
});

/* ---------- home (README) ---------- */
const GH = "https://github.com/nishide-dev/sumi-diagram/blob/main/";
const INSTALL =
  "curl -fsSL https://raw.githubusercontent.com/nishide-dev/sumi-diagram/main/install.sh | sh";
const SKILL = "npx skills add nishide-dev/sumi-diagram --skill sumi -a claude-code -y";
const HELLO = `version: 1
figure:
  id: hello
  layout:
    direction: down
nodes:
  - { id: input, component: box, label: Input }
  - { id: output, component: box, label: Output }
edges:
  - { from: input, to: output }`;
const RUN = `sumi fmt hello.sumi.yaml
sumi lint hello.sumi.yaml
sumi render hello.sumi.yaml                 # writes hello.svg
sumi render hello.sumi.yaml -o hello.pdf    # writes a vector PDF`;
const SNIP = { install: INSTALL, skill: SKILL, hello: HELLO, run: RUN };
function cmd(key, yaml) {
  return `<div class="cmd"><pre>${yaml ? highlightYaml(SNIP[key], false) : esc(SNIP[key])}</pre><button type="button" class="copy-sm" data-snip="${key}">${ICON.copy}${t("copy")}</button></div>`;
}
function renderHome() {
  const H = HOME[state.ui];
  const shown = ["transformer", "dit-block", "embedding-gemma", "clip"]
    .map((s) => DATA?.examples.find((x) => x.slug === s))
    .filter(Boolean);
  $("page-home").innerHTML = `
    <h2 class="tagline">${H.tagline}</h2>
    <p class="intro">${H.intro}</p>
    <div class="hero-cmd">${cmd("install")}</div>
    <nav class="go">${H.go.map(([h, l]) => `<a href="${h}">${l}</a>`).join("")}</nav>
    <div class="figs4">${shown.map((x) => `<figure><div class="stage fixed"><img loading="lazy" src="./examples/${x.slug}.svg" alt="${esc(x.title)}"></div><figcaption class="meta">${esc(x.title.split(" (")[0])}</figcaption></figure>`).join("")}</div>
    <div class="hrow"><span class="label">${H.install}</span><div class="body"><p>${H.installText}</p>${cmd("install")}<p class="sub">${H.installMore}</p></div></div>
    <div class="hrow"><span class="label">${H.quick}</span><div class="body"><p>${H.quickText}</p>${cmd("hello", true)}${cmd("run")}<p class="sub">${H.quickOut}</p></div></div>
    <div class="hrow"><span class="label">${H.features}</span><div class="body"><ul class="feat">${H.feats.map(([a, b]) => `<li><b style="font-weight:500">${a}</b><span>${b}</span></li>`).join("")}</ul></div></div>
    <div class="hrow"><span class="label">${H.claude}</span><div class="body"><p>${H.claudeText}</p>${cmd("skill")}</div></div>
    <div class="hrow"><span class="label">${H.docs}</span><div class="body"><ul class="docs">${H.docLinks.map(([l, h]) => `<li><a class="ext" href="${GH}${h}" target="_blank" rel="noreferrer">${l} ↗</a></li>`).join("")}</ul></div></div>
    <div class="hrow"><span class="label">${H.license}</span><div class="body"><p class="sub">${H.licenseText}</p></div></div>`;
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-snip]");
  if (b) copyText(SNIP[b.dataset.snip], b, "copy");
});

/* ---------- examples ---------- */
function renderExamples() {
  const fig = (x) => `
    <li class="fig">
      <div class="cap">
        <h3>${esc(x.title)}</h3>
        ${x.paperUrl ? `<a class="ext" href="${x.paperUrl}" target="_blank" rel="noreferrer">${t("original")}</a>` : ""}
      </div>
      ${viewer(`e-${x.slug}`, x.title, "fixed")}
    </li>`;
  const repro = DATA.examples.filter((x) => x.paperUrl),
    generic = DATA.examples.filter((x) => !x.paperUrl);
  $("examples").innerHTML = `
    <div class="ex-group" style="margin-top:36px"><h3 class="label">${t("reproductions")} · ${repro.length}</h3><ul class="figs">${repro.map(fig).join("")}</ul></div>
    <div class="ex-group"><h3 class="label">${t("generic")} · ${generic.length}</h3><ul class="figs">${generic.map(fig).join("")}</ul></div>`;
  for (const x of DATA.examples) {
    const box = document.querySelector(`[data-view-of="e-${x.slug}"]`);
    box.querySelector("img").src = `./examples/${x.slug}.svg`;
    box.querySelector("pre").innerHTML = highlightYaml(x.source, false);
  }
}

/* ---------- components ---------- */
const GROUPS = [
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
function itemList() {
  const comp = new Map(DATA.components.map((c) => [c.id.replace("sumi/", ""), c]));
  const C = (i) => ({
    key: `c-${comp.get(i).slug}`,
    type: "component",
    slug: comp.get(i).slug,
    c: comp.get(i),
    title: comp.get(i).id,
  });
  const groups = GROUPS.map(([name, ids]) => [name, ids.filter((i) => comp.has(i)).map(C)]);
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
let ITEMS = new Map();
function yamlOfKey(key) {
  if (key.startsWith("e-")) return DATA.examples.find((x) => `e-${x.slug}` === key).source;
  const it = ITEMS.get(key);
  const src = it.type === "component" ? it.c : it.f;
  return sampleSource(
    src.source,
    state.theme,
    src.profiles[state.theme],
    state.palette || undefined,
  );
}
function renderLibrary() {
  const groups = itemList();
  ITEMS = new Map(groups.flatMap(([, its]) => its).map((it) => [it.key, it]));
  $("side").innerHTML = groups
    .map(
      ([name, its]) =>
        `<div><span class="label">${name}</span><ul>${its.map((it) => `<li><button type="button" data-go="${it.key}">${esc(it.type === "component" ? it.c.id.replace("sumi/", "") : it.title)}</button></li>`).join("")}</ul></div>`,
    )
    .join("");
  $("items").innerHTML = [...ITEMS.values()]
    .map((it) => {
      const desc = it.type === "component" ? it.c.description : it.f.description;
      const schema = it.type === "component" ? it.c.props : {};
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
        <p>${desc}</p>
        ${viewer(it.key, it.title)}
        ${specs}
      </article>`;
    })
    .join("");
  for (const el of document.querySelectorAll(".item")) spy.observe(el);
}
function go(key) {
  $(key)?.scrollIntoView({
    behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    block: "start",
  });
}
$("side").addEventListener("click", (e) => {
  const b = e.target.closest("[data-go]");
  if (b) go(b.dataset.go);
});
const spy = new IntersectionObserver(
  (entries) => {
    for (const en of entries)
      if (en.isIntersecting)
        for (const b of $("side").querySelectorAll("[data-go]"))
          b.setAttribute("aria-current", String(b.dataset.go === en.target.id));
  },
  { rootMargin: "0px 0px -70% 0px" },
);

/* ---------- prompt ---------- */
function seg(el, items, key, inner) {
  el.innerHTML = items
    .map(
      (it) =>
        `<button type="button" data-v="${it.id}" aria-pressed="${state[key] === it.id}">${inner(it)}</button>`,
    )
    .join("");
  el.onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    state[key] = b.dataset.v;
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
      <select id="tone-t-${i}" data-i="${i}" data-f="1" aria-label="tone ${i + 1}">${TONES.map((k) => `<option ${x[1] === k ? "selected" : ""}>${k}</option>`).join("")}</select>
      <button type="button" class="x" data-del="${i}" aria-label="${t("remove")}">×</button>
    </div>`,
    )
    .join("");
  renderPrompt();
}
$("tones").addEventListener("input", (e) => {
  const el = e.target;
  if (el.dataset.i === undefined) return;
  state.tones[+el.dataset.i][+el.dataset.f] = el.value;
  renderPrompt();
});
$("tones").addEventListener("click", (e) => {
  const b = e.target.closest("[data-del]");
  if (!b) return;
  state.tones.splice(+b.dataset.del, 1);
  renderComposer();
});
$("add-tone").onclick = () => {
  const used = new Set(state.tones.map((x) => x[1]));
  state.tones.push(["", TONES.find((k) => !used.has(k)) || "gray"]);
  renderComposer();
};
$("purpose-custom").addEventListener("input", (e) => {
  state.purposeText = e.target.value;
  renderPrompt();
});
$("kind-custom").addEventListener("input", (e) => {
  state.kindText = e.target.value;
  renderPrompt();
});
for (const k of ["refs", "target", "figid", "content", "maxh", "layoutnote", "extra", "labellang"])
  $(k).addEventListener("input", (e) => {
    state[k] = e.target.value;
    renderPrompt();
  });

function renderPrompt() {
  const text = buildPrompt(state);
  $("prompt").innerHTML = text
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
  for (const el of document.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n);
  for (const [k, v] of Object.entries(PH[state.ui])) $(k).placeholder = v;
  $("labellang").innerHTML =
    `<option value="en">${t("langEn")}</option><option value="ja">${t("langJa")}</option>`;
  $("labellang").value = state.labellang;
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
  const b = e.target.closest("button");
  if (!b) return;
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
    if (!d.themes.includes(state.theme)) state.theme = d.themes[0];
    if (state.palette && !d.palettes.some((p) => p.id === state.palette)) state.palette = "";
    $("ver").textContent = `v${d.version}`;
    applyLang();
  })
  .catch(() => {
    $("examples").innerHTML = `<p class="lead">${t("loadFail")}</p>`;
  });
