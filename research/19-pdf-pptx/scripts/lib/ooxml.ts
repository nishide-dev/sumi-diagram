/**
 * The fixed parts of a one-slide PresentationML package (ECMA-376): content
 * types, relationships, presentation, one blank master / layout, a theme.
 * Only the slide and its media differ between the PoC variants.
 */

import type { ZipEntry } from "./zip";

export const NS = {
  a: "http://schemas.openxmlformats.org/drawingml/2006/main",
  r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  p: "http://schemas.openxmlformats.org/presentationml/2006/main",
  asvg: "http://schemas.microsoft.com/office/drawing/2016/SVG/main",
};
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

export const escapeXml = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/** Font used for Latin and East Asian text in the theme and every run. */
export const FONT = "BIZ UDPGothic";

export interface SlidePackage {
  /** Slide size in EMU (1pt = 12700 EMU). */
  cx: number;
  cy: number;
  /** `<p:spTree>` children of the slide. */
  shapes: string;
  /** Media parts: path under ppt/media/, relationship id used in `shapes`. */
  media: { rId: string; name: string; data: Uint8Array | string }[];
}

function rels(items: [id: string, type: string, target: string][]): string {
  return `${XML}<Relationships xmlns="${PKG_REL}">${items
    .map(
      ([id, type, target]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`,
    )
    .join("")}</Relationships>`;
}

const theme = `${XML}<a:theme xmlns:a="${NS.a}" name="Sumi"><a:themeElements>
<a:clrScheme name="Sumi"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="333333"/></a:dk2><a:lt2><a:srgbClr val="EEEEEE"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme>
<a:fontScheme name="Sumi"><a:majorFont><a:latin typeface="${FONT}"/><a:ea typeface="${FONT}"/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="${FONT}"/><a:ea typeface="${FONT}"/><a:cs typeface=""/></a:minorFont></a:fontScheme>
<a:fmtScheme name="Sumi"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>
</a:themeElements></a:theme>`;

const emptyTree = `<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>`;

const master = `${XML}<p:sldMaster xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}"><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`;

const layout = `${XML}<p:sldLayout xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}" type="blank" preserve="1">${emptyTree}<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;

/** Builds the package entries in a fixed order (deterministic zip). */
export function presentation(slide: SlidePackage): ZipEntry[] {
  const exts = new Set(slide.media.map((m) => m.name.split(".").pop() ?? ""));
  const mediaTypes: Record<string, string> = { png: "image/png", svg: "image/svg+xml" };
  const contentTypes = `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${[
    ...exts,
  ]
    .sort()
    .map((e) => `<Default Extension="${e}" ContentType="${mediaTypes[e]}"/>`)
    .join(
      "",
    )}<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/></Types>`;

  const pres = `${XML}<p:presentation xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst><p:sldSz cx="${slide.cx}" cy="${slide.cy}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`;

  const slideXml = `${XML}<p:sld xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${slide.shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;

  return [
    { name: "[Content_Types].xml", data: contentTypes },
    { name: "_rels/.rels", data: rels([["rId1", "officeDocument", "ppt/presentation.xml"]]) },
    { name: "ppt/presentation.xml", data: pres },
    {
      name: "ppt/_rels/presentation.xml.rels",
      data: rels([
        ["rId1", "slideMaster", "slideMasters/slideMaster1.xml"],
        ["rId2", "slide", "slides/slide1.xml"],
        ["rId3", "theme", "theme/theme1.xml"],
      ]),
    },
    { name: "ppt/slideMasters/slideMaster1.xml", data: master },
    {
      name: "ppt/slideMasters/_rels/slideMaster1.xml.rels",
      data: rels([
        ["rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"],
        ["rId2", "theme", "../theme/theme1.xml"],
      ]),
    },
    { name: "ppt/slideLayouts/slideLayout1.xml", data: layout },
    {
      name: "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
      data: rels([["rId1", "slideMaster", "../slideMasters/slideMaster1.xml"]]),
    },
    { name: "ppt/theme/theme1.xml", data: theme },
    { name: "ppt/slides/slide1.xml", data: slideXml },
    {
      name: "ppt/slides/_rels/slide1.xml.rels",
      data: rels([
        ["rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"],
        ...slide.media.map((m): [string, string, string] => [m.rId, "image", `../media/${m.name}`]),
      ]),
    },
    ...slide.media.map((m) => ({ name: `ppt/media/${m.name}`, data: m.data })),
  ];
}
