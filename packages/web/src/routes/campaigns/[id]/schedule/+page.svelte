<script lang="ts">
  import Breadcrumbs from "$lib/components/Breadcrumbs.svelte";
  import { onMount, untrack } from "svelte";
  import type { ActionData, PageData } from "./$types";

  let { data, form }: { data: PageData; form: ActionData } = $props();

  function pad(value: number): string {
    return String(value).padStart(2, "0");
  }

  // Form fields start from the saved values and then belong to the editor.
  const initial = untrack(() => data.reminder?.schedule);
  let day = $state(String(initial?.dayOfWeek ?? 0));
  let time = $state(
    initial ? `${pad(Math.floor(initial.minuteOfDay / 60))}:${pad(initial.minuteOfDay % 60)}` : "",
  );
  let timeZone = $state(initial?.timeZone ?? "");
  let inRotation = $state<Record<string, boolean>>(
    untrack(() =>
      Object.fromEntries(data.rotation.map((member) => [member.userId, member.inRotation])),
    ),
  );

  // Every zone the runtime knows, plus the one already saved or detected.
  const timeZones = $derived(
    [...new Set([...Intl.supportedValuesOf("timeZone"), ...(timeZone ? [timeZone] : [])])].toSorted(),
  );
  const upNext = $derived(data.rotation.find((member) => inRotation[member.userId])?.userId);

  onMount(() => {
    if (!timeZone) timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  });

  function pick(include: (member: PageData["rotation"][number]) => boolean) {
    inRotation = Object.fromEntries(
      data.rotation.map((member) => [member.userId, include(member)]),
    );
  }
</script>

<svelte:head><title>Session schedule — {data.campaign.name}</title></svelte:head>

<Breadcrumbs
  items={[
    { label: data.campaign.name, href: `/campaigns/${data.campaign.id}` },
    { label: "Schedule" },
  ]}
/>

<div class="panel">
  <p class="eyebrow">{data.campaign.name}</p>
  <h1>Session schedule</h1>

  {#if !data.reminder}
    <p>
      Run <code>/reminder</code> in the Discord channel where Libby should post session reminders,
      then use the link it gives you.
    </p>
  {:else}
    <p>
      Libby posts a reminder in
      {#if data.reminder.channelName}<strong>#{data.reminder.channelName}</strong>{:else}the channel
        where <code>/reminder</code> was run{/if}
      an hour before each session and mentions every player. To post in a different channel, run
      <code>/reminder</code> there.
    </p>

    {#if form?.message}
      <p class="error" role="alert">{form.message}</p>
    {/if}

    <form method="POST">
      <label>
        Day
        <select name="day" bind:value={day} required>
          {#each data.weekdays as weekday, index (weekday)}
            <option value={String(index)}>Every {weekday}</option>
          {/each}
        </select>
      </label>
      <label>
        Start time
        <input name="time" type="time" bind:value={time} required />
      </label>
      <label class="wide">
        Time zone
        <select name="timeZone" bind:value={timeZone} required>
          {#each timeZones as zone (zone)}
            <option value={zone}>{zone.replaceAll("_", " ")}</option>
          {/each}
        </select>
      </label>

      <fieldset class="wide">
        <legend>Recap duty</legend>
        <p>
          Whoever recapped least recently goes next. A skipped recapper stays at the front and goes
          the following week. The recapper is named in each reminder.
        </p>
        <div class="quick-pick">
          <span class="muted">Quick pick:</span>
          <button type="button" onclick={() => pick((m) => m.role === "player")}>All players</button>
          <button type="button" onclick={() => pick((m) => m.role === "dm")}>DM only</button>
          <button type="button" onclick={() => pick(() => true)}>Everyone</button>
        </div>
        <div class="rotation">
          {#each data.rotation as member (member.userId)}
            <label class="member" class:next={member.userId === upNext}>
              <input
                type="checkbox"
                name="recap"
                value={member.userId}
                bind:checked={inRotation[member.userId]}
              />
              <span class="name">
                <strong>{member.username}</strong>
                <span class="muted">· {member.role === "dm" ? "DM" : member.characterName}</span>
              </span>
              {#if member.userId === upNext}
                <span class="badge">Up next</span>
              {/if}
              <span class="muted last">
                {#if !inRotation[member.userId]}
                  Not in rotation
                {:else if member.lastRecapped}
                  Last recap {member.lastRecapped}
                {:else}
                  No recaps yet
                {/if}
              </span>
            </label>
          {/each}
        </div>
        <span class="muted">New players are added to the rotation automatically.</span>
      </fieldset>

      <div class="actions wide">
        <button type="submit" class="btn">Save schedule</button>
        {#if form?.saved}
          <span role="status">Saved.</span>
        {/if}
        {#if data.nextSession}
          <span class="muted">
            Next session: {data.nextSession.session}. Reminder at {data.nextSession.reminder}.
          </span>
        {/if}
      </div>
    </form>
  {/if}
</div>

<style>
  form {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
    gap: 1rem;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .wide {
    grid-column: 1 / -1;
  }
  select,
  input[type="time"] {
    font: inherit;
    padding: 0.45rem 0.6rem;
    background: var(--surface);
    color: var(--ink);
    border: 1px solid var(--edge);
    border-radius: 4px;
  }
  code {
    font-family: var(--font-mono);
    font-size: 0.85em;
    background: var(--surface-sunken);
    padding: 0.05rem 0.3rem;
    border-radius: 3px;
  }
  fieldset {
    margin: 0.5rem 0 0;
    border: 0;
    border-top: 1px solid var(--edge);
    padding: 1rem 0 0;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  fieldset p {
    margin: 0;
  }
  legend {
    font-family: var(--font-display);
    font-size: 1.1rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--accent);
    padding: 0 0.5rem 0 0;
  }
  .quick-pick {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.9rem;
  }
  .quick-pick button {
    font: inherit;
    background: var(--surface-sunken);
    border: 1px solid var(--edge);
    border-radius: 3px;
    color: var(--ink);
    padding: 0 0.6rem;
    min-height: 2rem;
    cursor: pointer;
  }
  .rotation {
    border: 1px solid var(--edge);
    border-radius: 4px;
    background: var(--surface);
    display: flex;
    flex-direction: column;
  }
  .member {
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
    padding: 0.6rem 0.9rem;
    border-bottom: 1px solid var(--edge);
    cursor: pointer;
  }
  .member:last-child {
    border-bottom: 0;
  }
  .member.next {
    background: var(--surface-sunken);
  }
  .member input {
    width: 1.25rem;
    height: 1.25rem;
    accent-color: var(--accent);
  }
  .name {
    flex: 1 1 10rem;
  }
  .badge {
    font-family: var(--font-display);
    font-size: 0.68rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--surface);
    background: var(--accent);
    border-radius: 3px;
    padding: 0.1rem 0.5rem;
  }
  .last {
    font-size: 0.9rem;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 1rem;
    border-top: 1px solid var(--edge);
    padding-top: 1rem;
  }
  .error {
    color: var(--accent-bright);
  }
</style>
