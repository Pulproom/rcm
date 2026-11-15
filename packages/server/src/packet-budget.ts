/** Target shares in the server's approximate token units. Empty shares are
 * reusable; these are allocation opportunities, not padding requirements.
 * The packet's existing charged 115% ceiling remains authoritative. */
export function automaticPacketBudget(tokens: number) {
  const b = Math.max(0, tokens);
  return {
    story: Math.floor(Math.min(6000, b * .105)),
    state: Math.floor(Math.min(b * .30, 6000, Math.max(400, b * .13 + 250))),
    sceneRelationships: Math.floor(Math.min(b * .10, 500, Math.max(200, b * .035))),
    eventCards: Math.floor(Math.min(b * .60, 20000, b * .38 + 800)),
    dialogue: Math.floor(Math.min(6000, Math.max(Math.min(200, b * .08), b * .14 - 340))),
    longterm: Math.floor(Math.min(6000, Math.max(Math.min(300, b * .05), b * .14 - 600))),
  };
}

export interface PacketFloorUsage { reserved: number; used: number; returned: number; inactive?: "cadence" }
export const packetFloorUsage = (reserved: number, used: number): PacketFloorUsage =>
  ({ reserved, used, returned: Math.max(0, reserved - used) });
