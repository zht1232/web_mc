import net.minecraft.SharedConstants;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.server.Bootstrap;
import net.minecraft.world.level.BlockGetter;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.SoundType;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.properties.Property;
import net.minecraft.world.level.material.FluidState;
import net.minecraft.world.level.material.Fluids;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.shapes.CollisionContext;
import net.minecraft.world.phys.shapes.VoxelShape;

import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;

/**
 * Runs the vanilla 26.2 code to produce ground truth for the browser port:
 * every block state's gameplay numbers plus its collision / occlusion / visual outline,
 * the item registry, entity dimensions and creative tab ordering.
 */
public class Dump {
    /** Neighbour view used while asking a state for its shape: self at the origin, stone above, air elsewhere. */
    static BlockGetter fakeLevel(final BlockState self) {
        return new BlockGetter() {
            @Override public net.minecraft.world.level.block.entity.BlockEntity getBlockEntity(BlockPos pos) { return null; }

            @Override
            public BlockState getBlockState(BlockPos pos) {
                if (pos.getX() == 0 && pos.getZ() == 0) {
                    if (pos.getY() == 1) return Blocks.STONE.defaultBlockState();
                    if (pos.getY() == 0) return self;
                }
                return Blocks.AIR.defaultBlockState();
            }

            @Override public FluidState getFluidState(BlockPos pos) {
                return pos.getX() == 0 && pos.getY() == 0 && pos.getZ() == 0 ? self.getFluidState() : Fluids.EMPTY.defaultFluidState();
            }
            @Override public int getHeight() { return 384; }
            @Override public int getMinY() { return -64; }
        };
    }

    public static void main(String[] args) throws Exception {
        Path outDir = Path.of(args.length > 0 ? args[0] : "out");
        Files.createDirectories(outDir);
        SharedConstants.tryDetectVersion();
        Bootstrap.bootStrap();
        System.out.println("[dump] bootstrap ok");
        bindComponents();

        dumpBlocks(outDir.resolve("blocks.json"));
        dumpItems(outDir.resolve("items.json"));
        dumpEntities(outDir.resolve("entities.json"));
        dumpCreativeTabs(outDir.resolve("creative_tabs.json"));
        System.out.println("[dump] done");
    }

    /**
     * Binds item/block default components so ItemStack can be constructed.
     * Datapack tags are not loaded in this headless run, so every tag lookup is
     * answered with an empty tag instead of throwing.
     */
    static void bindComponents() throws Exception {
        var m = net.minecraft.core.RegistryAccess.class.getDeclaredMethod("fromRegistryOfRegistries", net.minecraft.core.Registry.class);
        m.setAccessible(true);
        final var frozen = (net.minecraft.core.RegistryAccess.Frozen) m.invoke(null, net.minecraft.core.registries.BuiltInRegistries.REGISTRY);
        net.minecraft.core.HolderLookup.Provider lenient = new net.minecraft.core.HolderLookup.Provider() {
            @Override
            public java.util.stream.Stream<net.minecraft.resources.ResourceKey<? extends net.minecraft.core.Registry<?>>> listRegistryKeys() {
                return frozen.listRegistryKeys();
            }

            @Override
            public <T> java.util.Optional<? extends net.minecraft.core.HolderLookup.RegistryLookup<T>> lookup(
                net.minecraft.resources.ResourceKey<? extends net.minecraft.core.Registry<? extends T>> key) {
                var found = frozen.lookup(key);
                if (found.isPresent()) return found.map(Lenient::of);
                return java.util.Optional.of(new LenientEmpty<>(key));
            }
        };
        // sanity probe
        try {
            var tk = net.minecraft.tags.TagKey.create(net.minecraft.core.registries.Registries.DAMAGE_TYPE,
                net.minecraft.resources.Identifier.withDefaultNamespace("is_fire"));
            System.out.println("[dump] probe lookup class = " + lenient.lookup(net.minecraft.core.registries.Registries.DAMAGE_TYPE).map(o -> o.getClass().getName()).orElse("none"));
            System.out.println("[dump] probe tag ok = " + lenient.getOrThrow(tk).size());
        } catch (Throwable t) {
            System.out.println("[dump] probe failed: " + t);
        }
        int n = 0;
        for (var pending : net.minecraft.core.registries.BuiltInRegistries.DATA_COMPONENT_INITIALIZERS.build(lenient)) {
            pending.apply();
            n++;
        }
        System.out.println("[dump] components bound: " + n + " registries");
    }

