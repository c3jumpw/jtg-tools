# HaloDeck source

What `../index.html`, `../guide.html`, `../changelog.json` and `../CHANGELOG.md` are built from.

- `src/` — the app (`app.js`, `body.html`, `style.css`, the tour, What's new and change log code)
  and **`src/changelog.json`, the change log**: every version, oldest first. Each update adds an
  entry at the end; the version number comes from it.
- `guide_src/` — the illustrated guide's template, figure captions and the screenshot script.
- `build.py` — the release build. `dev_setup.py` — one-time setup. `test_app.py` — browser tests.

```
python3 dev_setup.py         # once
python3 build.py --publish   # build, retake screenshots, copy the four files into ../
python3 test_app.py          # check everything
```

See `../README.md` for details.
