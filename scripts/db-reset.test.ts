import { describe, expect, it } from "vitest";

import { assertDatabaseResetAllowed } from "./db-reset.js";

describe("database reset safety", () => {
  it("allows the local development database", () => {
    expect(() =>
      assertDatabaseResetAllowed(
        "postgres://codevault:secret@127.0.0.1:5433/codevault",
        "development",
      ),
    ).not.toThrow();
  });

  it("refuses production and remote databases", () => {
    expect(() =>
      assertDatabaseResetAllowed(
        "postgres://codevault:secret@127.0.0.1:5433/codevault",
        "production",
      ),
    ).toThrow("production");
    expect(() =>
      assertDatabaseResetAllowed(
        "postgres://codevault:secret@db.example.com/codevault",
        "development",
      ),
    ).toThrow("local PostgreSQL");
  });

  it("refuses PostgreSQL maintenance databases", () => {
    for (const database of ["postgres", "template0", "template1"]) {
      expect(() =>
        assertDatabaseResetAllowed(
          `postgres://codevault:secret@localhost:5433/${database}`,
          "development",
        ),
      ).toThrow("maintenance database");
    }
  });
});
