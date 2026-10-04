/**
 * The GHG Protocol vocabulary plugin.
 *
 * A claim's `category` is free text in the store, which is where inventories drift: the same
 * thing gets spelled three ways across a quarter, and a defect report becomes unsearchable. This
 * plugin publishes the standard's terms so the same check can be run against them.
 *
 * It is a plugin rather than core because the vocabulary is jurisdictional: a programme reporting
 * under ESRS or CDP wants different categories than one under the GHG Protocol, and that is a
 * deployment choice, not something the forge should hard-code.
 */

export const manifest = {
  name: 'ghg-protocol-defects',
  version: '0.1.0',
}

/** The twelve scope 1 categories in the GHG Protocol. */
export const SCOPE_1_CATEGORIES = Object.freeze([
  'stationary-combustion',
  'mobile-combustion',
  'fugitive-emissions',
  'process-emissions',
])

/** Scope 2 is location- and market-based; both methods are legitimate, neither is default. */
export const SCOPE_2_CATEGORIES = Object.freeze([
  'purchased-electricity',
  'purchased-heat',
  'tenant-electricity',
])

export const SCOPE_3_CATEGORIES = Object.freeze([
  'purchased-goods-and-services',
  'capital-goods',
  'fuel-and-energy-related-activities',
  'upstream-transport-and-distribution',
  'waste-generated-in-operations',
  'business-travel',
  'employee-commuting',
  'upstream-logistics',
  'downstream-logistics',
  'use-of-sold-products',
  'end-of-life-treatment',
])

const BY_SCOPE = new Map([
  [1, SCOPE_1_CATEGORIES],
  [2, SCOPE_2_CATEGORIES],
  [3, SCOPE_3_CATEGORIES],
])

/** Which standard categories exist for a scope. An unknown scope yields nothing, not a guess. */
export function categoriesForScope(scope) {
  return BY_SCOPE.get(scope) ?? []
}

export function isKnownCategory(scope, category) {
  return categoriesForScope(scope).includes(category)
}

/** The categories this vocabulary does not cover, so a gap is visible rather than silent. */
export function describe() {
  return {
    plugin: manifest.name,
    scopes: [1, 2, 3].map((scope) => ({ scope, categories: categoriesForScope(scope).length })),
    capabilities: ['ghg.scopeVocabulary', 'ghg.categoryVocabulary'],
  }
}
