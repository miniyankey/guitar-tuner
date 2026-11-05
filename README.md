# Guitar Tuner

A free guitar and bass tuner that runs in the browser. Open it on your phone, allow the microphone, and play a string.

**▶ Try it: [free-full-guitar-tuner.netlify.app](https://free-full-guitar-tuner.netlify.app/)**

No install, no account, no ads. The sound is analyzed on your device and never sent anywhere.

## Features

- **Accurate pitch detection** with the YIN algorithm, to about ±1 cent on a clear note.
- **Clear feedback:** a big note name, a bar that shows how far you are from the target note, and a plain hint ("Too low, tighten the string"). The screen turns blue when the string is in tune.
- **Works on a phone without an amp:** adjustable microphone sensitivity, a live level meter, and a hint when the signal is too weak.
- **Instruments:** 6-, 7- and 8-string guitar, 4- and 5-string bass.
- **Tunings:** Standard, Drop D, DADGAD, Open G, Open D, Open E and Drop tunings for every instrument, plus any custom tuning (`DADGBE` or `D2 A2 D3 G3 B3 E4`).
- **Pitch shift:** tune the whole instrument up or down by any amount, for example −¼ or −½ tone.
- **Reference pitch:** set A4 (432, 440, 442 Hz or any value) or the frequency of the lowest string.
- **Per-string control:** change the note or the exact frequency of each string.
- **Modes:** automatic string detection, one chosen string, or chromatic (any note).
- **5 languages:** English, French, German, Spanish and Portuguese. Your choice is remembered on the device.
- **Built for mobile:** large touch targets, bottom navigation, safe-area support.

## Built with

- [Vue 3](https://vuejs.org/) and [Vite](https://vite.dev/)
- [Web Audio API](https://developer.mozilla.org/docs/Web/API/Web_Audio_API) for microphone input
- [vue-i18n](https://vue-i18n.intlify.dev/) for translations
- [Inter Tight](https://fonts.google.com/specimen/Inter+Tight) via `@fontsource-variable/inter-tight`

## Project structure

```
src/
  components/
    Tuner.vue          # the interface (Tune, Tuning and Settings tabs)
    NumberField.vue    # number input that isn't overwritten while the tuner is listening
  composables/
    useTuner.js        # microphone, input gain, YIN pitch detection, smoothing
  stores/
    useGuitar.js       # instrument, tuning, reference pitch, string frequencies
  i18n/
    index.js           # vue-i18n setup, language list, setLocale()
    locales/           # en.json, fr.json, de.json, es.json, pt.json
  main.js
```

## Development

Requires Node.js. Then:

```sh
npm install      # install dependencies
npm run dev      # start the dev server with hot reload
npm run build    # build for production into dist/
npm run lint     # lint with ESLint
```

The microphone only works on `https://` or `http://localhost`, so test on a phone through a deployed version or an HTTPS tunnel.

## Adding a language

1. Copy `src/i18n/locales/en.json` to a new file, for example `it.json`, and translate the values. Keep the keys unchanged.
2. In `src/i18n/index.js`, import the file, add it to `messages`, and add `{ code: "it", name: "Italiano" }` to `SUPPORTED_LOCALES`.

A missing key falls back to English.

## Recommended setup

- IDE: [VS Code](https://code.visualstudio.com/) with [Vue (Official)](https://marketplace.visualstudio.com/items?itemName=Vue.volar) (disable Vetur).
- Browser: Vue.js devtools for [Chrome](https://chromewebstore.google.com/detail/vuejs-devtools/nhdogjmejiglipccpnnnanhbledajbpd) or [Firefox](https://addons.mozilla.org/en-US/firefox/addon/vue-js-devtools/).
- Configuration: see the [Vite configuration reference](https://vite.dev/config/).
