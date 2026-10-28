/**
 * Component Registry (design doc §3): registers, lists and resolves component
 * manifests, and validates how an element uses a component.
 *
 * All methods are synchronous; only `register` changes state, and only the
 * instance's own; a sealed registry (see {@link Registry.seal}) rejects it.
 * Diagnostics carry paths relative to what was checked (the manifest, or the
 * element's `props` / `variant`); the `component` stage prefixes them with
 * the element's path.
 */

import type { z } from "zod";
import { type Diagnostic, type DocPath, didYouMean, formatDocPath } from "../diagnostics";
import { getOutlineRenderer } from "../outline";
import type { Result } from "../result";
import { propsJsonSchema } from "./catalog";
import {
  BUILTIN_NAMESPACE,
  type ComponentId,
  type ComponentKind,
  type ComponentManifest,
  ComponentManifestSchema,
  componentId,
  type ManifestOf,
} from "./manifest";

/** How an element uses a component. Omitted fields take their defaults. */
export interface ComponentUsage {
  props?: unknown;
  variant?: string;
}

/** A valid usage: the variant and the props with manifest defaults applied. */
export interface ValidatedUsage {
  variant: string;
  props: Record<string, unknown>;
}

export class Registry {
  readonly #manifests = new Map<ComponentId, ComponentManifest>();
  #sealed = false;

  /** Whether {@link Registry.seal} has been called. */
  get sealed(): boolean {
    return this.#sealed;
  }

