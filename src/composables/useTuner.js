import { ref, shallowRef, computed, toValue, onScopeDispose, getCurrentScope } from 'vue'
import { guitar } from '@/stores/useGuitar'
/* -------------------------------------------------------------------------- */
/*  Pure DSP / music helpers                                                  */
/* -------------------------------------------------------------------------- */

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

export const centsBetween = (freq, target) => 1200 * Math.log2(freq / target)

export function freqToNote(freq, a4 = 440) {
  const midi = 69 + 12 * Math.log2(freq / a4)
  const rounded = Math.round(midi)
  return {
    name: NOTE_NAMES[((rounded % 12) + 12) % 12],
    octave: Math.floor(rounded / 12) - 1,
    cents: Math.round((midi - rounded) * 100),
    frequency: a4 * 2 ** ((rounded - 69) / 12),
  }
}

/**
 * YIN pitch detection.
 * Returns { freq, clarity } where clarity is 0..1 (1 = perfectly periodic).
 * freq = -1 when no pitch is found.
 */
export function detectPitchYin(
  buf,
  sampleRate,
  { minFreq = 60, maxFreq = 1200, threshold = 0.15 } = {},
) {
  const W = buf.length >> 1 // integration window
  const tauMax = Math.min(W - 1, Math.floor(sampleRate / minFreq))
  const tauMin = Math.max(2, Math.floor(sampleRate / maxFreq))
  if (tauMin >= tauMax) return { freq: -1, clarity: 0 }

  // 1. difference function
  const d = new Float32Array(tauMax + 1)
  for (let tau = 1; tau <= tauMax; tau++) {
    let sum = 0
    for (let i = 0; i < W; i++) {
      const diff = buf[i] - buf[i + tau]
      sum += diff * diff
    }
    d[tau] = sum
  }

  // 2. cumulative mean normalized difference
  d[0] = 1
  let running = 0
  for (let tau = 1; tau <= tauMax; tau++) {
    running += d[tau]
    d[tau] = running === 0 ? 1 : (d[tau] * tau) / running
  }

  // 3. first dip under the threshold -> walk down to its local minimum
  let tauEst = -1
  for (let tau = tauMin; tau <= tauMax; tau++) {
    if (d[tau] < threshold) {
      while (tau + 1 <= tauMax && d[tau + 1] < d[tau]) tau++
      tauEst = tau
      break
    }
  }
  if (tauEst === -1) return { freq: -1, clarity: 0 }

  // 4. parabolic interpolation (sub-sample accuracy)
  const x0 = d[tauEst - 1] ?? d[tauEst]
  const x2 = d[tauEst + 1] ?? d[tauEst]
  const denom = 2 * (x0 - 2 * d[tauEst] + x2)
  const shift = denom ? (x0 - x2) / denom : 0

  return { freq: sampleRate / (tauEst + shift), clarity: 1 - d[tauEst] }
}

const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

const nextPow2 = (n) => 2 ** Math.ceil(Math.log2(n))

/* -------------------------------------------------------------------------- */
/*  Composable                                                                */
/* -------------------------------------------------------------------------- */

/**
 * @param {Object}  options
 * @param {"auto"|"string"|"chromatic"} [options.mode="auto"]
 *        auto      -> compares with the closest string of the guitar
 *        string    -> compares with the string at `targetIndex`
 *        chromatic -> ignores strings, just nearest note
 * @param {number}  [options.targetIndex=0]      string index (0 = lowest) for "string" mode
 * @param {*}       [options.strings]            ref/getter/array of { frequency, name }. Default: guitar store
 * @param {number|"auto"} [options.fftSize="auto"]
 * Numeric options below (minRms, minClarity, yinThreshold, smoothing, updateInterval, holdMs,
 * inTuneCents) can be a number, a ref or a getter: they are re-read on every frame.
 * @param {number}  [options.minRms=0.01]        silence gate
 * @param {number}  [options.minClarity=0.85]    reject unclear pitches (0..1)
 * @param {number}  [options.yinThreshold=0.15]  lower = stricter
 * @param {number}  [options.smoothing=5]        median window (frames). 1 = off
 * @param {number}  [options.updateInterval=50]  ms between detections
 * @param {number}  [options.holdMs=600]         keep last reading this long after signal is lost
 * @param {number}  [options.inTuneCents=5]      tolerance for "in tune"
 * @param {number}  [options.minFreq] [options.maxFreq]  override detection range
 * @param {string}  [options.deviceId]           choose a specific microphone
 * @param {Function}[options.onUpdate]           called with each reading
 */
