# VALSTRIKE — 真实逆向资产版

在 btsunamib/minimal-valorant 的基础上，把程序化角色与武器替换为从
valstrike-closed-beta.apk 逆向出的真实模型与骨骼动画。

## 替换内容

| 层 | 原实现 | 现在 |
|---|---|---|
| 角色 | agent-art.js 用 BoxGeometry 拼几何体 | 真实 GLB（捷风/贤者/猎枭/凤凰/炼狱），含 113 段内嵌动画 |
| 武器 | weapon-art.js 程序化建模 | 真实第一人称 GLB（22 把 v_*.glb），含 shoot/reload/draw/inspect |

原实现完整保留在 agent-art-proc.js / weapon-art-proc.js，GLB 加载失败时自动回退，
不会白屏。带特殊皮肤的路径（champions26 / narukami / chaos / mercy / kuronami）不覆盖，
保留仓库原有皮肤系统。

## 逆向来源

tools/mdl2gltf.py（GoldSrc MDL 到 glTF）与 tools/bsp2gltf.py（BSP 到 glTF）。

关键格式结论：
- 顶点数组是 12 字节/顶点的纯 vec3_t（不是 32 字节）
- UV 不在顶点里，在三角形指令流的整数纹素坐标里
- 三角形指令流交错存储：short count + count 组 {short v; short n; short s; short t}
- 动画每骨骼 6 个 uint16 偏移（12 字节/骨骼），通道负载为 2 字节头 + numframes 组 int16
- bone.scale 按 int16 设计，byte-RLE 通道需乘以 256 补偿

## 本地运行

    python -m http.server 8080

然后打开 http://127.0.0.1:8080 （必须走 HTTP，ES module 在 file:// 下不可用）
