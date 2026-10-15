/**
 * Component Registry (design doc §3): registers, lists and resolves component
 * manifests, and validates how an element uses a component.
 *
 * All methods are synchronous; only `register` changes state, and only the
 * instance's own. Diagnostics carry paths relative to what was checked (the
 * manifest, or the element's `props` / `variant`); the `component` stage
 * prefixes them with the element's path.
 */

import type { z } from "zod";
import { type Diagnostic, type DocPath, didYouMean, formatDocPath } from "../diagnostics";
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

  /**
   * Validates `manifest` and adds it. Fails with `component/invalid-manifest`
   * if it is malformed, or `component/duplicate-id` if its canonical ID is
   * already registered.
   */
  register(manifest: ComponentManifest): Result<ComponentManifest> {
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

  const parsed = manifest.props.safeParse(props);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) diagnostics.push(...propIssue(manifest, issue));
  }

  if (!parsed.success || diagnostics.length > 0) return { ok: false, diagnostics };
  return { ok: true, value: { variant, props: parsed.data }, diagnostics };
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
