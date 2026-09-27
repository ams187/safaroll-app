const OPENAI_MODEL = 'gpt-5.5';

const SEARCH_TOOL = {
  type: 'function',
  name: 'search_safaroll_kb',
  description:
    "Search SafaRoll's zoological knowledge base. Call this whenever the user asks about an animal, species, taxonomy, behaviour, habitat, diet, conservation, or a SafaRoll card. Use the most precise species name available in the query and ground the answer in the returned context.",
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The animal or species to search for, preferably its common or scientific name.',
      },
    },
    required: ['query'],
    additionalProperties: false,
  },
};

function buildRequest(
  input: Record<string, unknown>[],
  previousResponseId: string | undefined,
): string {
  return JSON.stringify({
    type: 'response.create',
    model: OPENAI_MODEL,
    store: false,
    reasoning: { summary: 'auto' },
    instructions:
      "Tu es le Guide SafaRoll, un naturaliste chaleureux, précis et prudent. Réponds dans la langue de l'utilisateur. Distingue clairement les faits établis des incertitudes, ne propose jamais de manipuler ou déranger un animal, et n'expose jamais la localisation précise d'une espèce sensible.",
    input,
    tools: [SEARCH_TOOL],
    ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
  });
}

export function buildResponseCreate(
  text: string,
  previousResponseId: string | undefined,
  images: string[] = [],
): string {
  const content: Record<string, unknown>[] = [];
  if (text) content.push({ type: 'input_text', text });
  for (const imageUrl of images) content.push({ type: 'input_image', image_url: imageUrl });
  return buildRequest([{ type: 'message', role: 'user', content }], previousResponseId);
}

export function buildFunctionCallOutput(
  callId: string,
  output: string,
  previousResponseId: string,
): string {
  return buildRequest(
    [{ type: 'function_call_output', call_id: callId, output }],
    previousResponseId,
  );
}

type ServerEvent = { type: string; [key: string]: unknown };

export type ParsedServerEvent =
  | { kind: 'status'; label: string }
  | { kind: 'delta'; text: string }
  | { kind: 'reasoning'; text: string }
  | { kind: 'completed'; responseId: string }
  | { kind: 'tool_call'; callId: string; name: string; args: string }
  | { kind: 'error'; code?: string; message: string }
  | { kind: 'ignored'; type: string };

export function parseServerEvent(raw: string): ParsedServerEvent {
  let event: ServerEvent;
  try {
    event = JSON.parse(raw);
  } catch {
    return { kind: 'ignored', type: '<unparseable>' };
  }

  switch (event.type) {
    case 'response.created':
    case 'response.in_progress':
      return { kind: 'status', label: 'Réflexion' };
    case 'response.output_item.added': {
      const itemType = (event as { item?: { type?: string } }).item?.type;
      if (itemType === 'reasoning') return { kind: 'status', label: 'Réflexion' };
      if (itemType === 'function_call') return { kind: 'status', label: "Recherche dans l'atlas" };
      if (itemType === 'message') return { kind: 'status', label: 'Réponse' };
      return { kind: 'ignored', type: event.type };
    }
    case 'response.reasoning_summary_text.delta':
      return { kind: 'reasoning', text: (event as { delta?: string }).delta ?? '' };
    case 'response.output_text.delta':
      return { kind: 'delta', text: (event as { delta?: string }).delta ?? '' };
    case 'response.completed':
      return {
        kind: 'completed',
        responseId: (event as { response?: { id?: string } }).response?.id ?? '',
      };
    case 'response.output_item.done': {
      const item = (event as {
        item?: { type?: string; call_id?: string; name?: string; arguments?: string };
      }).item;
      if (item?.type === 'function_call') {
        return {
          kind: 'tool_call',
          callId: item.call_id ?? '',
          name: item.name ?? '',
          args: item.arguments ?? '',
        };
      }
      return { kind: 'ignored', type: event.type };
    }
    case 'response.failed':
    case 'error': {
      const error = event as {
        error?: { message?: string; code?: string };
        response?: { error?: { message?: string; code?: string } };
        message?: string;
      };
      return {
        kind: 'error',
        code: error.error?.code ?? error.response?.error?.code,
        message:
          error.error?.message ??
          error.response?.error?.message ??
          error.message ??
          'Erreur inconnue',
      };
    }
    default:
      return { kind: 'ignored', type: event.type };
  }
}
