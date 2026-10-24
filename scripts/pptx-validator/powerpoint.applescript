-- Test-only: open only a generated fixture, export it, then close that fixture.
-- Never operate on or quit an unrelated active presentation.
on run argv
    set inputPath to item 1 of argv
    set outputPath to item 2 of argv
    set expectedName to item 3 of argv
    with timeout of 45 seconds
        tell application "Microsoft PowerPoint"
            open POSIX file inputPath
            set fixture to active presentation
            if name of fixture is not expectedName then error "The generated fixture is not active; refusing to export/close"
            set shapeCount to count of shapes of slide 1 of fixture
            save fixture in POSIX file outputPath as save as PDF
            close fixture saving no
            return (version as text) & ": " & shapeCount
        end tell
    end timeout
end run
