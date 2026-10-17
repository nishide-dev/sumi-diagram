-- #19 research: opens a .pptx in Microsoft PowerPoint for Mac, prints the
-- number of shapes PowerPoint kept on slide 1 and saves the slide as PDF.
-- PowerPoint is sandboxed: keep both files under
-- ~/Library/Containers/com.microsoft.Powerpoint/Data/ to avoid file-access prompts.
-- A file PowerPoint considers broken opens a repair dialog; the timeout then
-- fails the call (the caller quits PowerPoint).
--   osascript powerpoint-to-pdf.applescript /abs/in.pptx /abs/out.pdf
on run argv
	set inPath to item 1 of argv
	set outPath to item 2 of argv
	with timeout of 40 seconds
		tell application "Microsoft PowerPoint"
			open POSIX file inPath
			set pres to active presentation
			set n to count of shapes of slide 1 of pres
			save pres in POSIX file outPath as save as PDF
			close pres saving no
		end tell
	end timeout
	return n
end run
