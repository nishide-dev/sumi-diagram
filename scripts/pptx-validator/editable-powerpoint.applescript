-- Only generated fixtures are opened/saved/closed; never quit the user's app.
on run argv
    set inputPath to item 1 of argv
    set outputPrefix to item 2 of argv
    set expectedName to item 3 of argv
    with timeout of 30 seconds
        tell application "Microsoft PowerPoint"
            open POSIX file inputPath
            set fixture to active presentation
            if name of fixture is not expectedName then error "Generated fixture is not active"
            set shapeCount to count of shapes of slide 1 of fixture
            save fixture in POSIX file (outputPrefix & ".before.pdf") as save as PDF
            save fixture in POSIX file (outputPrefix & ".roundtrip.pptx") as save as Open XML presentation
            if (count of argv) is 4 then
                set targetShape to shape (item 4 of argv) of slide 1 of fixture
                set originalLeft to left position of targetShape
                set left position of targetShape to originalLeft + 20
                set content of text range of text frame of targetShape to "EDITED 日本語"
                if content of text range of text frame of targetShape is not "EDITED 日本語" then error "Text edit did not persist"
                if left position of targetShape is less than originalLeft + 19 then error "Shape did not move"
                save fixture in POSIX file (outputPrefix & ".edited.pptx") as save as Open XML presentation
                save fixture in POSIX file (outputPrefix & ".after.pdf") as save as PDF
            end if
            close fixture saving no
            return (version as text) & ": " & shapeCount
        end tell
    end timeout
end run
