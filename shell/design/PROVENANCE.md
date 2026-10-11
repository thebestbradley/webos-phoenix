# Provenance of Ember Glass's values and glyphs in the shell

Phoenix 2.0's look, Ember Glass (`docs/SYSTEM-UI-2.md`), is drawn with:

- **`ember-glass.tokens.json`**: a copy of Ember Glass UI's design tokens
  (github.com/thebestbradley/ember-glass-ui, `tokens/ember-glass.tokens.json`,
  Apache-2.0 like this repository), read off this repository's own mock-ups
  (`docs/design-2.0/directions/ember-glass/`). `ember-glass.tokens.source.json`
  records the commit, version and SHA-256 it was copied from;
  `tools/gen-ember-glass-qml.cjs --from <checkout>` refreshes both and writes
  `shell/qml/Phoenix/Shell/EmberGlass.qml` from them.
- **Phosphor Icons** (github.com/phosphor-icons/core, MIT, the light weight;
  `LICENSE-phosphor`): the path data of the few glyphs the shell draws, in
  `shell/qml/Phoenix/Shell/EmberGlassIcons.js`, written by
  `tools/gen-ember-glass-icons.cjs` from `@phosphor-icons/core` 2.1.1. The
  mock-ups use the same set (SPEC.md, "Licences"). No Palm, HP or Onyx art
  is copied.
- **The gesture light, the card's glass and the status bar's scrim** are
  drawn in QML from the tokens and `docs/design-2.0/directions/ember-glass/assets/base.css`;
  they are not pictures.
