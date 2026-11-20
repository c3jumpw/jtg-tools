# HaloDeck change log

Every HaloDeck version, oldest first. Add a new entry at the end for every update: the build reads the version number from the last entry and stops if an entry is missing or malformed. Versions before 1.4 were reconstructed from the site's publishing history (the git commits of halo-deck/index.html).

Each change says who it affects: **everyone**: everyone who uses HaloDeck; **admins**: whoever hosts and maintains HaloDeck.

## 1.0 · First version

_Sep 23, 2026_

- **New** · Slides you can mark up: Text boxes, circle highlights, rectangles and arrows on top of pictures. Each is its own layer you can move, resize, rotate, hide, lock, duplicate and reorder, with undo and redo.
- **New** · Pictures in, any way: Insert images, paste a screenshot, or drop files onto the slide.
- **New** · Notes for each slide: Write commentary per slide. It travels with the deck as text.
- **New** · Export as one HTML file: A self-contained deck with previous and next navigation that opens in any browser, with no page limit.
- **New** · Autosave and project files: The deck saves itself in the browser as you work. Save project downloads a copy you can open again.
- **New** · _Admins_ · One file to host: HaloDeck is a single index.html on GitHub Pages: no server, accounts or database. Decks stay in each person's browser.

## 1.1 · Notes, on the slide or under it

_Sep 23, 2026_

- **New** · Notes onto the slide: Add a slide's notes to the slide itself as a text layer, ready to drag into place.
- **Improved** · Notes always visible in exports: Exported decks show each slide's notes under it instead of folding them away.

## 1.4 · Rebuilt editor: phones, page sizes, PNG and PDF export

_Oct 13, 2026_

> Version numbers 1.2 and 1.3 were never published on their own; their work went live as part of 1.4.

- **New** · Works on phones and tablets: Tools along the bottom, pinch to zoom, touch and hold for more options.
- **New** · Page sizes: Widescreen 16:9, 4:3, square, vertical 9:16, 4:5 and A4, changeable at any time.
- **New** · Export as PNG or PDF: Images at 1× or 2× (zipped with the notes), or a PDF whose typed text stays searchable. Every export lets you pick which slides go out.
- **New** · Paste button and right-click menu: Paste whatever you copied from the top bar. Right-click (or touch and hold) for cut, copy, paste here, arrange, lock and delete.
- **Improved** · Draw on top of anything: Shapes start wherever you drag, even over pictures, and the drawing tools stay on until you press Esc.
- **Improved** · Edit any text: Click into a text box to type where you clicked. Double-click text that sits under a shape or picture.
- **Improved** · Pictures autosave reliably: Decks, including large pictures, are kept in the browser's database. HTML decks made here can be opened again to keep editing.
- **Changed** · _Admins_ · New deck format: Decks from 1.0 and 1.1 are converted automatically the first time they open. Project files from those versions still open.

## 1.5 · PDFs and photos become slides

_Oct 13, 2026_

- **New** · Open a PDF as slides: Every page becomes a slide, sized to match the PDF, with the page's text copied into the notes.
- **New** · A batch of photos, one slide each: Open several photos at once from Open ▾ → Photos…
- **New** · Export just some slides: All, Current, or a list like 1-3, 5. The list and the thumbnails stay in sync.
- **New** · US Letter page size: Letter joins the other page sizes, and PDF exports keep each slide's own shape.
- **New** · _Admins_ · PDF reader loads from a CDN: The first time someone opens a PDF, HaloDeck loads PDF.js from cdn.jsdelivr.net (unpkg.com as backup). Allow those addresses on locked-down networks.

## 1.6 · Help and the illustrated guide

_Oct 30, 2026 · live Nov 18, 2026_

- **New** · Help panel: The ? button (or the ? key) opens a quick reference to every tool, menu and shortcut.
- **New** · Illustrated guide: Screenshots of every tool, menu and setting, for everyday users and admins, linked from Help.
- **New** · _Admins_ · guide.html sits next to the app: Upload guide.html beside index.html. Help links to it and says so if it's missing.

## 1.7 · Getting-started tour

_Nov 18, 2026 · build 53f0b41_

- **New** · Getting-started tour: Step-by-step screenshots of every part of HaloDeck. Open it any time from Help.
- **New** · Show me: A tour step can light up the real button on your screen.
- **New** · What's new after updates: A short summary of changes appears once, the first time you open a new version.
- **New** · _Admins_ · Admin track in the tour: Six steps on hosting, releasing updates, storage, network and rollout.
- **New** · _Admins_ · Version check: index.html and guide.html are stamped with one build number. Help shows the version and warns everyone if the two files don't match.

## 1.8 · Change log, updates by role, and the move to mkcworkspace.com

_Nov 20, 2026 · build 24cf83c_

- **New** · _Admins_ · Change log: Every version since the first, oldest first, with dates and who each change affects. It's in the admin tour and Help, downloadable as JSON or CSV, and published as changelog.json and CHANGELOG.md next to the app.
- **Improved** · What's new shows what applies to you: After an update you see only the changes that affect you, as cards with pictures and Show me buttons.
- **New** · Choose your role: Pick “I make decks” or “I run HaloDeck” in the tour or in Help. People who run HaloDeck also see admin changes.
- **Changed** · HaloDeck is moving to jtg-tools.mkcworkspace.com: Your autosaved deck stays at the old address. Use Save project before the move, then open that file at the new address with Open ▾ → HaloDeck project…
- **New** · _Admins_ · Moving-address notice: People who open HaloDeck at jtg-tools.jtgworkspace.com see a banner asking them to save their deck. Switch the domain only after people have had time to save.
