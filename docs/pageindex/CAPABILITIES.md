# PageIndex capability matrix

The pinned release is **pageindex 0.2.20**. The table is verified against its source and a live
run on this platform. `@flowaid/pageindex` `MODES` / `LOCAL_CAPABILITIES` encode the same facts;
the UI and validation read them.

| capability                 | local (enabled)                                                                            | cloud (not enabled in this release)                |
| -------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| where files are parsed     | the machine running the FlowAId PageIndex service                                          | PageIndex's servers                                |
| what leaves the machine    | page text sent to the **indexing model's** provider (nothing, with Ollama here)            | the file itself                                    |
| formats                    | PDF with a text layer                                                                      | PDF, including scanned (managed OCR), per upstream |
| scanned / image-only PDFs  | refused: `SCANNED_PDF`, "run OCR first"                                                    | OCR, per upstream                                  |
| encrypted PDFs             | refused: `ENCRYPTED_PDF`                                                                   | not verified                                       |
| tree building              | `flash` (layout-based) or `standard` (LLM-built)                                           | managed                                            |
| section ids                | yes (`node_id`, e.g. `0003`)                                                               | yes                                                |
| page locators              | physical, 1-based                                                                          | physical                                           |
| printed page labels        | no                                                                                         | not verified                                       |
| block ids / bounding boxes | no                                                                                         | block-level features exist upstream; not verified  |
| summaries                  | model-written per section (`summary_max_words` 150)                                        | managed                                            |
| limits in FlowAId          | 50 MiB, 500 pages, 2 concurrent jobs, 30 min per job (configurable)                        | —                                                  |
| verified live here         | yes: the sample travel policy with qwen2.5:3b on Ollama, restart survival, scanned refusal | **no**: no cloud credentials, so it stays off      |

Retrieval and citations are FlowAId's own. They are the same whatever built the index:

- Evidence is the source text of the physical pages of the sections the navigator chose.
- `pageLabel` is always null.
- The viewer opens the exact file version at the physical page (`#page=N`), which is the honest
  fallback when there are no block coordinates.
