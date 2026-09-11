# Contributing to DevScholar for JupyterLab

Thanks for your interest. Bug reports, feature requests and pull requests are all welcome.

## Reporting bugs

Open an issue at https://github.com/pallaprolus/devscholar-jupyter/issues/new (or use *Help → Report a DevScholar Issue* inside JupyterLab). Please include:

- JupyterLab version (`jupyter lab --version`) and the DevScholar version (`pip show devscholar-jupyter`)
- The cell text that triggers the problem (for example `arxiv:1706.03762`)
- Any errors from the browser console (View → Developer → JavaScript Console in most browsers)

## Development setup

```bash
git clone https://github.com/pallaprolus/devscholar-jupyter.git
cd devscholar-jupyter
pip install -e .
jupyter labextension develop . --overwrite
jlpm install
jlpm build          # or `jlpm watch` to rebuild on change
jupyter lab
```

## Checks before opening a pull request

```bash
jlpm lint:check     # ESLint + Prettier (run `jlpm lint` to auto-fix)
jlpm build:prod
cd ui-tests && npm install && npx playwright install chromium && npm test
```

The UI tests start their own JupyterLab on port 8888 and mock the metadata APIs, so they do not need network access.

## Project layout

- `src/paperParser.ts` – detects arXiv / DOI / IEEE / Semantic Scholar / OpenAlex references
- `src/metadataClient.ts` – fetches metadata (DataCite, OpenAlex, Semantic Scholar); only APIs that allow browser requests
- `src/highlighter.ts`, `src/editorExtension.ts` – underline references in rendered markdown and CodeMirror editors
- `src/tooltip.ts` – hover card
- `src/pdfPreview.ts` – in-JupyterLab PDF viewer
- `src/searchCiteDialog.ts` – Search & Cite dialog
- `src/zoteroSync.ts`, `src/mendeleySync.ts` – reference manager sync
- `schema/plugin.json` – settings and menu contributions

## Releasing (maintainers)

Bump `version` in `package.json` and push to `main`. The publish workflow runs the tests, publishes to PyPI via trusted publishing, tags the commit and creates a GitHub Release.
