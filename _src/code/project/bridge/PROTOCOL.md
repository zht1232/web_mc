# WebCraft Bridge protocol v1

Transport: RFC 6455 WebSocket, **text frames only**, UTF-8 JSON. Default endpoint:
`ws://127.0.0.1:8765/ws` (configurable `port`/`path`). A `GET /health` endpoint returns JSON on the
same port. Protocol version: `1`.

The bridge is a sidecar to a Paper 26.2 server. Browser clients join one configured Bukkit world;
the server is authoritative for every block change and avatar position. There is no Java client
protocol, encryption or Mojang login.

## Authentication and origins

- `Origin` is checked against `allowed-origins` when the browser sends one. Non-browser clients may
  omit it only if `allow-missing-origin: true` (default, used by the Node test client).
- If `token` is configured, the client must supply it either as `?token=...` on the WebSocket URL or
  in the `hello` message. Both are accepted; the query form is convenient for browsers because they
  cannot set WebSocket headers.
- Empty token = no shared-secret check. Keep the bind address on loopback in that case.
- Max clients, hello timeout and rate limits are enforced per connection.

## Conventions

- Coordinates are Minecraft world coordinates in blocks: `+X` east, `+Y` up, `+Z` south. Positions
  are doubles; block coordinates are integers.
- `yaw` is degrees in `[-180, 180)`, `0` = south (+Z), `90` = west (-X), `180`/`-180` = north,
  `-90` = east. `pitch` is degrees in `[-90, 90]`, positive = down. The avatar's eye height is 1.62.
- Every message is a JSON object with `"t"` naming the type. Do not use `t` for payload data; ping
  uses `"id"`.
- Block states are Minecraft block-data strings, e.g. `"minecraft:stone"` or
  `"minecraft:oak_stairs[facing=north,half=bottom,shape=straight,waterlogged=false]"`. The server
  canonicalises them with `BlockData#getAsString()`. A browser renderer maps them to its own IDs.
- Player/entity IDs are UUID strings. A bridge player's ID is its session ID.
- `world` is the Bukkit world name; `dimension` is its namespaced key (e.g. `minecraft:overworld`).

## Session flow

```
client                                  plugin
  │  WS upgrade (Origin, optional ?token)  │
  │───────────────────────────────────────>│
  │  {"t":"hello","protocol":1,"name":...}  │
  │───────────────────────────────────────>│
  │  {"t":"hello_ok", ...}                  │
  │<───────────────────────────────────────│
  │  {"t":"join", optional x/y/z/yaw/pitch} │
  │───────────────────────────────────────>│
  │  {"t":"joined", ...} + {"t":"inv", ...} │
  │<───────────────────────────────────────│
  │  chunk_begin / section* / chunk_end ... │
  │<───────────────────────────────────────│
  │  {"t":"stream_done"}                    │
  │<───────────────────────────────────────│
  │  move / look / block_set / chat / ...   │
  │<───────────────────────────────────────│
  │  players / entities / block / chat ...  │
```

### Client → server

| `t` | Schema | Notes / limit |
|---|---|---|
| `hello` | `{t, protocol:1, name, token?}` | Once. `name` matches `[A-Za-z0-9_]{1,16}`, unique among bridge sessions. Must arrive within 10 s of the upgrade. |
| `join` | `{t, x?, y?, z?, yaw?, pitch?}` | Once. Omitted coordinates use the world spawn; omitted `y` uses the highest block at x/z + 1. The join point must be within `max-join-distance` (default 256) of world spawn, inside the border, within world height and not inside a solid block. Rejection leaves the session authenticated and able to retry. |
| `move` | `{t, x, y, z, yaw?, pitch?}` | 20/s. Server enforces `max-speed` (default 12 blocks/s) plus a 0.1-block per-update tolerance; invalid moves produce `self` and can close the session after repeated violations. No collision/gravity simulation. |
| `look` | `{t, yaw, pitch}` | 20/s. Rotation only. |
| `block_set` | `{t, x, y, z, state}` | 8/s combined with break. Integer coords; target must be air; reach ≤ `max-reach` (6.0) from the avatar's eye; `state` must be a placeable block. No inventory item is consumed yet. |
| `block_break` | `{t, x, y, z}` | 8/s combined. Integer coords; reach-checked; unbreakable blocks (hardness < 0) rejected. |
| `chat` | `{t, text}` | 1/s; text is trimmed to 240 chars, control characters and `§` removed. Broadcast to bridge clients and Java players as `[Web] name: text`. |
| `inv_req` | `{t}` | Returns the placeholder `inv`. |
| `held` | `{t, slot}` | `0..8`; updates the virtual held slot and returns `inv`. |
| `chunk_req` | `{t, cx, cz}` | 2/s. Chunk coordinates (block >> 4); requests one chunk (begin/sections/end). Allowed within `view-distance + 2` chunks of the avatar. |
| `ping` | `{t, id?}` | 2/s. `id` is echoed unchanged. App-level ping complements WebSocket pings. |
| `leave` | `{t}` | Server closes with 1000. |

### Server → client

