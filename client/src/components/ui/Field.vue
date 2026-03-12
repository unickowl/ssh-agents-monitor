<template>
  <div class="space-y-1.5">
    <label class="block text-xs text-muted-foreground">{{ label }}</label>
    <slot />
  </div>
</template>
<script setup>
defineProps({ label: String })
</script>
