import { registerCommands, startBot } from "./discord.ts";
import { recoverSessions } from "./recovery.ts";
import { startReminderScheduler } from "./reminders.ts";
import { startJobQueue } from "@rainbot/db";

await startJobQueue();
await registerCommands();
const { bot } = await startBot();
await recoverSessions(bot);
startReminderScheduler(bot);
