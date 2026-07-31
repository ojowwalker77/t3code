import { describe, expect, it } from "vite-plus/test";

import {
  MODEL_ARC_GESTURE_ACTION,
  modelArcScrubGain,
  resolveModelArcGestureAction,
} from "./modelArcPickerGesture";

describe("model arc picker scrub gain", () => {
  it("stays direct at rest and caps high-velocity movement", () => {
    expect(modelArcScrubGain(0)).toBe(1);
    expect(modelArcScrubGain(540)).toBe(1.6);
    expect(modelArcScrubGain(5_000)).toBe(1.6);
  });
});

describe("model arc picker gesture intent", () => {
  it("resets accumulated provider drift during horizontal scrubbing", () => {
    expect(resolveModelArcGestureAction(8, 2, 40, 50)).toBe(
      MODEL_ARC_GESTURE_ACTION.resetProviderPull,
    );
  });

  it("keeps small vertical drift in model-scrub mode", () => {
    expect(resolveModelArcGestureAction(0.5, 1, 3, 11)).toBe(MODEL_ARC_GESTURE_ACTION.scrub);
  });

  it("holds the model still after a deliberate provider pull begins", () => {
    expect(resolveModelArcGestureAction(0.5, 4, 5, 30)).toBe(
      MODEL_ARC_GESTURE_ACTION.holdProviderPull,
    );
  });

  it("does not discard a provider pull for tiny horizontal jitter", () => {
    expect(resolveModelArcGestureAction(1, 0.25, 5, 30)).toBe(
      MODEL_ARC_GESTURE_ACTION.holdProviderPull,
    );
  });

  it("lets a decisive horizontal movement exit provider-pull mode", () => {
    expect(resolveModelArcGestureAction(3, 1, 5, 30)).toBe(
      MODEL_ARC_GESTURE_ACTION.resetProviderPull,
    );
  });

  it("rejects a long diagonal drag as provider intent", () => {
    expect(resolveModelArcGestureAction(3, 4, 52, 60)).toBe(MODEL_ARC_GESTURE_ACTION.scrub);
  });

  it("holds just below the provider switch distance", () => {
    expect(resolveModelArcGestureAction(0, 4, 4, 39)).toBe(
      MODEL_ARC_GESTURE_ACTION.holdProviderPull,
    );
  });

  it.each([
    { providerTravelY: -40, expected: MODEL_ARC_GESTURE_ACTION.previousProvider },
    { providerTravelY: 40, expected: MODEL_ARC_GESTURE_ACTION.nextProvider },
  ])("changes provider after an intentional $providerTravelY point pull", (example) => {
    expect(
      resolveModelArcGestureAction(
        0,
        example.providerTravelY < 0 ? -4 : 4,
        4,
        example.providerTravelY,
      ),
    ).toBe(example.expected);
  });
});
