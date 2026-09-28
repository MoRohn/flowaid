# PageIndex evaluation

The evaluation set is in `packages/pageindex/src/evals.ts`: eleven questions over the
redistributable samples in `fixtures/pageindex`.

**The documents:**

- the three-page Northwind support handbook;
- the four-page Northwind travel policy. It **contradicts itself on purpose**: §1.1 allows
  business class above 8 hours, while the FAQ says 6.

**The questions:**

- four single-section;
- two cross-section;
- one ambiguous: the handbook's revision note changes a limit;
- one contradiction;
- one across both documents;
- two with no answer in the documents.

Each answerable question lists the physical pages that answer it and what a correct answer must
say.

**How to run it:** `pnpm eval:pageindex` goes end to end on the real path:

1. The running PageIndex service (pinned SDK 0.2.20) indexes the samples.
2. **TypeSafe Jev** chooses sections (`choice`) and judges every citation (`boolean`).
3. A generation model writes the answer.
4. `checkCitations` validates it, and the result is scored.

## Thresholds (fixed before the first run)

| measure            | definition                                                                | threshold |
| ------------------ | ------------------------------------------------------------------------- | --------- |
| evidence recall    | answerable questions whose expected pages were **all** among the evidence | ≥ 0.8     |
| citation validity  | citations that name retrieved evidence                                    | = 1       |
| citation support   | valid citations Jev judged to support their sentence                      | ≥ 0.8     |
| answer correctness | answerable questions whose answer says what it must (not insufficient)    | ≥ 0.7     |
| abstention         | unanswerable questions reported `insufficient`                            | = 1       |

## Results

All runs on 2026-09-28, on this machine (Apple silicon, Ollama in Docker on the CPU).

- **Indexing and answers:** `ollama/qwen2.5:3b`, a 3B model.
- **Navigator and citation judge:** TypeSafe Jev (`jev-latest`), live.

| run                                               | evidence recall | citation validity | citation support | answer correctness | abstention     | latency / question | navigator cost |
| ------------------------------------------------- | --------------- | ----------------- | ---------------- | ------------------ | -------------- | ------------------ | -------------- |
| 1: before the section-snippet fix                 | 67% (6/9)       | 100% (12/12)      | 67% (8/12)       | 56% (5/9)          | 100% (2/2)     | 7.4 s              | $0.00047       |
| 2: section options carry their own text (current) | **100% (9/9)**  | **100% (9/9)**    | 78% (7/9)        | 56% (5/9)          | **100% (2/2)** | 6.9 s              | $0.00043       |

In run 2, **evidence recall, citation validity and abstention pass. Citation support (78%) and
answer correctness (56%) miss their thresholds.**

What run 2 shows, case by case:

- **Retrieval is right on every answerable question.** That includes the contradiction (both
  pages 1 and 4) and the question across both documents.
- **The misses are the 3B answer writer.** It answered `INSUFFICIENT_EVIDENCE` to:
  - "Who approves a $600 refund?" (the evidence said "Refunds above $200 and up to $1,000 need
    approval from a team lead");
  - the 70-day expense claim;
  - both sides of the contradiction;
  - the question across both documents.

  In two cases it cited a page for a sentence that page does not support. **The citation check
  caught both**, and the answers were reported `partial`, not presented as grounded.

- **The unanswerable questions were refused,** with no evidence and no citations.

Run 1 found a real defect. When several sections share a page, the local SDK gives each of them
the whole page's text as its summary, so the navigator was shown misleading options. The fix
(each option carries its own section's text, and shared pages are read once) is tested in
`retrieve.test.ts` and moved recall from 67% to 100%.

## Not measured

- **A stronger answer writer.** The next step for answer quality is a larger local model, or a
  hosted one (OpenAI or Anthropic; no key on this machine). `qwen2.5:7b` did not fit: Ollama
  needs 5.1 GiB and the Docker VM had about 4.7 GiB free.
  Re-run with `pnpm eval:pageindex -- --answer-model <model>` and add the row here.
- **PageIndex cloud:** not enabled (see [CAPABILITIES.md](CAPABILITIES.md)).
- **Upstream benchmark figures** are not FlowAId's measurements and are not quoted here.
