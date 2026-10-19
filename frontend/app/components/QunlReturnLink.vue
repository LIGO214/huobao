<template>
  <a href="/console" class="qunl-return-link" :title="t('layout.nav.qunl')">
    <ArrowLeft :size="15" :stroke-width="1.8" aria-hidden="true" />
    <span>{{ t('layout.nav.qunl') }}</span>
  </a>
</template>

<script setup>
import { ArrowLeft } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>

<style scoped>
.qunl-return-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  gap: 6px;
  min-height: 32px;
  padding: 0 12px;
  border-radius: var(--radius);
  color: var(--text-2);
  font-size: 13px;
  font-weight: 600;
  line-height: 1;
  letter-spacing: 0;
  text-decoration: none;
  white-space: nowrap;
  transition: background 0.18s var(--ease-out), color 0.18s var(--ease-out);
}
.qunl-return-link:hover {
  color: var(--text-0);
  background: var(--bg-hover);
}
.qunl-return-link:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3.5px var(--button-focus);
}
</style>
