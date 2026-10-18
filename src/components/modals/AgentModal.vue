<script setup lang="ts">
/* LureCast · 应用助手弹窗（P4）—— 对应老壳 #modalAgent
   ---------------------------------------------------------------------------
   聊天逻辑全在 lib/agent.ts（由 assets/agent.js 机械迁移，760 行）：工具调用
   （定位 / 换水域 / 换目标鱼 / 切页 / 刷新）、读本机数据回答、mdLite 渲染、历史落盘。
   这里只做一件事：把老壳那套 DOM 契约（agLog/agQuick/agInput/agSend/agStop/agFile…）
   摆出来，然后把 Agent.bind() 挂上。回复由模型生成，数据是本机算的，不编数字。 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useUiStore } from '../../stores/ui'
import { useEnvStore } from '../../stores/env'
import { useSpotsStore } from '../../stores/spots'
import { useMyStore } from '../../stores/my'
import { CFG } from '../../lib/cfg'
import { Agent, setAgentDeps } from '../../lib/agent'
import { createLcBridge } from '../../lib/lc-bridge'
import { AI } from '../../lib/ai'
import { toast } from '../../lib/ui'

const ui = useUiStore()
const env = useEnvStore()
const spots = useSpotsStore()
const my = useMyStore()

const visible = () => ui.modal === 'agent'

function loadAt(lat: number, lon: number, force = false, source: 'manual' | 'url' | 'gps' = 'manual') {
  env.load(lat, lon, force, source)
  spots.load(lat, lon, force)
}

onMounted(() => {
  setAgentDeps({
    My: { favorites: my.favorites, catches: my.catches, favorites_() { return my.favorites } },
    LureCast: createLcBridge({ env, spots, ui, my, loadAt })
  })
  Agent.bind()
})

/* 打开弹窗时滚到底 + 同步模型提示 */
watch(() => ui.modal, (m) => {
  if (m !== 'agent') return
  const box = document.getElementById('agLog')
  if (box) box.scrollTop = box.scrollHeight
  const note = document.getElementById('agModelNote')
  if (note) {
    note.textContent = AI.chatReady && AI.chatReady()
      ? '模型：' + (AI.chatModel ? AI.chatModel() : '默认')
      : '未配置 Key（去设置 → 识图与助手 填）'
  }
})

onBeforeUnmount(() => { /* Agent 没有全局监听要拆 */ })

function clearChat() {
  try { Agent.clear() } catch { /* 忽略 */ }
  toast('对话已清空')
}

const tip = '读本机数据回答，不编数字'
void CFG
</script>

<template>
  <div id="modalAgent" class="modal" :class="{ hidden: !visible() }" @click.self="ui.closeModal()">
    <div class="modal-box agbox">
      <div class="modal-head">
        <div class="agtitle">
          <span class="agmark">AI</span>
          <div>
            <h3>应用助手</h3>
            <i id="agModelNote">{{ tip }}</i>
          </div>
        </div>
        <div class="head-right">
          <button class="act ghost" @click="clearChat">清空</button>
          <button class="act ghost" @click="ui.closeModal()">关闭</button>
        </div>
      </div>

      <div class="aglog" id="agLog"></div>
      <div class="agquick" id="agQuick"></div>

      <div class="aginput">
        <button class="act ghost icoact" data-tip="发张照片|拍照或选图，助手能看鱼、看水下结构、看岸边环境。" aria-label="添加照片"
                onclick="document.getElementById('agFile').click()">
          <i class="ic" data-icon="camera"></i>
        </button>
        <div class="agthumb" id="agThumb" style="display:none">
          <img id="agThumbImg" alt="附件">
          <button id="agThumbX" aria-label="移除照片">×</button>
        </div>
        <textarea id="agInput" rows="1" placeholder="问点什么…（例如：今天这风该打哪一岸）"></textarea>
        <button class="act primary" id="agSend">发送</button>
        <button class="act ghost" id="agStop" style="display:none">停止</button>
        <input type="file" id="agFile" accept="image/*" style="display:none">
      </div>

      <div class="modal-foot">回答由你自选的模型生成；数据是本机的定位/气象/OSM/Sentinel-2 计算结果，推断值不等于实测。</div>
    </div>
  </div>
</template>
