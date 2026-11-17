import { expect, test } from "bun:test";
import { cuboid } from "../../core/outline/cuboid";
import { leaveFace } from "./face-exit";

const drawing = cuboid.draw(
  { x: 0, y: 0, width: 100, height: 80 },
  cuboid.params.parse({ depth: 40, ports: "face" }),
);
const faces = Object.values(drawing.faces ?? {});
const east = drawing.faceContacts?.east as { x: number; y: number };
const out = { x: 400, y: east.y };

test("a line leaving the side face through the silhouette starts at the exit", () => {
  const trimmed = leaveFace(faces, drawing.outline, east, [east, out]);
  expect(trimmed).toHaveLength(2);
  expect(trimmed?.[0]?.x).toBeGreaterThan(east.x);
  expect(trimmed?.[1]).toEqual(out);
});

test("a line leaving across the edge shared with another face, or the front, is rejected", () => {
  // Steeply up from the side face's centre: it exits through the edge it shares with the top face.
  expect(
    leaveFace(faces, drawing.outline, east, [east, { x: east.x + 5, y: -200 }]),
  ).toBeUndefined();
  // Back to the left: across the front face.
  expect(leaveFace(faces, drawing.outline, east, [east, { x: -200, y: east.y }])).toBeUndefined();
});

test("what follows the exit is kept for the caller to check (a curve that comes back)", () => {
  const back = [east, out, { x: 300, y: east.y + 10 }, { x: 60, y: east.y }];
  const trimmed = leaveFace(faces, drawing.outline, east, back);
  expect(trimmed?.slice(1)).toEqual(back.slice(1));
});

test("a line that never leaves the face is rejected", () => {
  expect(
    leaveFace(faces, drawing.outline, east, [east, { x: east.x + 0.1, y: east.y }]),
  ).toBeUndefined();
});
