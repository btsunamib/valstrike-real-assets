/* weapon-art.js  —  VALSTRIKE 逆向武器替换层
 * ---------------------------------------------------------------------------
 * 原始程序化实现在 weapon-art-proc.js。这一层：
 *   1. 照旧调用原实现，拿到 {model,blade,handle,flash,magazine}
 *      （main.js 对这些成员的引用全部继续有效）
 *   2. 把从 ValStrike APK 逆向出的真实第一人称武器 GLB 挂到 art.model 上
 *   3. GLB 就绪后隐藏程序化网格；失败则保持程序化模型（兜底）
 *   4. 本模块自带 rAF 驱动 AnimationMixer，并监听 art.flash.visible 触发开火动画
 *
 * 因为动画循环在模块内部，main.js 一行都不用改。
 * 带特殊皮肤的路径（champions26 / narukami / chaos / mercy / kuronami）不覆盖，
 * 以免破坏仓库原有的皮肤系统。
 */
import * as T from './three.module.js';
import * as SkeletonUtils from './utils/SkeletonUtils.js';
import { GLTFLoader } from './loaders/GLTFLoader.js';
import { createWeaponArt as createProceduralWeaponArt } from './weapon-art-proc.js';

/* 调参入口 */
const TARGET_LENGTH = 0.62;      // 归一化后最长边（weaponGroup 空间）
const MODEL_YAW = Math.PI / 2;   // GoldSrc +X 枪口 -> Three -Z 前向
const SWAP_SHOWCASE = false;     // 展示台里是否也用真实模型

const loader = new GLTFLoader();
const cache = new Map();
const loading = new Map();

function loadWeapon(id) {
  if (cache.has(id)) return Promise.resolve(cache.get(id));
  if (loading.has(id)) return loading.get(id);
  const p = new Promise((resolve) => {
    loader.load(
      './assets/weapons3d/v_' + id + '.glb',
      (g) => {
        g.scene.traverse((o) => {
          if (o.isMesh || o.isSkinnedMesh) {
            o.frustumCulled = false;
            if (o.material) {
              o.material.metalness = 0.35;
              o.material.roughness = 0.55;
              o.material.side = T.FrontSide;
            }
          }
        });
        const rec = { scene: g.scene, clips: g.animations || [] };
        cache.set(id, rec);
        resolve(rec);
      },
      undefined,
      () => { cache.set(id, null); resolve(null); }
    );
  });
  loading.set(id, p);
  return p;
}

function pickAction(actions, keys) {
  for (const k of keys) {
    if (actions[k]) return actions[k];
    const low = k.toLowerCase();
    const hit = Object.keys(actions).find((x) => x.toLowerCase() === low)
             || Object.keys(actions).find((x) => x.toLowerCase().startsWith(low));
    if (hit) return actions[hit];
  }
  return null;
}

/* 只有基础路径才覆盖，保留皮肤系统 */
function shouldSwap(id, s, showcase, variant, mercyVariant, chaosVariant, naruVariant) {
  if (showcase && !SWAP_SHOWCASE) return false;
  if (s && s.champions26) return false;
  if (variant && variant !== 'base') return false;
  if (chaosVariant && chaosVariant !== 'base') return false;
  if (naruVariant && naruVariant !== 'base') return false;
  return true;
}

const live = new Set();
let rafId = 0;
let last = 0;

function tick(now) {
  rafId = requestAnimationFrame(tick);
  const dt = Math.min(0.05, (now - last) / 1000 || 0);
  last = now;
  for (const inst of live) {
    if (inst.mixer) inst.mixer.update(dt);
    // art.flash.visible 由原实现的开火逻辑翻转 -> 当作开火信号
    const flashing = !!(inst.art.flash && inst.art.flash.visible);
    if (flashing && !inst._flashing) inst.play('shoot', { once: true, restart: true });
    inst._flashing = flashing;
  }
}

export function createWeaponArt(id, s, knifeType, showcase, variant, mercyVariant, chaosVariant, naruVariant) {
  /* 1) 原程序化实现照常构建 */
  const art = createProceduralWeaponArt(id, s, knifeType, showcase, variant,
                                        mercyVariant, chaosVariant, naruVariant);
  if (!art || !art.model) return art;

  if (!shouldSwap(id, s, showcase, variant, mercyVariant, chaosVariant, naruVariant)) return art;

  /* 2) 挂点 */
  const holder = new T.Group();
  holder.name = 'glb-weapon';
  holder.rotation.y = MODEL_YAW;
  art.model.add(holder);

  const inst = {
    art, holder, mixer: null, actions: {}, current: null, state: 'idle', _flashing: false,
  };

  inst.play = (state, o = {}) => {
    if (!inst.mixer) return;
    const table = {
      idle:   ['idle'],
      shoot:  ['shoot1', 'shoot', 'zoom_shoot'],
      reload: ['reload'],
      draw:   ['draw'],
      inspect:['inspect'],
      zoom:   ['zoom_idle'],
    };
    const next = pickAction(inst.actions, table[state] || table.idle);
    if (!next) return;
    if (inst.current === next && !o.once && !o.restart) return;
    if (inst.current && inst.current !== next) inst.current.fadeOut(0.06);
    next.reset();
    next.setLoop(o.once ? T.LoopOnce : T.LoopRepeat, o.once ? 1 : Infinity);
    next.clampWhenFinished = !!o.once;
    next.timeScale = o.speed || 1;
    next.fadeIn(0.06).play();
    inst.current = next;
    inst.state = state;
  };

  /* 3) 异步装真实模型 */
  loadWeapon(id).then((rec) => {
    if (!rec) return;                       // 失败：保留程序化模型
    holder.clear();

    const clone = SkeletonUtils.clone(rec.scene);
    const box = new T.Box3().setFromObject(clone);
    const size = box.getSize(new T.Vector3());
    const longest = Math.max(size.x, size.y, size.z);
    if (longest > 1e-4) clone.scale.setScalar(TARGET_LENGTH / longest);
    const box2 = new T.Box3().setFromObject(clone);
    const c = box2.getCenter(new T.Vector3());
    clone.position.sub(c);                  // 居中到 holder 原点

    holder.add(clone);

    inst.mixer = new T.AnimationMixer(clone);
    for (const clip of rec.clips) inst.actions[clip.name] = inst.mixer.clipAction(clip);
    inst.play('idle');
    inst.ready = true;

    // 真实模型就位后才隐藏程序化网格
    art.model.traverse((o) => { if (o.isMesh) o.visible = false; });
    if (art.flash) art.flash.visible = false;
  });

  /* 4) 包装 update（原实现若有则保留其行为） */
  const procUpdate = art.update;
  art.update = function (state) {
    if (typeof procUpdate === 'function') procUpdate.call(art, state);
    if (!inst.mixer) return;
    const eq = state && state.equipSeconds;
    if (eq != null && eq < 0.45) {
      if (inst.state !== 'draw') inst.play('draw', { once: true, restart: true });
    } else if (eq != null && eq >= 0.45 && inst.state === 'draw') {
      inst.play('idle');
    }
  };

  art.glb = inst;
  art.play = inst.play;

  live.add(inst);
  if (!rafId) { last = performance.now(); rafId = requestAnimationFrame(tick); }

  return art;
}
