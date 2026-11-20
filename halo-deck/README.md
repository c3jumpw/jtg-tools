# HaloDeck

A single-file slide & annotation designer. Paste, drop or upload images, put text, circle
highlights, rectangles and arrows on top, then export the deck as one self-contained HTML file
(no page limits, readable by people and LLMs), as PNG images, or as a PDF.

## Files

- `index.html` — the whole app.
- `guide.html` — the illustrated guide for users and admins (screenshots of every tool, menu and
  setting). Upload it next to `index.html`: the app's **Help** panel (the **?** button, or the `?` key)
  links to it, and the guide shows an **Open HaloDeck** button when it finds the app beside it.

- `changelog.json` and `CHANGELOG.md` — the change log: every version since the first, oldest
  first, with dates and who each change affects. The JSON is for tools and records; the Markdown
  reads well on GitHub.
- `source/` — what these files are built from, with the build and the tests (see below).

`index.html` and `guide.html` are a matching pair: both are stamped with the same version and
build number (shown at the bottom of Help and at the top of the guide). Always upload them together.

## Getting-started tour

HaloDeck opens with a step-by-step tour the first time someone uses it, with screenshots of this
exact version. There are two tracks:

- **I make decks** (14 steps): the workspace, bringing pictures in, PDF and photos as slides,
  marking up, selecting and resizing, labels and notes, the right-click menu, styling, layers,
  slide settings, export, sharing and saving, phones and tablets, and Help.
- **I set HaloDeck up for others** (7 steps, for admins): what an admin does, putting it online,
  releasing an update, keeping track of changes, where decks are stored, network and privacy, and
  a rollout checklist.