    /** Stand-in for datapack registries (damage types, enchantments, ...) that are not loaded here. */
    static final class LenientEmpty<T> implements net.minecraft.core.HolderLookup.RegistryLookup<T> {
        private final net.minecraft.resources.ResourceKey<? extends net.minecraft.core.Registry<? extends T>> key;
        LenientEmpty(net.minecraft.resources.ResourceKey<? extends net.minecraft.core.Registry<? extends T>> key) { this.key = key; }
        @Override public net.minecraft.resources.ResourceKey<? extends net.minecraft.core.Registry<? extends T>> key() { return this.key; }
        @Override public java.util.stream.Stream<net.minecraft.core.Holder.Reference<T>> listElements() { return java.util.stream.Stream.empty(); }
        @Override public java.util.stream.Stream<net.minecraft.core.HolderSet.Named<T>> listTags() { return java.util.stream.Stream.empty(); }
        @Override public com.mojang.serialization.Lifecycle registryLifecycle() { return com.mojang.serialization.Lifecycle.stable(); }
        @Override public java.util.Optional<net.minecraft.core.Holder.Reference<T>> get(net.minecraft.resources.ResourceKey<T> k) {
            return java.util.Optional.of(net.minecraft.core.Holder.Reference.createStandAlone(this, k));
        }
        @Override public java.util.Optional<net.minecraft.core.HolderSet.Named<T>> get(net.minecraft.tags.TagKey<T> k) { return java.util.Optional.of(net.minecraft.core.HolderSet.emptyNamed(this, k)); }
    }

    static final class Lenient<T> implements net.minecraft.core.HolderLookup.RegistryLookup<T> {
        private final net.minecraft.core.HolderLookup.RegistryLookup<T> base;
        Lenient(net.minecraft.core.HolderLookup.RegistryLookup<T> base) { this.base = base; }
        static <T> net.minecraft.core.HolderLookup.RegistryLookup<T> of(net.minecraft.core.HolderLookup.RegistryLookup<T> base) { return new Lenient<>(base); }
        @Override public net.minecraft.resources.ResourceKey<? extends net.minecraft.core.Registry<? extends T>> key() { return base.key(); }
        @Override public java.util.stream.Stream<net.minecraft.core.Holder.Reference<T>> listElements() { return base.listElements(); }
        @Override public java.util.stream.Stream<net.minecraft.core.HolderSet.Named<T>> listTags() { return base.listTags(); }
        @Override public com.mojang.serialization.Lifecycle registryLifecycle() { return base.registryLifecycle(); }
        @Override public java.util.Optional<net.minecraft.core.Holder.Reference<T>> get(net.minecraft.resources.ResourceKey<T> k) { return base.get(k); }
        @Override public java.util.Optional<net.minecraft.core.HolderSet.Named<T>> get(net.minecraft.tags.TagKey<T> k) {
            var found = base.get(k);
            return found.isPresent() ? found : java.util.Optional.of(net.minecraft.core.HolderSet.emptyNamed(base, k));
        }
    }

    /** Registry id of a sound type's break sound, e.g. "block.wood.break". */
    static String soundName(SoundType st) throws Exception {
        for (java.lang.reflect.Field f : SoundType.class.getDeclaredFields()) {
            if (!net.minecraft.sounds.SoundEvent.class.isAssignableFrom(f.getType())) continue;
            f.setAccessible(true);
            Object v = f.get(st);
            if (v == null) continue;
            var id = net.minecraft.core.registries.BuiltInRegistries.SOUND_EVENT.getKey((net.minecraft.sounds.SoundEvent) v);
            if (id != null && !"intentionally_empty".equals(id.getPath())) return id.getPath();
        }
        return "intentionally_empty";
    }