  /**
   * Makes the registry read-only so one instance can be shared: later
   * `register` calls throw, and the declarative data of every registered
   * manifest is deep-frozen. The `props` Zod schema is not frozen (freezing
   * Zod internals is unsafe); it is shared by reference with the source
   * manifest and every other registry built from it, so callers must treat
   * it as immutable, as they already had to. Returns the registry.
   */
  seal(): this {
    for (const manifest of this.#manifests.values()) freezeManifest(manifest);
    this.#sealed = true;
    return this;
  }

  /**
   * Validates `manifest` and adds it. Fails with `component/invalid-manifest`
   * if it is malformed, or `component/duplicate-id` if its canonical ID is
   * already registered. Throws if the registry is sealed.
   */
  register(manifest: ComponentManifest): Result<ComponentManifest> {
    if (this.#sealed) throw new Error("internal error: cannot register into a sealed registry");
    const parsed = ComponentManifestSchema.safeParse(manifest);
    const name = describeManifest(manifest);
    if (!parsed.success) {
      return {
        ok: false,
        diagnostics: parsed.error.issues.map((issue) => {
          const path = issue.path.filter((s) => typeof s !== "symbol");
          return error(
            "component/invalid-manifest",
            `Invalid component manifest ${name}: ${formatDocPath(path)}: ${issue.message}.`,
            path,
          );
        }),
      };
    }
    const value = parsed.data;
    try {
      propsJsonSchema(value.props);
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      return {
        ok: false,
        diagnostics: [
          error(
            "component/invalid-manifest",
            `Invalid component manifest ${name}: props cannot be expressed as JSON Schema (${reason}).`,
            ["props"],
          ),
        ],
      };
    }
    if (value.kind === "node" && value.render !== undefined) {
      const renderer = getOutlineRenderer(value.render.renderer);
      if (renderer === undefined) {
        return {
          ok: false,
          diagnostics: [
            error(
              "component/invalid-manifest",
              `Invalid component manifest ${name}: unknown outline renderer "${value.render.renderer}".`,
              ["render", "renderer"],
            ),
          ],
        };
      }
      const params = renderer.params.safeParse(value.render.params ?? {});
      if (!params.success) {
        return {
          ok: false,
          diagnostics: params.error.issues.map((issue) => {
            const path = ["render", "params", ...issue.path.filter((s) => typeof s !== "symbol")];
            return error(
              "component/invalid-manifest",
              `Invalid component manifest ${name}: ${formatDocPath(path)}: ${issue.message}.`,
              path,
            );
          }),
        };
      }
      value.render = { ...value.render, params: params.data };
    }
    const id = componentId(value);
    if (this.#manifests.has(id)) {
      return {
        ok: false,
        diagnostics: [error("component/duplicate-id", `Component ${id} is already registered.`)],
      };
    }
    this.#manifests.set(id, value);
    return { ok: true, value, diagnostics: [] };
  }

  /** Looks up a manifest by canonical ID (no short names, no diagnostics). */
  get(id: string): ComponentManifest | undefined {
    return this.#manifests.get(id as ComponentId);
  }

  /** All manifests in registration order, optionally of one kind. */
  list<K extends ComponentKind>(options: { kind?: K | undefined } = {}): ManifestOf<K>[] {
    const all = [...this.#manifests.values()];
    const { kind } = options;
    return (kind === undefined ? all : all.filter((m) => m.kind === kind)) as ManifestOf<K>[];
  }

  /**
   * Resolves a component reference — a short name (`box`, built-in namespace
   * only) or a canonical ID (`sumi/box`) — to its manifest, checking its kind
   * if given. Fails with `component/unknown` or `component/wrong-kind`; a
   * deprecated component resolves with a `component/deprecated` warning.
   */
  resolve<K extends ComponentKind>(ref: string, kind?: K): Result<ManifestOf<K>> {
    const what = kind === undefined ? "component" : `${kind} component`;
    const manifest = this.#manifests.get(canonicalId(ref));
    // Suggest references in the form the user wrote: short names or canonical IDs.
    const candidates = () =>
      this.list({ kind }).map((m) => (ref.includes("/") ? componentId(m) : shortestRef(m)));
    if (manifest === undefined) {
      return {
        ok: false,
        diagnostics: [
          error("component/unknown", `Unknown ${what} "${ref}".`, undefined, {
            hint: didYouMean(ref, candidates()) ?? known(what, candidates()),
          }),
        ],
      };
    }
    if (kind !== undefined && manifest.kind !== kind) {
      return {
        ok: false,
        diagnostics: [
          error(
            "component/wrong-kind",
            `Component "${ref}" (${componentId(manifest)}) is ${article(manifest.kind)} ${manifest.kind} component, but ${article(kind)} ${what} is required here.`,
            undefined,
            { hint: known(what, candidates()) },
          ),
        ],
      };
    }
    const diagnostics: Diagnostic[] = [];
    if (manifest.deprecated !== undefined) {
      const { since, replacement } = manifest.deprecated;
      diagnostics.push({
        code: "component/deprecated",
        severity: "warning",
        message: `Component ${componentId(manifest)} is deprecated since Sumi ${since}.`,
        ...(replacement !== undefined && { hint: `Use "${replacement}" instead.` }),
      });
    }
    return { ok: true, value: manifest as ManifestOf<K>, diagnostics };
  }

  /**
   * Checks an element's `variant` and `props` against `manifest`. Fails with
   * `component/unknown-variant`, `component/unknown-prop` or
   * `component/invalid-prop`; succeeds with the props normalized by the
   * manifest schema (defaults applied).
   */
  validateUsage(manifest: ComponentManifest, usage: ComponentUsage = {}): Result<ValidatedUsage> {
    return validateUsage(manifest, usage);
  }
}

/** Deep-freezes `manifest`, except its `props` schema. */
function freezeManifest(manifest: ComponentManifest): void {
  const seen = new WeakSet<object>();
  for (const [key, value] of Object.entries(manifest)) {
    if (key !== "props") deepFreeze(value, seen);
  }
  Object.freeze(manifest);
}

/**
 * Freezes `value` and everything reachable from it. Already-frozen objects are
 * still traversed (shallow freezing elsewhere must not hide mutable children);
 * `seen` guards against cycles.
 */
function deepFreeze(value: unknown, seen = new WeakSet<object>()): void {
  if (typeof value !== "object" || value === null || seen.has(value)) return;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  Object.freeze(value);
}

/** Canonical ID for a reference (short names map to the built-in namespace). */
function canonicalId(ref: string): ComponentId {
  return ref.includes("/") ? (ref as ComponentId) : `${BUILTIN_NAMESPACE}/${ref}`;
}

/** The shortest reference that resolves to `manifest`. */
function shortestRef(manifest: ComponentManifest): string {
  return manifest.namespace === BUILTIN_NAMESPACE ? manifest.name : componentId(manifest);
}

/** See {@link Registry.validateUsage}. */
export function validateUsage(
  manifest: ComponentManifest,
  usage: ComponentUsage = {},
): Result<ValidatedUsage> {
  const id = componentId(manifest);
  const { props = {}, variant = "default" } = usage;
  const diagnostics: Diagnostic[] = [];

  if (!manifest.variants.includes(variant)) {
    diagnostics.push(
      error("component/unknown-variant", `Unknown variant "${variant}" for ${id}.`, ["variant"], {
        hint:
          didYouMean(variant, manifest.variants) ??
          `Variants of ${id}: ${manifest.variants.join(", ")}.`,
      }),
    );
  }

  // A `__proto__` key (#180, e.g. a matrix class name) would be dropped by
  // the schema without a word: reject it where it is written.
  const reserved = reservedKeyPaths(props);
  for (const path of reserved) {
    diagnostics.push(
      error(
        "component/invalid-prop",
        `Invalid prop "${formatDocPath(path)}" for ${id}: "__proto__" is reserved and cannot be used as a name.`,
        ["props", ...path],
        { hint: "Use another name." },
      ),
    );
  }
  if (reserved.length > 0) return { ok: false, diagnostics };

  const parsed = manifest.props.safeParse(props);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) diagnostics.push(...propIssue(manifest, issue));
  }

  if (!parsed.success || diagnostics.length > 0) return { ok: false, diagnostics };
  return { ok: true, value: { variant, props: parsed.data }, diagnostics };
}

/** The paths of every own `__proto__` key in written props (objects and lists, deeply). */
function reservedKeyPaths(value: unknown, path: (string | number)[] = []): (string | number)[][] {
  if (Array.isArray(value)) return value.flatMap((item, i) => reservedKeyPaths(item, [...path, i]));
  if (value === null || typeof value !== "object") return [];
  const found: (string | number)[][] = [];
  if (Object.hasOwn(value, "__proto__")) found.push([...path, "__proto__"]);
  for (const [key, child] of Object.entries(value))
    found.push(...reservedKeyPaths(child, [...path, key]));
  return found;
}

function propIssue(manifest: ComponentManifest, issue: z.core.$ZodIssue): Diagnostic[] {
  const id = componentId(manifest);
  const path = ["props", ...issue.path.filter((s) => typeof s !== "symbol")];
  if (issue.code === "unrecognized_keys") {
    const known = Object.keys(manifest.props.shape);
    return issue.keys.map((key) =>
      error("component/unknown-prop", `Unknown prop "${key}" for ${id}.`, [...path, key], {
        hint:
          known.length === 0
            ? `${id} takes no props.`
            : (didYouMean(key, known) ?? `Props of ${id}: ${known.join(", ")}.`),
      }),
    );
  }
  const subject = path.length > 1 ? `prop "${formatDocPath(path.slice(1))}"` : "props";
  const message = issue.message.replace(/\.$/, "");
  // Prop schemas may pass a hint through custom issue params (see SizeLength).
  const hint = issue.code === "custom" ? issue.params?.hint : undefined;
  return [
    error("component/invalid-prop", `Invalid ${subject} for ${id}: ${message}.`, path, {
      ...(typeof hint === "string" && { hint }),
    }),
  ];
}

function error(
  code: string,
  message: string,
  path?: DocPath,
  details: Pick<Diagnostic, "hint"> = {},
): Diagnostic {
  return {
    code,
    severity: "error",
    message,
    ...(path !== undefined && { path }),
    ...(details.hint !== undefined && { hint: details.hint }),
  };
}

function known(what: string, candidates: string[]): string {
  return candidates.length === 0
    ? `No ${what}s are registered.`
    : `Known ${what}s: ${candidates.join(", ")}.`;
}

function article(word: string): string {
  return /^[aeiou]/.test(word) ? "an" : "a";
}

function describeManifest(manifest: unknown): string {
  if (typeof manifest !== "object" || manifest === null) return "(not an object)";
  const { namespace, name } = manifest as { namespace?: unknown; name?: unknown };
  return typeof namespace === "string" && typeof name === "string"
    ? `${namespace}/${name}`
    : "(unnamed)";
}
