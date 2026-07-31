import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useColorScheme, View, type LayoutChangeEvent } from "react-native";
import { Gesture, type GestureType } from "react-native-gesture-handler";
import Animated, {
  Extrapolation,
  FadeIn,
  FadeOut,
  interpolate,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type SharedValue,
} from "react-native-reanimated";
import { Path, Svg } from "react-native-svg";

import { groupByProvider, type ModelOption, type ProviderGroup } from "../lib/modelOptions";
import { AppText as Text } from "./AppText";
import {
  MODEL_ARC_GESTURE_ACTION,
  modelArcScrubGain,
  resolveModelArcGestureAction,
} from "./modelArcPickerGesture";
import { ProviderIcon } from "./ProviderIcon";

const APEX_RATIO = 0.58;
const DROP_RATIO = 0.3;
const RX_RATIO = 0.55;
const SPACING = 44;
const DRAG_RANGE = 260;
const MIN_DRAG_SPACING = 18;
const DOT_SIZE = 8;
const RING_SIZE = 56;
const RING_ICON_SIZE = 26;
const SNAP_SPRING = { damping: 22, mass: 0.5, stiffness: 260 };
const OVERSCROLL_DRAG = 0.25;
const TAP_SLOP = 10;
const SETTLE_MS = 220;

function clampIndex(value: number, count: number): number {
  "worklet";
  return Math.max(0, Math.min(count - 1, value));
}

function rubberBand(raw: number, count: number): number {
  "worklet";
  const max = count - 1;
  if (raw < 0) {
    return raw * OVERSCROLL_DRAG;
  }
  if (raw > max) {
    return max + (raw - max) * OVERSCROLL_DRAG;
  }
  return raw;
}

