# Plugins

A plugin is a folder with a `plugin.json` manifest. The registry validates every manifest
against a schema, resolves capability conflicts by priority, and reports **why** each plugin
was accepted, shadowed, disabled, or rejected. Nothing is dropped silently.

```json
{
  "name": "example",
  "version": "1.0.0",
  "description": "One sentence a human can act on.",
  "enabled": true,
  "priority": 50,
  "capabilities": ["example.capability"],
  "engines": { "@@carbonfluxforge/core": "0.1.0" }
}
```

- `priority` (0–100) decides a capability conflict. Highest wins; the loser is reported.
- `capabilities` are the names this plugin claims. Two plugins claiming one is a conflict.
- `engines` are exact version matches. A mismatch rejects the plugin and names both versions.

Inspect the resolved state with:

```bash
carbonflux-forge plugins --json
```
