import { describe, expect, test } from "vitest";

import { decodePubSubNotification } from "./gmail-notifications.js";

describe("Gmail Pub/Sub notification parsing", () => {
  test("accepts only bounded Gmail history facts", () => {
    const data = Buffer.from(
      JSON.stringify({ emailAddress: "User@Example.test", historyId: "12345" }),
    ).toString("base64");
    expect(
      decodePubSubNotification({
        message: { messageId: "notification-1", data },
      }),
    ).toEqual({
      notificationId: "notification-1",
      emailAddress: "user@example.test",
      historyId: "12345",
    });
  });

  test("rejects malformed data and header injection", () => {
    const data = Buffer.from(
      JSON.stringify({
        emailAddress: "victim@example.test\r\nX: bad",
        historyId: "1",
      }),
    ).toString("base64");
    expect(() =>
      decodePubSubNotification({ message: { messageId: "n", data } }),
    ).toThrow();
    expect(() =>
      decodePubSubNotification({
        message: { messageId: "n", data: "not-base64!" },
      }),
    ).toThrow();
  });
});
