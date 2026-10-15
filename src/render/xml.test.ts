import { describe, expect, test } from "bun:test";
import { attribute, childElements, classList, parseXml, textContent, type XmlElement } from "./xml";

function parse(text: string): XmlElement {
  const result = parseXml(text);
  if (!result.ok) throw new Error(result.message);
  return result.root;
}

function failure(text: string): string {
  const result = parseXml(text);
  if (result.ok) throw new Error("expected a parse failure");
  return result.message;
}

describe("parseXml", () => {
  test("parses elements, attributes, text, CDATA and comments", () => {
    const root = parse(
      `<?xml version="1.0" encoding="utf-8"?><!-- c --><svg a="1" b='two'><g class=" x  y "><text>hi<![CDATA[ <raw> & ]]></text></g><!-- in --><rect/></svg>\n`,
    );
    expect(root.name).toBe("svg");
    expect(root.attributes).toEqual([
      { name: "a", value: "1" },
      { name: "b", value: "two" },
    ]);
    const [g, rect] = childElements(root);
    expect(g && classList(g)).toEqual(["x", "y"]);
    expect(g && textContent(g)).toBe("hi <raw> & ");
    expect(rect?.name).toBe("rect");
    expect(rect?.children).toEqual([]);
  });

  test("decodes the predefined entities and character references", () => {
    const root = parse(`<t v="&lt;&#34;&apos;&gt;">&amp;&#x9;&#26085;&#x1F600;&quot;</t>`);
    expect(attribute(root, "v")).toBe(`<"'>`);
    expect(textContent(root)).toBe('&\t日😀"');
  });

  test("records source offsets for splicing", () => {
    const text = `<?xml version="1.0"?><svg viewBox="0 0 1 1"><g/></svg>`;
    const root = parse(text);
    expect(text.slice(root.start, root.startTagEnd)).toBe(`<svg viewBox="0 0 1 1">`);
    expect(text.slice(root.startTagEnd, root.end)).toBe("<g/></svg>");
    const [g] = childElements(root);
    expect(g && text.slice(g.start, g.end)).toBe("<g/>");
  });

  test("handles deep nesting without recursion", () => {
    const depth = 100_000;
    const root = parse(`${"<g>".repeat(depth)}${"</g>".repeat(depth)}`);
    expect(root.name).toBe("g");
  });

  describe("rejects unsafe constructs", () => {
    test("document type declarations (XXE, entity expansion)", () => {
      const billionLaughs = `<?xml version="1.0"?>
<!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;">]>
<svg>&lol2;</svg>`;
      expect(failure(billionLaughs)).toContain("DOCTYPE");
      const xxe = `<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg>&xxe;</svg>`;
      expect(failure(xxe)).toContain("DOCTYPE");
      expect(failure(`<svg><!DOCTYPE x></svg>`)).toContain("Markup declarations");
      expect(failure(`<svg><!ENTITY x "y"></svg>`)).toContain("Markup declarations");
    });

    test("undefined entities", () => {
      expect(failure(`<svg>&xxe;</svg>`)).toContain('Undefined entity "&xxe;"');
      expect(failure(`<svg a="&nbsp;"/>`)).toContain("Undefined entity");
      expect(failure(`<svg>& </svg>`)).toContain("entity");
    });

    test("processing instructions", () => {
      expect(failure(`<?xml-stylesheet href="x.css"?><svg/>`)).toContain("Processing instructions");
      expect(failure(`<svg><?php echo 1 ?></svg>`)).toContain("Processing instructions");
    });

    test("invalid character references", () => {
      expect(failure(`<svg>&#0;</svg>`)).toContain("not a valid XML character");
      expect(failure(`<svg>&#xD800;</svg>`)).toContain("not a valid XML character");
    });
  });

  describe("rejects malformed documents with a position", () => {
    const cases: [string, string, string][] = [
      ["mismatched tags", "<svg><g></svg>", "Expected </g>"],
      ["unclosed element", "<svg><g>", "Unclosed element"],
      ["unterminated start tag", "<svg", "Unterminated start tag"],
      ["duplicate attributes", `<svg a="1" a="2"/>`, "Duplicate attribute"],
      ["unquoted attribute", "<svg a=1/>", "quoted value"],
      ["'<' in an attribute", `<svg a="<"/>`, "'<' is not allowed"],
      ["missing whitespace between attributes", `<svg a="1"b="2"/>`, "whitespace"],
      ["content after the root", "<svg/><svg/>", "after the root"],
      ["text after the root", "<svg/>x", "after the root"],
      ["no root", "  ", "Expected a root element"],
      ["text before the root", "x<svg/>", "Expected a root element"],
      ["bad comment", "<svg><!-- a -- b --></svg>", "--"],
      ["unterminated CDATA", "<svg><![CDATA[x</svg>", "CDATA"],
      ["']]>' in text", "<svg>]]></svg>", "]]>"],
      ["invalid name", "<1svg/>", "Expected a name"],
    ];
    for (const [name, text, message] of cases) {
      test(name, () => {
        const result = parseXml(text);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.message).toContain(message);
        expect(result.line).toBeGreaterThanOrEqual(1);
        expect(result.column).toBeGreaterThanOrEqual(1);
      });
    }

    test("reports line and column", () => {
      const result = parseXml("<svg>\n  <g>\n  </h>\n</svg>");
      expect(result).toMatchObject({ ok: false, line: 3, column: 3 });
    });
  });
});
