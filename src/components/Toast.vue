<script setup>
defineProps({
  id: { type: Number, required: true },
  message: { type: String, required: true },
  type: { type: String, default: 'success' },
})
</script>

<template>
  <div class="toast" :class="type" role="alert" aria-live="assertive">
    <span class="icon">
      <svg v-if="type === 'success'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </svg>
      <svg v-else-if="type === 'info'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="16" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12.01" y2="8" />
      </svg>
      <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="15" y1="9" x2="9" y2="15" />
        <line x1="9" y1="9" x2="15" y2="15" />
      </svg>
    </span>
    <span class="message">{{ message }}</span>
  </div>
</template>

<style scoped>
.toast {
  display: flex;
  align-items: center;
  padding: 12px 18px;
  border-radius: 12px;
  font-size: 14px;
  font-weight: 500;
  color: #fff;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
  animation: toast-slide-in 0.3s ease-out forwards;
  pointer-events: auto;
}

.toast.success {
  background-color: #059669;
}
.toast.info {
  background-color: #2563eb;
}
.toast.error {
  background-color: #ef4444;
}

.icon {
  width: 20px;
  height: 20px;
  margin-right: 10px;
  flex-shrink: 0;
}
.icon svg {
  width: 100%;
  height: 100%;
}

.message {
  flex: 1;
}

@keyframes toast-slide-in {
  from {
    opacity: 0;
    transform: translateX(40px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}
</style>