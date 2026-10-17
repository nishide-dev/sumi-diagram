-- #19 research: imports a .pptx into Keynote and exports it as PDF.
--   osascript keynote-to-pdf.applescript /abs/in.pptx /abs/out.pdf
on run argv
	set inPath to item 1 of argv
	set outPath to item 2 of argv
	with timeout of 60 seconds
		tell application "Keynote"
			set doc to open POSIX file inPath
			export doc to POSIX file outPath as PDF
			close doc saving no
		end tell
	end timeout
end run
