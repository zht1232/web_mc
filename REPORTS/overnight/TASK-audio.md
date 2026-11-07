# TASK audio — 完整原版音效（脚步 / 方块 / 生物 / 环境 / 天气）

先读 `REPORTS/OVERNIGHT-BRIEF.md`、`session-reports/05-environment-audio.md`。

## 现状
`src/client/audio/SoundEngine.ts` + `SoundEvents.ts` 只有 28 个事件 / 112 个 ogg（`public/mc/sounds/**` + `index.json`），26.2 的 client jar 里没有 ogg 和 sounds.json，当时只拷了最少的一批。**但本机有完整的原版音效**：
- 资源索引 `C:/Users/zht/AppData/Roaming/.minecraft/assets/indexes/32.json`（`objects` 里 `minecraft/sounds.json` 与 4871 个 `minecraft/sounds/**.ogg`，共约 375 MB，含 70 个 music），对象文件在 `C:/Users/zht/AppData/Roaming/.minecraft/assets/objects/<hash前2位>/<hash>`。**只读，不要改动 `.minecraft`。**
夜晚的“像不像”很大程度靠声音：僵尸呻吟、骷髅、苦力怕、蜘蛛、脚步声随地面材质变化、方块破坏/放置声、雨声、雷声、洞穴环境音、受伤声。

## 任务
1. **导入脚本** `scripts/build-sounds.mjs`（node）：读 `indexes/32.json` → 取出 `minecraft/sounds.json`（事件→声音文件列表，含 volume/pitch/weight/stream/`type:event` 引用/`attenuation_distance`）→ 把**需要的**ogg 复制到 `public/mc/sounds/`（保持 `minecraft/sounds/` 之后的相对路径），生成 `public/mc/sounds/sounds.json`（精简后的事件表）与更新 `index.json`。范围：block（全部 step/break/place/hit/fall）、entity（本项目已有的生物及玩家：ambient/hurt/death/step/attack/shoot/explode…）、ambient（cave、underwater、weather）、weather（rain/thunder）、item（pickup/break/use/eat/burp）、random（click/pop/bow/explode…）、music **一律不要**（体积）。**新增数据总量 ≤ 80 MB**，超了就按优先级砍（先砍罕见生物与 records）。`public/mc` 对已有文件只读——新增目录文件允许，`build-sounds.mjs` 必须可重现。
2. **SoundEngine 补全**：按 `sounds.json` 的权重随机选声、`volume/pitch` 范围、`attenuation_distance`（LINEAR 衰减，按源码 `SoundEngine.java`/`SoundManager.java`）、同一事件的并发上限、`stream` 类长音；保留现有 API（`play(event,x,y,z,vol,pitch)`、`tick`、`resume`），新增接口只增不删。
3. **方块声音**：`blocks.json` 里每个方块有 `sounds`（SoundType）数据——走路/挖掘/破坏/放置/落地按 SoundType（`Block.getSoundType`，step/hit/break/place/fall）。挖掘期间每 4 tick 一次 hit 声（`MultiPlayerGameMode`），脚步按 `Entity.walkDist` 阈值（`playStepSound`，原版步幅 `distanceMoved > nextStep`、潜行不出声、水里用 swim 声）。`Game.playStepSound()`、`breakEffects()`、放置路径里的调用点由你对接（Edit 小改）。
4. **生物声音**：对接 `EntityManager` 里生物：随机环境音（`Mob.getAmbientSoundInterval` 与 `ambientSoundTime` 的概率机制 `tickMobAmbient`）、受伤、死亡、脚步（`getStepSound`）、僵尸/骷髅/苦力怕（`entity.creeper.primed` 引信）/蜘蛛/末影人的专属声音。生物类在 `src/vanilla/world/entity/**`（survival 包拥有）——**不要改生物逻辑**，在 `src/client/audio/MobSounds.ts` 里用观察者方式（遍历 `entityManager.getEntities()`，读取 `hurtTime/deathTime/walk distance` 等字段变化）触发声音。
5. **环境声**：雨声循环（`weather.rain` / `weather.rain.above`，随 `rainLevel`）、雷声（`WeatherRenderer.onThunder` 已有回调）、水下进出（`ambient.underwater.enter/exit`）、洞穴随机环境音（`ambient.cave`，原版 `AmbientSoundHandler`/`BiomeSpecialEffects.ambientMoodSettings`：低光照处随机“mood”）、玩家受伤/吃东西/拾取（`entity.item.pickup`）/击打。
6. **验收**：无头浏览器里无法听，所以用**可断言的数据**证明：`scripts/test-audio.mts`（纯数据）断言——sounds.json 事件数、每个引用的 ogg 都存在、权重选择分布、衰减公式、SoundType 到事件名映射覆盖 `blocks.json` 里全部 SoundType；再用浏览器实测一次：`__mc.sounds` 上暴露 `stats`（已播放事件计数 map，调试用），走路/挖方块/放置/生物受伤后计数变化，控制台零报错、零 404。写进报告。

## 文件所有权
`src/client/audio/**`、`scripts/build-sounds.mjs`、`scripts/test-audio.mts`、`public/mc/sounds/**`（新增）。`Game.ts` 里音效调用点（`playStepSound`、`breakEffects`、放置、`unlockAudio`）Edit 小改并报告。

## 交付
`REPORTS/overnight/audio.md`（含新增数据大小）。第一版 05:30 前。
