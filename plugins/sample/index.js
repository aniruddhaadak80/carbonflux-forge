/**
 * A plugin entry point. The manifest is the contract; this file is the behaviour.
 *
 * The registry loads the manifest, validates it, and reports the result. Registration of
 * actual tools happens through the same core registry every other surface uses — a plugin
 * gets no privileged path.
 */
export const manifest = {
  name: 'sample',
  version: '0.1.0',
}

export function describe() {
  return { plugin: manifest.name, capabilities: ['sample.echo'] }
}
