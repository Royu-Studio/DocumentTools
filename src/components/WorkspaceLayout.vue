<script setup>
import { nextTick, onDeactivated, ref } from 'vue'
import { useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'

defineProps({
  title: { type: String, required: true },
  subtitle: { type: String, default: '' },
  hasFile: Boolean,
  embedded: Boolean,
  leftLabel: { type: String, default: '页面' },
})
const showLeft = ref(false)
const showRight = ref(false)
const leftTrigger = ref(null)
const rightTrigger = ref(null)
const leftClose = ref(null)
const rightClose = ref(null)
const sheet = ref(null)
const router = useRouter()

async function openSheet(side) {
  if (side === 'left') showLeft.value = true
  else showRight.value = true
  await nextTick()
  sheet.value?.showModal()
  ;(side === 'left' ? leftClose.value : rightClose.value)?.focus()
}

function closeSheet(side) {
  sheet.value?.close()
  if (side === 'left') showLeft.value = false
  else showRight.value = false
  nextTick(() => (side === 'left' ? leftTrigger.value : rightTrigger.value)?.focus())
}
onDeactivated(() => { if (showLeft.value || showRight.value) closeSheet(showLeft.value ? 'left' : 'right') })

</script>

<template>
  <main class="workspace-page">
    <header class="workspace-commandbar">
      <button v-if="!embedded" class="workspace-back" type="button" aria-label="返回工具箱" title="返回工具箱" @click="router.push('/')">
        <AppIcon name="arrow-left" :size="22" />
      </button>
      <div class="workspace-heading">
        <h1>{{ title }}</h1>
        <span v-if="subtitle">{{ subtitle }}</span>
      </div>
      <nav v-if="hasFile" class="workspace-toolbar" aria-label="编辑工具"><slot name="toolbar" /></nav>
      <div class="workspace-actions"><slot name="actions" /></div>
    </header>

    <div v-if="hasFile" class="workspace-mobile-switches">
      <button ref="leftTrigger" type="button" class="tonal-button" @click="openSheet('left')">{{ leftLabel }}</button>
      <button ref="rightTrigger" type="button" class="tonal-button" @click="openSheet('right')">属性</button>
      <div class="mobile-history"><slot name="history" /></div>
    </div>

    <section class="workspace-grid" :class="{ 'without-file': !hasFile }">
      <aside v-if="hasFile" class="workspace-sidebar workspace-left"><slot name="left" /></aside>
      <section class="workspace-center">
        <div class="workspace-canvas"><slot /></div>
      </section>
      <aside v-if="hasFile" class="workspace-sidebar workspace-right"><slot name="right" /></aside>
    </section>

    <dialog v-if="showLeft || showRight" ref="sheet" class="workspace-sheet-dialog" :aria-label="showLeft ? leftLabel : '属性设置'" @cancel.prevent="closeSheet(showLeft ? 'left' : 'right')" @click.self="closeSheet(showLeft ? 'left' : 'right')">
      <aside v-if="showLeft" class="mobile-sheet">
        <div class="sheet-handle"></div>
        <button ref="leftClose" class="sheet-close" aria-label="关闭页面面板" @click="closeSheet('left')">×</button>
        <slot name="left" />
      </aside>
      <aside v-else class="mobile-sheet">
        <div class="sheet-handle"></div>
        <button ref="rightClose" class="sheet-close" aria-label="关闭属性面板" @click="closeSheet('right')">×</button>
        <slot name="right" />
      </aside>
    </dialog>
  </main>
</template>
