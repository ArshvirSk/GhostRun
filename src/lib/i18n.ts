/**
 * NF-20: Central Localisation (i18n) Engine
 *
 * Provides type-safe string translations across 5 languages:
 * English (en, default), Spanish (es), German (de), French (fr), Japanese (ja).
 */

export type SupportedLocale = 'en' | 'es' | 'de' | 'fr' | 'ja';

export const SUPPORTED_LOCALES: { id: SupportedLocale; name: string }[] = [
  { id: 'en', name: 'English' },
  { id: 'es', name: 'Español' },
  { id: 'de', name: 'Deutsch' },
  { id: 'fr', name: 'Français' },
  { id: 'ja', name: '日本語' },
];

export const TRANSLATION_CATALOG = {
  en: {
    // Common
    'common.host': 'Host a game',
    'common.join': 'Join with a code',
    'common.ready': 'Ready',
    'common.cancel': 'Cancel',
    'common.confirm': 'Confirm',
    'common.save': 'Save',
    'common.dismiss': 'Dismiss',
    'common.share': 'Share',
    'common.back': 'Back',

    // Roles
    'roles.runner': 'Runner',
    'roles.hunter': 'Hunter',
    'roles.spectator': 'Spectator',
    'roles.operator': 'Operator',

    // Modes
    'modes.classic_chase': 'Classic Chase',
    'modes.tag_hunt': 'Tag Hunt',
    'modes.jailbreak': 'Jailbreak',
    'modes.ghost_duel': 'Ghost Duel',
    'modes.relay_heist': 'Relay Heist',

    // Tactical Alerts
    'alerts.hunter_nearby': 'Hunter nearby! Conceal position.',
    'alerts.radar_ping': 'Radar ping sweep incoming.',
    'alerts.you_were_tagged': 'You have been tagged! Transitioning role.',
    'alerts.tag_confirmed': 'Target tagged successfully.',
    'alerts.boundary_warning': 'Warning: Approaching operational boundary.',

    // Safety & SOS
    'safety.checkin_prompt': 'Safety Check-in: Confirm you are safe.',
    'safety.im_safe': "I'm safe",
    'safety.sos_broadcast': 'EMERGENCY SOS: Player has triggered distress.',
    'safety.curfew_alert': 'Curfew in effect. Keep to illuminated areas.',
  },
  es: {
    // Common
    'common.host': 'Crear partida',
    'common.join': 'Unirse con código',
    'common.ready': 'Listo',
    'common.cancel': 'Cancelar',
    'common.confirm': 'Confirmar',
    'common.save': 'Guardar',
    'common.dismiss': 'Cerrar',
    'common.share': 'Compartir',
    'common.back': 'Atrás',

    // Roles
    'roles.runner': 'Corredor',
    'roles.hunter': 'Cazador',
    'roles.spectator': 'Espectador',
    'roles.operator': 'Operador',

    // Modes
    'modes.classic_chase': 'Persecución Clásica',
    'modes.tag_hunt': 'Cacería',
    'modes.jailbreak': 'Fuga de Prisión',
    'modes.ghost_duel': 'Duelo Fantasma',
    'modes.relay_heist': 'Atraco por Relevos',

    // Tactical Alerts
    'alerts.hunter_nearby': '¡Cazador cerca! Oculta tu posición.',
    'alerts.radar_ping': 'Barrido de radar entrante.',
    'alerts.you_were_tagged': '¡Has sido atrapado!',
    'alerts.tag_confirmed': 'Objetivo atrapado con éxito.',
    'alerts.boundary_warning': 'Aviso: Límite del área aproximándose.',

    // Safety & SOS
    'safety.checkin_prompt': 'Control de seguridad: Confirma que estás a salvo.',
    'safety.im_safe': 'Estoy a salvo',
    'safety.sos_broadcast': 'SOS DE EMERGENCIA: Jugador en apuros.',
    'safety.curfew_alert': 'Toque de queda activo. Permanece en áreas iluminadas.',
  },
  de: {
    // Common
    'common.host': 'Spiel erstellen',
    'common.join': 'Mit Code beitreten',
    'common.ready': 'Bereit',
    'common.cancel': 'Abbrechen',
    'common.confirm': 'Bestätigen',
    'common.save': 'Speichern',
    'common.dismiss': 'Schließen',
    'common.share': 'Teilen',
    'common.back': 'Zurück',

    // Roles
    'roles.runner': 'Läufer',
    'roles.hunter': 'Jäger',
    'roles.spectator': 'Zuschauer',
    'roles.operator': 'Operator',

    // Modes
    'modes.classic_chase': 'Klassische Jagd',
    'modes.tag_hunt': 'Fangjagd',
    'modes.jailbreak': 'Gefängnisausbruch',
    'modes.ghost_duel': 'Geister-Duell',
    'modes.relay_heist': 'Staffel-Raubzug',

    // Tactical Alerts
    'alerts.hunter_nearby': 'Jäger in der Nähe! Verstecken!',
    'alerts.radar_ping': 'Radar-Ping-Impuls naht.',
    'alerts.you_were_tagged': 'Du wurdest markiert!',
    'alerts.tag_confirmed': 'Ziel erfolgreich markiert.',
    'alerts.boundary_warning': 'Warnung: Zonenrand nähert sich.',

    // Safety & SOS
    'safety.checkin_prompt': 'Sicherheits-Check: Bestätige deine Sicherheit.',
    'safety.im_safe': 'Ich bin in Sicherheit',
    'safety.sos_broadcast': 'NOTRUF SOS: Spieler in Not.',
    'safety.curfew_alert': 'Ausgangssperre aktiv. Bleibe in beleuchteten Bereichen.',
  },
  fr: {
    // Common
    'common.host': 'Créer une partie',
    'common.join': 'Rejoindre avec un code',
    'common.ready': 'Prêt',
    'common.cancel': 'Annuler',
    'common.confirm': 'Confirmer',
    'common.save': 'Enregistrer',
    'common.dismiss': 'Fermer',
    'common.share': 'Partager',
    'common.back': 'Retour',

    // Roles
    'roles.runner': 'Fugitif',
    'roles.hunter': 'Chasseur',
    'roles.spectator': 'Spectateur',
    'roles.operator': 'Opérateur',

    // Modes
    'modes.classic_chase': 'Course Classique',
    'modes.tag_hunt': 'Chasse Traquée',
    'modes.jailbreak': 'Évasion',
    'modes.ghost_duel': 'Duel Fantôme',
    'modes.relay_heist': 'Braquage Relais',

    // Tactical Alerts
    'alerts.hunter_nearby': 'Chasseur proche ! Cachez-vous.',
    'alerts.radar_ping': 'Balayage radar imminent.',
    'alerts.you_were_tagged': 'Vous avez été capturé !',
    'alerts.tag_confirmed': 'Cible capturée avec succès.',
    'alerts.boundary_warning': 'Attention : Approche de la limite de zone.',

    // Safety & SOS
    'safety.checkin_prompt': 'Point de sécurité : Confirmez votre sécurité.',
    'safety.im_safe': 'Je vais bien',
    'safety.sos_broadcast': "SOS D'URGENCE : Signal de détresse émis.",
    'safety.curfew_alert': 'Couvre-feu en vigueur. Restez dans les zones éclairées.',
  },
  ja: {
    // Common
    'common.host': 'ゲームを作成',
    'common.join': 'コードで参加',
    'common.ready': '準備完了',
    'common.cancel': 'キャンセル',
    'common.confirm': '確認',
    'common.save': '保存',
    'common.dismiss': '閉じる',
    'common.share': '共有',
    'common.back': '戻る',

    // Roles
    'roles.runner': 'ランナー',
    'roles.hunter': 'ハンター',
    'roles.spectator': '観戦者',
    'roles.operator': 'オペレーター',

    // Modes
    'modes.classic_chase': 'クラシックチェイス',
    'modes.tag_hunt': 'タグハント',
    'modes.jailbreak': '脱獄',
    'modes.ghost_duel': 'ゴーストデュエル',
    'modes.relay_heist': 'リレーハイスト',

    // Tactical Alerts
    'alerts.hunter_nearby': 'ハンター接近！身を隠せ。',
    'alerts.radar_ping': 'レーダーパルス探知中。',
    'alerts.you_were_tagged': 'タグされました！',
    'alerts.tag_confirmed': 'ターゲットのタグに成功。',
    'alerts.boundary_warning': '警告: 作戦エリアの境界に接近中。',

    // Safety & SOS
    'safety.checkin_prompt': '安否確認: 安全を確認してください。',
    'safety.im_safe': '無事です',
    'safety.sos_broadcast': '緊急SOS: 救助要請が送信されました。',
    'safety.curfew_alert': '門限発動中。明るいエリアにとどまってください。',
  },
};

export type TranslationKey = keyof (typeof TRANSLATION_CATALOG)['en'];

let activeLocale: SupportedLocale = 'en';

export function setLocale(locale: SupportedLocale): void {
  if (TRANSLATION_CATALOG[locale]) {
    activeLocale = locale;
  }
}

export function getLocale(): SupportedLocale {
  return activeLocale;
}

/**
 * Translates a key with optional parameter interpolation
 */
export function t(
  key: TranslationKey,
  params?: Record<string, string | number>,
  overrideLocale?: SupportedLocale
): string {
  const loc = overrideLocale || activeLocale;
  const dict = TRANSLATION_CATALOG[loc] || TRANSLATION_CATALOG.en;
  let text = (dict as any)[key] || TRANSLATION_CATALOG.en[key] || (key as string);

  if (params) {
    for (const [paramKey, paramValue] of Object.entries(params)) {
      text = text.replace(new RegExp(`{${paramKey}}`, 'g'), String(paramValue));
    }
  }

  return text;
}
