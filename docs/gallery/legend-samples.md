# Legend samples

[Gallery](README.md) · [Examples](examples.md) · [Legend samples](legend-samples.md) · [Themes](themes.md) · [Tones](tones.md) · [Dimmed groups](dim.md) · [Node glyphs](glyphs.md) · [Set enclosures](sets.md) · [Stroke options](strokes.md) · [Palettes](palettes.md) · [Profiles and comparison](compare.md)

This contrastive\-learning sketch compares document features with related and unrelated attributes\. The legend identifies the document, title and abstract icons, their feature\-vector glyphs, positive and negative double\-arrow pairs, and the set enclosing related items\. Entries are arranged with <code>flow: row</code>, wrapped by <code>perRow</code> and grouped by <code>heading</code>; <code>labelAt: left</code> puts text before a sample\. Each sample follows the figure's theme\.

| <code>minimal</code> | <code>academic</code> | <code>slides</code> | <code>color</code> | <code>paper</code> | <code>llama</code> |
| --- | --- | --- | --- | --- | --- |
| <img src="legend-samples/legend-samples.minimal.svg" alt="legend samples, theme minimal"> | <img src="legend-samples/legend-samples.academic.svg" alt="legend samples, theme academic"> | <img src="legend-samples/legend-samples.slides.svg" alt="legend samples, theme slides"> | <img src="legend-samples/legend-samples.color.svg" alt="legend samples, theme color"> | <img src="legend-samples/legend-samples.paper.svg" alt="legend samples, theme paper"> | <img src="legend-samples/legend-samples.llama.svg" alt="legend samples, theme llama"> |
| <code>sumi render legend\-samples\.sumi\.yaml</code><br>87\.84mm × 78\.32mm \(max width 180mm, max height 220mm\) | <code>sumi render legend\-samples\.sumi\.yaml \-\-theme academic</code><br>87\.84mm × 78\.32mm \(max width 180mm, max height 220mm\) | <code>sumi render legend\-samples\.sumi\.yaml \-\-theme slides</code><br>166\.16mm × 125\.06mm \(max width 180mm, max height 220mm\) | <code>sumi render legend\-samples\.sumi\.yaml \-\-theme color</code><br>87\.84mm × 78\.32mm \(max width 180mm, max height 220mm\) | <code>sumi render legend\-samples\.sumi\.yaml \-\-theme paper</code><br>79\.38mm × 78\.32mm \(max width 180mm, max height 220mm\) | <code>sumi render legend\-samples\.sumi\.yaml \-\-theme llama</code><br>79\.38mm × 78\.32mm \(max width 180mm, max height 220mm\) |

<details>
<summary>Source: <code>legend-samples.sumi.yaml</code></summary>

```yaml
# Contrastive learning compares document features with related and unrelated attributes.
version: 1
figure:
  id: gallery-legend-samples
  title: Legend samples
  theme: minimal
  profile: paper-double
  layout:
    arrange:
      stack:
        gap: 6mm
        align: center
        items:
          - row: { gap: 18mm, align: center, items: [paper, title] }
          - row: { gap: 18mm, align: center, items: [other, abstract] }
          - key

nodes:
  - { id: paper, component: label, icon: tabler/file-text, iconSize: 1.5, glyphs: [{ kind: vector, tone: blue, strength: solid, dx: 0, dy: -0.6 }] }
  - { id: title, component: label, icon: tabler/letter-t, iconSize: 1.5, glyphs: [{ kind: vector, tone: yellow, strength: solid, dx: 0, dy: -0.6 }] }
  - { id: other, component: label, icon: tabler/file-text, iconSize: 1.5, glyphs: [{ kind: vector, tone: blue, strength: solid, dx: 0, dy: -0.6 }] }
  - { id: abstract, component: label, icon: tabler/menu-2, iconSize: 1.5, glyphs: [{ kind: vector, tone: orange, strength: solid, dx: 0, dy: -0.6 }] }
  - id: key
    component: legend
    variant: plain
    props:
      flow: row
      perRow: 2
      entries:
        - { heading: "Nodes:", icon: tabler/file-text, iconSize: 1.5, labelAt: left, label: Document }
        - { icon: tabler/letter-t, iconSize: 1.5, labelAt: left, label: Title }
        - { icon: tabler/menu-2, iconSize: 1.5, labelAt: left, label: Abstract }
        - { heading: "Features:", glyph: { kind: vector, tone: blue, strength: solid }, labelAt: left, label: Document }
        - { glyph: { kind: vector, tone: yellow, strength: solid }, labelAt: left, label: Title }
        - { glyph: { kind: vector, tone: orange, strength: solid }, labelAt: left, label: Abstract }
        - { heading: "Relations:", edge: { component: double-arrow, tone: blue }, label: Positive pair }
        - { edge: { component: double-arrow, variant: dashed, tone: red }, label: Negative pair }
        - { set: { tone: green }, label: Related items }

edges:
  - { from: paper, to: title, component: double-arrow, tone: blue }
  - { from: other, to: abstract, component: double-arrow, variant: dashed, tone: red }

sets:
  - { id: entities, members: [paper, title], shape: ellipse, tone: green, padding: 7mm }
```

</details>
