/* agent-art.js  —  VALSTRIKE 逆向资产替换层
 * ---------------------------------------------------------------------------
 * 原始程序化实现在 agent-art-proc.js，这里做的是：
 *   1. 照旧调用原实现拿到完整骨架/网格（main.js 的摆姿势代码继续有效）
 *   2. 挂上从 ValStrike APK 逆向出的真实模型（GLB，含 113 段骨骼动画）
 *   3. GLB 就绪后隐藏程序化网格；GLB 失败则保持程序化模型可见（兜底）
 *   4. 用本模块自带的 requestAnimationFrame 驱动 AnimationMixer
 *
 * 动画循环在模块内部，因此 main.js 一行都不用改。
 */
import * as T from './three.module.js';
import * as SkeletonUtils from './utils/SkeletonUtils.js';
import { GLTFLoader } from './loaders/GLTFLoader.js';
import { createAgentModel as createProceduralModel, HUMAN_PROPORTIONS } from './agent-art-proc.js';

export { HUMAN_PROPORTIONS };

/* 仓库的特工 id -> 逆向出的真实模型 */
const AGENT_GLB = {
  wushu:   'Jett',        // 捷风
  thorne:  'Sage',        // 贤者
  hunter:  'Sova',        // 猎枭
  phoenix: 'Phoenix',     // 凤凰
  clay:    'Brimstone',   // 炼狱
};

const TARGET_HEIGHT = HUMAN_PROPORTIONS.height;   // 1.86，与原模型同高
const MODEL_YAW = Math.PI / 2;                    // GoldSrc +X 前向 -> Three -Z 前向

/* 状态 -> 模型内嵌序列名 */
const CLIP = {
  idle:   ['idle1', 'idle'],
  walk:   ['walk'],
  run:    ['run'],
  crouch: ['crouch_idle'],
  jump:   ['jump'],
  shoot:  ['shoot1', 'shoot', 'zoom_shoot'],
  reload: ['reload'],
};

const loader = new GLTFLoader();
const cache = new Map();
const loading = new Map();

function loadModel(name) {
  if (cache.has(name)) return Promise.resolve(cache.get(name));
  if (loading.has(name)) return loading.get(name);
  const p = new Promise((resolve) => {
    loader.load(
      './assets/agents3d/' + name + '.glb',
      (g) => {
        g.scene.traverse((o) => {
          if (o.isMesh || o.isSkinnedMesh) {
            o.frustumCulled = false;
            o.castShadow = true;
            o.receiveShadow = true;
            if (o.material) {
              o.material.metalness = 0.05;
              o.material.roughness = 0.8;
              o.material.side = T.FrontSide;
            }
          }
        });
        const rec = { scene: g.scene, clips: g.animations || [] };
        cache.set(name, rec);
        resolve(rec);
      },
      undefined,
      () => { cache.set(name, null); resolve(null); }
    );
  });
  loading.set(name, p);
  return p;
}

function pickAction(actions, keys) {
  for (const k of keys) {
    if (actions[k]) return actions[k];
    const lower = k.toLowerCase();
    const hit = Object.keys(actions).find((x) => x.toLowerCase() === lower)
             || Object.keys(actions).find((x) => x.toLowerCase().startsWith(lower));
    if (hit) return actions[hit];
  }
  return null;
}

/* 内部驱动循环：推进所有实例的 mixer，并让 GLB 跟随原模型的世界位置 */
const live = new Set();
let rafId = 0;
let last = 0;

function tick(now) {
  rafId = requestAnimationFrame(tick);
  const dt = Math.min(0.05, (now - last) / 1000 || 0);
  last = now;
  for (const inst of live) {
    if (inst.mixer) inst.mixer.update(dt);
    if (inst.anchor && inst.holder) {
      // holder 与 anchor 同为 model 的子节点，用局部坐标即可（避免重复施加父变换）
      inst.holder.position.copy(inst.anchor.position);
      // 由世界位移推断移动状态，无需 main.js 配合
      const e = inst.anchor.matrixWorld.elements;
      const x = e[12], z = e[14];
      if (inst._lx !== undefined && inst.mixer) {
        const spd = Math.hypot(x - inst._lx, z - inst._lz) / Math.max(dt, 1e-3);
        const want = spd > 2.4 ? 'run' : spd > 0.4 ? 'walk' : 'idle';
        if (want !== inst.state) inst.play(want);
      }
      inst._lx = x; inst._lz = z;
    }
  }
}

export function createAgentModel(a, opts = {}) {
  /* 1) 原程序化模型照常构建，main.js 会继续操作它的骨骼组 */
  const model = createProceduralModel(a, opts);

  /* 2) 找到挂点：原模型的第一个子组 */
  const anchor = model.children.find((c) => c.isGroup) || model;

  const holder = new T.Group();
  holder.name = 'glb-agent';
  holder.rotation.y = MODEL_YAW;
  model.add(holder);

  const inst = {
    holder, anchor, mixer: null, actions: {}, current: null, state: 'idle',
  };

  inst.play = (state, o = {}) => {
    if (!inst.mixer) { inst.state = state; return; }
    const next = pickAction(inst.actions, CLIP[state] || CLIP.idle);
    if (!next) return;
    if (inst.current === next && !o.once) return;
    if (inst.current) inst.current.fadeOut(0.18);
    next.reset();
    next.setLoop(o.once ? T.LoopOnce : T.LoopRepeat, o.once ? 1 : Infinity);
    next.clampWhenFinished = !!o.once;
    next.timeScale = o.speed || 1;
    next.fadeIn(0.18).play();
    inst.current = next;
    inst.state = state;
  };

  const glbName = AGENT_GLB[a.id];
  if (glbName) {
    loadModel(glbName).then((rec) => {
      if (!rec) return;                       // 载入失败：保留程序化模型
      holder.clear();

      const clone = SkeletonUtils.clone(rec.scene);
      const box = new T.Box3().setFromObject(clone);
      const size = box.getSize(new T.Vector3());
      const scale = size.y > 0.001 ? TARGET_HEIGHT / size.y : 1;
      clone.scale.setScalar(scale);
      const box2 = new T.Box3().setFromObject(clone);
      clone.position.y -= box2.min.y;          // 脚踩 y=0
      holder.add(clone);

      inst.mixer = new T.AnimationMixer(clone);
      for (const clip of rec.clips) {
        inst.actions[clip.name] = inst.mixer.clipAction(clip);
      }
      inst.play('idle');
      inst.ready = true;

      model.traverse((o) => { if (o.isMesh) o.visible = false; });
    });
  }

  model.userData.agentGLB = inst;
  model.userData.play = inst.play;
  model.userData.isRealModel = true;

  live.add(inst);
  if (!rafId) { last = performance.now(); rafId = requestAnimationFrame(tick); }

  return model;
}

/** 可选的外部驱动入口；不调用也可以，内部 rAF 已在跑。 */
export function updateAgentModels(dt) {
  for (const inst of live) if (inst.mixer) inst.mixer.update(dt);
}
