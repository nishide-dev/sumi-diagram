# Palettes

[Gallery](README.md) · [Examples](examples.md) · [Themes](themes.md) · [Tones](tones.md) · [Dimmed groups](dim.md) · [Node glyphs](glyphs.md) · [Set enclosures](sets.md) · [Palettes](palettes.md) · [Profiles and comparison](compare.md)

<code>figure\.themeOverrides\.palette: &lt;name&gt;</code> recolors a theme with four colors from a popular Color Hunt palette: panels \(group fill\) take the palest, filled and tinted nodes and the <code>gray</code> tone the tint, emphasis the accent, and text, frames and edges the ink \(the darkest color, darkened to 9:1 on white when it is paler\)\. Every text keeps at least 4\.5:1 on the fill it sits on, so the same figure reads in each palette; the other tones, sizes and fonts stay the theme's \(the legend's green is the theme's\)\. The figure is the same in every palette: only <code>palette</code> changes in the source\. Colors: Color Hunt popular palettes, retrieved 2026\-11\-08\. <code>sumi catalog \-\-section palettes</code> lists them\.

| palette | colors as published | roles | derived or adjusted |
| --- | --- | --- | --- |
| <code>cool\-blue</code> | <code>\#f9f7f7</code><br><code>\#dbe2ef</code><br><code>\#3f72af</code><br><code>\#112d4e</code> | <code>panel \#f9f7f7</code><br><code>tint \#dbe2ef</code><br><code>accent \#3f72af</code><br><code>ink \#112d4e</code><br><code>muted \#607288</code><br><code>strong \#4d627a</code> | muted, strong |
| <code>slate</code> | <code>\#27374d</code><br><code>\#526d82</code><br><code>\#9db2bf</code><br><code>\#dde6ed</code> | <code>panel \#dde6ed</code><br><code>tint \#9db2bf</code><br><code>accent \#526d82</code><br><code>ink \#27374d</code><br><code>muted \#5b6778</code><br><code>strong \#5b6778</code> | muted, strong |
| <code>coral</code> | <code>\#fff5e4</code><br><code>\#ffe3e1</code><br><code>\#ffd1d1</code><br><code>\#ff9494</code> | <code>panel \#fff5e4</code><br><code>tint \#ffe3e1</code><br><code>accent \#cb4b4b</code><br><code>ink \#663b3b</code><br><code>muted \#896868</code><br><code>strong \#886666</code> | ink, accent, muted, strong |
| <code>terracotta</code> | <code>\#7d5a50</code><br><code>\#b4846c</code><br><code>\#e5b299</code><br><code>\#fcdec0</code> | <code>panel \#fcdec0</code><br><code>tint \#e5b299</code><br><code>accent \#9c6950</code><br><code>ink \#5d433b</code><br><code>muted \#755f58</code><br><code>strong \#755f58</code> | ink, accent, muted, strong |
| <code>sage</code> | <code>\#f8ede3</code><br><code>\#bdd2b6</code><br><code>\#a2b29f</code><br><code>\#798777</code> | <code>panel \#f8ede3</code><br><code>tint \#bdd2b6</code><br><code>accent \#5a7e4e</code><br><code>ink \#434a41</code><br><code>muted \#696e67</code><br><code>strong \#696e67</code> | ink, accent, muted, strong |
| <code>lavender</code> | <code>\#f4eeff</code><br><code>\#dcd6f7</code><br><code>\#a6b1e1</code><br><code>\#424874</code> | <code>panel \#f4eeff</code><br><code>tint \#dcd6f7</code><br><code>accent \#5d71c8</code><br><code>ink \#404671</code><br><code>muted \#666b8d</code><br><code>strong \#666b8d</code> | ink, accent, muted, strong |
| <code>cyan\-pink</code> | <code>\#364f6b</code><br><code>\#3fc1c9</code><br><code>\#f5f5f5</code><br><code>\#fc5185</code> | <code>panel \#f5f5f5</code><br><code>tint \#50c7ce</code><br><code>accent \#ca476f</code><br><code>ink \#334a65</code><br><code>muted \#607287</code><br><code>strong \#5e7085</code> | ink, tint, accent, muted, strong |
| <code>seafoam</code> | <code>\#ffb6b9</code><br><code>\#fae3d9</code><br><code>\#bbded6</code><br><code>\#61c0bf</code> | <code>panel \#fae3d9</code><br><code>tint \#bbded6</code><br><code>accent \#ca494e</code><br><code>ink \#284f4e</code><br><code>muted \#4d6d6c</code><br><code>strong \#4d6d6c</code> | ink, accent, muted, strong |