| `t` | Schema | Notes |
|---|---|---|
| `hello_ok` | `{t, protocol, id, name, tokenRequired, server:{name,version,minecraft}, limits:{maxClients,viewDistance,reach,maxSpeed,tickHz}}` | Session accepted. |
| `joined` | `{t, protocol, id, name, world, dimension, minY, maxY, tickHz, viewDistance, reach, maxSpeed, spawn:{x,y,z,yaw,pitch}}` | World joined; avatar exists. |
| `inv` | `{t, size:41, held, items:[], virtual:true, note}` | Inventory handshake placeholder. `items` is reserved for a later milestone. |
| `chunk_begin` | `{t, world, cx, cz}` | Client should clear/replace that chunk's sections. Missing sections are air. |
| `section` | `{t, cx, cz, sy, y, palette:[...], runs:[...]}` | One 16³ section, palette + RLE. See below. |
| `chunk_end` | `{t, cx, cz, sections}` | `sections` = number of section messages sent for this chunk. |
| `stream_done` | `{t}` | Initial view radius has been queued and sent. |
| `block` | `{t, world, x, y, z, state, by, source}` | Authoritative block update from a bridge (`source:"web"`) or Java (`source:"java"`) change. |
| `player_join` | `{t, player:{id,name,kind:"web",x,y,z,yaw,pitch}}` | Another bridge avatar appeared. |
| `player_leave` | `{t, id}` | Bridge avatar left. |
| `player_move` | `{t, id, x, y, z, yaw, pitch}` | Broadcast at most 10 Hz to other bridge clients. Interpolate. |
| `players` | `{t, players:[{id,name,kind:"web"\|"java",x,y,z,yaw,pitch}]}` | Full snapshot at 5 Hz, including Java players and bridge avatars in the same world. |
| `entities` | `{t, entities:[{id,type,x,y,z,yaw,pitch}]}` | Nearby non-player entities at 2 Hz, radius 48, max 128. Bridge avatars excluded. `type` is a namespaced entity type key. |
| `chat` | `{t, from:{id,name,kind}, text, ts, source}` | Java or bridge chat. Java→bridge forwarding uses the legacy `AsyncPlayerChatEvent`; bridge→Java uses the server broadcast API. |
| `pong` | `{t, id, now}` | Echo of app ping. |
| `self` | `{t, x, y, z, yaw, pitch, teleport:true}` | Server correction for a rejected move. Apply as a teleport. |
| `error` | `{t, code, message}` | Non-fatal unless followed by a close. |

### Section encoding

`section` covers a 16×16×16 block volume. `palette` is an array of block-data strings; index `0` is
always `"minecraft:air"`. `runs` is a flat array of `[runLength, paletteIndex, runLength,
paletteIndex, ...]` whose run lengths sum to exactly **4096**.

Block iteration order is local **Y outer, Z middle, X inner**:

```
index = localY * 256 + localZ * 16 + localX      // 0..4095
worldY = y + localY
worldX = cx * 16 + localX
worldZ = cz * 16 + localZ
```

`sy` is the absolute section Y coordinate (e.g. `-4` for the overworld's lowest section); `y` is
`sy * 16`. Sections that contain only air are omitted: treat a missing section as all air. A
`chunk_begin` must be followed by zero or more `section` messages and then `chunk_end`.

Example: one stone block at local index 4095, everything else air:

```json
{"t":"section","cx":0,"cz":0,"sy":4,"y":64,
 "palette":["minecraft:air","minecraft:stone"],
 "runs":[4095,0,1,1]}
```

The initial join streams chunks outward in rings within `view-distance` (default 2 → 5×5 chunks),
one chunk per two server ticks, full world height, skipping all-air sections. `chunk_req` can fill
in chunks while walking; the plugin also enqueues a new view ring when the avatar's chunk changes.

## Authority and limits

| Item | Default |
|---|---|
| Max simultaneous clients | 16 |
| `hello` timeout | 10 s after WebSocket upgrade |
| Max inbound JSON message | 32K characters (WebSocket layer rejects frames > 64 KB) |
| WebSocket heartbeat | ping every 20 s; close if silent for 75 s |
| Move / look | 20 messages/s each |
| Block intents | 8/s combined |
| Chat | 1/s, 240 chars |
| Chunk requests | 2/s |
| App ping | 2/s |
| Initial view | 2 chunks (configurable 0..8) |
| Reach | 6.0 blocks from the avatar eye |
| Speed | 12 blocks/s, +0.1 block tolerance per update |
| Join distance from world spawn | 256 blocks (0 = unlimited) |

The server validates join positions, world height, world border, reach, target block state, chunk
load state, block hardness, name uniqueness and token/origin. It does **not** simulate player
collision, gravity, fall damage, line-of-sight or inventory. A browser can fly within the speed
limit; blocks are not obstacles for the avatar. Block physics triggered by `setBlockData` (falling
sand, water flow, etc.) are not forwarded; only the explicitly changed block is broadcast.

## Errors and close codes

Common `error.code` values: `bad_json`, `bad_message`, `not_authenticated`, `already_hello`,
`auth_failed`, `protocol_mismatch`, `bad_name`, `name_in_use`, `world_not_found`, `world_error`, `bad_position`,
`spawn_too_far`, `outside_border`, `spawn_blocked`, `already_joined`, `not_joined`, `bad_move`,
`bad_look`, `bad_block`, `block_occupied`, `block_empty`, `unbreakable`, `out_of_reach`,
`chunk_not_loaded`, `chunk_out_of_range`, `chunk_error`, `bad_chunk`, `rate_limited`, `bad_chat`, `bad_slot`,
`unknown_message`, `internal`.

WebSocket close codes: `1000` normal, `1001` going away, `1003` binary unsupported, `1008` handshake
timeout, `1009` message too large, `1011` internal, `1012` bridge restarting, `1013` slow client, `4001`
auth failed, `4002` protocol mismatch, `4003` movement rejected, `4008` hello timeout.

## Future extension points

Protocol v2 may add a binary section frame (deflate or palette-indexed bytes), inventory/container
messages, entity metadata/skins, block-entity data, multi-world joins, and `wss`. Message types are
open-ended: unknown client messages receive `unknown_message` without closing, so additive fields and
types are safe. The inventory handshake is deliberately present but empty to reserve the flow.
