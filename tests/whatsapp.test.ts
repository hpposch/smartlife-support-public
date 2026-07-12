import { describe, expect, it } from "vitest";
import { extractIncomingMessages } from "../src/server/whatsapp";

const payload = {
  object: "whatsapp_business_account",
  entry: [
    {
      changes: [
        {
          value: {
            contacts: [{ wa_id: "4366412345", profile: { name: "Max Muster" } }],
            messages: [
              { id: "wamid.1", from: "4366412345", type: "text", text: { body: "Hallo, mein Sensor spinnt" } },
              { id: "wamid.2", from: "4366412345", type: "image" },
            ],
          },
        },
        { value: { statuses: [{ id: "wamid.1", status: "delivered" }] } },
      ],
    },
  ],
};

describe("extractIncomingMessages", () => {
  it("liest Text-Nachrichten mit Profilnamen, ignoriert Bilder und Statusmeldungen", () => {
    const messages = extractIncomingMessages(payload);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({
      waMessageId: "wamid.1",
      fromPhone: "4366412345",
      senderName: "Max Muster",
      text: "Hallo, mein Sensor spinnt",
    });
  });

  it("verkraftet leere/kaputte Payloads", () => {
    expect(extractIncomingMessages(null)).toEqual([]);
    expect(extractIncomingMessages({})).toEqual([]);
    expect(extractIncomingMessages({ entry: [{}] })).toEqual([]);
  });
});