export function useModelArcPicker(config: {
  readonly options: ReadonlyArray<ModelOption>;
  readonly selectedKey: string | null;
  readonly onSelect: (option: ModelOption) => void;
  readonly disabled?: boolean;
}): {
  readonly isOpen: boolean;
  readonly close: () => void;
  readonly triggerGesture: GestureType;
  readonly element: ReactNode;
} {
  const [isOpen, setIsOpen] = useState(false);
  const [focused, setFocused] = useState({ group: 0, model: 0 });
  const offset = useSharedValue(0);
  const scrubAcc = useSharedValue(0);
  const providerAnchorX = useSharedValue(0);
  const providerAnchorY = useSharedValue(0);
  const groupSv = useSharedValue(0);

  const groups = useMemo(() => groupByProvider(config.options), [config.options]);
  const disabled = config.disabled === true || groups.length === 0;
  const latest = useRef({
    disabled,
    groups,
    onSelect: config.onSelect,
  });
  latest.current = {
    disabled,
    groups,
    onSelect: config.onSelect,
  };

  const { counts, defaults, selectedGroupIndex, selectedModelIndex } = useMemo(() => {
    const groupCounts = groups.map((group) => group.models.length);
    const groupDefaults = groups.map((group) => {
      const index = group.models.findIndex((model) => model.isDefault);
      return index >= 0 ? index : 0;
    });
    let selGroup = 0;
    let selModel = groupDefaults[0] ?? 0;
    for (let g = 0; g < groups.length; g++) {
      const index = groups[g]!.models.findIndex((model) => model.key === config.selectedKey);
      if (index >= 0) {
        selGroup = g;
        selModel = index;
        break;
      }
    }
    return {
      counts: groupCounts,
      defaults: groupDefaults,
      selectedGroupIndex: selGroup,
      selectedModelIndex: selModel,
    };
  }, [groups, config.selectedKey]);

  const selGroupSv = useSharedValue(selectedGroupIndex);
  const selModelSv = useSharedValue(selectedModelIndex);
  useEffect(() => {
    selGroupSv.value = selectedGroupIndex;
    selModelSv.value = selectedModelIndex;
  }, [selectedGroupIndex, selectedModelIndex, selGroupSv, selModelSv]);

  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearCloseTimer = useCallback(() => {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);
  useEffect(() => clearCloseTimer, [clearCloseTimer]);

  const close = useCallback(() => {
    clearCloseTimer();
    setIsOpen(false);
  }, [clearCloseTimer]);
  useEffect(() => {
    if (disabled) {
      close();
    }
  }, [close, disabled]);

  const openWith = useCallback(
    (group: number, model: number) => {
      if (latest.current.disabled || latest.current.groups.length === 0) {
        return;
      }
      clearCloseTimer();
      setFocused({ group, model });
      setIsOpen(true);
    },
    [clearCloseTimer],
  );

  const handleFocusChange = useCallback((group: number, model: number) => {
    setFocused({ group, model });
    void Haptics.selectionAsync();
  }, []);

  const handleGroupChange = useCallback((group: number, model: number) => {
    setFocused({ group, model });
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, []);

  const selectAndClose = useCallback(
    (group: number, model: number) => {
      const option = latest.current.groups[group]?.models[model];
      if (option) {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        latest.current.onSelect(option);
      }
      clearCloseTimer();
      closeTimer.current = setTimeout(() => setIsOpen(false), SETTLE_MS);
    },
    [clearCloseTimer],
  );

  useAnimatedReaction(
    () => {
      const count = counts[groupSv.value] ?? 1;
      return groupSv.value * 1000 + Math.round(clampIndex(offset.value, count));
    },
    (current, previous) => {
      if (previous !== null && current !== previous) {
        const group = Math.floor(current / 1000);
        if (group === Math.floor(previous / 1000)) {
          runOnJS(handleFocusChange)(group, current % 1000);
        }
      }
    },
    [counts, handleFocusChange],
  );

  const triggerGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!disabled)
        .minDistance(0)
        .onBegin(() => {
          groupSv.value = selGroupSv.value;
          offset.value = selModelSv.value;
          scrubAcc.value = selModelSv.value;
          providerAnchorX.value = 0;
          providerAnchorY.value = 0;
          runOnJS(openWith)(selGroupSv.value, selModelSv.value);
        })
        .onChange((event) => {
          const action = resolveModelArcGestureAction(
            event.changeX,
            event.changeY,
            event.translationX - providerAnchorX.value,
            event.translationY - providerAnchorY.value,
          );

          if (action === MODEL_ARC_GESTURE_ACTION.resetProviderPull) {
            providerAnchorX.value = event.translationX;
            providerAnchorY.value = event.translationY;
          } else if (
            action === MODEL_ARC_GESTURE_ACTION.previousProvider ||
            action === MODEL_ARC_GESTURE_ACTION.nextProvider
          ) {
            providerAnchorX.value = event.translationX;
            providerAnchorY.value = event.translationY;
            const direction = action === MODEL_ARC_GESTURE_ACTION.nextProvider ? 1 : -1;
            const next = groupSv.value + direction;
            if (next >= 0 && next < counts.length) {
              const start = defaults[next] ?? 0;
              groupSv.value = next;
              offset.value = start;
              scrubAcc.value = start;
              runOnJS(handleGroupChange)(next, start);
            }
            return;
          } else if (action === MODEL_ARC_GESTURE_ACTION.holdProviderPull) {
            return;
          }

          const count = counts[groupSv.value] ?? 1;
          const dragSpacing = Math.min(
            SPACING,
            Math.max(MIN_DRAG_SPACING, DRAG_RANGE / Math.max(1, count - 1)),
          );
          const gain = modelArcScrubGain(event.velocityX);
          scrubAcc.value += (event.changeX / dragSpacing) * gain;
          offset.value = rubberBand(scrubAcc.value, count);
        })
        .onEnd((event) => {
          if (Math.abs(event.translationX) > TAP_SLOP || Math.abs(event.translationY) > TAP_SLOP) {
            const group = groupSv.value;
            const count = counts[group] ?? 1;
            const target = Math.round(clampIndex(offset.value, count));
            offset.value = withSpring(target, SNAP_SPRING);
            runOnJS(selectAndClose)(group, target);
          } else {
            runOnJS(close)();
          }
        })
        .onFinalize((_event, success) => {
          if (!success) {
            runOnJS(close)();
          }
        }),
    [
      disabled,
      counts,
      defaults,
      openWith,
      close,
      selectAndClose,
      handleGroupChange,
      offset,
      scrubAcc,
      providerAnchorX,
      providerAnchorY,
      groupSv,
      selGroupSv,
      selModelSv,
    ],
  );

  const element = isOpen ? (
    <ArcSurface
      activeGroup={focused.group}
      focusedModel={focused.model}
      groups={groups}
      offset={offset}
      onLand={selectAndClose}
    />
  ) : null;

  return { isOpen, close, triggerGesture, element };
}

