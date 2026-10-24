// Test-only independent schema validation; not bundled with Sumi.
using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Validation;

if (args.Length == 0) throw new ArgumentException("Pass generated PPTX paths");
if (args[0] == "--inspect") {
    var reports = new List<object>();
    foreach (var path in args.Skip(1)) {
        using var doc = PresentationDocument.Open(path, false);
        var slide = doc.PresentationPart!.SlideParts.Single().Slide;
        var shapes = slide.Descendants().Where(e => e.NamespaceUri == "http://schemas.openxmlformats.org/presentationml/2006/main" && (e.LocalName == "sp" || e.LocalName == "cxnSp")).Select(e => {
            var name = e.Descendants().First(x => x.LocalName == "cNvPr").GetAttribute("name", "").Value;
            var xfrm = e.Descendants().FirstOrDefault(x => x.LocalName == "xfrm");
            var off = xfrm?.ChildElements.FirstOrDefault(x => x.LocalName == "off");
            var ext = xfrm?.ChildElements.FirstOrDefault(x => x.LocalName == "ext");
            var text = string.Join("", e.Descendants().Where(x => x.LocalName == "t").Select(x => x.InnerText));
            return new { name, kind=e.LocalName, text, x=off?.GetAttribute("x", "").Value, y=off?.GetAttribute("y", "").Value, cx=ext?.GetAttribute("cx", "").Value, cy=ext?.GetAttribute("cy", "").Value };
        }).ToArray();
        reports.Add(new { file=Path.GetFileName(path), shapes });
    }
    Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(reports));
    return 0;
}
var validator = new OpenXmlValidator(FileFormatVersions.Office2019);
var failed = false;
foreach (var path in args) {
    using var presentation = PresentationDocument.Open(path, false);
    var errors = validator.Validate(presentation).ToArray();
    foreach (var error in errors) {
        Console.Error.WriteLine($"{path}: {error.Part?.Uri} {error.Path?.XPath}: {error.Description}");
    }
    if (errors.Length != 0) failed = true;
    else Console.WriteLine($"ok - {path}");
}
return failed ? 1 : 0;
