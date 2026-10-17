-- #19 research: opens a .pptx in PowerPoint, moves one shape (by name) down
-- by the given points and saves the slide as PDF, to see whether the edges
-- follow (glued connectors) or stay (freeform edges).
--   osascript powerpoint-move-shape.applescript /abs/in.pptx /abs/out.pdf "n:gateway" 60
on run argv
	set inPath to item 1 of argv
	set outPath to item 2 of argv
	set shapeName to item 3 of argv
	set dy to (item 4 of argv) as real
	with timeout of 40 seconds
		tell application "Microsoft PowerPoint"
			open POSIX file inPath
			set pres to active presentation
			set s to shape shapeName of slide 1 of pres
			set top of s to (top of s) + dy
			save pres in POSIX file outPath as save as PDF
			close pres saving no
		end tell
	end timeout
end run
