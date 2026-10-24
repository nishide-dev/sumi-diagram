// Test-only independent schema validation; not bundled with Sumi.
using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Validation;

if (args.Length == 0) throw new ArgumentException("Pass generated PPTX paths");
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
