<script setup>
import ToolHeader from '@/components/ToolHeader.vue'
import AppIcon from '@/components/AppIcon.vue'
import { toolRegistry as tools } from '@/workspaces/registry.js'
const emit = defineEmits(['open-tool'])
function openTool(event, tool) {
  if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  emit('open-tool', tool)
}
</script>
<template>
  <div class="toolbox-home">
    <ToolHeader />
    <main class="toolbox-content">
      <div class="toolbox-intro"><span class="eyebrow">ROYU / EVERYDAY UTILITIES</span><h1>文档工具箱<span>.</span></h1><p>选一个工具，开始处理。</p></div>
      <div class="tool-cards">
        <a v-for="tool in tools" :key="tool.path" :href="tool.path" class="tool-card" @click="openTool($event, tool)">
          <div class="tool-card-top"><span class="tool-card-icon"><AppIcon :name="tool.icon" :size="32" /></span><span class="eyebrow">{{ tool.tag }}</span></div>
          <h2>{{ tool.name }}</h2><p>{{ tool.text }}</p>
          <div class="tool-card-bottom"><span>{{ tool.foot }}</span><AppIcon name="arrow-right" /></div>
        </a>
      </div>
      <footer class="toolbox-footer"><span>文件与文本仅在当前浏览器处理</span><span>ROYU TOOLS</span></footer>
    </main>
  </div>
</template>
