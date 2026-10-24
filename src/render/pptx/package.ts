/** One picture, one blank slide: SVG extension + PNG fallback (ECMA-376 / MS-ODRAWXML). */
import type { SumiSvgMetadata } from "../finalize";
import { RESVG_VERSION } from "../pdf/engine";
import { type ZipEntry, zip } from "./zip";

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG = "http://schemas.openxmlformats.org/package/2006/relationships";
export const escapeXml = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const rels = (items: readonly [string, string, string][]) =>
  `${XML}<Relationships xmlns="${PKG}">${items.map(([id, type, target]) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`).join("")}</Relationships>`;
const tree =
  '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>';
const ns = `xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}"`;
const colors =
  '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>';
const theme = `${XML}<a:theme xmlns:a="${A}" name="Sumi"><a:themeElements><a:clrScheme name="Sumi">${Object.entries(
  {
    dk1: "000000",
    lt1: "FFFFFF",
    dk2: "333333",
    lt2: "EEEEEE",
    accent1: "4472C4",
    accent2: "ED7D31",
    accent3: "A5A5A5",
    accent4: "FFC000",
    accent5: "5B9BD5",
    accent6: "70AD47",
    hlink: "0563C1",
    folHlink: "954F72",
  },
)
  .map(([key, val]) => `<a:${key}><a:srgbClr val="${val}"/></a:${key}>`)
  .join(
    "",
  )}</a:clrScheme><a:fontScheme name="Sumi">${["majorFont", "minorFont"].map((tag) => `<a:${tag}><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:${tag}>`).join("")}</a:fontScheme><a:fmtScheme name="Sumi"><a:fillStyleLst>${'<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'.repeat(3)}</a:fillStyleLst><a:lnStyleLst>${[6350, 12700, 19050].map((w) => `<a:ln w="${w}"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>`).join("")}</a:lnStyleLst><a:effectStyleLst>${"<a:effectStyle><a:effectLst/></a:effectStyle>".repeat(3)}</a:effectStyleLst><a:bgFillStyleLst>${'<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'.repeat(3)}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;

/** Pure packaging; a separate validation script uses a sentinel PNG to test app fallback selection. */
export function picturePptx(
  svg: string,
  png: Uint8Array,
  widthPt: number,
  heightPt: number,
  metadata?: SumiSvgMetadata,
): Uint8Array {
  const w = Math.max(1, Math.round(widthPt * 12700));
  const h = Math.max(1, Math.round(heightPt * 12700));
  // ST_SlideSizeCoordinate is 1..56 inches. Pad tiny figures without scaling them.
  const cx = Math.max(914400, w);
  const cy = Math.max(914400, h);
  const x = Math.floor((cx - w) / 2);
  const y = Math.floor((cy - h) / 2);
  const title = escapeXml(metadata?.figureId ?? "Sumi diagram");
  const creator = metadata ? `Sumi ${metadata.sumiVersion}` : "Sumi";
  const description =
    "One picture with outlined SVG and PNG fallback; shapes and text are not individually editable.";
  const pic = `<p:pic><p:nvPicPr><p:cNvPr id="2" name="${title}" descr="${description}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"><a:extLst><a:ext uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}"><asvg:svgBlip xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main" r:embed="rId3"/></a:ext></a:extLst></a:blip><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
  const overrides: [string, string][] = [
    ["ppt/presentation.xml", "presentation.main"],
    ["ppt/slideMasters/slideMaster1.xml", "slideMaster"],
    ["ppt/slideLayouts/slideLayout1.xml", "slideLayout"],
    ["ppt/slides/slide1.xml", "slide"],
    ["ppt/theme/theme1.xml", "theme"],
  ];
  const properties: [string, string][] = [
    ["SumiPictureFormat", "outlined-svg+png"],
    ["SumiRasterizer", `resvg ${RESVG_VERSION}`],
  ];
  if (metadata)
    properties.push(
      ["SumiVersion", metadata.sumiVersion],
      ["SumiBackend", `${metadata.backend.name} ${metadata.backend.version}`],
      ["SumiTheme", metadata.theme],
      ["SumiProfile", metadata.profile],
      ["SumiFontSet", metadata.fontSet],
      ["SumiInputSha256", metadata.inputSha256],
      ["SumiD2Sha256", metadata.d2Sha256],
    );
  const entries: ZipEntry[] = [
    {
      name: "[Content_Types].xml",
      data: `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="svg" ContentType="image/svg+xml"/>${overrides.map(([part, kind]) => `<Override PartName="/${part}" ContentType="application/vnd.openxmlformats-officedocument.${kind === "theme" ? "theme" : `presentationml.${kind}`}+xml"/>`).join("")}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/><Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/></Types>`,
    },
    {
      name: "_rels/.rels",
      data: rels([
        ["rId1", `${R}/officeDocument`, "ppt/presentation.xml"],
        [
          "rId2",
          "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties",
          "docProps/core.xml",
        ],
        ["rId3", `${R}/extended-properties`, "docProps/app.xml"],
        ["rId4", `${R}/custom-properties`, "docProps/custom.xml"],
      ]),
    },
    {
      name: "docProps/core.xml",
      data: `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${title}</dc:title><dc:creator>${escapeXml(creator)}</dc:creator><dc:description>${description}</dc:description></cp:coreProperties>`,
    },
    {
      name: "docProps/app.xml",
      data: `${XML}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Sumi</Application><PresentationFormat>Custom</PresentationFormat><Slides>1</Slides></Properties>`,
    },
    {
      name: "docProps/custom.xml",
      data: `${XML}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">${properties.map(([name, value], i) => `<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="${i + 2}" name="${name}"><vt:lpwstr>${escapeXml(value)}</vt:lpwstr></property>`).join("")}</Properties>`,
    },
    {
      name: "ppt/presentation.xml",
      data: `${XML}<p:presentation ${ns}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst><p:sldSz cx="${cx}" cy="${cy}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
    },
    {
      name: "ppt/_rels/presentation.xml.rels",
      data: rels([
        ["rId1", `${R}/slideMaster`, "slideMasters/slideMaster1.xml"],
        ["rId2", `${R}/slide`, "slides/slide1.xml"],
      ]),
    },
    {
      name: "ppt/slideMasters/slideMaster1.xml",
      data: `${XML}<p:sldMaster ${ns}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>${tree}</p:spTree></p:cSld>${colors}<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`,
    },
    {
      name: "ppt/slideMasters/_rels/slideMaster1.xml.rels",
      data: rels([
        ["rId1", `${R}/slideLayout`, "../slideLayouts/slideLayout1.xml"],
        ["rId2", `${R}/theme`, "../theme/theme1.xml"],
      ]),
    },
    {
      name: "ppt/slideLayouts/slideLayout1.xml",
      data: `${XML}<p:sldLayout ${ns} type="blank" preserve="1"><p:cSld><p:spTree>${tree}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`,
    },
    {
      name: "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
      data: rels([["rId1", `${R}/slideMaster`, "../slideMasters/slideMaster1.xml"]]),
    },
    { name: "ppt/theme/theme1.xml", data: theme },
    {
      name: "ppt/slides/slide1.xml",
      data: `${XML}<p:sld ${ns}><p:cSld><p:spTree>${tree}${pic}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`,
    },
    {
      name: "ppt/slides/_rels/slide1.xml.rels",
      data: rels([
        ["rId1", `${R}/slideLayout`, "../slideLayouts/slideLayout1.xml"],
        ["rId2", `${R}/image`, "../media/figure.png"],
        ["rId3", `${R}/image`, "../media/figure.svg"],
      ]),
    },
    { name: "ppt/media/figure.svg", data: svg },
    { name: "ppt/media/figure.png", data: png },
  ];
  return zip(entries);
}
