import { copyFile, mkdir } from "node:fs/promises";
import { dirname, posix, resolve } from "node:path";
import { decodeHTML } from "entities";

const site = "https://nishide-dev.github.io/sumi-diagram/";
const github = "https://github.com/nishide-dev/sumi-diagram/blob/main/";
const escapeAttr = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
const relative = (url: string) => !/^(?:[a-z][\w+.-]*:|\/\/|\/|#)/i.test(url);

export async function readmeHtml(markdown: string, readme: string, root: string, out: string) {
  let html = Bun.markdown.html(markdown);
  html = html.replace(/^\s*<h1>\s*Sumi\s*<\/h1>\s*/i, "");
  // Only remove a standalone navigation paragraph near the top, never prose containing links.
  let paragraphs = 0;
  html = html.replace(/<p>([\s\S]*?)<\/p>/gi, (whole, body: string) => {
    if (++paragraphs > 4) return whole;
    const links = [...body.matchAll(/<a\s+[^>]*href="([^"]+)"[^>]*>[\s\S]*?<\/a>/gi)];
    const rest = body
      .replace(/<a\s+[^>]*href="[^"]+"[^>]*>[\s\S]*?<\/a>/gi, "")
      .replace(/[\s|·・/—–-]|&nbsp;/g, "");
    if (!links.length || rest) return whole;
    return links.every((m) => {
      const href = decodeHTML(m[1] ?? "");
      return (
        href.startsWith(site) ||
        (relative(href) && /(?:^|\/)README(?:-ja)?\.md(?:#.*)?$/i.test(href))
      );
    })
      ? ""
      : whole;
  });
  // A leading paragraph that is only bold text is the tagline.
  html = html.replace(/^\s*<p><strong>([^<]*)<\/strong><\/p>/i, '<p class="tagline">$1</p>');
  // A table whose header cells are all empty has no header (GitHub draws an empty row).
  html = html.replace(/<thead>\s*<tr>(?:\s*<th[^>]*>\s*<\/th>)+\s*<\/tr>\s*<\/thead>\s*/gi, "");
  html = html.replace(
    /<p>\s*(<(?:picture|details|table|div|figure)\b[\s\S]*?<\/(?:picture|details|table|div|figure)>)\s*<\/p>/gi,
    "$1",
  );
  const pending: Promise<void>[] = [];
  const image = (raw: string) => {
    const value = decodeHTML(raw);
    if (!relative(value)) return raw;
    const [path, suffix = ""] = value.split(/(?=[?#])/s, 2);
    const resolved = posix.normalize(posix.join(posix.dirname(readme), path ?? ""));
    if (resolved === ".." || resolved.startsWith("../"))
      throw new Error(`Image outside repository: ${value}`);
    const target = resolve(out, "readme", resolved);
    pending.push(
      mkdir(dirname(target), { recursive: true }).then(() =>
        copyFile(resolve(root, resolved), target),
      ),
    );
    return escapeAttr(`./readme/${resolved}${suffix}`);
  };
  html = html.replace(/<(img|source)\b[^>]*>/gi, (tag: string) =>
    tag.replace(/\b(src|srcset)="([^"]*)"/gi, (_m, attr: string, value: string) => {
      const rewritten =
        attr.toLowerCase() === "srcset"
          ? value
              .split(",")
              .map((item) => item.trim().replace(/^(\S+)/, image))
              .join(", ")
          : image(value);
      return `${attr}="${rewritten}"`;
    }),
  );
  html = html.replace(/<picture\b[^>]*>([\s\S]*?)<\/picture>/gi, (whole, content: string) => {
    const dark = content.match(
      /<source\b(?=[^>]*media="\(prefers-color-scheme:\s*dark\)")(?=[^>]*srcset="([^"]+)")[^>]*>/i,
    );
    const light = content.match(/<img\b[^>]*>/i);
    if (!dark || !light || !dark[1]) return whole;
    const darkSrc = dark[1].split(",")[0]?.trim().split(/\s+/)[0];
    if (!darkSrc) return whole;
    const darkImg = light[0]
      .replace(/\bsrc="[^"]*"/i, `src="${darkSrc}"`)
      .replace(/<img\b/i, '<img class="readme-dark"');
    return `<span class="readme-picture">${light[0].replace(/<img\b/i, '<img class="readme-light"')}${darkImg}</span>`;
  });
  html = html.replace(/<a\b[^>]*>/gi, (tag: string) => {
    let external = false;
    const result = tag.replace(/\bhref="([^"]*)"/i, (_m, raw: string) => {
      let href = decodeHTML(raw);
      if (href.startsWith(site)) {
        const fragment = href.slice(site.length);
        if (!fragment || /^#(?:home|examples|components|prompt)$/.test(fragment))
          href = fragment || "#home";
      } else if (relative(href)) {
        const [path, suffix = ""] = href.split(/(?=[?#])/s, 2);
        href = github + posix.normalize(posix.join(posix.dirname(readme), path ?? "")) + suffix;
      }
      external = /^(?:https?:)?\/\//i.test(href);
      return `href="${escapeAttr(href)}"`;
    });
    return external
      ? result
          .replace(/\s(?:target|rel)="[^"]*"/gi, "")
          .replace(/>$/, ' target="_blank" rel="noreferrer">')
      : result;
  });
  await Promise.all(pending);
  // README is trusted repository content, but scripts must not execute in the site.
  html = await new HTMLRewriter()
    .on("script, iframe, object, embed", {
      element(el) {
        el.remove();
      },
    })
    .on("*", {
      element(el) {
        for (const [name, value] of el.attributes)
          if (
            /^on/i.test(name) ||
            (/^(href|src|srcset)$/i.test(name) && /^\s*javascript:/i.test(value))
          )
            el.removeAttribute(name);
      },
    })
    .transform(new Response(html))
    .text();
  return html;
}