    static double r(double v) { return Math.round(v * 10000.0) / 10000.0; }

    static String boxes(VoxelShape shape) {
        StringBuilder sb = new StringBuilder("[");
        boolean first = true;
        for (AABB b : shape.toAabbs()) {
            if (!first) sb.append(',');
            first = false;
            sb.append('[').append(r(b.minX)).append(',').append(r(b.minY)).append(',').append(r(b.minZ)).append(',')
              .append(r(b.maxX)).append(',').append(r(b.maxY)).append(',').append(r(b.maxZ)).append(']');
        }
        return sb.append(']').toString();
    }

    static String q(String s) {
        StringBuilder sb = new StringBuilder("\"");
        for (char c : s.toCharArray()) {
            switch (c) {
                case '"' -> sb.append("\\\"");
                case '\\' -> sb.append("\\\\");
                case '\n' -> sb.append("\\n");
                case '\r' -> sb.append("\\r");
                case '\t' -> sb.append("\\t");
                default -> { if (c < 0x20) sb.append(String.format("\\u%04x", (int) c)); else sb.append(c); }
            }
        }
        return sb.append('"').toString();
    }

    static int indexOf(Property<?> p, BlockState state) {
        int i = 0;
        Comparable<?> cur = state.getValue(p);
        for (Object v : p.getPossibleValues()) {
            if (v.equals(cur)) return i;
            i++;
        }
        return -1;
    }

