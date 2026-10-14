<script setup>
import '@fontsource-variable/inter-tight'
import { computed, reactive, ref } from 'vue'
import { useTuner } from '@/composables/useTuner.js'
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
} from '@/stores/useGuitar.js'

/* ------------------------------ détection -------------------------------- */

const DEFAULT_DETECTION = { sensitivity: 3, smoothing: 5, tolerance: 5 }
const detection = reactive({ ...DEFAULT_DETECTION })
const RMS_BY_SENSITIVITY = [0.03, 0.018, 0.01, 0.005, 0.0025] // niveaux 1 à 5

const {
  isListening,
  error: micError,
  level,
  reading,
  status,
  mode,
  targetIndex,
  toggle,
  selectString,
} = useTuner({
  minRms: () => RMS_BY_SENSITIVITY[detection.sensitivity - 1],
  smoothing: () => detection.smoothing,
  inTuneCents: () => detection.tolerance,
})

const setMode = (m) => (mode.value = m)

/* ------------------------------ formats ---------------------------------- */

const nf = (n, d = 2) =>
  n.toLocaleString('fr-FR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: d,
    useGrouping: false,
  })
const fmtHz = (n) => nf(n, 2)

function parseHz(str) {
  const n = Number(String(str).replace(/\s/g, '').replace(',', '.'))
  if (!(n > 0)) throw new Error('Entrez une fréquence en Hz, par exemple 82,41.')
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
function fmtTones(t) {
  if (Math.abs(t) < 0.005) return '0'
  const abs = Math.abs(t)
  const eighths = Math.round(abs * 8)
  let body
  if (Math.abs(abs * 8 - eighths) < 0.04) {
    const whole = Math.floor(eighths / 8)
    body = `${whole || ''}${EIGHTHS[eighths % 8]}` || '0'
  } else {
    body = nf(abs, 2)
  }
  return `${t < 0 ? '−' : '+'}${body}`
}
const toneUnit = (t) => (Math.abs(t) > 1 ? 'tons' : 'ton')

/** Accepte -1/4, −0,25, +½, 1¼ ... (en tons) */
function parseTones(str) {
  const s = String(str)
    .trim()
    .replace(/[−–]/g, '-')
    .replace(',', '.')
    .replace(/\s+/g, '')
    .replace(/tons?$/i, '')
  const m = /^([+-]?)(?:(\d+)\/(\d+)|(\d*\.?\d*)([⅛¼⅜½⅝¾⅞])?)$/.exec(s)
  if (!s || !m) throw new Error('Écrivez un nombre de tons, par exemple −1/4 ou −0,25.')
  let n
  if (m[2]) {
    if (Number(m[3]) === 0) throw new Error('Division par zéro.')
    n = Number(m[2]) / Number(m[3])
  } else {
    if (!m[4] && !m[5]) throw new Error('Écrivez un nombre de tons, par exemple −1/4 ou −0,25.')
    n = (m[4] ? Number(m[4]) : 0) + (m[5] ? UNICODE_FRACTIONS[m[5]] : 0)
  }
  n = m[1] === '-' ? -n : n
  if (Math.abs(n) > 6) throw new Error('Valeur trop grande (6 tons maximum).')
  return n
}

/* ------------------------------ libellés --------------------------------- */

const INSTRUMENT_FR = {
  'guitar-6': 'Guitare 6 cordes',
  'guitar-7': 'Guitare 7 cordes',
  'guitar-8': 'Guitare 8 cordes',
  'bass-4': 'Basse 4 cordes',
  'bass-5': 'Basse 5 cordes',
}
const PRESET_FR = {
  standard: 'Standard',
  dropD: 'Drop D',
  dadgad: 'DADGAD',
  halfStepDown: 'Demi-ton plus bas',
  fullStepDown: 'Ton plus bas',
  openG: 'Open G',
  openD: 'Open D',
  openE: 'Open E',
}

/* ------------------------------ navigation ------------------------------- */

const tab = ref('tuner') // "tuner" | "settings"
const page = ref(null) // sous-menu ouvert dans Réglages
const formError = ref('')

const PAGES = {
  tuning: { title: 'Accordage', parent: null },
  shift: { title: 'Ton global', parent: null },
  advanced: { title: 'Avancé', parent: null },
  strings: { title: 'Cordes', parent: 'advanced' },
  pitch: { title: 'Fréquence de référence', parent: 'advanced' },
  custom: { title: 'Accordage personnalisé', parent: 'advanced' },
  detection: { title: 'Détection', parent: 'advanced' },
}

const customDraft = ref('')

function open(key) {
  formError.value = ''
  page.value = key
  if (key === 'custom') customDraft.value = tuningLabel.value
}
const back = () => open(PAGES[page.value].parent)

function attempt(fn) {
  try {
    fn()
    formError.value = ''
  } catch (e) {
    formError.value = String(e.message).replace('[useGuitar] ', '')
  }
}
const onInvalid = (msg) => (formError.value = msg)

/* ------------------------------ données dérivées ------------------------- */

const tuningLabel = computed(() => guitar.strings.map((s) => s.label).join(''))
const hasCustom = computed(() => guitar.strings.some((s) => s.customNote || s.customFrequency))
const customCount = computed(
  () => guitar.strings.filter((s) => s.customNote || s.customFrequency).length,
)
const instrumentId = computed(() => `${guitar.guitarType}-${guitar.numberStrings}`)

const presetList = computed(() => {
  if (guitar.guitarType === 'guitar' && guitar.numberStrings === 6) {
    return TUNING_PRESETS.map((p) => ({
      id: p.id,
      label: PRESET_FR[p.id] ?? p.label,
      tuning: p.tuning,
    }))
  }
  const t = setDefaultTuning(guitar.numberStrings, guitar.guitarType)
  return t ? [{ id: 'standard', label: 'Standard', tuning: t }] : []
})
const activePreset = computed(() => presetList.value.find((p) => p.tuning === tuningLabel.value))

const shiftTones = computed(() => guitar.shiftCents / 200)
const SHIFT_CHIPS = [-1, -0.5, -0.25, 0, 0.25, 0.5, 1]
const shiftText = computed(() =>
  Math.abs(shiftTones.value) < 0.005
    ? '0'
    : `${fmtTones(shiftTones.value)} ${toneUnit(shiftTones.value)}`,
)
const stepShift = (dir) =>
  attempt(() => setGlobalShift(Math.round((shiftTones.value + dir * 0.125) * 1000) / 1000))

const A4_CHIPS = [432, 440, 442]
const OCTAVES = [0, 1, 2, 3, 4, 5, 6, 7]

/* ------------------------------ écran Accorder --------------------------- */

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

const hint = computed(
  () =>
    ({
      idle: 'Appuyez sur Démarrer',
      waiting: targetString.value ? `Jouez ${targetString.value.name}` : 'Jouez une corde',
      flat: 'Trop bas · serrez la corde',
      sharp: 'Trop haut · desserrez la corde',
      'in-tune': 'Accordé',
    })[status.value],
)

const centsText = computed(() => {
  if (!reading.value) return ''
  const c = Math.round(reading.value.cents)
  return `${c > 0 ? '+' : c < 0 ? '−' : ''}${Math.abs(c)} cents`
})

const markLeft = computed(() => `${((reading.value?.needle ?? 0) + 1) * 50}%`)
const zoneWidth = computed(() => `${detection.tolerance * 2}%`)
const levelPct = computed(() =>
  isListening.value ? Math.min(100, Math.sqrt(level.value) * 140) : 0,
)

/* ------------------------------ réglages : actions ----------------------- */

const onInstrument = (id) => {
  const inst = INSTRUMENTS.find((i) => i.id === id)
  attempt(() => setInstrument(inst.guitarType, inst.numberStrings))
}
const onNoteName = (s, e) => attempt(() => setStringNote(s.index, `${e.target.value}${s.octave}`))
const onOctave = (s, e) => attempt(() => setStringNote(s.index, `${s.note}${e.target.value}`))
const applyCustom = () => attempt(() => setTuningModel(customDraft.value.trim()))

function resetEverything() {
  attempt(() => {
    setGuitar()
    Object.assign(detection, DEFAULT_DETECTION)
    mode.value = 'auto'
  })
}

const chromatic = computed({
  get: () => mode.value === 'chromatic',
  set: (on) => (mode.value = on ? 'chromatic' : 'auto'),
})
</script>

<template>
  <div class="app">
    <header v-if="tab === 'settings'" class="top">
      <button v-if="page" type="button" class="icon-btn" aria-label="Retour" @click="back">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
      </button>
      <h1>{{ page ? PAGES[page].title : 'Réglages' }}</h1>
    </header>

    <main class="screen">
      <!-- ============================ ACCORDER ============================ -->
      <section v-if="tab === 'tuner'" class="tune" aria-label="Accordeur">
        <div class="stage" :class="{ ok: isOk }" aria-live="polite">
          <div class="stage__note">{{ bigNote }}</div>

          <div class="stage__freq">
            <template v-if="reading">
              <span>{{ nf(reading.frequency, 1) }} Hz</span>
              <span>cible {{ nf(reading.targetFrequency, 1) }} Hz</span>
            </template>
            <span v-else>&nbsp;</span>
          </div>

          <div
            class="bar"
            role="meter"
            aria-label="Écart par rapport à la note visée, en cents"
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
            <span>Trop bas</span>
            <b>{{ centsText }}</b>
            <span>Trop haut</span>
          </div>

          <p class="stage__hint">{{ hint }}</p>
        </div>

        <div class="pills" role="radiogroup" aria-label="Corde à accorder">
          <button
            type="button"
            role="radio"
            :aria-checked="mode === 'auto'"
            class="pill"
            :class="{ on: mode === 'auto' }"
            @click="setMode('auto')"
          >
            Auto
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

        <div class="listen">
          <div class="level" aria-hidden="true"><i :style="{ width: levelPct + '%' }" /></div>
          <button type="button" class="cta" :class="{ on: isListening }" @click="toggle">
            {{ isListening ? 'Arrêter' : 'Démarrer' }}
          </button>
          <p v-if="micError" class="notice" role="alert">{{ micError }}</p>
        </div>
      </section>

      <!-- ============================ RÉGLAGES ============================ -->
      <section v-else class="settings">
        <p v-if="formError" class="notice" role="alert">{{ formError }}</p>

        <!-- Menu principal -->
        <div v-if="!page" class="list">
          <button type="button" class="row" @click="open('tuning')">
            <span class="row__label">Accordage</span>
            <span class="row__value"
              >{{ activePreset?.label ?? 'Personnalisé' }} · {{ tuningLabel }}</span
            >
            <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
          </button>
          <button type="button" class="row" @click="open('shift')">
            <span class="row__label">Ton global</span>
            <span class="row__value">{{ shiftText }}</span>
            <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
          </button>
          <button type="button" class="row" @click="open('advanced')">
            <span class="row__label">Avancé</span>
            <span class="row__value" />
            <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
          </button>
        </div>

        <!-- Accordage -->
        <div v-else-if="page === 'tuning'" class="stack">
          <h2>Instrument</h2>
          <div class="list">
            <button
              v-for="i in INSTRUMENTS"
              :key="i.id"
              type="button"
              class="row"
              role="radio"
              :aria-checked="instrumentId === i.id"
              @click="onInstrument(i.id)"
            >
              <span class="row__label">{{ INSTRUMENT_FR[i.id] }}</span>
              <svg
                v-if="instrumentId === i.id"
                class="check"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            </button>
          </div>

          <h2>Accordage</h2>
          <div class="list">
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
              <svg
                v-if="activePreset?.id === p.id"
                class="check"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            </button>
          </div>
        </div>

        <!-- Ton global -->
        <div v-else-if="page === 'shift'" class="stack">
          <div class="big">
            <b>{{ shiftText }}</b>
            <span>La4 = {{ nf(guitar.referencePitch, 1) }} Hz</span>
          </div>

          <div class="chips" role="radiogroup" aria-label="Ton global">
            <button
              v-for="t in SHIFT_CHIPS"
              :key="t"
              type="button"
              role="radio"
              class="chip"
              :class="{ on: Math.abs(shiftTones - t) < 0.001 }"
              :aria-checked="Math.abs(shiftTones - t) < 0.001"
              @click="attempt(() => setGlobalShift(t))"
            >
              {{ fmtTones(t) }}
            </button>
          </div>

          <div class="stepper">
            <button
              type="button"
              class="chip"
              aria-label="Baisser d'un huitième de ton"
              @click="stepShift(-1)"
            >
              −⅛
            </button>
            <NumberField
              :model-value="shiftTones"
              :format="fmtTones"
              :parse="parseTones"
              inputmode="text"
              unit="ton"
              label="Ton global, en tons"
              placeholder="−1/8"
              @update:model-value="(v) => attempt(() => setGlobalShift(v))"
              @invalid="onInvalid"
            />
            <button
              type="button"
              class="chip"
              aria-label="Monter d'un huitième de ton"
              @click="stepShift(1)"
            >
              +⅛
            </button>
          </div>
        </div>

        <!-- Avancé -->
        <div v-else-if="page === 'advanced'" class="stack">
          <div class="list">
            <button type="button" class="row" @click="open('strings')">
              <span class="row__label">Cordes</span>
              <span class="row__value">{{
                customCount ? `${customCount} modifiée${customCount > 1 ? 's' : ''}` : ''
              }}</span>
              <svg class="chev" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M9 5l7 7-7 7" />
              </svg>
            </button>
            <button type="button" class="row" @click="open('pitch')">
              <span class="row__label">Fréquence de référence</span>
              <span class="row__value">La4 {{ nf(guitar.referencePitch, 1) }} Hz</span>
              <svg class="chev" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M9 5l7 7-7 7" />
              </svg>
            </button>
            <button type="button" class="row" @click="open('custom')">
              <span class="row__label">Accordage personnalisé</span>
              <span class="row__value" />
              <svg class="chev" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M9 5l7 7-7 7" />
              </svg>
            </button>
            <button type="button" class="row" @click="open('detection')">
              <span class="row__label">Détection</span>
              <span class="row__value" />
              <svg class="chev" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
          <button type="button" class="btn btn--ghost" @click="resetEverything">
            Tout réinitialiser
          </button>
        </div>

        <!-- Cordes -->
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
                <span v-if="s.index === 0" class="tag">base</span>
                <span v-else-if="s.customFrequency" class="tag">Hz fixe</span>
                <span v-if="s.customNote" class="tag">note modifiée</span>
              </div>
              <div class="srow__fields">
                <select
                  :value="s.note"
                  :aria-label="`Note de la corde ${s.stringNumber}`"
                  @change="onNoteName(s, $event)"
                >
                  <option v-for="n in NOTE_NAMES" :key="n" :value="n">{{ n }}</option>
                </select>
                <select
                  :value="s.octave"
                  :aria-label="`Octave de la corde ${s.stringNumber}`"
                  @change="onOctave(s, $event)"
                >
                  <option v-for="o in OCTAVES" :key="o" :value="o">{{ o }}</option>
                </select>
                <NumberField
                  :model-value="s.frequency"
                  :format="fmtHz"
                  :parse="parseHz"
                  unit="Hz"
                  :label="`Fréquence de la corde ${s.stringNumber}`"
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
                Réinitialiser
              </button>
            </li>
          </ul>
          <button
            v-if="hasCustom"
            type="button"
            class="btn btn--ghost"
            @click="attempt(resetOverrides)"
          >
            Réinitialiser toutes les cordes
          </button>
        </div>

        <!-- Fréquence de référence -->
        <div v-else-if="page === 'pitch'" class="stack">
          <div class="field">
            <span>Corde de base ({{ guitar.strings[0]?.name }})</span>
            <NumberField
              :model-value="guitar.firstStringFrequency"
              :format="fmtHz"
              :parse="parseHz"
              unit="Hz"
              label="Fréquence de la corde de base"
              @update:model-value="(v) => attempt(() => setFirstStringFrequency(v))"
              @invalid="onInvalid"
            />
          </div>
          <div class="field">
            <span>La4</span>
            <NumberField
              :model-value="guitar.referencePitch"
              :format="fmtHz"
              :parse="parseHz"
              unit="Hz"
              label="Fréquence du La4"
              @update:model-value="(v) => attempt(() => setReferencePitch(v))"
              @invalid="onInvalid"
            />
          </div>
          <div class="chips" role="group" aria-label="Valeurs courantes du La4">
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
        </div>

        <!-- Accordage personnalisé -->
        <div v-else-if="page === 'custom'" class="stack">
          <div class="field">
            <span>Notes, de la plus grave à la plus aiguë</span>
            <input
              v-model="customDraft"
              type="text"
              class="text"
              placeholder="DADGBE ou D2 A2 D3 G3 B3 E4"
              autocomplete="off"
              autocapitalize="characters"
              spellcheck="false"
              aria-label="Accordage personnalisé"
              @keydown.enter.prevent="applyCustom"
            />
          </div>
          <button type="button" class="btn" @click="applyCustom">Appliquer</button>
        </div>

        <!-- Détection -->
        <div v-else-if="page === 'detection'" class="stack">
          <label class="slider">
            <span
              >Sensibilité <b>{{ detection.sensitivity }}/5</b></span
            >
            <input v-model.number="detection.sensitivity" type="range" min="1" max="5" step="1" />
          </label>
          <label class="slider">
            <span
              >Lissage <b>{{ detection.smoothing }}</b></span
            >
            <input v-model.number="detection.smoothing" type="range" min="1" max="9" step="1" />
          </label>
          <label class="slider">
            <span
              >Tolérance « accordé » <b>±{{ detection.tolerance }} cents</b></span
            >
            <input v-model.number="detection.tolerance" type="range" min="1" max="10" step="1" />
          </label>
          <label class="switch">
            <span>Toutes les notes, sans cordes</span>
            <input v-model="chromatic" type="checkbox" role="switch" />
          </label>
        </div>
      </section>
    </main>

    <nav class="nav" aria-label="Navigation">
      <button
        type="button"
        :aria-current="tab === 'tuner' ? 'page' : undefined"
        @click="tab = 'tuner'"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 12h3l2-6 4 12 3-9 2 3h4" />
        </svg>
        <span>Accorder</span>
        <i v-if="isListening" class="dot" aria-label="Écoute en cours" />
      </button>
      <button
        type="button"
        :aria-current="tab === 'settings' ? 'page' : undefined"
        @click="tab = 'settings'"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
          <circle cx="16" cy="7" r="2" />
          <circle cx="8" cy="17" r="2" />
        </svg>
        <span>Réglages</span>
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
    height: min(860px, calc(100dvh - 48px));
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
input:focus-visible {
  outline: 3px solid var(--blue-400);
  outline-offset: 2px;
}

/* ---------- haut / contenu / navigation ---------- */
.top {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 56px;
  padding: max(8px, env(safe-area-inset-top)) 12px 8px;
}
.top h1 {
  margin: 0;
  font-size: 1.35rem;
  font-weight: 700;
  letter-spacing: -0.01em;
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

.screen {
  flex: 1;
  min-height: 0;
  padding: 12px 16px 16px;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.app:has(.tune) .screen {
  padding-top: max(16px, env(safe-area-inset-top));
}

.nav {
  display: grid;
  grid-template-columns: 1fr 1fr;
  border-top: 1.5px solid var(--blue-100);
  padding-bottom: env(safe-area-inset-bottom);
  background: #fff;
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
  gap: 14px;
  min-height: 100%;
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
  min-height: 330px;
  padding: 24px 20px 20px;
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
  font-size: clamp(5.5rem, 30vw, 8.5rem);
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
  margin: 26px 4px 4px;
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
.bar__legend span:first-child {
  text-align: left;
}
.bar__legend span:last-child {
  text-align: right;
}
.bar__legend span {
  opacity: 0.75;
}
.bar__legend b {
  min-width: 6ch;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}
.stage__hint {
  min-height: 1.6em;
  margin: 18px 0 0;
  font-size: 1.3rem;
  font-weight: 650;
  letter-spacing: -0.01em;
}

.pills {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(54px, 1fr));
  gap: 8px;
}
.pill {
  min-height: 48px;
  padding: 0 6px;
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
.level {
  height: 4px;
  border-radius: 2px;
  background: var(--blue-100);
  overflow: hidden;
}
.level i {
  display: block;
  height: 100%;
  background: var(--blue);
  transition: width 0.08s linear;
}
.cta,
.btn {
  min-height: 56px;
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
  margin: 0;
  padding: 12px 14px;
  border: 1.5px solid var(--blue);
  border-radius: 12px;
  background: var(--blue-50);
  color: var(--blue-900);
}
.settings > .notice {
  margin-bottom: 12px;
}

/* ---------- réglages ---------- */
.stack {
  display: grid;
  gap: 16px;
}
.stack h2 {
  margin: 8px 0 -8px;
  font-size: 0.95rem;
  font-weight: 650;
  color: var(--blue-500);
}

.list {
  border-top: 1.5px solid var(--blue-100);
}
.row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 60px;
  padding: 0 4px;
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
}
.chev,
.check {
  flex: none;
  width: 22px;
  height: 22px;
  color: var(--blue);
}
.chev {
  color: var(--blue-400);
}
.check {
  stroke-width: 2.5;
}
.row[aria-checked='true'] .row__label {
  color: var(--blue);
}

.big {
  display: grid;
  gap: 2px;
  padding: 22px 16px;
  border-radius: 20px;
  background: var(--blue-50);
  text-align: center;
}
.big b {
  font-size: 3.2rem;
  font-weight: 700;
  line-height: 1;
  letter-spacing: -0.03em;
}
.big span {
  color: var(--blue-500);
  font-variant-numeric: tabular-nums;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.chip {
  min-width: 56px;
  min-height: 48px;
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
  color: var(--blue-500);
  font-size: 0.95rem;
  font-weight: 550;
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

.slider,
.switch {
  display: grid;
  gap: 10px;
}
.slider span,
.switch span {
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
  accent-color: var(--blue);
}
.switch {
  grid-template-columns: 1fr auto;
  align-items: center;
  min-height: 52px;
}
.switch input {
  width: 26px;
  height: 26px;
  accent-color: var(--blue);
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
  .level i,
  .stage,
  .dot {
    transition: none;
    animation: none;
  }
}
</style>