function ArcSurface(props: {
  readonly activeGroup: number;
  readonly focusedModel: number;
  readonly groups: ReadonlyArray<ProviderGroup>;
  readonly offset: SharedValue<number>;
  readonly onLand: (group: number, model: number) => void;
}) {
  const isDarkMode = useColorScheme() === "dark";
  const [size, setSize] = useState({ height: 0, width: 0 });
  const { activeGroup, offset } = props;
  const group = props.groups[activeGroup];
  const models = group?.models ?? [];
  const spread = useSharedValue(0);
  useEffect(() => {
    spread.value = 0;
    spread.value = withSpring(1, { damping: 20, mass: 0.6, stiffness: 240 });
  }, [spread, activeGroup]);

  const latest = useRef(props);
  latest.current = props;
  const handleLand = useCallback((model: number) => {
    latest.current.onLand(latest.current.activeGroup, model);
  }, []);

  const apexY = size.height * APEX_RATIO;
  const arcDrop = size.height * DROP_RATIO;

  const arcPath = useMemo(() => {
    if (size.width <= 0 || size.height <= 0) {
      return "";
    }
    const rx = size.width * RX_RATIO;
    const segments = 48;
    let path = "";
    for (let step = 0; step <= segments; step++) {
      const x = (size.width * step) / segments;
      const t = Math.max(-1, Math.min(1, (x - size.width / 2) / rx));
      const y = apexY + arcDrop * (1 - Math.sqrt(1 - t * t));
      path += `${step === 0 ? "M" : " L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    return path;
  }, [size.width, size.height, apexY, arcDrop]);

  const focusedOption = models[props.focusedModel] ?? models[0];
  const hairline = isDarkMode ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)";

  const handleLayout = (event: LayoutChangeEvent) => {
    const { height, width } = event.nativeEvent.layout;
    setSize((current) =>
      current.width === width && current.height === height ? current : { height, width },
    );
  };

  const showProviderLine = size.height >= 120;
  const count = models.length;

  return (
    <Animated.View
      entering={FadeIn.duration(120)}
      exiting={FadeOut.duration(100)}
      style={{ height: "100%", width: "100%" }}
    >
      <View
        accessibilityLabel="Model picker"
        accessibilityRole="adjustable"
        accessibilityValue={{ text: focusedOption?.label }}
        accessibilityActions={[
          { name: "increment", label: "Next model" },
          { name: "decrement", label: "Previous model" },
        ]}
        onAccessibilityAction={(event) => {
          const target = clampIndex(
            props.focusedModel + (event.nativeEvent.actionName === "increment" ? 1 : -1),
            count,
          );
          offset.value = withSpring(target, SNAP_SPRING);
          handleLand(target);
        }}
        onLayout={handleLayout}
        className="flex-1 overflow-hidden"
      >
        {size.width > 0 && size.height > 0 ? (
          <View key={activeGroup} className="flex-1">
            <Svg
              pointerEvents="none"
              width={size.width}
              height={size.height}
              style={{ position: "absolute" }}
            >
              <Path d={arcPath} stroke={hairline} strokeWidth={1} fill="none" />
            </Svg>

            {models.map((option, index) => (
              <ArcDot
                key={option.key}
                apexY={apexY}
                arcDrop={arcDrop}
                index={index}
                isDarkMode={isDarkMode}
                offset={offset}
                spread={spread}
                width={size.width}
              />
            ))}

            <View
              pointerEvents="none"
              style={{
                alignItems: "center",
                backgroundColor: isDarkMode ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
                borderColor: isDarkMode ? "rgba(255,255,255,0.4)" : "rgba(0,0,0,0.3)",
                borderRadius: RING_SIZE / 2,
                borderWidth: 1.5,
                height: RING_SIZE,
                justifyContent: "center",
                left: size.width / 2 - RING_SIZE / 2,
                position: "absolute",
                top: apexY - RING_SIZE / 2,
                width: RING_SIZE,
              }}
            >
              {models.map((option, index) => (
                <ApexIcon key={option.key} index={index} offset={offset} option={option} />
              ))}
            </View>

            <View
              pointerEvents="none"
              style={{ alignItems: "center", left: 0, position: "absolute", right: 0, top: 10 }}
            >
              <Text
                className="font-t3-bold text-foreground"
                numberOfLines={1}
                style={{ fontSize: 12, letterSpacing: 2, textTransform: "uppercase" }}
              >
                {focusedOption?.label}
              </Text>
              {showProviderLine ? (
                <Text
                  className="text-foreground-tertiary"
                  numberOfLines={1}
                  style={{
                    fontSize: 9,
                    letterSpacing: 1.4,
                    marginTop: 2,
                    textTransform: "uppercase",
                  }}
                >
                  {group?.providerLabel}
                </Text>
              ) : null}
            </View>
          </View>
        ) : null}

        {props.groups.length > 1 ? (
          <View
            pointerEvents="none"
            style={{
              alignItems: "center",
              bottom: 0,
              gap: 5,
              justifyContent: "center",
              position: "absolute",
              right: 14,
              top: 0,
            }}
          >
            {props.groups.map((pagerGroup, index) => (
              <View
                key={pagerGroup.providerKey}
                style={{
                  backgroundColor:
                    index === activeGroup
                      ? isDarkMode
                        ? "rgba(255,255,255,0.85)"
                        : "rgba(0,0,0,0.7)"
                      : isDarkMode
                        ? "rgba(255,255,255,0.22)"
                        : "rgba(0,0,0,0.16)",
                  borderRadius: 3,
                  height: 6,
                  width: 6,
                }}
              />
            ))}
          </View>
        ) : null}
      </View>
    </Animated.View>
  );
}

function ApexIcon(props: {
  readonly index: number;
  readonly offset: SharedValue<number>;
  readonly option: ModelOption;
}) {
  const { index, offset } = props;
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(
      Math.abs(index - offset.value),
      [0, 0.4, 0.6],
      [1, 0.2, 0],
      Extrapolation.CLAMP,
    ),
  }));
  return (
    <Animated.View style={[{ position: "absolute" }, style]}>
      <ProviderIcon provider={props.option.providerDriver} size={RING_ICON_SIZE} />
    </Animated.View>
  );
}

function ArcDot(props: {
  readonly apexY: number;
  readonly arcDrop: number;
  readonly index: number;
  readonly isDarkMode: boolean;
  readonly offset: SharedValue<number>;
  readonly spread: SharedValue<number>;
  readonly width: number;
}) {
  const { apexY, arcDrop, index, offset, spread, width } = props;

  const style = useAnimatedStyle(() => {
    const rx = width * RX_RATIO;
    const rel = (index - offset.value) * spread.value;
    const x = width / 2 + rel * SPACING;
    const t = Math.max(-1, Math.min(1, (x - width / 2) / rx));
    const distance = Math.abs(index - offset.value);
    return {
      opacity:
        interpolate(distance, [0.25, 0.55], [0, 1], Extrapolation.CLAMP) *
        interpolate(distance, [2.8, 4.4], [1, 0], Extrapolation.CLAMP),
      transform: [
        { translateX: x - DOT_SIZE / 2 },
        { translateY: apexY + arcDrop * (1 - Math.sqrt(1 - t * t)) - DOT_SIZE / 2 },
      ],
    };
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          backgroundColor: props.isDarkMode ? "rgba(255,255,255,0.38)" : "rgba(0,0,0,0.28)",
          borderRadius: DOT_SIZE / 2,
          height: DOT_SIZE,
          left: 0,
          position: "absolute",
          top: 0,
          width: DOT_SIZE,
        },
        style,
      ]}
    />
  );
}
