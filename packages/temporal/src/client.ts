import { Connection, Client } from "@temporalio/client";

let client: Client | null = null;

export async function getTemporalClient(): Promise<Client> {
  if (!client) {
    const temporalUrl = process.env.TEMPORAL_URL;
    if (!temporalUrl) throw new Error("Missing required environment variable: TEMPORAL_URL");
    const connection = await Connection.connect({ address: temporalUrl });
    client = new Client({ connection, namespace: "rainbot" });
  }
  return client;
}
