package io.webcraft.bridge;

import net.kyori.adventure.text.Component;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.entity.ArmorStand;
import org.bukkit.event.entity.CreatureSpawnEvent;
import org.bukkit.inventory.ItemStack;

import java.util.UUID;

/**
 * A browser player's visible stand-in. Armor stands are pure Bukkit API, visible to Java
 * players, and need no NMS or fake Player objects. The base is invisible; equipment and the
 * custom name plate remain visible.
 */
final class Avatar {

    static final String TAG = "webcraft_bridge";

    private final UUID id;
    private final String name;
    private final World world;
    private Location location;
    private float yaw;
    private float pitch;
    private ArmorStand stand;

    Avatar(UUID id, String name, Location location, float yaw, float pitch) {
        this.id = id;
        this.name = name;
        this.world = location.getWorld();
        this.location = location.clone();
        this.yaw = yaw;
        this.pitch = pitch;
    }

    UUID id() {
        return id;
    }

    String name() {
        return name;
    }

    World world() {
        return world;
    }

    Location location() {
        return location;
    }

    float yaw() {
        return yaw;
    }

    float pitch() {
        return pitch;
    }

    void setPosition(Location newLocation, float newYaw, float newPitch) {
        this.location = newLocation.clone();
        this.yaw = normalizeYaw(newYaw);
        this.pitch = clampPitch(newPitch);
    }

    /** Applies the latest position to the armor stand. Must run on the server thread. */
    void apply() {
        if (!ensureStand()) {
            return;
        }
        if (stand == null || !stand.isValid()) {
            return;
        }
        if (!world.isChunkLoaded(location.getBlockX() >> 4, location.getBlockZ() >> 4)) {
            return;
        }
        try {
            Location current = stand.getLocation();
            if (current.getWorld() == location.getWorld()
                    && current.distanceSquared(location) < 1.0E-6
                    && Math.abs(current.getYaw() - yaw) < 0.01F
                    && Math.abs(current.getPitch() - pitch) < 0.01F) {
                return;
            }
            stand.teleport(location);
            stand.setRotation(yaw, pitch);
        } catch (RuntimeException ignored) {
            // Entity may have been removed with its chunk; the next tick retries.
        }
    }

    void remove() {
        if (stand != null) {
            try {
                if (stand.isValid()) {
                    stand.remove();
                }
            } catch (RuntimeException ignored) {
                // chunk unloaded
            }
            stand = null;
        }
    }

    private boolean ensureStand() {
        if (stand != null && stand.isValid()) {
            return true;
        }
        stand = null;
        if (!world.isChunkLoaded(location.getBlockX() >> 4, location.getBlockZ() >> 4)) {
            return false;
        }
        try {
            stand = world.spawn(location, ArmorStand.class, CreatureSpawnEvent.SpawnReason.CUSTOM, false,
                    this::configure);
            return stand != null;
        } catch (RuntimeException exception) {
            stand = null;
            return false;
        }
    }

    private void configure(ArmorStand armorStand) {
        armorStand.setVisible(false);
        armorStand.setBasePlate(false);
        armorStand.setArms(true);
        armorStand.setSmall(false);
        armorStand.setGravity(false);
        armorStand.setInvulnerable(true);
        armorStand.setSilent(true);
        armorStand.setPersistent(false);
        armorStand.setCollidable(false);
        armorStand.customName(Component.text(name));
        armorStand.setCustomNameVisible(true);
        armorStand.addScoreboardTag(TAG);
        armorStand.getEquipment().setHelmet(new ItemStack(Material.PLAYER_HEAD), true);
        armorStand.getEquipment().setChestplate(new ItemStack(Material.LEATHER_CHESTPLATE), true);
        armorStand.getEquipment().setLeggings(new ItemStack(Material.LEATHER_LEGGINGS), true);
        armorStand.getEquipment().setBoots(new ItemStack(Material.LEATHER_BOOTS), true);
        armorStand.setRotation(yaw, pitch);
    }

    static float normalizeYaw(float yaw) {
        float normalized = yaw % 360.0F;
        if (normalized >= 180.0F) {
            normalized -= 360.0F;
        }
        if (normalized < -180.0F) {
            normalized += 360.0F;
        }
        return normalized;
    }

    static float clampPitch(float pitch) {
        return Math.max(-90.0F, Math.min(90.0F, pitch));
    }
}
