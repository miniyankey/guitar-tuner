import { reactive, readonly } from 'vue'

/* -------------------------------------------------------------------------- */
/*  Constants                                                                 */
/* -------------------------------------------------------------------------- */

const SEMITONES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

export const TUNING_PRESETS = [
  { id: 'standard', label: 'Standard', tuning: 'EADGBE' },
  { id: 'dropD', label: 'Drop D', tuning: 'DADGBE' },
  { id: 'dadgad', label: 'DADGAD', tuning: 'DADGAD' },
  { id: 'halfStepDown', label: 'Half step down', tuning: 'EbAbDbGbBbEb' },
  { id: 'fullStepDown', label: 'Full step down', tuning: 'DGCFAD' },
  { id: 'openG', label: 'Open G', tuning: 'DGDGBD' },
  { id: 'openD', label: 'Open D', tuning: 'DADF#AD' },
  { id: 'openE', label: 'Open E', tuning: 'EBEG#BE' },
]
export const GUITAR_TUNINGS = Object.fromEntries(TUNING_PRESETS.map((p) => [p.id, p.tuning]))

export const INSTRUMENTS = [
  { id: 'guitar-6', guitarType: 'guitar', numberStrings: 6, label: 'Guitar, 6 strings' },
  { id: 'guitar-7', guitarType: 'guitar', numberStrings: 7, label: 'Guitar, 7 strings' },
  { id: 'guitar-8', guitarType: 'guitar', numberStrings: 8, label: 'Guitar, 8 strings' },
  { id: 'bass-4', guitarType: 'bass', numberStrings: 4, label: 'Bass, 4 strings' },
  { id: 'bass-5', guitarType: 'bass', numberStrings: 5, label: 'Bass, 5 strings' },
]

// Default tuning per instrument / number of strings (low -> high)
const DEFAULT_TUNINGS = {
  guitar: { 6: 'EADGBE', 7: 'BEADGBE', 8: 'F#BEADGBE' },
  bass: { 4: 'EADG', 5: 'BEADG', 6: 'BEADGC' },
}

// MIDI note of the LOWEST string, used to guess octaves when a tuning has none
// (40 = E2, 35 = B1, 30 = F#1, 28 = E1, 23 = B0)
const LOWEST_MIDI = {
  guitar: { 6: 40, 7: 35, 8: 30 },
  bass: { 4: 28, 5: 23, 6: 23 },
}

/* -------------------------------------------------------------------------- */
/*  Small helpers                                                             */
/* -------------------------------------------------------------------------- */

const mod = (n, m) => ((n % m) + m) % m

export const midiToFreq = (midi, a4 = 440) => a4 * 2 ** ((midi - 69) / 12)
export const midiToName = (midi) => `${NOTE_NAMES[mod(midi, 12)]}${Math.floor(midi / 12) - 1}`

function assertHz(hz) {
  if (!Number.isFinite(hz) || hz <= 0) {
    throw new Error('[useGuitar] Frequency must be a positive number of Hz.')
  }
  return hz
}

/**
 * Accepts:
 *  - "EADGBE"            (compact, octaves inferred)
 *  - "E2 A2 D3 G3 B3 E4" (explicit octaves, separated by space/comma)
 *  - ["E2", "A2", ...]   (array)
 */
