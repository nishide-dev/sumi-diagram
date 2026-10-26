/** The syntax of `icon: <set>/<name>` (#94), shared by the figure schema and the icon lookup. */

/** `<set>/<name>`: lowercase letters, digits and inner hyphens. */
export const ICON_REF_PATTERN = /^([a-z][a-z0-9]*)\/([a-z0-9]+(?:-[a-z0-9]+)*)$/;

/** The longest `icon:` value (Tabler's longest name is under 40 characters); keeps typo hints cheap. */
export const ICON_REF_MAX_LENGTH = 80;

/** `tabler/wave-sine` → `{ set: "tabler", name: "wave-sine" }`; `undefined` if malformed. */
export function parseIconRef(ref: string): { set: string; name: string } | undefined {
  if (ref.length > ICON_REF_MAX_LENGTH) return undefined;
  const match = ICON_REF_PATTERN.exec(ref);
  return match === null ? undefined : { set: match[1] as string, name: match[2] as string };
}
