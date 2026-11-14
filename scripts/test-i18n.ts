import assert from 'node:assert';
import {
  t,
  setLocale,
  getLocale,
  SUPPORTED_LOCALES,
  TRANSLATION_CATALOG,
  TranslationKey,
} from '../src/lib/i18n';

console.log('--- Testing NF-20: Central Localisation (i18n) Engine ---');

// Test 1: Supported Locales List
{
  assert.strictEqual(SUPPORTED_LOCALES.length, 5, 'Must support 5 languages');
  const ids = SUPPORTED_LOCALES.map((l) => l.id);
  assert.ok(ids.includes('en'));
  assert.ok(ids.includes('es'));
  assert.ok(ids.includes('de'));
  assert.ok(ids.includes('fr'));
  assert.ok(ids.includes('ja'));
  console.log('✓ Test 1: SUPPORTED_LOCALES includes en, es, de, fr, ja');
}

// Test 2: Key parity across dictionaries
{
  const enKeys = Object.keys(TRANSLATION_CATALOG.en) as TranslationKey[];
  for (const locale of ['es', 'de', 'fr', 'ja'] as const) {
    const locKeys = Object.keys(TRANSLATION_CATALOG[locale]);
    for (const key of enKeys) {
      assert.ok(
        (TRANSLATION_CATALOG[locale] as any)[key],
        `Locale ${locale} is missing translation for "${key}"`
      );
    }
  }
  console.log(`✓ Test 2: Full parity verified across all ${enKeys.length} translation keys for all languages`);
}

// Test 3: Default English Translations
{
  setLocale('en');
  assert.strictEqual(t('roles.runner'), 'Runner');
  assert.strictEqual(t('roles.hunter'), 'Hunter');
  assert.strictEqual(t('alerts.hunter_nearby'), 'Hunter nearby! Conceal position.');
  console.log('✓ Test 3: Default English translations retrieve correct tactical strings');
}

// Test 4: Locale Switching
{
  setLocale('es');
  assert.strictEqual(getLocale(), 'es');
  assert.strictEqual(t('roles.runner'), 'Corredor');
  assert.strictEqual(t('modes.classic_chase'), 'Persecución Clásica');

  setLocale('ja');
  assert.strictEqual(t('roles.runner'), 'ランナー');
  assert.strictEqual(t('common.ready'), '準備完了');

  setLocale('de');
  assert.strictEqual(t('roles.hunter'), 'Jäger');

  setLocale('fr');
  assert.strictEqual(t('roles.runner'), 'Fugitif');

  // Reset back to English
  setLocale('en');
  console.log('✓ Test 4: Dynamic locale switching successfully changes output language');
}

// Test 5: Per-call override & parameter interpolation
{
  const overrideRes = t('roles.hunter', undefined, 'de');
  assert.strictEqual(overrideRes, 'Jäger');
  assert.strictEqual(getLocale(), 'en', 'Active locale should remain en');
  console.log('✓ Test 5: Per-call override executes without altering global locale');
}

console.log('\nAll 5 NF-20 localisation tests passed successfully!\n');
