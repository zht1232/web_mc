package io.webcraft.bridge;

import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;

import java.util.Locale;

final class BridgeCommand implements CommandExecutor {

    private final BridgeService bridge;

    BridgeCommand(BridgeService bridge) {
        this.bridge = bridge;
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!sender.hasPermission("webcraft.bridge.admin")) {
            sender.sendMessage("You do not have permission to use the WebCraft bridge.");
            return true;
        }
        String subcommand = args.length == 0 ? "status" : args[0].toLowerCase(Locale.ROOT);
        switch (subcommand) {
            case "status" -> sender.sendMessage(bridge.statusLine());
            case "token" -> {
                if (bridge.config().tokenRequired()) {
                    sender.sendMessage("Bridge token: " + bridge.config().token());
                } else {
                    sender.sendMessage("Bridge token is not configured. The endpoint is unauthenticated "
                            + "(loopback only by default).");
                }
            }
            default -> sender.sendMessage("Usage: /wcbridge <status|token>");
        }
        return true;
    }
}
