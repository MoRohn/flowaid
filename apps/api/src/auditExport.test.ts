import { describe, expect, it } from "vitest";
import { auditCsv, csvField } from "./routes/triggers.js";

describe("audit CSV export", () => {
  it("quotes fields that need it and defuses spreadsheet formulas", () => {
    expect(csvField("workflow.publish")).toBe("workflow.publish");
    expect(csvField('say "hi", then go')).toBe('"say ""hi"", then go"');
    expect(csvField("two\nlines")).toBe('"two\nlines"');
    expect(csvField('=HYPERLINK("http://x")')).toBe('"\'=HYPERLINK(""http://x"")"');
    expect(csvField("+1")).toBe("'+1");
    expect(csvField("@sum")).toBe("'@sum");
  });

  it("writes a header row and one CRLF line per event", () => {
    const csv = auditCsv([
      {
        id: "01a10000-0000-7000-8000-000000000001",
        workspaceId: "01a10000-0000-7000-8000-000000000002",
        actorType: "user",
        actorId: "u-1",
        action: "credential.create",
        resourceType: "credential",
        resourceId: "c-1",
        details: { type: "http.bearer", storage: "db" },
        ip: "127.0.0.1",
        userAgent: null,
        requestId: "req-1",
        at: new Date("2026-10-05T12:00:00.000Z"),
      },
    ]);
    expect(csv.split("\r\n")).toEqual([
      "at,action,actor_type,actor_id,resource_type,resource_id,ip,user_agent,request_id,details",
      '2026-10-05T12:00:00.000Z,credential.create,user,u-1,credential,c-1,127.0.0.1,,req-1,"{""type"":""http.bearer"",""storage"":""db""}"',
      "",
    ]);
  });
});
