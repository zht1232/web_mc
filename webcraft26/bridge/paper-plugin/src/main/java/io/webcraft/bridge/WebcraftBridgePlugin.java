package io.webcraft.bridge;

import org.bukkit.command.PluginCommand;
import org.bukkit.plugin.java.JavaPlugin;

import java.util.logging.Level;

public final class WebcraftBridgePlugin extends JavaPlugin {

    private BridgeService bridge;

    @Override
    public void onEnable() {
        saveDefaultConfig();
        BridgeConfig config;
        try {
            config = BridgeConfig.from(getConfig());
        } catch (RuntimeException exception) {
            getLogger().log(Level.SEVERE, "Invalid WebCraftBridge config.yml", exception);
            getServer().getPluginManager().disablePlugin(this);
            return;
        }

        bridge = new BridgeService(this, config);
        try {
            bridge.start();
        } catch (Exception exception) {
            getLogger().log(Level.SEVERE, "WebCraftBridge failed to start (port "
                    + config.port() + " may already be in use)", exception);
            bridge.stop();
            bridge = null;
            getServer().getPluginManager().disablePlugin(this);
            return;
        }

        PluginCommand command = getCommand("wcbridge");
        if (command != null) {
            command.setExecutor(new BridgeCommand(bridge));
        }
    }

    @Override
    public void onDisable() {
        if (bridge != null) {
            bridge.stop();
            bridge = null;
        }
    }

    public BridgeService bridge() {
        return bridge;
    }
}
