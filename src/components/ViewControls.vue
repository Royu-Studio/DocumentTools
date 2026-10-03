<script setup>
defineProps({ zoom: { type: Number, required: true } })
defineEmits(['zoom-in', 'zoom-out', 'fit', 'actual'])
</script>

<template>
  <div class="view-controls" aria-label="视图控制">
    <button class="icon-button" aria-label="缩小" title="缩小" @click="$emit('zoom-out')">−</button>
    <select class="zoom-select" aria-label="缩放选项" value="current" @change="$emit($event.target.value); $event.target.value = 'current'"><option value="current" disabled>{{ Math.round(zoom * 100) }}%</option><option value="fit">适应窗口</option><option value="actual">实际大小 100%</option></select>
    <button class="icon-button" aria-label="放大" title="放大" @click="$emit('zoom-in')">＋</button>
  </div>
</template>
