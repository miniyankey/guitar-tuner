<script setup>
// npm i vue-i18n @fontsource-variable/inter-tight
import '@fontsource-variable/inter-tight'
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { SUPPORTED_LOCALES, setLocale } from '@/i18n'
import { useTuner } from '@/composables/useTuner'
import NumberField from './NumberField.vue'
import {
  guitar,
  INSTRUMENTS,
  TUNING_PRESETS,
  NOTE_NAMES,
  setDefaultTuning,
  setGuitar,
  setGlobalShift,
  setReferencePitch,
  setFirstStringFrequency,
  setTuningModel,
  setInstrument,
  setStringNote,
  setStringFrequency,
  resetString,
  resetOverrides,
} from '@/stores/useGuitar'

const { t, locale } = useI18n()

/* ========================================================================== */
/*  Micro et détection                                                        */
/* ========================================================================== */

const DEFAULT_DETECTION = { sensitivity: 7, smoothing: 5, tolerance: 5, autoGain: false }
const detection = reactive({ ...DEFAULT_DETECTION })

/**
 * Le seuil de silence est fixe APRÈS le gain. La sensibilité (1 à 10) règle le gain d'entrée :
 * niveau 1 = seuil brut 0,02, niveau 7 (défaut) ≈ 0,0009 (×11), niveau 10 ≈ 0,0002 (×50).
 * Plus la sensibilité est haute, plus la détection tolère un signal bruité.
 */
const GATE = 0.01
const audio = computed(() => {
  const s = detection.sensitivity
  const rawGate = 0.02 * 0.6 ** (s - 1)
  return { gain: GATE / rawGate, yin: 0.12 + ((s - 1) * 0.13) / 9 }
})

const {
  isListening,
  error: micError,
  errorCode: micErrorCode,
  level,
  sinceDetection,
  reading,
  status,
  mode,
  targetIndex,
  start,
  toggle,
  selectString,
} = useTuner({
  inputGain: () => audio.value.gain,
  minRms: GATE,
  yinThreshold: () => audio.value.yin,
  minClarity: 0, // le seuil YIN filtre déjà les sons pas assez nets
  smoothing: () => detection.smoothing,
  inTuneCents: () => detection.tolerance,
  autoGainControl: () => detection.autoGain,
})

const micMessage = computed(() =>
  micErrorCode.value ? t(`mic.${micErrorCode.value}`, { message: micError.value ?? '' }) : '',
)

// Signal trop faible : en écoute, aucune note, et sous le seuil depuis 3 s
const quietFor = ref(0)
let lastLoud = 0
watch([level, sinceDetection], () => {
  const now = performance.now()
  if (!lastLoud || level.value >= GATE) lastLoud = now
  quietFor.value = now - lastLoud
})
watch(isListening, () => {
  lastLoud = 0
  quietFor.value = 0
})
const lowSignal = computed(() => isListening.value && !reading.value && quietFor.value > 3000)
const boost = () => {
  detection.sensitivity = Math.min(10, detection.sensitivity + 1)
  lastLoud = 0
}

/** RMS -> % sur une échelle log : le repère (GATE) tombe à ~43 %. */
const toPct = (rms) =>
  Math.min(100, Math.max(0, ((Math.log10(Math.max(rms, 1e-5)) + 3.5) / 3.5) * 100))
const levelPct = computed(() => (isListening.value ? toPct(level.value) : 0))
const gatePct = `${toPct(GATE)}%`

/* ========================================================================== */
/*  Formats (suivent la langue : 82.41 en anglais, 82,41 ailleurs)            */
/* ========================================================================== */

const nf = (n, d = 2) =>
  n.toLocaleString(locale.value, {
    minimumFractionDigits: 0,
    maximumFractionDigits: d,
    useGrouping: false,
  })
const fmtHz = (n) => nf(n, 2)

/** Accepte le point ou la virgule, quelle que soit la langue. */
function parseHz(str) {
  const n = Number(String(str).replace(/\s/g, '').replace(',', '.'))
  if (!(n > 0)) throw new Error(t('errors.invalidHz'))
  return n
}

const EIGHTHS = ['', '⅛', '¼', '⅜', '½', '⅝', '¾', '⅞']
const UNICODE_FRACTIONS = {
  '⅛': 0.125,
  '¼': 0.25,
  '⅜': 0.375,
  '½': 0.5,
  '⅝': 0.625,
  '¾': 0.75,
  '⅞': 0.875,
}

/** -0.25 -> "−¼" ; 1.5 -> "+1½" ; 0 -> "0" */
function fmtTones(v) {
  if (Math.abs(v) < 0.005) return '0'
  const abs = Math.abs(v)
  const eighths = Math.round(abs * 8)
  let body
  if (Math.abs(abs * 8 - eighths) < 0.04) {
    const whole = Math.floor(eighths / 8)
    body = `${whole || ''}${EIGHTHS[eighths % 8]}` || '0'
  } else {
    body = nf(abs, 2)
  }
  return `${v < 0 ? '−' : '+'}${body}`
}

