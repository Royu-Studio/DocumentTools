<script setup>
defineProps({
  name: { type: String, required: true },
  size: { type: [Number, String], default: 20 },
})
</script>

<template>
  <svg
    class="app-icon"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <template v-if="name === 'json'"><path d="M8 3H6v6l-3 3 3 3v6h2M16 3h2v6l3 3-3 3v6h-2M11 9h2m-2 6h2" /></template>
    <template v-else-if="name === 'xml'"><path d="m7 6-5 6 5 6m10-12 5 6-5 6M14 3l-4 18" /></template>
    <template v-else-if="name === 'layers'"><path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5" /></template>
    <template v-else-if="name === 'plus'"><path d="M12 5v14M5 12h14" /></template>
    <template v-else-if="name === 'edit'"><path d="m14 5 5 5M4 20l5-1L20 8a2 2 0 0 0-5-5L4 14v6ZM13 20h7" /></template>
    <template v-else-if="name === 'scan'"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M8 8h8M12 8v8m-3 0h6" /></template>
    <template v-else-if="name === 'shield'"><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z" /><path d="m8 12 3 3 5-6" /></template>
    <template v-else-if="name === 'stamp'"><path d="M5 16h14v4H5zM8 16v-3c0-2 2-2 2-4V7a2 2 0 0 1 4 0v2c0 2 2 2 2 4v3M4 23h16" /></template>
    <template v-else-if="name === 'file'"><path d="M14 3H5v18h14V8l-5-5Zm0 0v5h5M8 12h8M8 16h5" /></template>
    <template v-else-if="name === 'image'"><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8" cy="8" r="1" /><path d="m3 17 5-5 4 4 4-6 5 7" /></template>
    <template v-else-if="name === 'arrow-left'">
      <path d="m15 18-6-6 6-6" />
    </template>
    <template v-else-if="name === 'arrow-right'">
      <path d="m9 18 6-6-6-6" />
    </template>
    <template v-else-if="name === 'home'">
      <path d="m3 11 9-8 9 8" />
      <path d="M5 10v10h14V10M9 20v-6h6v6" />
    </template>
    <template v-else-if="name === 'sun'">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42" />
    </template>
    <template v-else-if="name === 'moon'">
      <path d="M20.2 15.1A8.5 8.5 0 0 1 8.9 3.8 8.5 8.5 0 1 0 20.2 15.1Z" />
    </template>
  </svg>
</template>

<style scoped>
.app-icon { display: block; flex: 0 0 auto; }
</style>