export function useTuner(options = {}) {
  const {
    strings = () => guitar.strings,
    fftSize = 'auto',
    minRms = 0.01,
    minClarity = 0.85,
    yinThreshold = 0.15,
    smoothing = 5,
    updateInterval = 50,
    holdMs = 600,
    inTuneCents = 5,
    deviceId,
    onUpdate,
  } = options

  // writable refs -> usable with v-model
  const mode = ref(options.mode ?? 'auto')
  const targetIndex = ref(options.targetIndex ?? 0)

  // state
  const isListening = ref(false)
  const error = ref(null)
  const level = ref(0) // RMS of the input, handy for a level meter
  const reading = shallowRef(null)

  // internals
  let ctx = null
  let stream = null
  let analyser = null
  let buf = null
  let rafId = 0
  let lastRun = 0
  let lastSignal = 0
  let history = []

  /* ------------------------------ derived ------------------------------- */

  const list = computed(() => toValue(strings) ?? [])
  const frequency = computed(() => reading.value?.frequency ?? null)
  const cents = computed(() => reading.value?.cents ?? 0)
  const status = computed(() => {
    if (!isListening.value) return 'idle'
    if (!reading.value) return 'waiting' // listening, no note played
    return reading.value.direction // "flat" | "sharp" | "in-tune"
  })

  const detectionRange = () => {
    const f = list.value.map((s) => s.frequency)
    return {
      minFreq: options.minFreq ?? (f.length ? Math.min(...f) * 0.8 : 50),
      maxFreq: options.maxFreq ?? (f.length ? Math.max(...f) * 1.5 : 1500),
    }
  }

  /* ------------------------------ lifecycle ------------------------------ */

  async function start() {
    if (isListening.value) return
    error.value = null

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      })

      ctx = new AudioContext()
      await ctx.resume()

      const { minFreq } = detectionRange()
      // window must hold ~4 periods of the lowest note
      const size =
        fftSize === 'auto'
          ? Math.min(32768, Math.max(2048, nextPow2(4 * (ctx.sampleRate / minFreq))))
          : fftSize

      analyser = ctx.createAnalyser()
      analyser.fftSize = size
      buf = new Float32Array(analyser.fftSize)

      // NOT connected to ctx.destination -> no feedback
      ctx.createMediaStreamSource(stream).connect(analyser)

      history = []
      lastRun = 0
      isListening.value = true
      rafId = requestAnimationFrame(tick)
    } catch (e) {
      error.value =
        e?.name === 'NotAllowedError'
          ? 'Microphone permission denied.'
          : e?.name === 'NotFoundError'
            ? 'No microphone found.'
            : (e?.message ?? String(e))
      await stop()
    }
  }

  async function stop() {
    cancelAnimationFrame(rafId)
    stream?.getTracks().forEach((t) => t.stop())
    if (ctx && ctx.state !== 'closed') await ctx.close()
    ctx = stream = analyser = buf = null
    history = []
    reading.value = null
    level.value = 0
    isListening.value = false
  }

  const toggle = () => (isListening.value ? stop() : start())

  /* ------------------------------ main loop ------------------------------ */

  function tick(now) {
    rafId = requestAnimationFrame(tick)
    if (now - lastRun < toValue(updateInterval)) return
    lastRun = now

    analyser.getFloatTimeDomainData(buf)

    let sum = 0
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
    const rms = Math.sqrt(sum / buf.length)
    level.value = rms

    if (rms < toValue(minRms)) return signalLost(now)

    const { freq, clarity } = detectPitchYin(buf, ctx.sampleRate, {
      ...detectionRange(),
      threshold: toValue(yinThreshold),
    })
    if (freq <= 0 || clarity < toValue(minClarity)) return signalLost(now)

    lastSignal = now
    history.push(freq)
    while (history.length > Math.max(1, toValue(smoothing))) history.shift()

    publish(median(history))
  }

  function signalLost(now) {
    if (reading.value && now - lastSignal > toValue(holdMs)) {
      history = []
      reading.value = null
    }
  }

  function publish(freq) {
    const note = freqToNote(freq, guitar.referencePitch)
    const strs = list.value

    let target = null
    if (mode.value === 'string') {
      target = strs[targetIndex.value] ?? null
    } else if (mode.value === 'auto' && strs.length) {
      target = strs.reduce((best, s) =>
        Math.abs(centsBetween(freq, s.frequency)) < Math.abs(centsBetween(freq, best.frequency))
          ? s
          : best,
      )
    }

    const diff = target ? centsBetween(freq, target.frequency) : note.cents
    const inTune = Math.abs(diff) <= toValue(inTuneCents)

    reading.value = {
      frequency: freq,
      note, // nearest chromatic note { name, octave, cents, frequency }
      string: target, // string being compared to (null in chromatic mode)
      targetFrequency: target?.frequency ?? note.frequency,
      cents: Math.round(diff * 10) / 10,
      needle: Math.max(-1, Math.min(1, diff / 50)), // -1 .. 1 for a gauge
      inTune,
      direction: inTune ? 'in-tune' : diff < 0 ? 'flat' : 'sharp', // flat = tune UP
    }
    onUpdate?.(reading.value)
  }

  /* ------------------------------ helpers ------------------------------- */

  const selectString = (i) => {
    targetIndex.value = i
    mode.value = 'string'
  }

  if (getCurrentScope()) onScopeDispose(stop)

  return {
    // state
    isListening,
    error,
    level,
    reading,
    frequency,
    cents,
    status,
    // config (writable)
    mode,
    targetIndex,
    // data
    strings: list,
    // actions
    start,
    stop,
    toggle,
    selectString,
  }
}