/** Accepte -1/4, −0,25, +½, 1¼ ... (en tons). L'unité tapée (tone, ton, Ton, tono, tom...) est ignorée. */
function parseTones(str) {
  const s = String(str)
    .trim()
    .replace(/[−–]/g, '-')
    .replace(',', '.')
    .replace(/\s+/g, '')
    .replace(/\p{L}+$/u, '')
  const m = /^([+-]?)(?:(\d+)\/(\d+)|(\d*\.?\d*)([⅛¼⅜½⅝¾⅞])?)$/.exec(s)
  if (!s || !m || (!m[2] && !m[4] && !m[5])) throw new Error(t('errors.invalidTones'))
  let n
  if (m[2]) {
    if (Number(m[3]) === 0) throw new Error(t('errors.divisionByZero'))
    n = Number(m[2]) / Number(m[3])
  } else {
    n = (m[4] ? Number(m[4]) : 0) + (m[5] ? UNICODE_FRACTIONS[m[5]] : 0)
  }
  n = m[1] === '-' ? -n : n
  if (Math.abs(n) > 6) throw new Error(t('errors.tooLarge'))
  return n
}

/* ========================================================================== */
/*  Navigation                                                                */
/* ========================================================================== */

const PAGES = {
  strings: 'tuning',
  pitch: 'tuning',
  custom: 'tuning',
  detection: 'settings',
  language: 'settings',
} // sous-page -> onglet parent

const tab = ref('tuner')
const pages = reactive({ tuning: null, settings: null }) // sous-page ouverte, par onglet
const page = computed(() => (tab.value === 'tuner' ? null : pages[tab.value]))
const title = computed(() => (page.value ? t(`pages.${page.value}`) : t(`tabs.${tab.value}`)))

const formError = ref('')
const customDraft = ref('')
const screenEl = ref(null)

function goTab(name) {
  formError.value = ''
  if (tab.value === name) pages[name] = null // toucher l'onglet actif revient à sa racine
  tab.value = name
}
function open(key) {
  formError.value = ''
  const parent = PAGES[key]
  tab.value = parent
  pages[parent] = key
  if (key === 'custom') customDraft.value = tuningLabel.value
}
function back() {
  formError.value = ''
  pages[tab.value] = null
}
watch([tab, page], () => nextTick(() => screenEl.value && (screenEl.value.scrollTop = 0)))

/** Erreurs du store (GuitarError : code + params) ou des champs (message déjà traduit). */
function attempt(fn) {
  try {
    fn()
    formError.value = ''
  } catch (e) {
    formError.value = e?.code
      ? t(`errors.${e.code}`, e.params ?? {})
      : e?.message || t('errors.invalidValue')
  }
}
const onInvalid = (msg) => (formError.value = msg || t('errors.invalidValue'))

// Un message affiché reste dans l'ancienne langue : on l'efface au changement de langue.
watch(locale, () => (formError.value = ''))

/* ========================================================================== */
/*  Langue                                                                    */
/* ========================================================================== */

const currentLanguage = computed(
  () => SUPPORTED_LOCALES.find((l) => l.code === locale.value)?.name ?? '',
)

/* ========================================================================== */
/*  Accordage                                                                 */
/* ========================================================================== */

const instrumentLabel = (i) => t(`instrument.${i.guitarType}`, { n: i.numberStrings })

// Noms propres, identiques dans toutes les langues
const PRESET_NAMES = {
  dropD: 'Drop D',
  dadgad: 'DADGAD',
  openG: 'Open G',
  openD: 'Open D',
  openE: 'Open E',
}
// « Demi-ton / ton plus bas » doublonnent le ton global : on ne les propose pas ici.
const HIDDEN_PRESETS = new Set(['halfStepDown', 'fullStepDown'])

const SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
/** Accordage « Drop » : la corde la plus grave descend d'un ton. */
function dropOf(tuning) {
  const notes = tuning.match(/[A-G][#b]?/g) ?? []
  if (!notes.length) return null
  const n = notes[0]
  const v = SEMI[n[0]] + (n[1] === '#' ? 1 : n[1] === 'b' ? -1 : 0) - 2
  const note = NOTE_NAMES[((v % 12) + 12) % 12]
  return { id: 'drop', note, tuning: note + notes.slice(1).join('') }
}

const tuningLabel = computed(() => guitar.strings.map((s) => s.label).join(''))
const instrumentId = computed(() => `${guitar.guitarType}-${guitar.numberStrings}`)
const customCount = computed(
  () => guitar.strings.filter((s) => s.customNote || s.customFrequency).length,
)

const presetList = computed(() => {
  let list
  if (guitar.guitarType === 'guitar' && guitar.numberStrings === 6) {
    list = TUNING_PRESETS.filter((p) => !HIDDEN_PRESETS.has(p.id)).map((p) => ({
      id: p.id,
      tuning: p.tuning,
    }))
  } else {
    const std = setDefaultTuning(guitar.numberStrings, guitar.guitarType)
    list = std ? [{ id: 'standard', tuning: std }, dropOf(std)].filter(Boolean) : []
  }
  return list.map((p) => ({
    ...p,
    label:
      p.id === 'standard'
        ? t('presets.standard')
        : p.id === 'drop'
          ? t('presets.drop', { note: p.note })
          : (PRESET_NAMES[p.id] ?? p.id),
  }))
})
const activePreset = computed(() =>
  customCount.value ? null : presetList.value.find((p) => p.tuning === tuningLabel.value),
)

const shiftTones = computed(() => guitar.shiftCents / 200)
const hasShift = computed(() => Math.abs(shiftTones.value) >= 0.005)
const shiftText = computed(
  () => `${fmtTones(shiftTones.value)} ${t('units.tone', Math.abs(shiftTones.value) > 1 ? 2 : 1)}`,
)
const SHIFT_CHIPS = [-1, -0.5, -0.25, 0, 0.25, 0.5, 1]
const stepShift = (dir) =>
  attempt(() => setGlobalShift(Math.round((shiftTones.value + dir * 0.125) * 1000) / 1000))

const A4_CHIPS = [432, 440, 442]
const OCTAVES = [0, 1, 2, 3, 4, 5, 6, 7]

const onInstrument = (id) => {
  const inst = INSTRUMENTS.find((i) => i.id === id)
  attempt(() => setInstrument(inst.guitarType, inst.numberStrings))
}
const onNoteName = (s, e) => attempt(() => setStringNote(s.index, `${e.target.value}${s.octave}`))
const onOctave = (s, e) => attempt(() => setStringNote(s.index, `${s.note}${e.target.value}`))
function applyCustom() {
  attempt(() => setTuningModel(customDraft.value.trim()))
  if (!formError.value) back()
}
function resetTuning() {
  const inst = INSTRUMENTS.find((i) => i.id === instrumentId.value) ?? INSTRUMENTS[0]
  attempt(() => setGuitar({ guitarType: inst.guitarType, numberStrings: inst.numberStrings }))
}
const resetDetection = () => Object.assign(detection, DEFAULT_DETECTION)

const chromatic = computed({
  get: () => mode.value === 'chromatic',
  set: (on) => (mode.value = on ? 'chromatic' : 'auto'),
})

/* ========================================================================== */
/*  Écran Accorder                                                            */
/* ========================================================================== */

const activeIndex = computed(() => reading.value?.string?.index ?? -1)
const isOk = computed(() => !!reading.value?.inTune)
const targetString = computed(() =>
  mode.value === 'string' ? guitar.strings[targetIndex.value] : null,
)

const bigNote = computed(() => {
  if (reading.value?.string) return reading.value.string.name
  if (reading.value) return `${reading.value.note.name}${reading.value.note.octave}`
  if (targetString.value) return targetString.value.name
  return '–'
})

const hint = computed(() => {
  switch (status.value) {
    case 'idle':
      return t('tuner.hint.idle')
    case 'waiting':
      return targetString.value
        ? t('tuner.hint.waitingString', { note: targetString.value.name })
        : t('tuner.hint.waiting')
    case 'flat':
      return t('tuner.hint.flat')
    case 'sharp':
      return t('tuner.hint.sharp')
    default:
      return t('tuner.hint.inTune')
  }
})

const centsText = computed(() => {
  if (!reading.value) return ''
  const c = Math.round(reading.value.cents)
  return t('tuner.cents', { value: `${c > 0 ? '+' : c < 0 ? '−' : ''}${Math.abs(c)}` })
})

const markLeft = computed(() => `${((reading.value?.needle ?? 0) + 1) * 50}%`)
const zoneWidth = computed(() => `${detection.tolerance * 2}%`)
</script>

<template>
  <div class="app">
    <header v-if="tab !== 'tuner'" class="top">
      <button
        v-if="page"
        type="button"
        class="icon-btn"
        :aria-label="t('common.back')"
        @click="back"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
      </button>
      <h1>{{ title }}</h1>
    </header>

    <main ref="screenEl" class="screen">
      <p v-if="formError && tab !== 'tuner'" class="notice" role="alert">{{ formError }}</p>

      <!-- ============================== ACCORDER ============================== -->
      <section v-if="tab === 'tuner'" class="tune" :aria-label="t('tuner.region')">
        <button type="button" class="summary" @click="goTab('tuning')">
          <span class="summary__main">
            {{ activePreset?.label ?? t('tuner.custom') }} <b>{{ tuningLabel }}</b>
          </span>
          <span v-if="hasShift" class="badge">{{ shiftText }}</span>
          <span v-if="mode === 'chromatic'" class="badge">{{ t('tuner.chromatic') }}</span>
          <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
        </button>

        <div class="stage" :class="{ ok: isOk }" aria-live="polite">
          <div class="stage__note">{{ bigNote }}</div>
          <div class="stage__freq">
            <template v-if="reading">
              <span>{{ nf(reading.frequency, 1) }} Hz</span>
              <span>{{ t('tuner.target', { hz: nf(reading.targetFrequency, 1) }) }}</span>
            </template>
            <span v-else>&nbsp;</span>
          </div>

          <div
            class="bar"
            role="meter"
            :aria-label="t('tuner.meter')"
            aria-valuemin="-50"
            aria-valuemax="50"
            :aria-valuenow="reading ? Math.round(reading.cents) : 0"
          >
            <div class="bar__track" />
            <div class="bar__zone" :style="{ width: zoneWidth }" />
            <i class="bar__tick" style="left: 0%" />
            <i class="bar__tick" style="left: 25%" />
            <i class="bar__tick bar__tick--mid" style="left: 50%" />
            <i class="bar__tick" style="left: 75%" />
            <i class="bar__tick" style="left: 100%" />
            <div class="bar__mark" :class="{ idle: !reading }" :style="{ left: markLeft }" />
          </div>
          <div class="bar__legend">
            <span>{{ t('tuner.tooLow') }}</span>
            <b>{{ centsText }}</b>
            <span>{{ t('tuner.tooHigh') }}</span>
          </div>

          <p class="stage__hint">{{ hint }}</p>
        </div>

        <div
          v-if="mode !== 'chromatic'"
          class="pills"
          role="radiogroup"
          :aria-label="t('tuner.stringPicker')"
        >
          <button
            type="button"
            role="radio"
            :aria-checked="mode === 'auto'"
            class="pill"
            :class="{ on: mode === 'auto' }"
            @click="mode = 'auto'"
          >
            {{ t('tuner.auto') }}
          </button>
          <button
            v-for="s in guitar.strings"
            :key="s.index"
            type="button"
            role="radio"
            :aria-checked="mode === 'string' && targetIndex === s.index"
            class="pill"
            :class="{
              on: mode === 'string' && targetIndex === s.index,
              hit: activeIndex === s.index,
            }"
            @click="selectString(s.index)"
          >
            {{ s.name }}
          </button>
        </div>

        <div v-if="lowSignal" class="notice notice--row" role="status">
          <span>{{ t('tuner.lowSignal') }}</span>
          <button
            v-if="detection.sensitivity < 10"
            type="button"
            class="chip chip--small"
            @click="boost"
          >
            {{ t('tuner.moreSensitivity') }}
          </button>
        </div>

        <div class="listen">
          <div class="meter" aria-hidden="true">
            <i class="meter__fill" :style="{ width: levelPct + '%' }" />
            <i class="meter__gate" :style="{ left: gatePct }" />
          </div>
          <button type="button" class="cta" :class="{ on: isListening }" @click="toggle">
            {{ isListening ? t('tuner.stop') : t('tuner.start') }}
          </button>
          <p v-if="micMessage" class="notice" role="alert">{{ micMessage }}</p>
        </div>
      </section>

      <!-- ============================== ACCORDAGE ============================= -->
      <template v-else-if="tab === 'tuning'">
        <!-- Racine -->
        <div v-if="!page" class="stack">
          <button type="button" class="strip" @click="open('strings')">
            <span class="strip__grid">
              <span
                v-for="s in guitar.strings"
                :key="s.index"
                class="strip__s"
                :class="{ custom: s.customNote || s.customFrequency }"
              >
                <b>{{ s.name }}</b>
                <small>{{ nf(s.frequency, 1) }}</small>
              </span>
            </span>
            <span class="strip__edit">
              {{ t('tuning.editStrings') }}
              <svg class="chev" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M9 5l7 7-7 7" />
              </svg>
            </span>
          </button>

          <section class="group">
            <h2>{{ t('tuning.instrument') }}</h2>
            <div class="chips" role="radiogroup" :aria-label="t('tuning.instrument')">
              <button
                v-for="i in INSTRUMENTS"
                :key="i.id"
                type="button"
                role="radio"
                class="chip"
                :class="{ on: instrumentId === i.id }"
                :aria-checked="instrumentId === i.id"
                @click="onInstrument(i.id)"
              >
                {{ instrumentLabel(i) }}
              </button>
            </div>
          </section>

          <section class="group">
            <h2>{{ t('tuning.tuning') }}</h2>
            <div class="list" role="radiogroup" :aria-label="t('tuning.tuning')">
              <button
                v-for="p in presetList"
                :key="p.id"
                type="button"
                class="row"
                role="radio"
                :aria-checked="activePreset?.id === p.id"
                @click="attempt(() => setTuningModel(p.tuning))"
              >
                <span class="row__label">{{ p.label }}</span>
                <span class="row__value">{{ p.tuning }}</span>
                <span class="row__end">
                  <svg
                    v-if="activePreset?.id === p.id"
                    class="check"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path d="M5 12.5l4.5 4.5L19 7.5" />
                  </svg>
                </span>
              </button>
              <button
                type="button"
                class="row"
                :aria-checked="!activePreset"
                role="radio"
                @click="open('custom')"
              >
                <span class="row__label">{{ t('tuner.custom') }}</span>
                <span class="row__value">{{ activePreset ? '' : tuningLabel }}</span>
                <span class="row__end">
                  <svg class="chev" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M9 5l7 7-7 7" />
                  </svg>
                </span>
              </button>
            </div>
          </section>

          <section class="group">
            <h2>{{ t('tuning.shift') }}</h2>
            <div class="chips chips--row" role="radiogroup" :aria-label="t('tuning.shift')">
              <button
                v-for="v in SHIFT_CHIPS"
                :key="v"
                type="button"
                role="radio"
                class="chip"
                :class="{ on: Math.abs(shiftTones - v) < 0.001 }"
                :aria-checked="Math.abs(shiftTones - v) < 0.001"
                @click="attempt(() => setGlobalShift(v))"
              >
                {{ fmtTones(v) }}
              </button>
            </div>
            <div class="stepper">
              <button
                type="button"
                class="chip"
                :aria-label="t('tuning.shiftDown')"
                @click="stepShift(-1)"
              >
                −⅛
              </button>
              <NumberField
                :model-value="shiftTones"
                :format="fmtTones"
                :parse="parseTones"
                inputmode="text"
                :unit="t('units.tone', 1)"
                :label="t('tuning.shiftField')"
                @update:model-value="(v) => attempt(() => setGlobalShift(v))"
                @invalid="onInvalid"
              />
              <button
                type="button"
                class="chip"
                :aria-label="t('tuning.shiftUp')"
                @click="stepShift(1)"
              >
                +⅛
              </button>
            </div>
          </section>

          <section class="group">
            <h2>{{ t('tuning.advanced') }}</h2>
            <div class="list">
              <button type="button" class="row" @click="open('strings')">
                <span class="row__label">{{ t('pages.strings') }}</span>
                <span class="row__value">{{
                  customCount ? t('tuning.modified', customCount) : ''
                }}</span>
                <span class="row__end">
                  <svg class="chev" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M9 5l7 7-7 7" />
                  </svg>
                </span>
              </button>
              <button type="button" class="row" @click="open('pitch')">
                <span class="row__label">{{ t('pages.pitch') }}</span>
                <span class="row__value">{{
                  t('pitch.a4Value', { hz: nf(guitar.referencePitch, 1) })
                }}</span>
                <span class="row__end">
                  <svg class="chev" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M9 5l7 7-7 7" />
                  </svg>
                </span>
              </button>
            </div>
          </section>

          <button type="button" class="btn btn--ghost" @click="resetTuning">
            {{ t('tuning.reset') }}
          </button>
        </div>

        <!-- Cordes une par une -->
        <div v-else-if="page === 'strings'" class="stack">
          <ul class="slist">
            <li
              v-for="s in guitar.strings"
              :key="s.index"
              class="srow"
              :class="{ hit: activeIndex === s.index }"
            >
              <div class="srow__name">
                <b>{{ s.name }}</b>
                <span v-if="s.index === 0" class="tag">{{ t('strings.base') }}</span>
                <span v-else-if="s.customFrequency" class="tag">{{ t('strings.fixedHz') }}</span>
                <span v-if="s.customNote" class="tag">{{ t('strings.noteChanged') }}</span>
              </div>
              <div class="srow__fields">
                <select
                  :value="s.note"
                  :aria-label="t('strings.noteOf', { n: s.stringNumber })"
                  @change="onNoteName(s, $event)"
                >
                  <option v-for="n in NOTE_NAMES" :key="n" :value="n">{{ n }}</option>
                </select>
                <select
                  :value="s.octave"
                  :aria-label="t('strings.octaveOf', { n: s.stringNumber })"
                  @change="onOctave(s, $event)"
                >
                  <option v-for="o in OCTAVES" :key="o" :value="o">{{ o }}</option>
                </select>
                <NumberField
                  :model-value="s.frequency"
                  :format="fmtHz"
                  :parse="parseHz"
                  unit="Hz"
                  :label="t('strings.freqOf', { n: s.stringNumber })"
                  @update:model-value="(v) => attempt(() => setStringFrequency(s.index, v))"
                  @invalid="onInvalid"
                />
              </div>
              <button
                v-if="s.customNote || s.customFrequency"
                type="button"
                class="link"
                @click="attempt(() => resetString(s.index))"
              >
                {{ t('common.reset') }}
              </button>
            </li>
          </ul>
          <p class="help">{{ t('strings.help') }}</p>
          <button
            v-if="customCount"
            type="button"
            class="btn btn--ghost"
            @click="attempt(resetOverrides)"
          >
            {{ t('strings.resetAll') }}
          </button>
        </div>

        <!-- Diapason -->
        <div v-else-if="page === 'pitch'" class="stack">
          <div class="field">
            <span>{{ t('pitch.a4') }}</span>
            <NumberField
              :model-value="guitar.referencePitch"
              :format="fmtHz"
              :parse="parseHz"
              unit="Hz"
              :label="t('pitch.a4Field')"
              @update:model-value="(v) => attempt(() => setReferencePitch(v))"
              @invalid="onInvalid"
            />
          </div>
          <div class="chips" role="group" :aria-label="t('pitch.common')">
            <button
              v-for="hz in A4_CHIPS"
              :key="hz"
              type="button"
              class="chip"
              :class="{ on: Math.abs(guitar.referencePitch - hz) < 0.005 }"
              @click="attempt(() => setReferencePitch(hz))"
            >
              {{ hz }} Hz
            </button>
          </div>
          <div class="field">
            <span>{{ t('pitch.baseString', { note: guitar.strings[0]?.name ?? '' }) }}</span>
            <NumberField
              :model-value="guitar.firstStringFrequency"
              :format="fmtHz"
              :parse="parseHz"
              unit="Hz"
              :label="t('pitch.baseField')"
              @update:model-value="(v) => attempt(() => setFirstStringFrequency(v))"
              @invalid="onInvalid"
            />
          </div>
          <p class="help">{{ t('pitch.equivalent', { shift: shiftText }) }}</p>
        </div>

        <!-- Accordage personnalisé -->
        <div v-else-if="page === 'custom'" class="stack">
          <div class="field">
            <span>{{ t('custom.label') }}</span>
            <input
              v-model="customDraft"
              type="text"
              class="text"
              :placeholder="t('custom.placeholder')"
              autocomplete="off"
              autocapitalize="characters"
              spellcheck="false"
              :aria-label="t('pages.custom')"
              @keydown.enter.prevent="applyCustom"
            />
          </div>
          <button type="button" class="btn" @click="applyCustom">{{ t('common.apply') }}</button>
        </div>
      </template>

      <!-- ============================== RÉGLAGES ============================== -->
      <template v-else>
        <div v-if="!page" class="stack">
          <section class="group">
            <h2>{{ t('settings.mic') }}</h2>
            <div class="mic">
              <label class="slider">
                <span
                  >{{ t('settings.sensitivity') }} <b>{{ detection.sensitivity }}/10</b></span
                >
                <input
                  v-model.number="detection.sensitivity"
                  type="range"
                  min="1"
                  max="10"
                  step="1"
                />
              </label>
              <div class="meter meter--big" aria-hidden="true">
                <i class="meter__fill" :style="{ width: levelPct + '%' }" />
                <i class="meter__gate" :style="{ left: gatePct }" />
              </div>
              <p class="help">{{ t('settings.meterHelp') }}</p>
              <button v-if="!isListening" type="button" class="btn btn--ghost" @click="start">
                {{ t('settings.test') }}
              </button>
              <p v-if="micMessage" class="notice" role="alert">{{ micMessage }}</p>
            </div>
          </section>

          <div class="list">
            <label class="row row--switch">
              <span class="row__label">{{ t('settings.chromatic') }}</span>
              <input v-model="chromatic" type="checkbox" role="switch" />
            </label>
            <button type="button" class="row" @click="open('detection')">
              <span class="row__label">{{ t('pages.detection') }}</span>
              <span class="row__value" />
              <span class="row__end">
                <svg class="chev" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M9 5l7 7-7 7" />
                </svg>
              </span>
            </button>
          </div>

          <div class="list">
            <button type="button" class="row" @click="open('language')">
              <span class="row__label">{{ t('settings.language') }}</span>
              <span class="row__value">{{ currentLanguage }}</span>
              <span class="row__end">
                <svg class="chev" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M9 5l7 7-7 7" />
                </svg>
              </span>
            </button>
          </div>
        </div>

        <div v-else-if="page === 'detection'" class="stack">
          <label class="slider">
            <span
              >{{ t('settings.smoothing') }} <b>{{ detection.smoothing }}</b></span
            >
            <input v-model.number="detection.smoothing" type="range" min="1" max="9" step="1" />
          </label>
          <label class="slider">
            <span>
              {{ t('settings.tolerance') }}
              <b>{{ t('settings.toleranceValue', { n: detection.tolerance }) }}</b>
            </span>
            <input v-model.number="detection.tolerance" type="range" min="1" max="10" step="1" />
          </label>
          <div class="list">
            <label class="row row--switch">
              <span class="row__label">{{ t('settings.autoGain') }}</span>
              <input v-model="detection.autoGain" type="checkbox" role="switch" />
            </label>
          </div>
          <button type="button" class="btn btn--ghost" @click="resetDetection">
            {{ t('settings.resetDetection') }}
          </button>
        </div>

        <div v-else-if="page === 'language'" class="stack">
          <div class="list" role="radiogroup" :aria-label="t('settings.language')">
            <button
              v-for="l in SUPPORTED_LOCALES"
              :key="l.code"
              type="button"
              class="row"
              role="radio"
              :lang="l.code"
              :aria-checked="locale === l.code"
              @click="setLocale(l.code)"
            >
              <span class="row__label">{{ l.name }}</span>
              <span class="row__end">
                <svg v-if="locale === l.code" class="check" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
              </span>
            </button>
          </div>
        </div>
      </template>
    </main>

    <nav class="nav" :aria-label="t('common.navigation')">
      <button
        type="button"
        :aria-current="tab === 'tuner' ? 'page' : undefined"
        @click="goTab('tuner')"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h3l2-6 4 12 3-9 2 3h4" /></svg>
        <span>{{ t('tabs.tuner') }}</span>
        <i v-if="isListening" class="dot" role="img" :aria-label="t('common.listening')" />
      </button>
      <button
        type="button"
        :aria-current="tab === 'tuning' ? 'page' : undefined"
        @click="goTab('tuning')"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9 3v7a3 3 0 0 0 6 0V3M12 13v8" />
        </svg>
        <span>{{ t('tabs.tuning') }}</span>
      </button>
      <button
        type="button"
        :aria-current="tab === 'settings' ? 'page' : undefined"
        @click="goTab('settings')"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
          <circle cx="16" cy="7" r="2" />
          <circle cx="8" cy="17" r="2" />
        </svg>
        <span>{{ t('tabs.settings') }}</span>
      </button>
    </nav>
  </div>
</template>

<style scoped>
.app {
  --blue-900: #000040;
  --blue-700: #0000b3;
  --blue: #0000ff;
  --blue-500: #3333ff;
  --blue-400: #6666ff;
  --blue-200: #b8b8ff;
  --blue-100: #dcdcff;
  --blue-50: #f1f1ff;

  display: flex;
  flex-direction: column;
  height: 100vh;
  height: 100dvh;
  max-width: 560px;
  margin: 0 auto;
  background: #fff;
  color: var(--blue-900);
  font-family:
    'Inter Tight Variable',
    'Inter Tight',
    system-ui,
    -apple-system,
    'Segoe UI',
    sans-serif;
  font-size: 16px;
  line-height: 1.4;
  -webkit-tap-highlight-color: transparent;
}
.app *,
.app *::before,
.app *::after {
  box-sizing: border-box;
}
@media (min-width: 600px) {
  .app {
    height: min(880px, calc(100dvh - 48px));
    margin: 24px auto;
    border: 1.5px solid var(--blue-100);
    border-radius: 28px;
    overflow: hidden;
  }
}

button {
  font: inherit;
  color: inherit;
}
button:focus-visible,
select:focus-visible,
input:focus-visible,
label:focus-within {
  outline: 3px solid var(--blue-400);
  outline-offset: 2px;
}
.row--switch:focus-within {
  outline-offset: -3px;
}

/* ---------- structure ---------- */
.top {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 56px;
  padding: max(8px, env(safe-area-inset-top)) 12px 4px;
}
.top h1 {
  margin: 0;
  padding-left: 4px;
  font-size: 1.4rem;
  font-weight: 700;
  letter-spacing: -0.015em;
}
.icon-btn {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  cursor: pointer;
}
.icon-btn svg,
.chev,
.check,
.nav svg {
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.icon-btn svg {
  width: 24px;
  height: 24px;
}
.chev,
.check {
  flex: none;
  width: 22px;
  height: 22px;
}
.chev {
  color: var(--blue-400);
}
.check {
  color: var(--blue);
  stroke-width: 2.5;
}

.screen {
  flex: 1;
  min-height: 0;
  padding: 8px 16px 20px;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.screen:has(.tune) {
  padding-top: max(12px, env(safe-area-inset-top));
}

.nav {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  border-top: 1.5px solid var(--blue-100);
  padding-bottom: env(safe-area-inset-bottom);
  background: #fff;
  padding: 32px 0;
  margin-bottom: 16px;
}
.nav button {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  min-height: 60px;
  padding: 8px 0;
  border: 0;
  background: transparent;
  color: var(--blue-400);
  font-size: 0.8rem;
  font-weight: 550;
  cursor: pointer;
}
.nav button[aria-current='page'] {
  color: var(--blue);
  font-weight: 700;
}
.nav svg {
  width: 26px;
  height: 26px;
}
.dot {
  position: absolute;
  top: 10px;
  left: calc(50% + 10px);
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--blue);
  animation: pulse 1.6s ease-in-out infinite;
}
@keyframes pulse {
  50% {
    opacity: 0.35;
  }
}

/* ---------- écran Accorder ---------- */
.tune {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 100%;
}
.summary {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 48px;
  padding: 0 8px 0 14px;
  border: 1.5px solid var(--blue-100);
  border-radius: 14px;
  background: #fff;
  text-align: left;
  cursor: pointer;
}
.summary__main {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--blue-500);
}
.summary__main b {
  color: var(--blue-900);
  font-weight: 700;
  letter-spacing: 0.02em;
}
.badge {
  flex: none;
  padding: 3px 9px;
  border-radius: 999px;
  background: var(--blue-100);
  color: var(--blue-700);
  font-size: 0.85rem;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}

.stage {
  --fg: var(--blue-900);
  --track: var(--blue-100);
  --zone: var(--blue-200);
  --tick: var(--blue-400);
  --mark: var(--blue);

  display: flex;
  flex: 1;
  flex-direction: column;
  justify-content: center;
  min-height: 168px;
  padding: 20px 18px 16px;
  border-radius: 24px;
  background: var(--blue-50);
  color: var(--fg);
  text-align: center;
  transition:
    background 0.2s,
    color 0.2s;
}
.stage.ok {
  --fg: #fff;
  --track: #ffffff40;
  --zone: #ffffff59;
  --tick: #ffffffb3;
  --mark: #fff;
  background: var(--blue);
}
.stage__note {
  font-size: clamp(4rem, 24vw, 7rem);
  font-weight: 700;
  line-height: 0.9;
  letter-spacing: -0.05em;
}
.stage__freq {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 2px 16px;
  min-height: 1.5em;
  margin-top: 12px;
  font-size: 1.05rem;
  font-variant-numeric: tabular-nums;
  opacity: 0.8;
}
.bar {
  position: relative;
  height: 48px;
  margin: 24px 4px 4px;
}
.bar__track {
  position: absolute;
  inset: 50% 0 auto;
  height: 10px;
  transform: translateY(-50%);
  border-radius: 5px;
  background: var(--track);
}
.bar__zone {
  position: absolute;
  top: 50%;
  left: 50%;
  height: 26px;
  transform: translate(-50%, -50%);
  border-radius: 8px;
  background: var(--zone);
}
.bar__tick {
  position: absolute;
  top: 50%;
  width: 2px;
  height: 16px;
  transform: translate(-50%, -50%);
  background: var(--tick);
  opacity: 0.55;
}
.bar__tick--mid {
  height: 34px;
  opacity: 0.9;
}
.bar__mark {
  position: absolute;
  top: 50%;
  width: 12px;
  height: 48px;
  transform: translate(-50%, -50%);
  border-radius: 6px;
  background: var(--mark);
  transition:
    left 0.18s ease-out,
    opacity 0.2s;
}
.bar__mark.idle {
  opacity: 0;
}
.bar__legend {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: baseline;
  gap: 8px;
  font-size: 0.9rem;
}
.bar__legend span {
  opacity: 0.75;
}
.bar__legend span:first-child {
  text-align: left;
}
.bar__legend span:last-child {
  text-align: right;
}
.bar__legend b {
  min-width: 6ch;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}
.stage__hint {
  min-height: 1em;
  margin: 12px 0 0;
  font-size: 1rem;
  font-weight: 650;
  letter-spacing: -0.01em;
}

.pills {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(54px, 1fr));
  gap: 8px;
}
.pill {
  min-height: 36px;
  padding: 0 4px;
  border: 1.5px solid var(--blue-200);
  border-radius: 14px;
  background: #fff;
  font-weight: 650;
  cursor: pointer;
  transition:
    background 0.15s,
    color 0.15s,
    border-color 0.15s;
}
.pill.hit {
  border-color: var(--blue);
  box-shadow: 0 0 0 1.5px var(--blue) inset;
}
.pill.on {
  border-color: var(--blue);
  background: var(--blue);
  color: #fff;
}

