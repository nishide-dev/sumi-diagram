/**
 * The pinned D2 CLI release (design doc §6). Output is only byte-for-byte
 * deterministic within one D2 version, so the backend requires exactly this
 * version and the installer verifies the release tarballs against these
 * checksums (copied from the release's `SHA256SUMS`).
 */

export const D2_VERSION = "0.9.0";

/** Platforms with an official release tarball, as `<process.platform>-<process.arch>`. */
export type D2Platform = "darwin-arm64" | "darwin-x64" | "linux-arm64" | "linux-x64";

export interface D2ReleaseAsset {
  /** Asset file name in the GitHub release. */
  name: string;
  /** SHA-256 of the tarball, lowercase hex. */
  sha256: string;
}

export const D2_RELEASE_ASSETS: Readonly<Record<D2Platform, D2ReleaseAsset>> = {
  "darwin-arm64": {
    name: `d2-v${D2_VERSION}-macos-arm64.tar.gz`,
    sha256: "eaf6c0c143e56dd9fa97bfb6df25ea9c1ebce40245f056a0768cf1a6c15d3064",
  },
  "darwin-x64": {
    name: `d2-v${D2_VERSION}-macos-amd64.tar.gz`,
    sha256: "cad39576a480d6bb02ea142fef1726647914b0d2da51ccc9b30b660a2b1babf0",
  },
  "linux-arm64": {
    name: `d2-v${D2_VERSION}-linux-arm64.tar.gz`,
    sha256: "ac2c028697199479acb321db1e3d68caee9f2ba492ed73caa3cd13f3829bf913",
  },
  "linux-x64": {
    name: `d2-v${D2_VERSION}-linux-amd64.tar.gz`,
    sha256: "5669ddc46b99e942cc96078f4a4e36d5e62103348f4c05179ede27802fdd87a9",
  },
};

export const D2_RELEASE_BASE_URL = `https://github.com/terrastruct/d2/releases/download/v${D2_VERSION}`;

/** Path of the `d2` binary inside the release tarball. */
export const D2_TARBALL_BINARY = `d2-v${D2_VERSION}/bin/d2`;

/** Location of the managed binary installed by `bun run d2:install`, relative to the project root. */
export const MANAGED_D2_PATH = ".sumi/bin/d2";

/** Returns the release asset for a platform, or `undefined` if D2 publishes none. */
export function d2ReleaseAsset(
  platform: string = process.platform,
  arch: string = process.arch,
): D2ReleaseAsset | undefined {
  return Object.hasOwn(D2_RELEASE_ASSETS, `${platform}-${arch}`)
    ? D2_RELEASE_ASSETS[`${platform}-${arch}` as D2Platform]
    : undefined;
}