**Show me** on a step closes the tour for a moment and rings the real button on screen (on a
phone it points at the ⋯ menu when that's where the button lives). Esc, or a click anywhere,
returns to the same step. The tour is always in **Help → Take the getting-started tour** and in
the ⋯ menu on small screens.

## What's new, by role

After an update, each person sees **What's new** once, the first time they open the new version:
cards for the changes since the version they last used, with pictures and **Show me** buttons.
It shows only what applies to them:

- **I make decks** (the default): changes marked for everyone.
- **I run HaloDeck for others**: those plus admin changes (hosting, releases, storage, moves).

HaloDeck has no accounts, so the role is what the person picks: in the tour's welcome, in
**Help → Your role**, or by opening HaloDeck once with `?role=admin` at the end of the address.
If nothing in an update applies to someone, they aren't interrupted.

## Change log

**Help → Change log** (also in the ⋯ menu and the admin tour) shows every version as a timeline,
oldest first, with each change marked New, Improved, Fixed, Changed or Removed and tagged when it's
for admins only. Filter to admin changes, flip the order, or download it as JSON or CSV. The same
log is published next to the app as `changelog.json` and `CHANGELOG.md`, and drives What's new.

## Moving to a new address

Browsers keep autosaved decks per web address, so a new domain starts everyone with an empty deck.
`SITE_MOVE` in `source/src/updates.js` lists the old address(es) and the new one. People who open
HaloDeck at an old address see a notice with a **Save project** button; at the new address, the
welcome tells them to open the file they saved. Version 1.8 is set up for the move from
`jtg-tools.jtgworkspace.com` to `jtg-tools.mkcworkspace.com`: publish it, give people time to
save, then switch the domain.

## Deploy on GitHub Pages

1. Create a new GitHub repo (public, unless you have a plan that allows Pages on private repos).
2. Upload `index.html` and `guide.html` to the repo root. That's the whole app and its guide — no build step, no dependencies.
3. **Settings → Pages → Build and deployment → Source: "Deploy from a branch"**, branch `main`,
   folder `/ (root)` → **Save**.
4. After a minute, open the URL GitHub shows (usually `https://<username>.github.io/<repo>/`).

To update later, replace `index.html`, `guide.html`, `changelog.json` and `CHANGELOG.md` together. Decks people have open
are kept in their own browser, so updating the app doesn't touch their work. If only one file gets
replaced, the Help panel shows everyone a notice that the guide is from a different build, with
both build numbers, so the missing upload gets noticed.

## Building a new version (for whoever maintains HaloDeck)

The `source/` folder holds the source files, the build and the tests:

1. Once: `python3 dev_setup.py` (needs Python 3 with Playwright, Pillow and reportlab, plus npm; it
   fetches the PDF reader used by the tests and makes sample PDFs).
2. Edit the files in `src/`. **Add an entry at the end of `src/changelog.json`** for the new
   version: its number, date, a short title, and each change with its type (`new`, `improved`,
   `fixed`, `changed`, `removed`) and who it's for (`everyone` or `admins`). The version number
   comes from that entry. A change can name a `shot` (a screenshot to show in What's new) and
   `show` (the control Show me points at). When the update goes live, add its `live` date.
3. `python3 build.py` builds `dist/index.html`, opens it in a headless browser, retakes every
   screenshot, puts them into the tour and the guide, and stamps everything with one build number.
   It stops if the change log is missing an entry or has one out of order, if a tour step or change
   points at a screenshot that wasn't taken, or if a guide figure's markers don't match its
   explanation. (`python3 build.py --quick` rebuilds just the app while editing.)
4. `python3 test_app.py` runs the browser tests (every tour step and Show me, What's new for each
   role, the change log, the moving notice, on desktop and phone).
5. `python3 build.py --publish` does step 3 and copies the four files into the `halo-deck` folder
   above `source/`. Commit and push.

## Open a PDF or a batch of photos as slides

**Open ▾** in the top bar (⋯ menu on small screens):

- **PDF…** — every page becomes a slide. Choose all pages or a range like `1-3, 7`.
  - **Slide size → Match the PDF** (the default for a new deck) sets the slides to the PDF's own
    shape — Letter, A4, 16:9 slides, anything — so nothing is stretched, cropped or letterboxed.
    It follows the first page you import; if pages have different sizes, each one is fitted inside
    its slide. Exporting back to PDF gives the same page size (a Letter PDF comes back as Letter).
  - **Keep this deck's size** fits each page inside the current slides instead.
  - Each page comes in as a sharp, **locked** picture so you can draw on it straight away
    (unlock it in Layers to move it). With "Copy each page's text into its slide notes" ticked,
    the PDF's words travel into the HTML export as real text — that's what keeps the HTML useful
    to LLMs. Scanned PDFs have no text layer, so they come in as pictures only.
  - Put them in **a new deck** (named after the file) or **this deck**, after the current slide.
  - The PDF reader (PDF.js) is downloaded from a CDN the first time you open a PDF, so that step
    needs an internet connection; the rest of the app stays a single offline-capable file.
    Password-protected PDFs can't be opened — save an unprotected copy first.
  - You can also just drop a PDF onto the page.
- **Photos…** — pick as many as you like; one slide each, in file-name order (or the order you
  picked). **Match the photos** sizes the slides to the photos' shape (used for a new deck);
  adding to this deck keeps its size unless you choose otherwise. **Show it whole** fits each
  photo inside the slide; **Fill the slide** crops to cover it edge to edge.
- **HaloDeck project…** — a saved `.halodeck.json`, or an HTML deck exported from HaloDeck.

## Using it

- **Tools** (toolbar on desktop, bottom bar on phones/tablets; keys `V T O R A`): Select, Text,
  Circle highlight, Rectangle, Arrow. Drag on the slide to draw, or click/tap to drop one.
  Shapes can be started anywhere — on top of pictures, text or other shapes. The circle,
  rectangle and arrow tools **stay on** so you can mark up several things in a row; press
  `Esc` or `V` (or click Select) when you're done.
- **Hollow circles and rectangles** only catch clicks on their outline, so whatever is inside
  them (a picture, a text box) stays clickable.
- **Text**: click a text box to type in it (the cursor lands where you click); drag it to move it.
  On touch screens, the first tap selects and the second tap starts typing.
  If a text box is covered by a picture or a filled box, **double-click** it to edit — it floats
  to the top while you type. You can also edit text from the **Text** box in the Style panel,
  the ✎ button in Layers, or right-click → Edit text. Locked text can still be edited, just not moved.
- **Paste**: the **Paste** button in the toolbar (also in the ⋯ menu on small screens and the
  right-click menu) pastes whatever is on the clipboard — a screenshot, an image copied from a
  website, text, or a layer you copied in HaloDeck. If the browser won't share the clipboard
  directly (Firefox and Safari often ask, or a copied *file*), a small paste box opens: press
  Ctrl/⌘+V there, or on a phone touch-and-hold it and tap Paste. Ctrl/⌘+V on the slide works too.
- **Right-click menu** (touch-and-hold on phones/tablets): Cut, Copy, Paste here, Duplicate,
  Bring to front / Send to back, Lock, Delete; on empty space: Paste here, Add text here,
  Insert images. Paste here drops the item where you clicked.
- **Images**: the image button, paste, or drag one or many files from your file explorer onto
  the slide — each becomes its own layer. Drop images on the **slide list** to make one new
  slide per image.
- **Layers**: reorder by dragging (grab the ⋮⋮ grip on touch screens), hide, lock, delete.
- **Page size**: Slide panel → widescreen, 4:3, square, vertical 9:16, 4:5, A4, US Letter.
- **Notes**: per-slide commentary, exported as real text. "Add notes to slide" also puts the note
  on the slide as a text layer.
- **Zoom**: pinch on touch screens, Ctrl/⌘ + scroll or trackpad pinch on desktop, FIT to reset.

## Export

**Export ▾** → **HTML**, **PNG** or **PDF**. Each opens a confirmation window where you can
still switch format and choose the slides: **All** (the default), **Current**, **Clear**, a
**Custom** list such as `1-3, 5, 8`, or click thumbnails (Shift-click picks a run) — the list and
the thumbnails stay in sync. Ctrl/⌘+E opens it with the format you used last.

- **HTML** — one `.html` file with arrow-key/swipe navigation, an all-slides view, full-screen
  presenting, and your notes as text. You can open this file back in HaloDeck to keep editing.
- **PNG** — one image per slide at 1× or 2× resolution (JPG also available), zipped together
  with `notes.txt` when there's more than one. A single slide downloads as just that image.
- **PDF** — one page per slide at the slide's own shape (16:9 is 13.33 × 7.5 in, A4 is A4).
  Text you typed stays real text in the PDF — selectable, searchable and readable by tools
  and LLMs — and each slide's notes can follow it on a notes page. "Sharp" keeps screenshots
  lossless; "Smaller" uses JPEG for much smaller files.

## Saving

Your deck autosaves in this browser as you work (including images). **Save project** downloads a
`.halodeck.json` file you can **Open** (or drop onto the page) on any device. Decks from the
previous version of HaloDeck are converted automatically the first time it loads.
