export const INITIAL_CALIBRATION_MEMORY_KEY_PREFIX = "setup-recognition:";

/** Classifies the product-owned memory key, never the memory's prose. */
export function isInitialCalibrationMemory(memory?: { memoryKey?: unknown; memory_key?: unknown } | null): boolean {
  return String(memory?.memoryKey ?? memory?.memory_key ?? "").startsWith(INITIAL_CALIBRATION_MEMORY_KEY_PREFIX);
}

/** Standalone recognition stays in Names/state, including manually edited rows. */
export function isRecognitionMemory(memory?: { memoryKey?: unknown; memory_key?: unknown; recognitionOnly?: unknown } | null): boolean {
  return isInitialCalibrationMemory(memory) || memory?.recognitionOnly === true;
}
