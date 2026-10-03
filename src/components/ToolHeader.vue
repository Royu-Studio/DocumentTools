<script setup>
import AppIcon from './AppIcon.vue'
import { useTheme } from '@/composables/useTheme.js'
defineProps({ title: String })
const { themeMode, resolvedTheme } = useTheme()
</script>
<template>
  <header class="tool-header">
    <RouterLink v-if="title" to="/" class="tool-home" aria-label="返回文档工具箱"><AppIcon name="arrow-left" /> <span>工具箱</span></RouterLink>
    <RouterLink v-else to="/" class="royu-brand"><i></i>ROYU <span>TOOLS</span></RouterLink>
    <strong v-if="title" class="tool-title">{{ title }}</strong>
    <span class="tool-privacy"><AppIcon name="shield" :size="16" />本地处理 · 文件不上传</span>
    <slot />
    <button class="theme-icon-button" :aria-label="resolvedTheme === 'dark' ? '切换到亮色模式' : '切换到暗色模式'" @click="themeMode = resolvedTheme === 'dark' ? 'light' : 'dark'"><AppIcon :name="resolvedTheme === 'dark' ? 'sun' : 'moon'" /></button>
  </header>
</template>