    static void dumpBlocks(Path file) throws Exception {
        StringBuilder sb = new StringBuilder();
        sb.append("{\"blocks\":[");
        boolean firstBlock = true;
        int stateCount = 0;
        List<String> errs = new ArrayList<>();
        CollisionContext ctx = CollisionContext.empty();

        for (Block block : BuiltInRegistries.BLOCK) {
            String name = BuiltInRegistries.BLOCK.getKey(block).getPath();
            var def = block.getStateDefinition();
            List<Property<?>> ordered = new ArrayList<>(def.getProperties());

            StringBuilder propJson = new StringBuilder("[");
            for (int i = 0; i < ordered.size(); i++) {
                if (i > 0) propJson.append(',');
                Property<?> p = ordered.get(i);
                propJson.append("{\"name\":").append(q(p.getName())).append(",\"values\":[");
                boolean f = true;
                for (Object v : p.getPossibleValues()) {
                    if (!f) propJson.append(',');
                    f = false;
                    propJson.append(q(String.valueOf(v)));
                }
                propJson.append("]}");
            }
            propJson.append(']');

            if (!firstBlock) sb.append(',');
            firstBlock = false;

            BlockState def0 = block.defaultBlockState();
            sb.append("{\"name\":").append(q(name));
            sb.append(",\"cls\":").append(q(block.getClass().getSimpleName()));
            sb.append(",\"props\":").append(propJson);
            sb.append(",\"default\":").append(Block.BLOCK_STATE_REGISTRY.getId(def0));
            sb.append(",\"hardness\":").append(r(def0.getDestroySpeed(fakeLevel(def0), BlockPos.ZERO)));
            sb.append(",\"resistance\":").append(r(block.getExplosionResistance()));
            sb.append(",\"requiresTool\":").append(def0.requiresCorrectToolForDrops() ? 1 : 0);
            sb.append(",\"randomTicks\":").append(0);
            sb.append(",\"hasCollision\":").append(1);
            String sound = "?";
            try {
                SoundType st = def0.getSoundType();
                sound = st == null ? "" : soundName(st);
            } catch (Throwable t) { sound = "?"; }
            sb.append(",\"sound\":").append(q(sound));
            sb.append(",\"item\":").append(q(block.asItem() == net.minecraft.world.item.Items.AIR ? "" : BuiltInRegistries.ITEM.getKey(block.asItem()).getPath()));
            sb.append(",\"states\":[");

            boolean firstState = true;
            for (BlockState state : def.getPossibleStates()) {
                stateCount++;
                final BlockGetter level = fakeLevel(state);
                if (!firstState) sb.append(',');
                firstState = false;
                sb.append('[').append(Block.BLOCK_STATE_REGISTRY.getId(state)).append(",[");
                for (int i = 0; i < ordered.size(); i++) {
                    if (i > 0) sb.append(',');
                    sb.append(indexOf(ordered.get(i), state));
                }
                sb.append("],");
                sb.append(state.getLightEmission()).append(',');
                sb.append(state.getLightDampening()).append(',');
                sb.append(state.isSolid() ? 1 : 0).append(',');
                sb.append(state.canOcclude() ? 1 : 0).append(',');
                sb.append(state.useShapeForLightOcclusion() ? 1 : 0).append(',');
                sb.append(state.propagatesSkylightDown() ? 1 : 0).append(',');
                sb.append(state.isAir() ? 1 : 0).append(',');
                sb.append(state.liquid() ? 1 : 0).append(',');
                sb.append(state.getFluidState().isEmpty() ? 0 : 1).append(',');
                sb.append(state.emissiveRendering() ? 1 : 0).append(',');
                sb.append(r(state.getDestroySpeed(level, BlockPos.ZERO))).append(',');
                try {
                    sb.append(boxes(state.getCollisionShape(level, BlockPos.ZERO, ctx)));
                } catch (Throwable t) {
                    errs.add(name + " collision: " + t);
                    sb.append("[[0,0,0,1,1,1]]");
                }
                sb.append(',');
                try {
                    sb.append(boxes(state.getOcclusionShape()));
                } catch (Throwable t) {
                    errs.add(name + " occlusion: " + t);
                    sb.append("[[0,0,0,1,1,1]]");
                }
                sb.append(',');
                try {
                    sb.append(boxes(state.getVisualShape(level, BlockPos.ZERO, ctx)));
                } catch (Throwable t) {
                    errs.add(name + " visual: " + t);
                    sb.append("[]");
                }
                sb.append(',');
                try {
                    sb.append(boxes(state.getShape(level, BlockPos.ZERO, ctx)));
                } catch (Throwable t) {
                    errs.add(name + " shape: " + t);
                    sb.append("[]");
                }
                int mask = 0;
                for (Direction d : Direction.values()) {
                    try {
                        if (state.isFaceSturdy(level, BlockPos.ZERO, d)) mask |= 1 << d.get3DDataValue();
                    } catch (Throwable ignored) {}
                }
                sb.append(',').append(mask);
                sb.append(']');
            }
            sb.append("]}");
        }
        sb.append("],\"stateCount\":").append(stateCount).append(",\"errors\":[");
        for (int i = 0; i < Math.min(errs.size(), 40); i++) {
            if (i > 0) sb.append(',');
            sb.append(q(errs.get(i)));
        }
        sb.append("],\"errorCount\":").append(errs.size()).append("}");
        Files.writeString(file, sb.toString(), StandardCharsets.UTF_8);
        System.out.println("[dump] blocks: " + BuiltInRegistries.BLOCK.size() + " blocks, " + stateCount + " states, errors=" + errs.size());
        for (String e : errs.subList(0, Math.min(10, errs.size()))) System.out.println("  ! " + e);
    }

