import { expect, test } from "bun:test";
import { descriptionHtml } from "./description";

test("descriptions allow only exact inline code tags", () => {
  expect(
    descriptionHtml('<code>src & value</code> <img onerror="alert(1)"> <script>alert(1)</script>'),
  ).toBe(
    "<code>src &amp; value</code> &lt;img onerror=&quot;alert(1)&quot;&gt; &lt;script&gt;alert(1)&lt;/script&gt;",
  );
  expect(descriptionHtml('<code onclick="x">bad</code> &lt;code&gt;x&lt;/code&gt;')).toBe(
    "&lt;code onclick=&quot;x&quot;&gt;bad&lt;/code&gt; &amp;lt;code&amp;gt;x&amp;lt;/code&amp;gt;",
  );
});
