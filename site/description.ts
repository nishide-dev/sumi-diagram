export function descriptionHtml(text: string): string {
  return text
    .replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c)
    .replace(/&lt;code&gt;([^<]*?)&lt;\/code&gt;/g, "<code>$1</code>");
}
