import {
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
} from "discord.js";
import { getCampaignReminder, setCampaignReminder } from "@rainbot/db";
import {
  WEEKDAYS,
  formatTimeOfDay,
  nextSessionAfter,
  normalizeTimeZone,
  parseTimeOfDay,
} from "../reminder-schedule.ts";
import { REMINDER_LEAD_MS } from "../reminders.ts";
import { campaignAutocomplete } from "./autocomplete.ts";
import { requireDmOfCampaign } from "./guard.ts";

const MODAL_PREFIX = "reminder:";
const DAY_INPUT = "day";
const TIME_INPUT = "time";
const TIME_ZONE_INPUT = "time-zone";

export const reminder = {
  data: new SlashCommandBuilder()
    .setName("reminder")
    .setDescription("Remind players in this channel an hour before each weekly session")
    .addStringOption((option) =>
      option
        .setName("campaign")
        .setDescription("Which campaign to set the session reminder for")
        .setRequired(true)
        .setAutocomplete(true),
    ),
  autocomplete: campaignAutocomplete,
  handler: async (interaction: ChatInputCommandInteraction) => {
    if (!interaction.guildId) {
      await interaction.reply("This command can only be used in a server.");
      return;
    }

    const campaignId = interaction.options.getString("campaign", true);
    const meta = await requireDmOfCampaign(interaction, campaignId, "set session reminders");
    if (!meta) return;

    const existing = await getCampaignReminder(campaignId);

    const day = new StringSelectMenuBuilder()
      .setCustomId(DAY_INPUT)
      .setRequired(true)
      .addOptions(
        WEEKDAYS.map((name, index) => ({
          label: name,
          value: String(index),
          default: existing?.dayOfWeek === index,
        })),
      );
    const time = new TextInputBuilder()
      .setCustomId(TIME_INPUT)
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("19:30 or 7:30 pm")
      .setRequired(true)
      .setMaxLength(10);
    const timeZone = new TextInputBuilder()
      .setCustomId(TIME_ZONE_INPUT)
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("America/New_York")
      .setRequired(true)
      .setMaxLength(64);
    if (existing) {
      time.setValue(formatTimeOfDay(existing.minuteOfDay));
      timeZone.setValue(existing.timeZone);
    }

    const modal = new ModalBuilder()
      .setCustomId(`${MODAL_PREFIX}${campaignId}`)
      .setTitle("Weekly session reminder")
      .addLabelComponents(
        new LabelBuilder().setLabel("Session day").setStringSelectMenuComponent(day),
        new LabelBuilder()
          .setLabel("Session start time")
          .setDescription("24-hour or am/pm time")
          .setTextInputComponent(time),
        new LabelBuilder()
          .setLabel("Time zone")
          .setDescription("IANA time zone name, e.g. Europe/London or America/St_Johns")
          .setTextInputComponent(timeZone),
      );

    await interaction.showModal(modal);
  },
  modalSubmit: async (interaction: ModalSubmitInteraction) => {
    if (!interaction.guildId || !interaction.channelId) {
      await interaction.reply("This command can only be used in a server.");
      return;
    }

    const campaignId = interaction.customId.slice(MODAL_PREFIX.length);
    const meta = await requireDmOfCampaign(interaction, campaignId, "set session reminders");
    if (!meta) return;

    const dayOfWeek = Number(interaction.fields.getStringSelectValues(DAY_INPUT)[0]);
    const minuteOfDay = parseTimeOfDay(interaction.fields.getTextInputValue(TIME_INPUT));
    const timeZone = normalizeTimeZone(interaction.fields.getTextInputValue(TIME_ZONE_INPUT));
    if (!Number.isInteger(dayOfWeek) || !WEEKDAYS[dayOfWeek]) {
      await interaction.reply({
        content: "Please pick a session day.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (minuteOfDay === null) {
      await interaction.reply({
        content: "I couldn't read that time. Try something like `19:30` or `7:30 pm`.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (!timeZone) {
      await interaction.reply({
        content:
          "I don't recognise that time zone. Use an IANA name such as `America/New_York` " +
          "(see https://en.wikipedia.org/wiki/List_of_tz_database_time_zones).",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const schedule = { dayOfWeek, minuteOfDay, timeZone };
    // The first session is the next one whose reminder is still ahead of us.
    const nextSessionAt = nextSessionAfter(schedule, new Date(Date.now() + REMINDER_LEAD_MS));

    try {
      await setCampaignReminder({
        campaignId,
        channelId: interaction.channelId,
        nextSessionAt,
        ...schedule,
      });
    } catch (err) {
      console.error("[reminder] failed to save reminder:", err);
      await interaction.reply("Failed to save the reminder.");
      return;
    }

    const timestamp = Math.floor(nextSessionAt.getTime() / 1000);
    await interaction.reply(
      `Sessions are set for every **${WEEKDAYS[dayOfWeek]} at ${formatTimeOfDay(minuteOfDay)}** ` +
        `(${timeZone}). I'll remind the players in this channel an hour before each one.\n` +
        `Next session: <t:${timestamp}:F>.`,
    );
  },
};
