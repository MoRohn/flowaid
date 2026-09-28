import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PageIndexServiceClient } from "./protocol.js";
import { startPageIndexStub, type PageIndexStub } from "./testing.js";

const WS = "0199a000-0000-7000-8000-00000000aaaa";
const OTHER = "0199a000-0000-7000-8000-00000000cccc";
const JOB = "0199a000-0000-7000-8000-00000000bbbb";

describe("the protocol v1 stub, driven by the client", () => {
  let stub: PageIndexStub;
  let client: PageIndexServiceClient;
  beforeAll(async () => {
    stub = await startPageIndexStub();
    client = new PageIndexServiceClient({ baseUrl: stub.url, token: stub.token });
  });
  afterAll(() => stub.close());

  it("runs a job to a ready document the workspace can read, and no other", async () => {
    const submitted = await client.submitJob({
      jobId: JOB,
      workspaceId: WS,
      fileName: "a.pdf",
      contentSha256: "abc",
      mode: "flash",
      optimize: "merge",
      model: { litellm: "ollama/qwen2.5:3b" },
      indexId: "idx-1",
      pdf: new Uint8Array([37, 80, 68, 70]),
    });
    expect(submitted.state).toBe("running");
    // idempotent resubmission
    expect((await client.submitJob({ ...stubJob(), pdf: new Uint8Array([1]) })).jobId).toBe(JOB);
    stub.finish(JOB);
    const done = await client.getJob(WS, JOB);
    expect(done.state).toBe("ready");
    const docId = done.result?.docId ?? "";
    expect((await client.tree(WS, docId)).map((n) => n.title)).toEqual([
      "Refunds",
      "Data requests",
    ]);
    expect(await client.pages(WS, docId, [1])).toEqual([
      { page: 1, text: "Refunds above $200 and up to $1,000 need approval from a team lead." },
    ]);
    await expect(client.tree(OTHER, docId)).rejects.toMatchObject({ status: 404 });
    await expect(client.getJob(OTHER, JOB)).rejects.toMatchObject({ status: 404 });
    expect(await client.listDocuments(WS)).toEqual([{ docId, indexId: "idx-1" }]);
    expect(await client.deleteDocument(WS, docId)).toBe(true);
    expect(stub.requests.every((r) => r.authorized || r.path === "/healthz")).toBe(true);
  });

  it("refuses a wrong token", async () => {
    const bad = new PageIndexServiceClient({ baseUrl: stub.url, token: "wrong" });
    await expect(bad.getJob(WS, JOB)).rejects.toMatchObject({ status: 401 });
  });
});

function stubJob() {
  return {
    jobId: JOB,
    workspaceId: WS,
    fileName: "a.pdf",
    contentSha256: "abc",
    mode: "flash" as const,
    optimize: "merge" as const,
    model: { litellm: "ollama/qwen2.5:3b" },
    indexId: "idx-1",
  };
}