| <code>cool\-blue</code> | <code>slate</code> | <code>coral</code> | <code>terracotta</code> | <code>sage</code> | <code>lavender</code> | <code>cyan\-pink</code> | <code>seafoam</code> |
| --- | --- | --- | --- | --- | --- | --- | --- |
| <img src="palettes/palettes.cool-blue.svg" alt="one figure, palette cool-blue"> | <img src="palettes/palettes.slate.svg" alt="one figure, palette slate"> | <img src="palettes/palettes.coral.svg" alt="one figure, palette coral"> | <img src="palettes/palettes.terracotta.svg" alt="one figure, palette terracotta"> | <img src="palettes/palettes.sage.svg" alt="one figure, palette sage"> | <img src="palettes/palettes.lavender.svg" alt="one figure, palette lavender"> | <img src="palettes/palettes.cyan-pink.svg" alt="one figure, palette cyan-pink"> | <img src="palettes/palettes.seafoam.svg" alt="one figure, palette seafoam"> |
| <code>themeOverrides\.palette: cool\-blue</code><br>174\.1mm × 49\.74mm \(max width 180mm, max height 220mm\) | <code>themeOverrides\.palette: slate</code><br>174\.1mm × 49\.74mm \(max width 180mm, max height 220mm\) | <code>themeOverrides\.palette: coral</code><br>174\.1mm × 49\.74mm \(max width 180mm, max height 220mm\) | <code>themeOverrides\.palette: terracotta</code><br>174\.1mm × 49\.74mm \(max width 180mm, max height 220mm\) | <code>themeOverrides\.palette: sage</code><br>174\.1mm × 49\.74mm \(max width 180mm, max height 220mm\) | <code>themeOverrides\.palette: lavender</code><br>174\.1mm × 49\.74mm \(max width 180mm, max height 220mm\) | <code>themeOverrides\.palette: cyan\-pink</code><br>174\.1mm × 49\.74mm \(max width 180mm, max height 220mm\) | <code>themeOverrides\.palette: seafoam</code><br>174\.1mm × 49\.74mm \(max width 180mm, max height 220mm\) |

<details>
<summary>Source: <code>palette.sumi.yaml</code></summary>

```yaml
# One figure in every built-in palette. Generated by `bun run gallery` (#417).
version: 1
figure:
  id: gallery-palette
  title: Palette
  theme: paper
  profile: paper-double
  themeOverrides:
    palette: cool-blue
  layout:
    arrange:
      row:
        gap: 9mm
        align: center
        items: [input, encoder, head, out, key]

groups:
  - id: encoder
    caption: Encoder
    arrange: { row: { gap: 7mm, items: [embed, attn, ffn] } }

nodes:
  - { id: input, component: box, label: Input }
  - { id: embed, component: box, label: Embed }
  - { id: attn, component: box, label: Attention, variant: solid }
  - { id: ffn, component: box, label: FFN, variant: filled }
  - { id: head, component: box, label: Head, variant: emphasis }
  - { id: out, component: box, label: Output, variant: outlined }
  - id: key
    component: legend
    props:
      entries:
        - { node: {}, label: default }
        - { node: { variant: solid }, label: solid }
        - { node: { variant: tinted }, label: tinted }
        - { node: { variant: filled }, label: filled }
        - { node: { variant: outlined }, label: outlined }
        - { node: { variant: emphasis }, label: emphasis }
        - { node: { variant: muted }, label: muted }
        - { node: { tone: green }, label: tone green }
        - { edge: { variant: emphasis }, label: emphasis edge }

edges:
  - { from: input, to: embed }
  - { from: embed, to: attn }
  - { from: attn, to: ffn }
  - { from: ffn, to: head, variant: emphasis }
  - { from: head, to: out }

sets:
  - { id: decoder, label: Decoder, members: [head, out], shape: rect, labelAt: bottom }
```

</details>
