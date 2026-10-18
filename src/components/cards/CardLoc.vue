<script setup lang="ts">
import { computed } from 'vue'
import { useEnvStore } from '../../stores/env'
import { Engine as E } from '../../lib/engine'

const env = useEnvStore()
const types = [
  ['auto', '自动'], ['sea', '海/河口'], ['river', '河流'], ['lake', '湖/水库'], ['pond', '塘']
] as const
const species = computed(() => Object.keys((E as any).SPECIES))
const coord = computed(() => (env.me ? `${env.me.lat.toFixed(4)}, ${env.me.lon.toFixed(4)}` : '未定位'))
</script>

<template>
  <section class="card span2 show" data-fam="loc">
    <div class="card-head">
      <span class="ico"><i class="ic" data-icon="pin"></i></span>
      <h2>当前位置与水域</h2>
      <div class="head-right">
        <button class="act ghost" @click="env.me && env.load(env.me.lat, env.me.lon, true)">重取</button>
      </div>
    </div>

    <div>
      <div class="statgrid">
        <div class="st"><i>坐标</i><b><u style="font-size:12px">{{ coord }}</u></b><em>WGS84</em></div>
        <div class="st"><i>水域</i><b>{{ env.typeLabel }}</b><em>靠海况/OSM 自动判</em></div>
        <div class="st"><i>目标鱼</i><b>{{ env.speciesLabel }}</b><em>影响六因子权重</em></div>
      </div>
    </div>

    <div class="chipwrap">
      <div class="chiprow">
        <span class="chiprow-key">水域</span>
        <button v-for="t in types" :key="t[0]" class="chip" :class="{ on: env.waterType === t[0] }"
                @click="env.setWaterType(t[0] as any)">{{ t[1] }}</button>
      </div>
      <div class="chiprow">
        <span class="chiprow-key">目标鱼</span>
        <button v-for="k in species" :key="k" class="chip" :class="{ on: env.species === k }"
                @click="env.setSpecies(k)">{{ (E as any).SPECIES[k].label }}</button>
      </div>
    </div>
    <div class="card-foot">水域类型靠海况接口与 OSM 标签自动判，不对就点上面 chips 改。</div>
  </section>
</template>
