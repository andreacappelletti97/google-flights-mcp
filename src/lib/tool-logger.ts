// Tool handler wrapper that adds automatic logging for every invocation.
// Logs: tool name, parameters, timing, success/error status.

import { logger, startTimer } from "./logger.js";
import type { Result } from "./result.js";

export const withToolLogging = <P>(
  toolName: string,
  handler: (params: P) => Promise<Result<string>>
) =>
  async (params: P): Promise<Result<string>> => {
    const elapsed = startTimer();

    logger.info("tool_invoked", {
      tool: toolName,
      params: JSON.stringify(params).substring(0, 200),
    });

    const result = await handler(params);

    if (result.tag === "ok") {
      logger.info("tool_success", {
        tool: toolName,
        durationMs: elapsed(),
        resultLength: result.value.length,
      });
    } else {
      logger.error("tool_error", {
        tool: toolName,
        durationMs: elapsed(),
        error: result.error,
      });
    }

    return result;
  };
