import { assertHostSelection, messageRole, readCurrentChatScope, sameMessageSourceInputs } from "./context.js";
import { addLog, isChatMemoryEnabled } from "./settings.js";
import type { RuntimeState } from "./types.js";

const BTW = "risu_btw_plugin";
const REQUEST = "rcm-btw-memory.v1/request";
const RESPONSE = "rcm-btw-memory.v1/response";
const ATTRIBUTE = "rcm:btw-request:";
const REQUEST_LIFETIME_MS = 10 * 60_000;

function outputIdentity(output: any) {
  return {
    id: output?.chatId ?? output?.id,
    generation: output?.generationInfo?.generationId,
    content: output?.data ?? output?.content,
  };
}

export function createBtwMemoryBridge(state: RuntimeState) {
  let last: { chatId: string; output: ReturnType<typeof outputIdentity>; packet: string } | undefined;
  let delivery: {
    requestId: string;
    chatId: string;
    characterId: string;
    packet: string;
    sources: NonNullable<RuntimeState["automaticTurnPacket"]>["sourceInputs"];
    signal: AbortSignal;
  } | undefined;
  // BTW serializes submissions. The grant is also recognized on provider retries.
  let grant: { id: string; expiresAt: number; started: boolean } | undefined;
  const currentGrant = () => grant && grant.expiresAt > Date.now() ? grant : undefined;

  return {
    async install() {
      if (typeof risuai.addPluginChannelListener !== "function" || typeof risuai.postPluginChannelMessage !== "function") return;
      await risuai.addPluginChannelListener(REQUEST, async (request, metadata) => {
        if (metadata?.sender !== BTW || typeof request?.id !== "string") return;
        if (request.action === "finish") {
          if (grant?.id === request.id) grant = undefined;
          return;
        }
        if (request.action !== "read" || typeof request.chatId !== "string" || state.unloaded) return;
        let packet = "";
        try {
          const { chatId, characterId, hostSnapshot } = await readCurrentChatScope();
          await assertHostSelection(hostSnapshot.characterIndex, hostSnapshot.chatIndex);
          if (chatId === request.chatId && isChatMemoryEnabled(state.settings, chatId, characterId)) {
            const chat = hostSnapshot.chat;
            if (delivery?.chatId === chatId && delivery.characterId === characterId && !delivery.signal.aborted
              && state.cache[chatId]?.lastPacket === delivery.packet) {
              const sourceCount = delivery.sources.length;
              const count = chat.message?.length;
              const tail = chat.message?.at(-1);
              const appendedReply = count === sourceCount + 1 && tail && messageRole(tail) === "assistant" && !tail.isComment && !tail.disabled;
              const waitingForReply = count === sourceCount && state.mainGeneration?.id === delivery.requestId;
              if ((waitingForReply || appendedReply)
                && sameMessageSourceInputs(delivery.sources, chat, appendedReply ? sourceCount : undefined)) {
                packet = delivery.packet;
              }
            } else if (last?.chatId === chatId) {
              const output = chat.message?.findLast((row: any) => messageRole(row) === "assistant");
              const current = outputIdentity(output);
              if (!output?.isComment && !output?.disabled && (current.id || current.generation)
                && current.id === last.output.id && current.generation === last.output.generation && current.content === last.output.content) {
                packet = last.packet;
              }
            }
          }
        } catch { /* BTW can run without a committed memory packet. */ }
        if (state.unloaded) return;
        const attribute = request.mainModel === true ? ATTRIBUTE + request.id : undefined;
        if (attribute) grant = { id: request.id, expiresAt: Date.now() + REQUEST_LIFETIME_MS, started: false };
        await risuai.postPluginChannelMessage(BTW, RESPONSE, { id: request.id, packet, attribute });
      }).catch(() => addLog(state.logs, "warn", "BTW memory bridge could not be registered"));
    },
    record(requestId: string, signal: AbortSignal) {
      const active = state.activeModelRequest;
      const prepared = state.automaticTurnPacket;
      // Output observation can clear the active request before its commit hook.
      // Retain the delivered packet with its original source receipt.
      last = undefined;
      delivery = active?.requestId === requestId && active.characterId && active.packet
        && prepared?.chatId === active.chatId && prepared.turnKey === active.turnKey && prepared.referenceTurnKey === active.referenceTurnKey
        ? { requestId, chatId: active.chatId, characterId: active.characterId, packet: active.packet, sources: prepared.sourceInputs, signal }
        : undefined;
    },
    commit(requestId: string | undefined, chatId: string, output: unknown, packet: string | undefined) {
      if (!packet) {
        if (last?.chatId === chatId) last = undefined;
        return;
      }
      const identity = outputIdentity(output);
      if (!identity.id && !identity.generation) return;
      if (delivery && delivery.requestId === requestId && delivery.chatId === chatId) delivery = undefined;
      last = { chatId, output: identity, packet };
    },
    ownsRequest(messages: OpenAIChat[]): boolean {
      const active = currentGrant();
      if (!active || !messages.some(message => message.attr?.includes(ATTRIBUTE + active.id))) return false;
      active.started = true;
      return true;
    },
    hasModelRequest() {
      return currentGrant()?.started === true;
    },
  };
}