    static void dumpItems(Path file) throws Exception {
        StringBuilder sb = new StringBuilder("{\"items\":[");
        boolean first = true;
        for (var item : BuiltInRegistries.ITEM) {
            if (!first) sb.append(',');
            first = false;
            String name = BuiltInRegistries.ITEM.getKey(item).getPath();
            var comps = item.components();
            sb.append("{\"name\":").append(q(name));
            sb.append(",\"maxStack\":").append(item.getDefaultMaxStackSize());
            Integer dmg = comps.get(net.minecraft.core.component.DataComponents.MAX_DAMAGE);
            sb.append(",\"maxDamage\":").append(dmg == null ? 0 : dmg);
            Object rarity = comps.get(net.minecraft.core.component.DataComponents.RARITY);
            sb.append(",\"rarity\":").append(q(rarity == null ? "COMMON" : String.valueOf(rarity)));
            sb.append(",\"block\":").append(q(item instanceof net.minecraft.world.item.BlockItem bi
                ? BuiltInRegistries.BLOCK.getKey(bi.getBlock()).getPath() : ""));
            var food = comps.get(net.minecraft.core.component.DataComponents.FOOD);
            sb.append(",\"food\":").append(q(food == null ? "" : food.nutrition() + ":" + food.saturation()));
            var tool = comps.get(net.minecraft.core.component.DataComponents.TOOL);
            StringBuilder rules = new StringBuilder("[");
            if (tool != null) {
                boolean f3 = true;
                for (var rule : tool.rules()) {
                    if (!f3) rules.append(',');
                    f3 = false;
                    rules.append("{\"tag\":").append(q(rule.blocks().toString().replace("holders", "").trim()))
                         .append(",\"speed\":").append(rule.speed().orElse(1.0F)).append("}");
                }
            }
            rules.append(']');
            sb.append(",\"tool\":").append(rules);
            var equip = comps.get(net.minecraft.core.component.DataComponents.EQUIPPABLE);
            sb.append(",\"equip\":").append(q(equip == null ? "" : String.valueOf(equip.slot())));
            sb.append("}");
        }
        sb.append("]}");
        Files.writeString(file, sb.toString(), StandardCharsets.UTF_8);
        System.out.println("[dump] items: " + BuiltInRegistries.ITEM.size());
    }

    static void dumpEntities(Path file) throws Exception {
        StringBuilder sb = new StringBuilder("{\"entities\":[");
        boolean first = true;
        for (var type : BuiltInRegistries.ENTITY_TYPE) {
            if (!first) sb.append(',');
            first = false;
            String name = BuiltInRegistries.ENTITY_TYPE.getKey(type).getPath();
            var dims = type.getDimensions();
            sb.append("{\"name\":").append(q(name));
            sb.append(",\"w\":").append(r(dims.width())).append(",\"h\":").append(r(dims.height()));
            sb.append(",\"fireImmune\":").append(type.fireImmune() ? 1 : 0);
            sb.append(",\"category\":").append(q(String.valueOf(type.getCategory())));
            sb.append("}");
        }
        sb.append("]}");
        Files.writeString(file, sb.toString(), StandardCharsets.UTF_8);
        System.out.println("[dump] entity types: " + BuiltInRegistries.ENTITY_TYPE.size());
    }

    static void dumpCreativeTabs(Path file) throws Exception {
        StringBuilder sb = new StringBuilder("{\"tabs\":[");
        boolean first = true;
        try {
            for (var tab : net.minecraft.world.item.CreativeModeTabs.allTabs()) {
                if (!first) sb.append(',');
                first = false;
                sb.append("{\"key\":").append(q(tab.getDisplayName().getString()));
                sb.append(",\"icon\":").append(q(tab.getIconItem().getItem().toString()));
                sb.append(",\"items\":[");
                boolean f2 = true;
                try {
                    for (var stack : tab.getDisplayItems()) {
                        if (!f2) sb.append(',');
                        f2 = false;
                        sb.append(q(BuiltInRegistries.ITEM.getKey(stack.getItem()).getPath()));
                    }
                } catch (Throwable t) { System.out.println("  tab items fail " + tab.getDisplayName().getString() + ": " + t); }
                sb.append("]}");
            }
        } catch (Throwable t) {
            System.out.println("[dump] creative tabs failed: " + t);
        }
        sb.append("]}");
        Files.writeString(file, sb.toString(), StandardCharsets.UTF_8);
        System.out.println("[dump] creative tabs written");
    }
}