function tokenize(tuning) {
  if (Array.isArray(tuning)) return tuning.map(String)
  const str = String(tuning).trim()
  if (/[\s,;]/.test(str)) return str.split(/[\s,;]+/)
  return str.match(/[A-G][#b]?-?\d*/g) ?? []
}

function parseNote(token) {
  const m = /^([A-Ga-g])([#b♯♭]?)(-?\d+)?$/.exec(String(token).trim())
  if (!m) throw new Error(`[useGuitar] Invalid note "${token}"`)
  const letter = m[1].toUpperCase()
  const acc = m[2] === '#' || m[2] === '♯' ? 1 : m[2] ? -1 : 0
  return {
    label: letter + (m[2] === '♯' ? '#' : m[2] === '♭' ? 'b' : m[2]),
    base: SEMITONES[letter] + acc, // may be -1 or 12 (Cb, B#)
    octave: m[3] !== undefined ? Number(m[3]) : null,
  }
}

/** "D#3" -> MIDI number. The octave is required. */
export function noteToMidi(note) {
  const n = parseNote(note)
  if (n.octave === null) throw new Error(`[useGuitar] Add an octave to "${note}", like ${note}3.`)
  return (n.octave + 1) * 12 + n.base
}

/** Tuning model -> [{ label, midi }] (low -> high). Octaves are inferred when missing. */
function resolveModel(tuningModel, lowestMidi = 40) {
  let prev = null
  return tokenize(tuningModel)
    .map(parseNote)
    .map((n) => {
      let midi
      if (n.octave !== null) {
        midi = (n.octave + 1) * 12 + n.base
      } else if (prev === null) {
        // lowest string: octave closest to `lowestMidi`
        const d = mod(n.base - lowestMidi, 12)
        midi = lowestMidi + (d > 6 ? d - 12 : d)
      } else {
        // next occurrence of the note ABOVE the previous string
        midi = prev + (mod(n.base - prev, 12) || 12)
      }
      prev = midi
      return { label: n.label, midi }
    })
}

/* -------------------------------------------------------------------------- */
/*  Core computation (pure)                                                   */
/* -------------------------------------------------------------------------- */

/**
 * `pitch` is either { firstString: hz } or { a4: hz }.
 * `overrides` is { [stringIndex]: { midi?: number, frequency?: number } }.
 *
 * Every string is computed in equal temperament from the pitch base, so
 * setting the FIRST string to 432 Hz moves the whole tuning by the same ratio.
 * A custom `frequency` (strings 2+) is absolute and ignores the base.
 */
function build(pitch, tuningModel, numberStrings, lowestMidi, overrides = {}) {
  const model = resolveModel(tuningModel, lowestMidi)

  if (!model.length) throw new Error(`[useGuitar] Could not read the tuning "${tuningModel}".`)
  if (numberStrings != null && model.length !== numberStrings) {
    throw new Error(
      `[useGuitar] Tuning "${tuningModel}" has ${model.length} notes but numberStrings is ${numberStrings}`,
    )
  }

  const midis = model.map((m, i) => overrides[i]?.midi ?? m.midi)
  const a4 =
    pitch.firstString != null
      ? assertHz(pitch.firstString) * 2 ** ((69 - midis[0]) / 12)
      : assertHz(pitch.a4 ?? 440)

  const strings = model.map((m, i) => {
    const ov = overrides[i] ?? {}
    const midi = midis[i]
    const customNote = ov.midi !== undefined
    const customFrequency = i > 0 && ov.frequency !== undefined
    const label = customNote ? NOTE_NAMES[mod(midi, 12)] : m.label
    const octave = Math.floor(midi / 12) - 1
    const frequency = customFrequency ? ov.frequency : midiToFreq(midi, a4)
    const standardFrequency = midiToFreq(midi, 440)

    return {
      index: i,
      stringNumber: model.length - i, // 6 = lowest E, 1 = highest E on a guitar
      label,
      name: `${label}${octave}`,
      note: NOTE_NAMES[mod(midi, 12)], // sharp spelling, handy for <select>
      octave,
      midi,
      frequency,
      standardFrequency,
      offsetCents: 1200 * Math.log2(frequency / standardFrequency),
      customNote,
      customFrequency,
    }
  })

  return { a4, strings }
}

export const setDefaultTuning = (numberStrings, guitarType = 'guitar') =>
  DEFAULT_TUNINGS[guitarType]?.[numberStrings] ?? null

/**
 * Frequencies of every string, low -> high.
 * `firstStringFrequency` is the frequency of the FIRST (lowest) string of the model;
 * the others follow in equal temperament. Pass null for standard pitch (A4 = 440).
 */
export const setStringsFrequencies = (
  firstStringFrequency,
  tuningModel,
  numberStrings = null,
  lowestMidi = 40,
  overrides = {},
) =>
  build(
    firstStringFrequency != null ? { firstString: firstStringFrequency } : { a4: 440 },
    tuningModel,
    numberStrings,
    lowestMidi,
    overrides,
  ).strings

/* -------------------------------------------------------------------------- */
/*  Store                                                                     */
/* -------------------------------------------------------------------------- */

const state = reactive({
  guitarType: 'guitar',
  numberStrings: 6,
  tuningModel: 'EADGBE',
  lowestMidi: 40,
  overrides: {}, // per-string custom note / frequency
  referencePitch: 440, // effective A4, derived from the first string
  shiftCents: 0, // distance from standard pitch (A4 = 440), 200 cents = 1 tone
  firstStringFrequency: 0,
  strings: [], // [{ index, name, frequency, ... }] low -> high
  frequencies: [], // [82.4, 110, 146.8, ...]
})

const guitar = readonly(state)

/** Build first, assign after: invalid input throws and leaves the state untouched. */
function commit(patch = {}, pitch = { a4: state.referencePitch }) {
  const next = {
    guitarType: state.guitarType,
    numberStrings: state.numberStrings,
    tuningModel: state.tuningModel,
    lowestMidi: state.lowestMidi,
    overrides: state.overrides,
    ...patch,
  }
  const { a4, strings } = build(
    pitch,
    next.tuningModel,
    next.numberStrings,
    next.lowestMidi,
    next.overrides,
  )
  Object.assign(state, next, {
    referencePitch: a4,
    shiftCents: 1200 * Math.log2(a4 / 440),
    firstStringFrequency: strings[0].frequency,
    strings,
    frequencies: strings.map((s) => s.frequency),
  })
}

const resolvePreset = (t) => (typeof t === 'string' ? (GUITAR_TUNINGS[t] ?? t) : t)

/**
 * Full (re)configuration.
 *  firstStringFrequency  Hz of the first string (wins over referencePitch)
 *  referencePitch        Hz of A4 (default 440)
 *  guitarType, numberStrings, tuningModel (preset key, "DADGAD", "D2 A2 ...", or an array)
 *  overrides             { [index]: { midi?, frequency? } }
 */
const setGuitar = (props = {}) => {
  const guitarType = props.guitarType ?? 'guitar'
  const custom = props.tuningModel ? resolvePreset(props.tuningModel) : null
  const numberStrings = props.numberStrings ?? (custom ? tokenize(custom).length : 6)
  const tuningModel = custom ?? setDefaultTuning(numberStrings, guitarType)

  if (!tuningModel) {
    throw new Error(
      `[useGuitar] No default tuning for a ${numberStrings}-string ${guitarType}. Provide "tuningModel".`,
    )
  }

  commit(
    {
      guitarType,
      numberStrings,
      tuningModel,
      lowestMidi: props.lowestMidi ?? LOWEST_MIDI[guitarType]?.[numberStrings] ?? 40,
      overrides: props.overrides ?? {},
    },
    props.firstStringFrequency != null
      ? { firstString: props.firstStringFrequency }
      : { a4: props.referencePitch ?? 440 },
  )
}

/* ------------------------------- actions ---------------------------------- */

/** Set the pitch base from A4 (432, 440, 442...). All non-custom strings follow. */
const setReferencePitch = (hz) => commit({}, { a4: hz })

/** Set the pitch base from the first string. All non-custom strings follow. */
const setFirstStringFrequency = (hz) => commit({}, { firstString: hz })

/** Global shift in TONES from standard pitch: -1/4 -> -0.25, -1/2 -> -0.5 (half step), 1 -> a whole tone. */
const setGlobalShift = (tones) => commit({}, { a4: 440 * 2 ** (tones / 6) })

/** Change the tuning model (keeps the pitch base, clears per-string overrides). */
const setTuningModel = (model) => {
  const tuningModel = resolvePreset(model)
  const numberStrings = tokenize(tuningModel).length
  commit({
    tuningModel,
    numberStrings,
    lowestMidi: LOWEST_MIDI[state.guitarType]?.[numberStrings] ?? state.lowestMidi,
    overrides: {},
  })
}

/** Switch instrument / string count (default tuning, keeps the pitch base). */
const setInstrument = (guitarType, numberStrings) => {
  const tuningModel = setDefaultTuning(numberStrings, guitarType)
  if (!tuningModel) throw new Error(`[useGuitar] No default tuning for ${numberStrings} strings.`)
  commit({
    guitarType,
    numberStrings,
    tuningModel,
    lowestMidi: LOWEST_MIDI[guitarType]?.[numberStrings] ?? 40,
    overrides: {},
  })
}

function patchOverride(i, patch) {
  if (!Number.isInteger(i) || i < 0 || i >= state.numberStrings) {
    throw new Error(`[useGuitar] No string at index ${i}.`)
  }
  const next = { ...state.overrides }
  const merged = { ...next[i], ...patch }
  Object.keys(merged).forEach((k) => merged[k] === undefined && delete merged[k])
  if (Object.keys(merged).length) next[i] = merged
  else delete next[i]
  return next
}

/** Change the note of one string ("D#3" or a MIDI number). Frequency follows the pitch base. */
const setStringNote = (i, note) => {
  const midi = typeof note === 'number' ? note : noteToMidi(note)
  const modelMidi = resolveModel(state.tuningModel, state.lowestMidi)[i]?.midi
  commit({
    overrides: patchOverride(i, {
      midi: midi === modelMidi ? undefined : midi,
      frequency: undefined,
    }),
  })
}

/**
 * Set the frequency of one string.
 * String 0 is the pitch base: changing it retunes the whole instrument.
 * Other strings become "custom" and keep that exact Hz.
 */
const setStringFrequency = (i, hz) => {
  assertHz(hz)
  if (i === 0) return setFirstStringFrequency(hz)
  commit({ overrides: patchOverride(i, { frequency: hz }) })
}

const resetString = (i) =>
  commit({ overrides: patchOverride(i, { midi: undefined, frequency: undefined }) })
const resetOverrides = () => commit({ overrides: {} })

// Standard 6-string guitar, A4 = 440, available out of the box
setGuitar()

export {
  guitar,
  setGuitar,
  setReferencePitch,
  setFirstStringFrequency,
  setGlobalShift,
  setTuningModel,
  setInstrument,
  setStringNote,
  setStringFrequency,
  resetString,
  resetOverrides,
}
