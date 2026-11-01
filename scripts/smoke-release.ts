/**
 * Smoke-tests a release tarball (`bun run release:smoke <tarball> [--keep]`;
 * design doc §6.8, #20). Used by CI (release.yml, ci.yml) and by hand.
 *
 * Extracts the tarball into a fresh temporary directory whose path contains a
 * space, then runs the extracted `sumi` from an empty working directory
 * outside the repository, with a minimal environment: `PATH` limited to the
 * system directories (no Bun or Node.js), a temporary `HOME`, and no
 * `SUMI_D2_PATH`, so only the files in the tarball can satisfy it. Checks:
 *
 * 1. the tarball's `.sha256` (when present next to it) and the inner `SHA256SUMS`
 * 2. `sumi --version` matches `VERSION`
 * 3. `sumi doctor --json` passes, in compiled mode, with the bundled D2
 * 4. `sumi render` of a figure with Japanese labels exits 0 and writes a
 *    well-formed SVG that contains the labels
 * 5. the same through a symlink to `bin/sumi` in another directory
 * 6. `sumi render -o x.pdf` (#59): one page of the SVG's pt size, the labels
 *    as text in embedded font subsets, no raster images, and the same bytes
 *    as the PDF engine produces from source for that SVG (so every target
 *    writes the same PDF); its sha256 is printed for comparison across targets
 * 6b. a structured figure with label math (#93) renders to PDF with the bundled
 *    STIX Two math fonts embedded and its math extractable as text
 *
 * Exits 1 on the first failure.
 */

import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import pkg from "../package.json";
import { compileFigure } from "../src/compiler/compile";
import { RELEASE_LAYOUT } from "../src/core/install-layout";
import { runCommand } from "../src/core/subprocess";
import { svgToPdf } from "../src/render/pdf";
import { inspectPdf, textLines } from "../src/render/pdf/testing";
import { svgToEditablePptx, svgToPptx } from "../src/render/pptx";
import { inspectPptx, readPptx } from "../src/render/pptx/testing";
import { descendants, parseXml, textContent } from "../src/render/xml";
import { parseSha256Sums, sha256Hex } from "./release/lib";

const SYSTEM_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";

const FIGURE = `version: 1
figure:
  id: smoke
  title: リリース smoke test
  layout:
    direction: down

groups:
  - id: system
    label: 処理系

nodes:
  - id: input
    component: box
    label: 入力データ
  - id: parse
    component: box
    label: 構文解析
    group: system
  - id: output
    component: cylinder
    label: 出力 (SVG)

edges:
  - from: input
    to: parse
    label: 読み込み
  - from: parse
    to: output
`;
/** A structured figure with label math (#93): needs the math fonts from share/sumi/fonts. */
const MATH_FIGURE = `version: 1
figure:
  id: math
  theme: color
  profile: paper-single
  layout:
    arrange:
      stack: { gap: 8mm, items: [a, b] }
nodes:
  - { id: a, component: box, label: 'Scale $\\gamma_1,\\beta_1$' }
  - { id: b, component: box, label: 'x₂ $32 \\times 32$' }
edges:
  - { from: a, to: b, label: $\\alpha_2$ }
`;

/** A structured figure with a bundled icon and an image beside it (#94). */
const ASSET_FIGURE = `version: 1
figure: { id: assets, layout: { arrange: { row: { items: [icon, image] } } } }
nodes:
  - { id: icon, component: circle, icon: tabler/wave-sine }
  - { id: image, component: image, props: { src: gradient.png, height: 20pt } }
`;

/** Exercises the embedded Takumi WASM and supplied fonts outside the checkout (#283). */
const HTML_FIGURE = `version: 1
figure: { id: html-smoke, theme: paper, layout: { arrange: { row: { items: [card] } } } }
nodes:
  - id: card
    component: html
    props:
      viewport: 320x176
      width: 160pt
      html: |
        <div style="padding:12px;color:var(--sumi-fg);border:2px solid var(--sumi-accent)"><b style="font-size:24px">HTML 日本語</b><div style="font-family:var(--sumi-mono);white-space:pre">  code()</div></div>
`;