.listen {
  display: grid;
  gap: 10px;
}

/* niveau du micro, avec repère de détection */
.meter {
  position: relative;
  height: 6px;
  border-radius: 3px;
  background: var(--blue-100);
}
.meter--big {
  height: 14px;
  border-radius: 7px;
}
.meter__fill {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: inherit;
  background: var(--blue);
  transition: width 0.08s linear;
}
.meter__gate {
  position: absolute;
  top: -4px;
  bottom: -4px;
  width: 2px;
  transform: translateX(-50%);
  background: var(--blue-900);
}

.cta,
.btn {
  min-height: 48px;
  padding: 0 24px;
  border: 2px solid var(--blue);
  border-radius: 16px;
  background: var(--blue);
  color: #fff;
  font-size: 1.05rem;
  font-weight: 650;
  cursor: pointer;
}
.cta.on,
.btn--ghost {
  background: #fff;
  color: var(--blue);
}
.btn {
  min-height: 52px;
}

.notice {
  margin: 0 0 12px;
  padding: 12px 14px;
  border: 1.5px solid var(--blue);
  border-radius: 12px;
  background: var(--blue-50);
  color: var(--blue-900);
}
.tune .notice {
  margin: 0;
}
.notice--row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.notice--row span {
  flex: 1;
}

