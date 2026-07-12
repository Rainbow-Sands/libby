import { Client, Events, GatewayIntentBits, REST, Routes, type Interaction } from "discord.js";
import { start } from "./commands/start.ts";
import { stop } from "./commands/stop.ts";
import { campaign } from "./commands/campaign.ts";
import { addPlayer } from "./commands/add-player.ts";
import { removePlayer } from "./commands/remove-player.ts";
import { DISCORD_TOKEN, DISCORD_APPLICATION_ID } from "./env.ts";

const commands = {
  start,
  stop,
  campaign,
  "add-player": addPlayer,
  "remove-player": removePlayer,
};

export const registerCommands = async () => {
  console.log("Registering commands.");
  const rest = new REST().setToken(DISCORD_TOKEN);

  await rest.put(Routes.applicationCommands(DISCORD_APPLICATION_ID), {
    body: Object.values(commands).map(({ data }) => data.toJSON()),
  });
};

export const startBot = async () => {
  console.log("Starting the bot.");
  const bot = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
  });

  const ready = new Promise<void>((resolve) => {
    bot.once(Events.ClientReady, (c) => {
      console.log(`Discord bot ready. Logged in as ${c.user.tag}`);
      resolve();
    });
  });

  bot.on("interactionCreate", async (interaction: Interaction) => {
    if (interaction.isAutocomplete()) {
      const command = commands[interaction.commandName as keyof typeof commands];
      if (command && "autocomplete" in command) {
        await command.autocomplete(interaction);
      }
      return;
    }

    if (!interaction.isChatInputCommand()) {
      return;
    }

    if (interaction.commandName in commands) {
      const command = commands[interaction.commandName as keyof typeof commands];
      await command.handler(interaction);
    }
  });

  bot.login(DISCORD_TOKEN);
  await ready;

  return { bot };
};
