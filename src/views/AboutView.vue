<script setup>
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>

<template>
  <section class="about-view">
    <!-- 页面标题 -->
    <header class="about-header">
      <h1 class="page-title">{{ t('about.title') }}</h1>
      <p class="page-desc">{{ t('about.description') }}</p>
    </header>

    <!-- 特性列表 -->
    <div class="features-grid">
      <div class="feature-card">
        <div class="feature-icon">🔒</div>
        <h3 class="feature-name">{{ t('about.features.privacy.name') }}</h3>
        <p class="feature-desc">{{ t('about.features.privacy.desc') }}</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon">⚡</div>
        <h3 class="feature-name">{{ t('about.features.speed.name') }}</h3>
        <p class="feature-desc">{{ t('about.features.speed.desc') }}</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon">🎨</div>
        <h3 class="feature-name">{{ t('about.features.design.name') }}</h3>
        <p class="feature-desc">{{ t('about.features.design.desc') }}</p>
      </div>
    </div>

    <!-- 技术栈说明 -->
    <div class="tech-section">
      <h2 class="section-title">{{ t('about.techStack') }}</h2>
      <div class="tech-tags">
        <span class="tech-tag">Vue 3</span>
        <span class="tech-tag">Vite</span>
        <span class="tech-tag">Vue Router 4</span>
        <span class="tech-tag">Composition API</span>
      </div>
    </div>
    <!-- 删除了底部的 <footer> 部分，由 App.vue 统一提供 -->
  </section>
</template>

<style scoped>
/* 样式保持不变，只需删除页脚相关样式 */
.about-view {
  display: flex;
  flex-direction: column;
  align-items: center;
  animation: fade-up 0.5s ease both;
}

@keyframes fade-up {
  from {
    opacity: 0;
    transform: translateY(16px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.about-header {
  text-align: center;
  margin-bottom: 36px;
  animation: fade-up 0.5s ease 0.1s both;
}

.page-title {
  font-size: 28px;
  font-weight: 700;
  color: #1e293b;
  margin-bottom: 10px;
  letter-spacing: 0.5px;
}

.page-desc {
  font-size: 14px;
  color: #64748b;
  max-width: 500px;
  line-height: 1.6;
}

.features-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 16px;
  width: 100%;
  max-width: 700px;
  margin-bottom: 36px;
}

.feature-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 24px 18px;
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.8);
  background: rgba(255, 255, 255, 0.55);
  backdrop-filter: blur(16px) saturate(140%);
  -webkit-backdrop-filter: blur(16px) saturate(140%);
  box-shadow: 0 6px 20px rgba(96, 125, 169, 0.12);
  transition: all 0.2s ease;
  text-align: center;
}

.feature-card:hover {
  transform: translateY(-3px);
  box-shadow: 0 10px 28px rgba(96, 125, 169, 0.2);
  border-color: rgba(59, 130, 246, 0.5);
}

.feature-icon {
  width: 48px;
  height: 48px;
  border-radius: 14px;
  background: linear-gradient(135deg, #60a5fa, #2563eb);
  color: #fff;
  display: grid;
  place-items: center;
  font-size: 22px;
  margin-bottom: 12px;
  box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3);
}

.feature-name {
  font-size: 16px;
  font-weight: 700;
  color: #1e293b;
  margin-bottom: 6px;
}

.feature-desc {
  font-size: 13px;
  color: #64748b;
  line-height: 1.5;
}

.tech-section {
  width: 100%;
  max-width: 500px;
  margin-bottom: 32px;
}

.section-title {
  font-size: 18px;
  font-weight: 700;
  color: #1e293b;
  margin-bottom: 16px;
  text-align: center;
}

.tech-tags {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
}

.tech-tag {
  padding: 6px 14px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 600;
  color: #2563eb;
  background: rgba(59, 130, 246, 0.1);
  border: 1px solid rgba(59, 130, 246, 0.22);
}

/* 删除了 .about-footer 样式 */

@media (max-width: 560px) {
  .features-grid {
    grid-template-columns: 1fr;
    max-width: 360px;
  }

  .page-title {
    font-size: 24px;
  }

  .feature-card {
    padding: 20px 16px;
  }
}
</style>
