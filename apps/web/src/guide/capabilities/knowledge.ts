import type { CapabilityGuide } from "./types";

export const KNOWLEDGE: CapabilityGuide = {
  id: "knowledge",
  title: "Knowledge",
  what: "Collect documents your workflows can search and cite: uploaded files, pasted text, web pages, a sitemap or a GitHub repository, and PDFs indexed by section with PageIndex.",
  when: "When a step has to answer from your own material, such as a support reply grounded in the help center or a policy question answered from the handbook, with the passages it used.",
  needs:
    "Nothing to start: keyword search works without a model. Searching by meaning needs an embedding model that is set up: an OpenAI or Gemini key, or the address of an Ollama server, and PDF section indexing needs the PageIndex service.",
  start:
    "Press New source. Short steps cover what it holds, where its documents come from, how it is searched and how text is split, then you review it before creating.",
  result:
    "A searchable source. Uploads are added on its page; web pages, sitemaps and repositories are fetched in the background. Try a search there, then add a Knowledge base or Hybrid search step to a workflow and pick the source.",
  reading: {
    title: "Reading a source",
    items: [
      "New waits for documents or its first sync, Syncing is at work, Ready is searchable, Stale needs a sync, and Error gives the reason on the source's page.",
      "A document marked Error failed on its own; the others still index. Its badge in the table says why.",
      "Try a search shows what a step would receive. Scores only rank hits within that search: read the passages to judge whether they answer the question.",
    ],
  },
  quality: {
    title: "What makes retrieval work well",
    items: [
      "One source per body of material, named after it, so a step searches only what is relevant.",
      "Clean text: navigation menus, banners and duplicate pages crowd out the passages that answer.",
      "Meaning search for questions people phrase in their own words; keywords alone miss paraphrases.",
      "Test with the questions people actually ask before wiring the source into a workflow.",
    ],
  },
};
