# Run 8 method-taxonomy (S)

Start: 2026-11-14 03:00:54

## Plan

- Request: graph representation learning taxonomy (spectral / spatial / attention / self-supervised), overlaps, 2-3 methods per family. paper-double, theme sumi.
- Layout: started from `layouts/set-taxonomy` (four overlapping ellipses in a row): matches structure directly.
- Chain order Spectral - Spatial - Attention - Self-supervised so each neighbour pair has a real overlap method:
  GCN (spectral approximation run as spatial aggregation), GAT (attention-weighted spatial), GraphMAE (masked autoencoder pre-training with a GAT encoder).
- Singles: Spectral CNN, ChebNet | GraphSAGE, GIN | Graph Transformer, Graphormer | DGI, GraphCL.
  Method names are my choice of well-known representatives (the request asked for examples); the request's own example (attention-using spatial) = GAT.
- Visual language: family = ellipse set, one tone each (blue/green/orange/purple as in layout); method = outlined box; overlap method = emphasis box; legend below.
- Mockup: yes — the Skill requires one for sets/taxonomies even when the layout is copied.
- Checklist: 4 families with defining idea; 6 single methods; 3 overlap methods in the right overlaps; legend.
- Mockup round 1: left ellipse clipped (mockup page offset), SSL title wrapped to 3 lines -> shortened to "pretext objectives", page shifted. Round 2 passes the checklist. Centre of each ellipse is empty (inherited from the layout; it's the space between the two single methods).

## Rounds

- draft1 (layout labels swapped in): 1 error geometry/label-overflow (GraphMAE in the layout's 37pt overlap box), 4 warnings set-outline-crosses-node/text ("Graph Transformer" too wide; ellipses grew unevenly).
- Overlap boxes 46pt; singles given one width so every ellipse fits the same: 76pt -> too wide (189mm); 56pt + "Graph\nTransformer" -> 180.8mm; 52pt, rows moved inward (y 25/47) -> fits, 1 warning, but the attention ellipse taller (two-line box) and titles uneven; fixed height 26pt for all -> ellipses wider, crossing warnings.
- Replaced "Graph Transformer" by GraphGPS (my own choice of representative; one-line name keeps every box and ellipse the same size). 54pt singles -> 0/0/0. "learned neighbour weights" -> "learned edge weights" (titles almost touched).
- 55pt / 57pt to give "Spectral CNN" more padding exceed 180mm -> back to 54pt.
- Critique vs set-taxonomy + llada (compare script, self-review): one vocabulary, short text, sizes uniform. Kept: centre of each ellipse empty (inherent to two singles per family + overlaps on the sides), four hues (one per family, as the layout; lint did not flag), "Spectral CNN" tight in its box.

## Result

- Layout: set-taxonomy. Mockup: yes (2 rounds).
- Renders: 13 Sumi renders of draft/figure (plus 1 render of the unmodified layout to read its size, 2 mockup screenshots).
- Final lint (lint --geometry): 0 errors, 0 warnings, 0 infos. 179.74mm x 72.32mm, paper-double, theme sumi.
- Hard: the set fit grows the ellipse from member bboxes, so box widths, row positions and the 180mm budget interact; ellipse size and equality were controlled only indirectly (minWidth only grows). Label width vs. box width had to be tuned by trial (no auto-width for a uniform group).
- Sumi could not express: a fixed ellipse size/centre independent of members (minWidth is a minimum only); "same width for all boxes of a kind" without repeating width on each node.
- Content note: method names (Spectral CNN, ChebNet, GCN, GraphSAGE, GIN, GAT, GraphGPS, Graphormer, GraphMAE, DGI, GraphCL) are my picks of representatives; the chain order forces SSL to overlap only attention (GraphMAE, GAT encoder) — SSL is orthogonal to architecture in reality, which a 4-ellipse chain can't show fully.

End: 2026-11-14 03:04:25