/* ---------- onglets Accordage et Réglages ---------- */
.stack {
  display: grid;
  gap: 20px;
}
.group {
  display: grid;
  gap: 10px;
}
.group h2 {
  margin: 0;
  font-size: 1rem;
  font-weight: 700;
  letter-spacing: -0.005em;
}

.strip {
  display: grid;
  gap: 10px;
  width: 100%;
  padding: 14px;
  border: 0;
  border-radius: 20px;
  background: var(--blue-50);
  text-align: left;
  cursor: pointer;
}
.strip__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(50px, 1fr));
  gap: 6px;
}
.strip__s {
  display: grid;
  justify-items: center;
  padding: 8px 2px;
  border-radius: 12px;
  background: #fff;
}
.strip__s b {
  font-size: 1.05rem;
  font-weight: 700;
}
.strip__s small {
  color: var(--blue-500);
  font-size: 0.78rem;
  font-variant-numeric: tabular-nums;
}
.strip__s.custom {
  box-shadow: 0 0 0 1.5px var(--blue) inset;
}
.strip__edit {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 2px;
  color: var(--blue);
  font-weight: 650;
}
.strip__edit .chev {
  color: var(--blue);
}

.list {
  border-top: 1.5px solid var(--blue-100);
}
.row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 56px;
  padding: 0 2px;
  border: 0;
  border-bottom: 1.5px solid var(--blue-100);
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.row__label {
  flex: 1;
  font-weight: 600;
}
.row__value {
  color: var(--blue-500);
  font-variant-numeric: tabular-nums;
  text-align: right;
  letter-spacing: 0.02em;
}
.row__end {
  display: grid;
  place-items: center;
  width: 22px;
}
.row[aria-checked='true'] .row__label {
  color: var(--blue);
}
.row--switch input {
  width: 26px;
  height: 26px;
  margin: 0;
  accent-color: var(--blue);
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.chip {
  min-width: 56px;
  min-height: 46px;
  padding: 0 14px;
  border: 1.5px solid var(--blue-200);
  border-radius: 14px;
  background: #fff;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
}
.chip.on {
  border-color: var(--blue);
  background: var(--blue);
  color: #fff;
}
.chips--row {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 6px;
}
.chips--row .chip {
  min-width: 0;
  padding: 0;
}
.chip--small {
  flex: none;
  min-height: 40px;
  padding: 0 12px;
}
.stepper {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
}

.field {
  display: grid;
  gap: 6px;
}
.field > span {
  font-weight: 600;
}
.text,
select {
  min-height: 44px;
  padding: 0 12px;
  border: 1.5px solid var(--blue-200);
  border-radius: 12px;
  background: #fff;
  color: var(--blue-900);
  font: inherit;
  font-size: 16px;
}
.text {
  width: 100%;
}
.text:focus,
select:focus {
  outline: none;
  border-color: var(--blue);
  box-shadow: 0 0 0 3px var(--blue-100);
}
.help {
  margin: 0;
  color: var(--blue-500);
  font-size: 0.92rem;
}

.mic {
  display: grid;
  gap: 12px;
  padding: 16px;
  border-radius: 20px;
  background: var(--blue-50);
}
.slider {
  display: grid;
  gap: 8px;
}
.slider span {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-weight: 600;
}
.slider b {
  color: var(--blue);
  font-variant-numeric: tabular-nums;
}
.slider input {
  width: 100%;
  height: 32px;
  margin: 0;
  accent-color: var(--blue);
}
.slider:focus-within {
  outline: none;
}

.slist {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.srow {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1.5px solid var(--blue-100);
  border-radius: 16px;
}
.srow.hit {
  border-color: var(--blue);
}
.srow__name {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 4px 8px;
}
.srow__name b {
  font-size: 1.3rem;
  letter-spacing: -0.01em;
}
.srow__fields {
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr);
  gap: 8px;
  align-items: center;
}
@media (max-width: 380px) {
  .srow__fields {
    grid-template-columns: 1fr 1fr;
  }
  .srow__fields > :last-child {
    grid-column: 1 / -1;
  }
}
.tag {
  padding: 1px 9px;
  border-radius: 999px;
  background: var(--blue-100);
  color: var(--blue-700);
  font-size: 0.8rem;
  font-weight: 600;
}
.link {
  justify-self: start;
  min-height: 32px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--blue);
  font-weight: 600;
  text-decoration: underline;
  cursor: pointer;
}

@media (prefers-reduced-motion: reduce) {
  .bar__mark,
  .meter__fill,
  .stage,
  .dot {
    transition: none;
    animation: none;
  }
}
</style>
