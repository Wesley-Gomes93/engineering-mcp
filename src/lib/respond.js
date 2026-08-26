export function ok(payload, text) {
  const body = text ?? JSON.stringify(payload, null, 2);
  return {
    content: [{ type: "text", text: body }],
    structuredContent: { ok: true, ...payload },
  };
}

export function fail(error) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text", text: message }],
    structuredContent: { ok: false, error: message },
    isError: true,
  };
}

export function wrap(handler) {
  return async (args = {}) => {
    try {
      return await handler(args);
    } catch (err) {
      return fail(err);
    }
  };
}

export function lines(parts) {
  return parts.filter((part) => part !== null && part !== undefined && part !== "").join("\n");
}

export function bullet(items, empty = "- (vazio)") {
  if (!items?.length) return empty;
  return items.map((item) => `- ${item}`).join("\n");
}