const EXPECTED_LABELS = ["入力データ", "構文解析", "出力 (SVG)", "読み込み", "処理系"];

class SmokeFailure extends Error {}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new SmokeFailure(message);
}

function step(message: string): void {
  console.log(`ok - ${message}`);
}

async function smoke(tarballArg: string, keep: boolean): Promise<void> {
  const tarball = resolve(tarballArg);
  check(existsSync(tarball), `${tarball} does not exist`);
  const name = basename(tarball).replace(/\.tar\.gz$/, "");
  const bytes = await readFile(tarball);

  // 1a. The tarball's own checksum, if published next to it.
  for (const sums of [`${tarball}.sha256`, join(dirname(tarball), "SHA256SUMS")]) {
    if (!existsSync(sums)) continue;
    const expected = parseSha256Sums(await readFile(sums, "utf8")).get(basename(tarball));
    if (expected === undefined) continue;
    check(sha256Hex(bytes) === expected, `${basename(tarball)} does not match ${sums}`);
    step(`tarball sha256 matches ${basename(sums)}`);
  }

  const root = await mkdtemp(join(tmpdir(), "sumi smoke "));
  try {
    const extracted = join(root, "install dir");
    const work = join(root, "work dir");
    const home = join(root, "home");
    await Promise.all([extracted, work, home].map((d) => mkdir(d, { recursive: true })));

    const tar = await runCommand(["tar", "-xzf", tarball, "-C", extracted]);
    check(tar.exitCode === 0, `tar failed: ${tar.stderr}`);
    const top = await readdir(extracted);
    check(
      top.length === 1 && top[0] === name,
      `expected one top-level directory ${name}, got ${top.join(", ")}`,
    );
    const prefix = join(extracted, name);
    step(`extracted to "${prefix}"`);

    // 1b. Every file listed in the inner SHA256SUMS, and nothing unlisted.
    const inner = parseSha256Sums(await readFile(join(prefix, "SHA256SUMS"), "utf8"));
    for (const path of Object.values(RELEASE_LAYOUT)) {
      check(
        [...inner.keys()].some((f) => f === path || f.startsWith(`${path}/`)),
        `SHA256SUMS lists nothing under ${path}`,
      );
    }
    for (const required of [
      "LICENSE",
      "NOTICE",
      "licenses/d2/LICENSE.txt",
      "licenses/biz-ud-gothic/OFL.txt",
      "licenses/stix-two/OFL.txt",
      "licenses/inter/OFL.txt",
      "licenses/bun/LICENSE.md",
      "licenses/pdf-wasm/THIRD_PARTY.md",
      "licenses/pdf-wasm/krilla-0.8.2/NOTICE.md",
      "licenses/pdf-wasm/krilla-0.8.2/LICENSE_MIT",
      "licenses/pdf-wasm/krilla-0.8.2/LICENSE-MPL-2.0",
      "licenses/pdf-wasm/krilla-svg-0.8.1/LICENSE_MIT",
      "licenses/pdf-wasm/resvg-0.47.0/LICENSE-MIT",
      "licenses/pdf-wasm/resvg-0.47.0/LICENSE-APACHE",
      "licenses/tabler-icons/LICENSE",
      "licenses/fluent-emoji/LICENSE",
    ]) {
      check(inner.has(required), `the tarball lacks ${required}`);
    }
    // Every production dependency is bundled into bin/sumi and needs its license text.
    for (const dependency of Object.keys(pkg.dependencies)) {
      check(
        [...inner.keys()].some((f) => f.startsWith(`licenses/npm/${dependency}/`)),
        `the tarball lacks the license of the bundled npm package ${dependency}`,
      );
    }
    for (const [file, expected] of inner) {
      check(sha256Hex(await readFile(join(prefix, file))) === expected, `${file}: sha256 mismatch`);
    }
    step(`${inner.size} files match the inner SHA256SUMS`);

    const env: Record<string, string> = { PATH: SYSTEM_PATH, HOME: home, TMPDIR: root, LANG: "C" };
    for (const runtime of ["bun", "node"]) {
      check(
        Bun.which(runtime, { PATH: SYSTEM_PATH }) === null,
        `${runtime} is on the restricted PATH (${SYSTEM_PATH}); the smoke test would not prove the binary is standalone`,
      );
    }
    const sumiAt = async (sumi: string, args: string[]) => {
      const result = await runCommand([sumi, ...args], { cwd: work, env, timeoutMs: 120_000 });
      const out = `${result.stdout}${result.stderr}`.trim();
      check(
        result.exitCode === 0,
        `sumi ${args.join(" ")} exited with ${result.exitCode ?? result.signal}:\n${out}`,
      );
      return result.stdout;
    };
    const sumi = join(prefix, RELEASE_LAYOUT.sumi);

    // 2. Version.
    const version = (await readFile(join(prefix, "VERSION"), "utf8")).trim();
    const reported = (await sumiAt(sumi, ["--version"])).trim();
    check(reported === version, `sumi --version printed "${reported}", VERSION says "${version}"`);
    step(`sumi --version: ${reported} (without Bun or Node.js on PATH)`);

    // 3. Doctor, through the binary and through a symlink elsewhere.
    const doctor = async (path: string, label: string) => {
      const report = JSON.parse(await sumiAt(path, ["doctor", "--json"]));
      check(report.ok === true, `${label}: doctor reported failures`);
      check(
        report.runtime?.mode === "compiled",
        `${label}: runtime mode is ${report.runtime?.mode}`,
      );
      const d2 = report.checks.find((c: { id: string }) => c.id === "d2");
      check(
        d2?.status === "ok" && d2.details?.source === "bundled",
        `${label}: D2 is not the bundled one: ${JSON.stringify(d2)}`,
      );
      check(
        d2.details.path === join(await realpath(prefix), RELEASE_LAYOUT.d2),
        `${label}: unexpected D2 path ${d2.details.path}`,
      );
      const fonts = report.checks.find((c: { id: string }) => c.id === "fonts");
      check(fonts?.status === "ok", `${label}: fonts check failed: ${JSON.stringify(fonts)}`);
      step(`${label}: sumi doctor ok (bundled D2, ${fonts.message})`);
    };
    await doctor(sumi, "direct");
    const linkDir = join(root, "link bin");
    await mkdir(linkDir);
    await symlink(sumi, join(linkDir, "sumi"));
    await doctor(join(linkDir, "sumi"), "symlink");

    // Install the real archive through a local HTTP release mirror. This also
    // exercises wget on hosts where it cannot read file:// URLs.
    let corrupt = false;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === `/${basename(tarball)}`) return new Response(Bun.file(tarball));
        if (path === "/SHA256SUMS") {
          return new Response(
            `${corrupt ? "0".repeat(64) : sha256Hex(bytes)}  ${basename(tarball)}\n`,
          );
        }
        return new Response("Not found", { status: 404 });
      },
    });
    try {
      const installer = resolve(import.meta.dir, "..", "install.sh");
      const installHome = join(home, ".local", "share", "sumi");
      const installBin = join(home, ".local", "bin");
      const installEnv = {
        ...env,
        SUMI_VERSION: `v${version}`,
        SUMI_DOWNLOAD_BASE: `http://127.0.0.1:${server.port}`,
      };
      const latest = join(root, "latest release.json");
      await Bun.write(latest, JSON.stringify({ tag_name: `v${version}` }));
      const installed = await runCommand(["sh", installer], {
        cwd: work,
        // No SUMI_VERSION: resolve the latest tag without contacting GitHub.
        env: { ...env, SUMI_DOWNLOAD_BASE: installEnv.SUMI_DOWNLOAD_BASE, SUMI_LATEST_URL: latest },
        timeoutMs: 120_000,
      });
      check(installed.exitCode === 0, `installer failed: ${installed.stderr}${installed.stdout}`);
      check(installed.stdout.includes("export PATH="), "installer omitted the PATH hint");
      check(
        (await realpath(join(installBin, "sumi"))) ===
          (await realpath(join(installHome, name, RELEASE_LAYOUT.sumi))),
        "installer symlink does not point into the intact release layout",
      );
      const installedDoctor = JSON.parse(
        await sumiAt(join(installBin, "sumi"), ["doctor", "--json"]),
      );
      check(installedDoctor.ok, "installed binary failed doctor");
      step(
        "installer: offline latest-tag resolution, checksum, default paths, symlink, doctor, and PATH hint",
      );

      // Reinstall into custom paths, as used for upgrades and isolated installs.
      const customEnv = {
        ...installEnv,
        SUMI_HOME: join(root, "custom release home"),
        SUMI_BIN_DIR: join(root, "custom bin"),
      };
      const customInstall = await runCommand(["sh", installer], { cwd: work, env: customEnv });
      check(customInstall.exitCode === 0, `custom install failed: ${customInstall.stderr}`);
      const releaseDir = join(customEnv.SUMI_HOME, name);
      const executable = join(releaseDir, RELEASE_LAYOUT.sumi);
      const stale = join(releaseDir, "stale-file");
      await Bun.write(stale, "must disappear on reinstall");
      // Keep the old inode alive so inode reuse cannot hide an in-place overwrite.
      const oldExecutable = await open(executable, "r");
      try {
        const before = await oldExecutable.stat();
        const reinstall = await runCommand(["sh", installer], { cwd: work, env: customEnv });
        check(reinstall.exitCode === 0, `custom reinstall failed: ${reinstall.stderr}`);
        check(
          (await stat(executable)).ino !== before.ino,
          "reinstall overwrote the old executable in place",
        );
        check(!existsSync(stale), "reinstall retained stale files in the old release directory");
        check(
          (await readdir(customEnv.SUMI_HOME)).every((entry) => !entry.startsWith(`.${name}.tmp.`)),
          "reinstall left a staging directory behind",
        );
      } finally {
        await oldExecutable.close();
      }
      check(
        (await sumiAt(join(customEnv.SUMI_BIN_DIR, "sumi"), ["--version"])).trim() === version,
        "custom install reports the wrong version",
      );
      step(
        "installer: custom directories with spaces and staged replacement of an existing release",
      );

      corrupt = true;
      const rejectedHome = join(root, "rejected home");
      const rejected = await runCommand(["sh", installer], {
        cwd: work,
        env: { ...installEnv, SUMI_HOME: rejectedHome },
      });
      check(
        rejected.exitCode !== 0 && rejected.stderr.includes("Checksum mismatch"),
        `installer did not clearly reject a checksum mismatch: ${rejected.stderr}`,
      );
      check(!existsSync(rejectedHome), "checksum mismatch modified the installation directory");
      step("installer: checksum mismatch rejected before installation");
    } finally {
      await server.stop(true);
    }

    // 4. Render a figure with Japanese labels.
    await Bun.write(join(work, "図.sumi.yaml"), FIGURE);
    for (const [path, label] of [
      [sumi, "direct"],
      [join(linkDir, "sumi"), "symlink"],
    ] as const) {
      const svgPath = join(work, `出力-${label}.svg`);
      await sumiAt(path, ["render", "図.sumi.yaml", "-o", svgPath]);
      const svg = await readFile(svgPath, "utf8");
      const parsed = parseXml(svg);
      check(
        parsed.ok,
        `${label}: rendered SVG is not well-formed XML: ${parsed.ok ? "" : parsed.message}`,
      );
      check(parsed.root.name === "svg", `${label}: root element is <${parsed.root.name}>`);
      const texts = [...descendants(parsed.root)]
        .filter((e) => e.name === "text")
        .map((e) => textContent(e));
      const missing = EXPECTED_LABELS.filter((l) => !texts.some((t) => t.includes(l)));
      check(missing.length === 0, `${label}: SVG lacks the labels ${missing.join(", ")}`);
      step(`${label}: sumi render wrote a valid SVG (${svg.length} bytes) with Japanese labels`);
    }

    // 5. Icons and images (#94): the icon archive embedded in bin/sumi, an image next to the YAML.
    await mkdir(join(work, "assets"));
    await Bun.write(
      join(work, "assets", "gradient.png"),
      await readFile(join(import.meta.dir, "..", "tests", "fixtures", "assets", "gradient.png")),
    );
    await Bun.write(join(work, "assets", "icons.sumi.yaml"), ASSET_FIGURE);
    await sumiAt(sumi, ["render", "assets/icons.sumi.yaml", "-o", join(work, "icons.svg")]);
    const iconSvg = await readFile(join(work, "icons.svg"), "utf8");
    check(iconSvg.includes('<g class="sumi-icon"'), "the icon was not drawn");
    check(iconSvg.includes('xlink:href="data:image/png;base64,'), "the image was not embedded");
    check(/assets-sha256="[0-9a-f]{64}"/.test(iconSvg), "the SVG lacks assets-sha256");
    check(iconSvg.includes('name="Tabler Icons"'), "the SVG lacks the Tabler notice");
    step("sumi render drew a bundled icon and embedded an image");
    await Bun.write(join(work, "html.sumi.yaml"), HTML_FIGURE);
    for (const format of ["svg", "pdf", "pptx"]) {
      await sumiAt(sumi, ["render", "html.sumi.yaml", "-o", `html.${format}`]);
      const first = await readFile(join(work, `html.${format}`));
      await sumiAt(sumi, ["render", "html.sumi.yaml", "-o", `html-repeat.${format}`]);
      check(
        first.equals(await readFile(join(work, `html-repeat.${format}`))),
        `HTML ${format} is not deterministic`,
      );
    }
    const htmlSvg = await readFile(join(work, "html.svg"), "utf8");
    const htmlXml = parseXml(htmlSvg);
    check(htmlXml.ok, "HTML SVG is malformed");
    const htmlUri = [...descendants(htmlXml.root)]
      .flatMap((e) => e.attributes)
      .find((a) => a.value.startsWith("data:image/svg+xml;base64,"))?.value;
    check(htmlUri, "HTML vector image is missing");
    const htmlOutlines = parseXml(
      Buffer.from(htmlUri.split(",")[1] ?? "", "base64").toString("utf8"),
    );
    check(htmlOutlines.ok, "HTML vector image is malformed");
    check(
      [...descendants(htmlOutlines.root)].filter((e) => e.name === "path").length > 10,
      "HTML outlines are missing",
    );
    const htmlPdf = inspectPdf(new Uint8Array(await readFile(join(work, "html.pdf"))));
    check(htmlPdf.pages.length === 1 && htmlPdf.images === 0, "HTML PDF is not one vector page");
    check(
      inspectPptx(new Uint8Array(await readFile(join(work, "html.pptx")))).widthPt > 0,
      "HTML picture PPTX is invalid",
    );
    step(
      "HTML with Japanese, theme colors and supplied mono font renders deterministically to SVG/PDF/PPTX",
    );
    await Bun.write(
      join(work, "emoji.sumi.yaml"),
      `version: 1
figure: { id: emoji-smoke, layout: { arrange: { row: { items: [lora, qkv] } } } }
nodes:
  - { id: lora, component: bowtie, label: LoRA, badge: { icon: emoji/fire, corner: north-east } }
  - { id: qkv, component: box, label: QKV, badge: { icon: emoji/artist-dark, corner: north-east } }
`,
    );
    await sumiAt(sumi, ["render", "emoji.sumi.yaml", "-o", join(work, "emoji.svg")]);
    const emojiSvg = await readFile(join(work, "emoji.svg"), "utf8");
    check(emojiSvg.includes('class="sumi-badge"'), "the emoji badge was not drawn");
    check(emojiSvg.includes('name="Fluent Emoji Flat"'), "the Fluent Emoji notice is missing");
    check(emojiSvg.includes("Microsoft Corporation"), "the emoji copyright is missing");
    const emojiCatalog = JSON.parse(await sumiAt(sumi, ["catalog", "--icons", "", "--json"])) as {
      icons: string[];
    };
    check(
      emojiCatalog.icons.filter((name) => name.startsWith("emoji/")).length === 3124,
      "the expanded emoji names are missing",
    );
    check(!emojiCatalog.icons.includes("emoji/teacher"), "unsupported emoji was listed");
    await sumiAt(sumi, ["render", "emoji.sumi.yaml", "-o", join(work, "emoji.pdf")]);
    await sumiAt(sumi, ["render", "emoji.sumi.yaml", "-o", join(work, "emoji.pptx")]);
    step("bundled multicolour emoji badges and bowtie render to SVG/PDF/PPTX with notices");

    // 6. The same figure as PDF.
    const svg = await readFile(join(work, "出力-direct.svg"), "utf8");
    const fromSource = svgToPdf(svg);
    check(fromSource.ok, "the PDF engine failed from source on the binary's SVG");
    const widthPt = Number(/<svg[^>]* width="([\d.]+)pt"/.exec(svg)?.[1]);
    const heightPt = Number(/<svg[^>]* height="([\d.]+)pt"/.exec(svg)?.[1]);
    let first: Uint8Array | undefined;
    for (const [path, label] of [
      [sumi, "direct"],
      [join(linkDir, "sumi"), "symlink"],
    ] as const) {
      const pdfPath = join(work, `出力-${label}.pdf`);
      await sumiAt(path, ["render", "図.sumi.yaml", "-o", pdfPath]);
      const pdf = new Uint8Array(await readFile(pdfPath));
      const inspected = inspectPdf(pdf);
      const box = inspected.pages[0]?.mediaBox ?? [];
      check(
        inspected.pages.length === 1 && box.join(" ") === `0 0 ${widthPt} ${heightPt}`,
        `${label}: PDF page is [${box.join(" ")}], the SVG is ${widthPt} × ${heightPt}pt`,
      );
      check(inspected.images === 0, `${label}: the PDF has ${inspected.images} raster images`);
      check(
        inspected.fonts.length > 0 && inspected.fonts.every((f) => f.embedded && f.subset),
        `${label}: fonts are not embedded subsets: ${JSON.stringify(inspected.fonts)}`,
      );
      const text = textLines(inspected.glyphs).map((l) => l.text);
      const missing = EXPECTED_LABELS.filter((l) => !text.includes(l));
      check(missing.length === 0, `${label}: PDF text lacks ${missing.join(", ")}`);
      check(
        sha256Hex(pdf) === sha256Hex(fromSource.value),
        `${label}: the PDF differs from the engine's output from source`,
      );
      first ??= pdf;
      check(sha256Hex(pdf) === sha256Hex(first), `${label}: PDF differs from the direct run`);
      step(
        `${label}: sumi render wrote a ${widthPt} × ${heightPt}pt vector PDF with the labels as text (sha256 ${sha256Hex(pdf)})`,
      );
    }

    // 6b. Label math draws with the bundled STIX Two fonts (#93).
    await Bun.write(join(work, "math.sumi.yaml"), MATH_FIGURE);
    await sumiAt(sumi, ["render", "math.sumi.yaml", "-o", "math.pdf"]);
    const mathPdf = inspectPdf(new Uint8Array(await readFile(join(work, "math.pdf"))));
    const mathFonts = mathPdf.fonts.map((f) => f.baseFont.replace(/^[A-Z]{6}\+/, "")).sort();
    check(
      mathFonts.includes("STIXTwoMath-Regular") && mathFonts.includes("STIXTwoText-Italic"),
      `label math PDF lacks the STIX Two fonts: ${mathFonts.join(", ")}`,
    );
    const mathText = mathPdf.glyphs.map((g) => g.text).join("");
    check(
      ["γ1,β1", "α2", "x₂", "32\u2005×\u200532"].every((t) => mathText.includes(t)),
      `label math PDF text is ${JSON.stringify(mathText)}`,
    );
    step(`label math: structured PDF with ${mathFonts.join(", ")}; text "γ1,β1" extracts`);

    // 7. Picture PPTX uses the same embedded WASM, without Bun/Node on PATH.
    const pptxSource = svgToPptx(svg);
    check(pptxSource.ok, "PPTX conversion failed from source");
    for (const [path, label] of [
      [sumi, "direct"],
      [join(linkDir, "sumi"), "symlink"],
    ] as const) {
      const file = join(work, `出力-${label}.pptx`);
      await sumiAt(path, ["render", "図.sumi.yaml", "-o", file]);
      const bytes = new Uint8Array(await readFile(file));
      const picture = inspectPptx(bytes);
      check(
        picture.widthPt === Math.max(72, widthPt) && picture.heightPt === Math.max(72, heightPt),
        `${label}: PPTX slide size changed`,
      );
      check(sha256Hex(bytes) === sha256Hex(pptxSource.value), `${label}: PPTX differs from source`);
      step(
        `${label}: one-picture PPTX with outlined SVG + PNG fallback (sha256 ${sha256Hex(bytes)})`,
      );
    }

    const compiled = compileFigure(FIGURE);
    check(compiled.ok, "Cannot compile native smoke source");
    for (const connectors of ["freeform", "glued"] as const) {
      const expected = svgToEditablePptx(svg, compiled.value.ir, { connectors });
      check(expected.ok, `Cannot make ${connectors} native source`);
      for (const [path, label] of [
        [sumi, "direct"],
        [join(linkDir, "sumi"), "symlink"],
      ] as const) {
        const file = join(work, `編集-${label}-${connectors}.pptx`);
        await sumiAt(path, [
          "render",
          "図.sumi.yaml",
          "-o",
          file,
          "--pptx-mode",
          "editable",
          "--pptx-connectors",
          connectors,
        ]);
        const bytes = new Uint8Array(await readFile(file));
        const parts = readPptx(bytes);
        check(
          ![...parts.keys()].some((p) => p.startsWith("ppt/media/")),
          "Native PPTX contains picture media",
        );
        const xml = parseXml(new TextDecoder().decode(parts.get("ppt/slides/slide1.xml")));
        check(xml.ok, "Malformed native slide");
        const words = [...descendants(xml.root)].filter((e) => e.name === "a:t").map(textContent);
        check(
          EXPECTED_LABELS.every((text) => words.includes(text)),
          "Native text missing",
        );
        check(sha256Hex(bytes) === sha256Hex(expected.value), "Native PPTX differs from source");
        step(`${label}: experimental editable PPTX ${connectors} (sha256 ${sha256Hex(bytes)})`);
      }
    }

    console.log(`\nSmoke test passed: ${basename(tarball)}`);
  } finally {
    if (keep) console.log(`Kept ${root}`);
    else await rm(root, { recursive: true, force: true });
  }
}

const args = Bun.argv.slice(2);
const keep = args.includes("--keep");
const positional = args.filter((a) => a !== "--keep");
if (positional.length !== 1 || positional[0]?.startsWith("-")) {
  console.error("Usage: bun run release:smoke <sumi-<version>-<target>.tar.gz> [--keep]");
  process.exit(2);
}
try {
  await smoke(positional[0] as string, keep);
} catch (error) {
  console.error(`not ok - ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
