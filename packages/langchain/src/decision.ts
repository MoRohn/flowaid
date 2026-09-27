/**
 * `LangChainDecisionProvider` (LANGCHAIN.md §2): typed decisions from any LangChain chat model.
 * It is the `LLMDecisionProvider` (ARCHITECTURE.md §6.4) over a `LangChainGenerationProvider`, so
 * the prompt, the strict JSON Schema via `withStructuredOutput`, renormalisation, the one re-ask
 * and the fuzzy-choice confidence penalty are exactly the native ones: `provider = 'llm'`,
 * `model = <the LangChain model>`.
 */
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { LLMDecisionProvider } from "@flowaid/providers";
import {
  LangChainGenerationProvider,
  type ChatModelBuilder,
  type LangChainGenerationOptions,
} from "./generation.js";

export class LangChainDecisionProvider extends LLMDecisionProvider {
  constructor(
    model: BaseChatModel | ChatModelBuilder | LangChainGenerationProvider,
    options: LangChainGenerationOptions = {},
  ) {
    super(
      model instanceof LangChainGenerationProvider
        ? model
        : new LangChainGenerationProvider(model, options),
    );
  }
}
