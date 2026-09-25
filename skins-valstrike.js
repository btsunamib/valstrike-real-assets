/* skins-valstrike.js  —  从 ValStrike APK 解包出的武器皮肤
 * ---------------------------------------------------------------------------
 * APK 里成体系的武器皮肤是「秘术」系列（Arcane），各带一整套专属音效：
 *   assets/skins/arcane-sheriff/  17 个 wav   (秘术 Sheriff)
 *   assets/skins/arcane-vandal/   11 个 wav   (秘术 Vandal)
 * 另有 5 个特工专属第一人称手臂模型：assets/agents3d/hands/v_*.glb
 *
 * 这里提供：音效提示音播放 + 对 GLB 材质做色调处理，让皮肤在视觉上可辨识。
 */
const VS_SKINS = {
  sheriff: {
    id: 'arcane-sheriff', label: '秘术 Sheriff',
    base: './assets/skins/arcane-sheriff/',
    tint: 0x16305e, glow: 0x2f6bff,
    cues: { equip: 'Equip_Draw_FP.wav', reload: 'Reload_Shells_Out_FP.wav', inspect: 'Inspect_Elem_A.wav' },
  },
  vandal: {
    id: 'arcane-vandal', label: '秘术 Vandal',
    base: './assets/skins/arcane-vandal/',
    tint: 0x2b1a4a, glow: 0x9a5cff,
    cues: { equip: 'draw1.wav', reload: 're1.wav', inspect: 'ins1.wav' },
  },
};

let ctx = null;
const buffers = new Map();
const inflight = new Map();

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) ctx = new AC();
  }
  return ctx;
}

export function hasSkin(weaponId) { return !!VS_SKINS[weaponId]; }
export const SKIN_LIST = Object.keys(VS_SKINS).map((k) => ({ weapon: k, ...VS_SKINS[k] }));

async function loadCue(url) {
  if (buffers.has(url)) return buffers.get(url);
  if (inflight.has(url)) return inflight.get(url);
  const p = (async () => {
    try {
      const c = audio();
      if (!c) return null;
      const r = await fetch(url);
      if (!r.ok) return null;
      const b = await c.decodeAudioData(await r.arrayBuffer());
      buffers.set(url, b);
      return b;
    } catch {
      buffers.set(url, null);
      return null;
    }
  })();
  inflight.set(url, p);
  return p;
}

export function preloadSkin(weaponId) {
  const s = VS_SKINS[weaponId];
  if (!s) return;
  for (const k in s.cues) loadCue(s.base + s.cues[k]);
}

/** 播放皮肤专属提示音；返回是否真的播了 */
export function playSkinCue(weaponId, cue, vol = 0.5) {
  const s = VS_SKINS[weaponId];
  if (!s || !s.cues[cue]) return false;
  const url = s.base + s.cues[cue];
  const c = audio();
  const b = buffers.get(url);
  if (!b) { loadCue(url); return false; }
  if (!c) return false;
  try {
    const src = c.createBufferSource();
    src.buffer = b;
    const g = c.createGain();
    g.gain.value = vol;
    src.connect(g); g.connect(c.destination);
    src.start();
    return true;
  } catch { return false; }
}

/** 给皮肤武器上色（幂等） */
export function applySkinMaterials(weaponId, root) {
  const s = VS_SKINS[weaponId];
  if (!s || !root) return;
  const tint = new (Object.getPrototypeOf(root).constructor === Object ? Object : Object)();
  root.traverse((o) => {
    if (!o.isMesh && !o.isSkinnedMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m || !m.color || m.userData.vsSkinned) continue;
      m.userData.vsSkinned = true;
      try {
        m.color.setHex(s.tint);
        if (m.emissive) { m.emissive.setHex(s.glow); m.emissiveIntensity = 0.12; }
      } catch { /* 材质类型不支持就跳过 */ }
    }
  });
}
