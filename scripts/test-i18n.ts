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
  assert.strictEqual(t('modes.outbreak_horde'), 'Outbreak Horde');
  assert.strictEqual(t('modes.blackout_radar'), 'Blackout Radar');
  console.log('✓ Test 3: Default English translations retrieve correct tactical strings');
}

// Test 4: Locale Switching across languages
{
  setLocale('es');
  assert.strictEqual(getLocale(), 'es');
  assert.strictEqual(t('roles.runner'), 'Corredor');
  assert.strictEqual(t('modes.classic_chase'), 'Persecución Clásica');
  assert.strictEqual(t('modes.outbreak_horde'), 'Horda del Brote');

  setLocale('ja');
  assert.strictEqual(t('roles.runner'), 'ランナー');
  assert.strictEqual(t('common.ready'), '準備完了');
  assert.strictEqual(t('modes.blackout_radar'), 'ブラックアウトレーダー');

  setLocale('de');
  assert.strictEqual(t('roles.hunter'), 'Jäger');
  assert.strictEqual(t('modes.jailbreak'), 'Gefängnisausbruch');

  setLocale('fr');
  assert.strictEqual(t('roles.runner'), 'Fugitif');
  assert.strictEqual(t('modes.territory_pulse'), 'Pulsion de Territoire');

  // Reset back to English
  setLocale('en');
  console.log('✓ Test 4: Dynamic locale switching successfully changes output language');
}

// Test 5: Per-call override
{
  const overrideRes = t('roles.hunter', undefined, 'de');
  assert.strictEqual(overrideRes, 'Jäger');
  assert.strictEqual(getLocale(), 'en', 'Active locale should remain en');
  console.log('✓ Test 5: Per-call override executes without altering global locale');
}

// Test 6: Parameter Interpolation
{
  const interpolatedEn = t('alerts.countdown', { seconds: 15 });
  assert.strictEqual(interpolatedEn, '15s remaining');

  const interpolatedEs = t('alerts.countdown', { seconds: 30 }, 'es');
  assert.strictEqual(interpolatedEs, '30s restantes');

  const interpolatedJa = t('alerts.countdown', { seconds: 10 }, 'ja');
  assert.strictEqual(interpolatedJa, '残り10秒');

  const distanceAlert = t('alerts.hunter_distance', { distance: 25 }, 'en');
  assert.strictEqual(distanceAlert, 'Hunter within 25m!');
  console.log('✓ Test 6: Parameter interpolation substitutes template placeholders across locales');
}

// Test 7: Fallback to English for missing keys in custom dicts
{
  const missingFallback = t('roles.runner', undefined, 'invalid_locale' as any);
  assert.strictEqual(missingFallback, 'Runner', 'Falls back to English for unknown locale');
  console.log('✓ Test 7: Graceful fallback to English dictionary on missing locale');
}

console.log('\nAll 7 NF-20 localisation tests passed successfully!\n');
