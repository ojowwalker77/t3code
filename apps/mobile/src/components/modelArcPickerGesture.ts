export const MODEL_ARC_GESTURE_ACTION = {
  scrub: 0,
  resetProviderPull: 1,
  holdProviderPull: 2,
  previousProvider: 3,
  nextProvider: 4,
} as const;

export type ModelArcGestureAction =
  (typeof MODEL_ARC_GESTURE_ACTION)[keyof typeof MODEL_ARC_GESTURE_ACTION];

const PROVIDER_PULL_ACTIVATION_DISTANCE = 12;
const PROVIDER_SWITCH_DISTANCE = 40;
const PROVIDER_PULL_DOMINANCE = 1.2;
const HORIZONTAL_RESET_DISTANCE = 10;
const HORIZONTAL_RESET_DOMINANCE = 1.25;
const HORIZONTAL_STEP_RESET_DISTANCE = 2;
const HORIZONTAL_STEP_RESET_DOMINANCE = 2;
const MAX_MODEL_SCRUB_GAIN = 1.6;
const MODEL_SCRUB_VELOCITY_SCALE = 900;

export function modelArcScrubGain(velocityX: number): number {
  "worklet";
  return Math.min(MAX_MODEL_SCRUB_GAIN, 1 + Math.abs(velocityX) / MODEL_SCRUB_VELOCITY_SCALE);
}

export function resolveModelArcGestureAction(
  changeX: number,
  changeY: number,
  providerTravelX: number,
  providerTravelY: number,
): ModelArcGestureAction {
  "worklet";

  const stepX = Math.abs(changeX);
  const stepY = Math.abs(changeY);
  const travelX = Math.abs(providerTravelX);
  const travelY = Math.abs(providerTravelY);
  if (
    (stepX >= HORIZONTAL_STEP_RESET_DISTANCE && stepX >= stepY * HORIZONTAL_STEP_RESET_DOMINANCE) ||
    (travelX >= HORIZONTAL_RESET_DISTANCE && travelX >= travelY * HORIZONTAL_RESET_DOMINANCE)
  ) {
    return MODEL_ARC_GESTURE_ACTION.resetProviderPull;
  }

  const isProviderPull =
    travelY >= PROVIDER_PULL_ACTIVATION_DISTANCE && travelY >= travelX * PROVIDER_PULL_DOMINANCE;
  if (!isProviderPull) {
    return MODEL_ARC_GESTURE_ACTION.scrub;
  }
  if (travelY < PROVIDER_SWITCH_DISTANCE) {
    return MODEL_ARC_GESTURE_ACTION.holdProviderPull;
  }
  return providerTravelY < 0
    ? MODEL_ARC_GESTURE_ACTION.previousProvider
    : MODEL_ARC_GESTURE_ACTION.nextProvider;
}
