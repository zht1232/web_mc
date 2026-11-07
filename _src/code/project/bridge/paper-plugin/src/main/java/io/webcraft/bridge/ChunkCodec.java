package io.webcraft.bridge;

import org.bukkit.Chunk;
import org.bukkit.ChunkSnapshot;
import org.bukkit.Material;
import org.bukkit.World;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Encodes a chunk as palette + run-length sections. Air is implicit: sections that contain
 * only air are omitted, and palette index 0 is always minecraft:air.
 */
final class ChunkCodec {

    static final String AIR = "minecraft:air";

    private ChunkCodec() {
    }

    static List<String> encode(World world, int chunkX, int chunkZ) {
        Chunk chunk = world.getChunkAt(chunkX, chunkZ);
        ChunkSnapshot snapshot = chunk.getChunkSnapshot(false, false, false);
        int minSection = world.getMinHeight() >> 4;
        int maxSection = world.getMaxHeight() >> 4;

        List<String> messages = new ArrayList<>(maxSection - minSection + 2);
        messages.add("{\"t\":\"chunk_begin\",\"world\":" + Json.quote(world.getName())
                + ",\"cx\":" + chunkX + ",\"cz\":" + chunkZ + "}");

        int sentSections = 0;
        for (int sectionY = minSection; sectionY < maxSection; sectionY++) {
            int baseY = sectionY << 4;
            Map<String, Integer> palette = new LinkedHashMap<>();
            palette.put(AIR, 0);
            StringBuilder runs = new StringBuilder(512);
            int runLength = 0;
            int runIndex = -1;
            int nonAir = 0;

            for (int localY = 0; localY < 16; localY++) {
                int worldY = baseY + localY;
                for (int localZ = 0; localZ < 16; localZ++) {
                    for (int localX = 0; localX < 16; localX++) {
                        int paletteIndex;
                        Material type = snapshot.getBlockType(localX, worldY, localZ);
                        if (type.isAir()) {
                            paletteIndex = 0;
                        } else {
                            String state = snapshot.getBlockData(localX, worldY, localZ).getAsString();
                            Integer existing = palette.get(state);
                            if (existing == null) {
                                existing = palette.size();
                                palette.put(state, existing);
                            }
                            paletteIndex = existing;
                            nonAir++;
                        }

                        if (runIndex < 0) {
                            runIndex = paletteIndex;
                            runLength = 1;
                        } else if (runIndex == paletteIndex) {
                            runLength++;
                        } else {
                            appendRun(runs, runLength, runIndex);
                            runIndex = paletteIndex;
                            runLength = 1;
                        }
                    }
                }
            }
            if (nonAir == 0) {
                continue;
            }
            appendRun(runs, runLength, runIndex);

            StringBuilder message = new StringBuilder(256 + palette.size() * 32 + runs.length());
            message.append("{\"t\":\"section\",\"cx\":").append(chunkX)
                    .append(",\"cz\":").append(chunkZ)
                    .append(",\"sy\":").append(sectionY)
                    .append(",\"y\":").append(baseY)
                    .append(",\"palette\":[");
            boolean first = true;
            for (String state : palette.keySet()) {
                if (!first) {
                    message.append(',');
                }
                first = false;
                message.append(Json.quote(state));
            }
            message.append("],\"runs\":[").append(runs).append("]}");
            messages.add(message.toString());
            sentSections++;
        }

        messages.add("{\"t\":\"chunk_end\",\"cx\":" + chunkX + ",\"cz\":" + chunkZ
                + ",\"sections\":" + sentSections + "}");
        return messages;
    }

    private static void appendRun(StringBuilder runs, int length, int paletteIndex) {
        if (length <= 0 || paletteIndex < 0) {
            return;
        }
        if (!runs.isEmpty()) {
            runs.append(',');
        }
        runs.append(length).append(',').append(paletteIndex);
    }
}
