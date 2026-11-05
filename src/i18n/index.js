import { createI18n } from 'vue-i18n'
import en from './locales/en.json'
import fr from './locales/fr.json'
import de from './locales/de.json'
import es from './locales/es.json'
import pt from './locales/pt.json'

/** Each language is listed in its own name, so people can find theirs. */
export const SUPPORTED_LOCALES = [
  { code: 'en', name: 'English' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'es', name: 'Español' },
  { code: 'pt', name: 'Português' },
]
export const DEFAULT_LOCALE = 'en'

const STORAGE_KEY = 'tuner.locale'
const isSupported = (code) => SUPPORTED_LOCALES.some((l) => l.code === code)

function readSaved() {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return isSupported(v) ? v : null
  } catch {
    return null // private mode, storage blocked...
  }
}

export const i18n = createI18n({
  legacy: false, // Composition API: useI18n()
  locale: readSaved() ?? DEFAULT_LOCALE,
  fallbackLocale: DEFAULT_LOCALE, // a key missing in a language shows the English text
  messages: { en, fr, de, es, pt },
})

function syncHtmlLang(code) {
  if (typeof document !== 'undefined') document.documentElement.lang = code
}
syncHtmlLang(i18n.global.locale.value)

/** Change the language, remember it on this device and update <html lang>. */
export function setLocale(code) {
  if (!isSupported(code)) return
  i18n.global.locale.value = code
  try {
    localStorage.setItem(STORAGE_KEY, code)
  } catch {
    /* ignore */
  }
  syncHtmlLang(code)
}
