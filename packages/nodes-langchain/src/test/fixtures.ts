/**
 * Recorded vendor wire responses (shapes captured from the OpenAI Chat Completions and Anthropic
 * Messages streaming APIs) replayed through a fake SafeFetch, so the real `@langchain/openai` and
 * `@langchain/anthropic` clients are exercised end to end without network.
 */
const sse = (events: { event?: string; data: unknown }[]) =>
  events
    .map(
      (e) =>
        `${e.event ? `event: ${e.event}\n` : ""}data: ${typeof e.data === "string" ? e.data : JSON.stringify(e.data)}\n\n`,
    )
    .join("");

const chunk = (delta: object, finish: string | null = null) => ({
  id: "chatcmpl-rec1",
  object: "chat.completion.chunk",
  created: 1_760_000_000,
  model: "gpt-4.1-mini-2025-04-14",
  choices: [{ index: 0, delta, logprobs: null, finish_reason: finish }],
});

export const OPENAI_TEXT_STREAM = sse([
  { data: chunk({ role: "assistant", content: "", refusal: null }) },
  { data: chunk({ content: "Hello" }) },
  { data: chunk({ content: " from" }) },
  { data: chunk({ content: " OpenAI." }) },
  { data: chunk({}, "stop") },
  {
    data: {
      id: "chatcmpl-rec1",
      object: "chat.completion.chunk",
      created: 1_760_000_000,
      model: "gpt-4.1-mini-2025-04-14",
      choices: [],
      usage: {
        prompt_tokens: 19,
        completion_tokens: 4,
        total_tokens: 23,
        prompt_tokens_details: { cached_tokens: 0 },
        completion_tokens_details: { reasoning_tokens: 0 },
      },
    },
  },
  { data: "[DONE]" },
]);

export const OPENAI_TOOL_STREAM = sse([
  {
    data: chunk({
      role: "assistant",
      content: null,
      tool_calls: [
        {
          index: 0,
          id: "call_rec1",
          type: "function",
          function: { name: "weather", arguments: "" },
        },
      ],
    }),
  },
  { data: chunk({ tool_calls: [{ index: 0, function: { arguments: '{"city":' } }] }) },
  { data: chunk({ tool_calls: [{ index: 0, function: { arguments: '"Oslo"}' } }] }) },
  { data: chunk({}, "tool_calls") },
  {
    data: {
      id: "chatcmpl-rec1",
      object: "chat.completion.chunk",
      created: 1_760_000_000,
      model: "gpt-4.1-mini-2025-04-14",
      choices: [],
      usage: { prompt_tokens: 51, completion_tokens: 15, total_tokens: 66 },
    },
  },
  { data: "[DONE]" },
]);

export const ANTHROPIC_STREAM = sse([
  {
    event: "message_start",
    data: {
      type: "message_start",
      message: {
        id: "msg_rec1",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-4-5-20250929",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: 25,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 8,
          output_tokens: 1,
        },
      },
    },
  },
  {
    event: "content_block_start",
    data: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  },
  { event: "ping", data: { type: "ping" } },
  {
    event: "content_block_delta",
    data: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hi from" } },
  },
  {
    event: "content_block_delta",
    data: {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: " Claude." },
    },
  },
  { event: "content_block_stop", data: { type: "content_block_stop", index: 0 } },
  {
    event: "message_delta",
    data: {
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: { output_tokens: 6 },
    },
  },
  { event: "message_stop", data: { type: "message_stop" } },
]);

export const OPENAI_COMPLETION = {
  id: "chatcmpl-rec2",
  object: "chat.completion",
  created: 1_760_000_000,
  model: "gpt-4.1-mini-2025-04-14",
  choices: [
    {
      index: 0,
      message: { role: "assistant", content: "Plain answer.", refusal: null },
      logprobs: null,
      finish_reason: "length",
    },
  ],
  usage: {
    prompt_tokens: 7,
    completion_tokens: 3,
    total_tokens: 10,
    prompt_tokens_details: { cached_tokens: 2 },
  },
};
