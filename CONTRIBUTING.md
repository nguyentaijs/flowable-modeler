# Contributing / development

## Build and run

```
npm install
npm run build        # bundles into dist/
npm test             # unit tests (node --test)
```

Press **F5** to launch an Extension Development Host on the `samples/` folder. Open a `.bpmn` or `.dmn` file there.

| Script | What it does |
|---|---|
| `npm run build` | Bundles the extension host and the three webviews (BPMN, DMN, run) with esbuild |
| `npm run watch` | Same, rebuilding on change |
| `npm test` | Runs all tests with Node's test runner |
| `npm run package` | Builds and creates `flowable-design-<version>.vsix` |
| `node scripts/extract-flowable-schema.mjs` | Regenerates `schema/flowable-7.2.0.json` from the Flowable 7.2.0 sources on GitHub (needs network; `--cache <dir>` reuses downloads) |
| `node scripts/extract-flowable-dmn-schema.mjs` | Regenerates `schema/flowable-dmn-7.2.0.json` the same way |

Install a built package with `code --install-extension flowable-design-<version>.vsix` (or Extensions view → ... → Install from VSIX).

Publishing: `npx vsce login nguyentaijs`, then `npx vsce publish` (add `--pre-release` for a pre-release).

## Where behaviour is configured

| Where | What |
|---|---|
| `.vscode/launch.json` | F5 launch: opens the `samples/` folder in the Extension Development Host |
| `package.json` → `activationEvents` | Extension starts for XML files and for workspaces containing `.bpmn` or `.dmn` |
| `package.json` → `customEditors` | Which file names open in which editor (priority `default`) |
| `.vscodeignore` | Only `dist/*.js`, `dist/*.cjs`, `dist/*.css`, README, CHANGELOG and `package.json` go into the `.vsix` |

## Project layout

| Path | Contents |
|---|---|
| `src/core/` | Pure logic, no VS Code or browser dependencies: XML parser with source ranges, the differ, rules, schema access, validators, panel and palette registries, DMN model, run history |
| `src/extension/` | VS Code side: the shared editor provider, BPMN and DMN providers, diagnostics, decision index, navigation, run commands, database access and run panel |
| `src/webview/` | Browser side: bpmn-js modeler and properties panel, DMN grid, run viewer |
| `schema/` | Generated Flowable 7.2.0 schemas (BPMN attributes and children; DMN hit policies and aggregations). Never hand-edited. |
| `samples/` | Dummy BPMN and DMN files for trying the extension and for tests |
| `test/diff/`, `test/data/` | Tests and test-only input files |
| `references/` | Reference material (not part of the extension) |

## Extending it

Most behaviour is data or registry driven, and every `register…` function returns a function that removes the entry again.

| To add or change | Use | Where |
|---|---|---|
| Text that must not be written, attributes that don't count as changes, equivalent spellings, CDATA for certain elements, order-sensitive elements | `registerRule(kind, rule)` | `src/core/rules.mjs` |
| A diagnostic | `registerValidator({ name, kind, check \| checkDocument })` | `src/core/validators.mjs` |
| A properties-panel group or field | `registerProvider({ id, appliesTo, groups })` | `src/core/panel.mjs` |
| A field check such as id validation | `registerFieldValidator(name, fn)` | `src/core/panel.mjs` |
| A palette entry | `registerPaletteEntry({ id, type, attrs, … })` | `src/core/palette.mjs` |
| More Flowable attributes or elements | `extendSchema(patch)`, or add the element to the generator | `src/core/schema.mjs`, `scripts/extract-flowable-schema.mjs` |

## Tests

Core logic is covered by `node --test` (differ, rules, validators, panel, palette, DMN model, run history). The visual editors and the run viewer have only headless checks; they need a human pass in VS Code after changes.
