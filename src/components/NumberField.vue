<script setup>
import { ref, watch, nextTick } from 'vue'

/**
 * Champ numérique "à brouillon".
 * Ce que l'utilisateur tape vit dans `draft` (état local) et n'est validé qu'à la sortie du champ
 * (blur / Entrée). Le composant parent peut donc se re-rendre 20 fois par seconde sans jamais
 * écraser la saisie en cours.
 */
const props = defineProps({
  modelValue: { type: Number, required: true },
  label: { type: String, default: '' }, // aria-label
  unit: { type: String, default: '' },
  format: { type: Function, default: null }, // number -> string affichée
  parse: { type: Function, default: null }, // string -> number (peut lancer une erreur)
  inputmode: { type: String, default: 'decimal' },
  placeholder: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue', 'invalid'])

const fmt = (n) =>
  props.format ? props.format(n) : String(Math.round(n * 100) / 100).replace('.', ',')
const parseFn = (s) => {
  if (props.parse) return props.parse(s)
  const n = Number(s.replace(/\s/g, '').replace(',', '.'))
  if (!Number.isFinite(n)) throw new Error('Valeur invalide.')
  return n
}

const draft = ref(fmt(props.modelValue))
const focused = ref(false)

// La valeur du store ne remplace le brouillon que si le champ n'est pas en cours d'édition.
watch(
  () => props.modelValue,
  (v) => {
    if (!focused.value) draft.value = fmt(v)
  },
)

function onFocus(e) {
  focused.value = true
  e.target.select()
}

function commit() {
  focused.value = false
  try {
    const n = parseFn(draft.value.trim())
    if (!Number.isFinite(n)) throw new Error('Valeur invalide.')
    if (fmt(n) !== fmt(props.modelValue)) emit('update:modelValue', n)
  } catch (e) {
    emit('invalid', e.message)
  }
  // Remet la valeur officielle (arrondie, ou ancienne valeur si la saisie était refusée)
  nextTick(() => (draft.value = fmt(props.modelValue)))
}

function cancel(e) {
  draft.value = fmt(props.modelValue)
  e.target.blur()
}
</script>

<template>
  <label class="nf">
    <input
      v-model="draft"
      type="text"
      :inputmode="inputmode"
      :aria-label="label || undefined"
      :placeholder="placeholder"
      autocomplete="off"
      autocorrect="off"
      autocapitalize="off"
      spellcheck="false"
      @focus="onFocus"
      @blur="commit"
      @keydown.enter.prevent="$event.target.blur()"
      @keydown.esc.prevent="cancel"
    />
    <span v-if="unit" class="nf__unit">{{ unit }}</span>
  </label>
</template>

<style scoped>
.nf {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.nf input {
  width: 100%;
  min-width: 0;
  min-height: 44px;
  padding: 0 12px;
  border: 1.5px solid var(--blue-200, #b8b8ff);
  border-radius: 12px;
  background: #fff;
  color: var(--blue-900, #000040);
  font: inherit;
  font-size: 16px; /* évite le zoom automatique d'iOS */
  font-variant-numeric: tabular-nums;
}
.nf input:focus {
  outline: none;
  border-color: var(--blue, #0000ff);
  box-shadow: 0 0 0 3px var(--blue-100, #dcdcff);
}
.nf__unit {
  color: var(--blue-500, #3333ff);
}
</style>
