<script setup>
import ToolHeader from '@/components/ToolHeader.vue'
import AppIcon from '@/components/AppIcon.vue'
const tools = [
  { path: '/pdf', icon: 'file', tag: 'DOCUMENT', name: 'PDF 工具', text: 'PDF 与图片统一编辑、盖章、文字识别与 Word 导出', foot: 'PDF / PNG / JPG / WEBP' },
  { path: '/json', icon: 'json', tag: 'STRUCTURED DATA', name: 'JSON 格式化', text: '格式化、压缩与语法校验', foot: 'JSON' },
  { path: '/xml', icon: 'xml', tag: 'MARKUP', name: 'XML 格式化', text: '整理缩进、压缩与语法校验', foot: 'XML' },
]
</script>
<template>
  <div class="toolbox-home">
    <ToolHeader />
    <main class="toolbox-content">
      <div class="toolbox-intro"><span class="eyebrow">ROYU / EVERYDAY UTILITIES</span><h1>文档工具箱<span>.</span></h1><p>选一个工具，开始处理。</p></div>
      <div class="tool-cards">
        <RouterLink v-for="tool in tools" :key="tool.path" :to="tool.path" class="tool-card">
          <div class="tool-card-top"><span class="tool-card-icon"><AppIcon :name="tool.icon" :size="32" /></span><span class="eyebrow">{{ tool.tag }}</span></div>
          <h2>{{ tool.name }}</h2><p>{{ tool.text }}</p>
          <div class="tool-card-bottom"><span>{{ tool.foot }}</span><AppIcon name="arrow-right" /></div>
        </RouterLink>
      </div>
      <footer class="toolbox-footer"><span>文件与文本仅在当前浏览器处理</span><span>ROYU TOOLS</span></footer>
    </main>
  </div>
</template>
