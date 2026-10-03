<script setup>
import { RouterView } from 'vue-router'
</script>
<template><RouterView v-slot="{ Component, route }"><KeepAlive :max="4"><component :is="Component" :key="route.path" /></KeepAlive></RouterView></template>
