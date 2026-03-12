<template>
  <div class="flex flex-col">
    <span :class="color" class="font-mono text-sm font-medium leading-tight">{{ value }}</span>
    <span class="font-mono text-[10px] text-muted-foreground">{{ label }}</span>
  </div>
</template>
<script setup>
defineProps({ label: String, value: String, color: String })
</script>
