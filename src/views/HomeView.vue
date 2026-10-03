<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import FileDropZone from '@/components/FileDropZone.vue'
import { useWorkspaceStore } from '@/stores/workspace.js'

const router = useRouter()
const workspace = useWorkspaceStore()
const error = ref('')

async function openFile(file, kind) {
  error.value = ''
  const mode = kind === 'pdf' ? 'pdf' : 'image'
  workspace.stageFile(file, mode)
  localStorage.setItem('document-tools-last-mode', mode)
  await router.push(mode === 'pdf' ? '/pdf' : '/image_tool')
}

function openOcr() {
  workspace.setCurrentFileName('')
  localStorage.setItem('document-tools-last-mode', 'ocr')
  router.push('/ocr')
}
</script>

<template>
  <main class="home-page">
    <section class="home-hero">
      <div class="home-intro">
        <h1>一个入口，处理 <em>PDF</em> 与 <em>图片</em></h1>
        <p>盖章、编辑、识别，轻松高效，隐私安全。</p>
      </div>
      <svg class="hero-art" viewBox="0 0 310 170" aria-hidden="true">
        <defs><linearGradient id="paper" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#fff"/><stop offset="1" stop-color="#edf3ff"/></linearGradient><linearGradient id="stamp" x1="0" x2="1"><stop stop-color="#8db7ff"/><stop offset="1" stop-color="#315fc7"/></linearGradient></defs>
        <path d="M22 116 113 50l62 79H45z" fill="#edf3ff"/><rect x="82" y="12" width="111" height="138" rx="10" transform="rotate(-8 82 12)" fill="url(#paper)" stroke="#e4ebf7"/><path d="m101 43 62-9m-58 31 66-9m-61 31 51-7" stroke="#b7cff8" stroke-width="7" stroke-linecap="round"/><rect x="105" y="91" width="65" height="42" rx="6" fill="#7ba7f8" transform="rotate(-8 105 91)"/><path d="m111 124 17-22 13 10 12-18 21 25" fill="#eaf2ff"/><ellipse cx="229" cy="136" rx="57" ry="12" fill="#dfe9fb"/><path d="M219 84h31l9 37h-49z" fill="url(#stamp)"/><path d="M229 84c-1-17 1-30 12-35 15-7 31 7 24 22-4 9-11 10-15 14z" fill="url(#stamp)"/><rect x="195" y="118" width="79" height="19" rx="7" fill="#315fc7"/></svg>
    </section>

    <FileDropZone title="拖拽 PDF 或图片到此处，或" hint="支持 PDF、PNG、JPG、WEBP 等格式（单个文件 ≤ 200MB）" @file="openFile" @error="error = $event" />
    <p v-if="error" class="status-message error" role="alert">{{ error }}</p>

    <section class="capabilities" aria-label="工具能力">
      <button class="capability" type="button" @click="router.push('/pdf')">
        <span class="capability-icon stamp-icon">▣</span>
        <span><strong>PDF 盖章</strong><small>添加印章、签名、日期戳<br>批量盖章，位置自定义</small></span><AppIcon class="enter-icon" name="arrow-right" :size="21" />
      </button>
      <button class="capability" type="button" @click="router.push('/image_tool')">
        <span class="capability-icon">▧</span>
        <span><strong>图片编辑</strong><small>涂抹、文字、裁剪、取色<br>轻松编辑与标注图片</small></span><AppIcon class="enter-icon" name="arrow-right" :size="21" />
      </button>
      <button class="capability" type="button" @click="openOcr">
        <span class="capability-icon">▤</span>
        <span><strong>离线文字识别</strong><small>从图片或 PDF 中提取文字<br>支持多语言 OCR</small></span><AppIcon class="enter-icon" name="arrow-right" :size="21" />
      </button>
    </section>
  </main>
</template>

<style scoped>
.home-page { width: min(1100px, calc(100% - 40px)); margin: 0 auto; padding: 58px 0 42px; }
.home-hero { position: relative; min-height: 180px; display: flex; align-items: center; padding: 0 340px 20px 72px; }
.home-intro { text-align: left; }
h1 { margin: 0; white-space: nowrap; font-size: clamp(31px, 3.3vw, 48px); line-height: 1.16; letter-spacing: -.035em; }
h1 em { color: var(--md-primary); font-style: normal; }
.home-intro p { margin: 16px 0 0; color: var(--md-on-surface-variant); font-size: 16px; letter-spacing: .04em; }
.hero-art { position: absolute; top: -14px; right: 48px; width: 300px; height: 170px; filter: drop-shadow(0 18px 22px rgba(39, 77, 145, .12)); }
.status-message { margin-top: 12px; }
.capabilities { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-top: 24px; }
.capability { min-height: 148px; padding: 22px; border: 1px solid #e4eaf4; border-radius: 10px; display: grid; grid-template-columns: 54px 1fr auto; align-items: center; gap: 14px; text-align: left; background: var(--md-surface); box-shadow: 0 8px 24px rgba(30, 56, 100, .07); cursor: pointer; transition: .18s ease; }
.capability:hover { border-color: #b9ccf4; transform: translateY(-2px); box-shadow: 0 12px 28px rgba(30, 56, 100, .12); }
.capability-icon { flex: 0 0 54px; height: 54px; border-radius: 12px; display: grid; place-items: center; background: linear-gradient(135deg,#edf3ff,#d6e4ff); color: #2f63cd; font-size: 28px; font-weight: 800; box-shadow: inset 0 0 0 1px rgba(76,119,208,.08); }
.capability strong, .capability small { display: block; }
.capability strong { margin-bottom: 6px; font-size: 17px; }
.capability small { color: var(--md-on-surface-variant); line-height: 1.55; }
.enter-icon { color: #26364d; transition: transform .18s ease; }
.capability:hover .enter-icon { transform: translateX(3px); }
@media (max-width: 860px) { .home-hero { padding: 20px 0 28px; } .hero-art { opacity: .24; right: 0; } .home-intro { position: relative; z-index: 1; } .capabilities { grid-template-columns: 1fr; } }
@media (max-width: 560px) { .home-page { width: min(100% - 28px, 1100px); padding-top: 28px; } .home-hero { min-height: 145px; align-items: flex-start; } h1 { white-space: normal; font-size: 34px; } .hero-art { width: 220px; top: 25px; } .capability { min-height: 112px; padding: 16px; } }
:global(:root[data-theme='dark']) .capability { border-color: var(--md-outline-variant); box-shadow: 0 8px 24px rgba(0, 0, 0, .18); }
:global(:root[data-theme='dark']) .enter-icon { color: var(--md-on-surface-variant); }
</style>
