from lib3d import *

def volume_grid(fg, x, y, n, c, cd, P, tone="blue"):
    nx, ny, nz = n
    return fg.cuboid(x, y, nx * c, ny * c, nz * cd, tone, P, grid=(nx, ny, nz))

def build_into(fg, oy, theme_mode="right", angle=45, scale=0.5):
    P = Proj(angle, scale)
    t = fg.t
    c, cd = 5.2, 5.2
    X, Y = 16, oy + 24
    g_in = volume_grid(fg, X, Y, (6, 6, 6), c, cd, P)
    # kernel block: top-right-front corner, 3x3x3 cells
    kw, kd = 3 * c, 3 * cd
    kx, ky = X + 3 * c, Y
    ofill, oline = t["tones"]["orange"]
    # pyramid lines go behind the output volume, in front of the input volume
    X2, Y2 = 100, oy + 24 + 6.5
    c2 = c
    # kernel (drawn after the input)
    gk = fg.cuboid(kx, ky, kw, kw, kd, "orange", P, grid=(3, 3, 3), sw=t["frame_w"])
    # output volume 4x4x4 first, then the cell on top
    # lines (drawn before output so the output hides their ends)
    dxk, dyk = gk["dx"], gk["dy"]
    dxc, dyc = P.off(cd)
    cell = dict(x=X2, y=Y2)
    if theme_mode == "right":  # kernel right face -> output cell left face
        ks = [(kx + kw, ky), (kx + kw + dxk, ky - dyk), (kx + kw + dxk, ky + kw - dyk), (kx + kw, ky + kw)]
        cs = [(X2, Y2), (X2 + dxc, Y2 - dyc), (X2 + dxc, Y2 + c2 - dyc), (X2, Y2 + c2)]
    elif theme_mode == "front":  # front face -> front face (crosses the input volume)
        ks = [(kx, ky), (kx + kw, ky), (kx + kw, ky + kw), (kx, ky + kw)]
        cs = [(X2, Y2), (X2 + c2, Y2), (X2 + c2, Y2 + c2), (X2, Y2 + c2)]
    else:  # tangents: only the silhouette tangents (outer 2 lines)
        ks = [(kx + kw + dxk, ky - dyk), (kx + kw, ky + kw)]
        cs = [(X2 + dxc, Y2 - dyc), (X2, Y2 + c2)]
    for (a, b) in zip(ks, cs):
        fg.line([a, b], color=oline, sw=t["edge_w"], dash="1.8 1.2")
    g_out = fg.cuboid(X2, Y2 - 6.5 + 6.5, 4 * c2, 4 * c2, 4 * cd, "blue", P, grid=(4, 4, 4))
    # output cell highlighted: top-front-left
    fg.cuboid(X2, Y2, c2, c2, cd, "orange", P)
    # dims
    lab = 7
    fg.text(X + 3 * c, Y + 6 * c + 3.4, "W = 6", lab)
    fg.text(X - 2, Y + 3 * c, "H = 6", lab, "end")
    mx, my = X + 6 * c + g_in["dx"] / 2, Y + 6 * c - g_in["dy"] / 2
    fg.text(mx + 1.6, my + 2.2, "D = 6", lab, "start")
    fg.text(X2 + 2 * c2, Y2 + 4 * c2 + 3.4, "4 × 4 × 4", lab)
    fg.text(X + 3 * c, Y + 6 * c + 8.6, "input volume", lab, bold=False, color=t["ink"])
    fg.text(X2 + 2 * c2, Y2 + 4 * c2 + 8.6, "output volume", lab)
    # callouts
    fg.text(kx + kw / 2 + 2, Y - g_in["dy"] - 5.2, "kernel 3 × 3 × 3", lab)
    fg.line([(kx + kw / 2 + 4, Y - g_in["dy"] - 3.0), (kx + kw / 2 + 4 + 0.0, ky - dyk * 0.5 - 0.6)], dash=None, sw=t["edge_w"] * 0.8)
    fg.text(X2 + 6, Y2 - dyc - 10.5, "one output cell", lab)
    fg.line([(X2 + 3.2, Y2 - dyc - 8.2), (X2 + c2 / 2 + 0.6, Y2 - dyc * 0.5 - 0.4)], sw=t["edge_w"] * 0.8)
    return fg

def build(theme, mode="right", angle=45):
    fg = Fig(180, 82, theme)
    build_into(fg, 4, mode, angle)
    return fg

if __name__ == "__main__":
    for th in ["sumi", "paper"]:
        build(th).save(f"conv3d-{th}.svg")
    # variants sheet
    for th in ["sumi"]:
        fg = Fig(180, 3 * 82, th)
        for i, m in enumerate(["right", "front", "tangent"]):
            build_into(fg, i * 82 + 4, m)
            fg.text(4, i * 82 + 8, ["A  kernel right face -> cell left face (4 lines)", "B  front face -> front face (crosses the input)", "C  two silhouette tangents only"][i], 7, "start", bold=True)
        fg.save(f"variants-rf-{th}.svg")
