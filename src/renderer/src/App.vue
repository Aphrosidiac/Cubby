<script setup lang="ts">
import Toasts from '@/components/ui/Toasts.vue'
import ConfirmHost from '@/components/ui/ConfirmHost.vue'
import { app } from '@/lib/store'
</script>

<template>
  <RouterView v-if="app.ready" />
  <Toasts />
  <ConfirmHost />
</template>
