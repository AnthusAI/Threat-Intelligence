// @ts-nocheck
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ComposableRenderer } from "babulus-renderer/ComposableRenderer.tsx";
import { RendererProvider } from "babulus-renderer/context.tsx";
import { registerComponent } from "babulus-renderer/components/registry.ts";
import { dslToScriptData } from "babulus-shared/dsl-to-script.ts";
import { executeVomXml } from "babulus-videoml-player/xml.ts";
import { TiTitleSlide } from "./ti-title-slide";
import { TiQuoteCard } from "./ti-quote-card";
import { advanceScriptPreviewTime, computePreviewPlaybackState } from "./preview-timing";
import { computePreviewStageFit } from "./preview-stage-fit";
import { tiVideoRhythmCssVars } from "./ti-video-rhythm";

import "babulus-browser-bundle";

registerComponent("TiTitleSlide", TiTitleSlide);
registerComponent("TiQuoteCard", TiQuoteCard);

const TI_VIDEO_RHYTHM_VARS = tiVideoRhythmCssVars();

const TI_SCENE_STYLES_DARK = {
  background: "#111110",
  color: "#eeeeec",
  vars: {
    ...TI_VIDEO_RHYTHM_VARS,
    "--color-bg": "#111110",
    "--color-bg-subtle": "#191918",
    "--color-surface": "#111110",
    "--color-surface-strong": "#222221",
    "--color-text": "#eeeeec",
    "--color-text-muted": "#b5b3ad",
    "--color-primary": "#eeeeec",
    "--color-accent": "#e54d2e",
    "--color-secondary": "#222221",
    "--ti-section-rule": "#e54d2e",
    "--ti-alarm-red": "#e54d2e",
    "--ti-headline-color": "#eeeeec",
    "--ti-body-color": "#b5b3ad",
    "--ti-cta-red": "#e54d2e",
    "--ti-cta-background": "#853a2d",
    "--ti-cta-foreground": "#eeeeec",
    "--ti-inverted-alert": "#ff977d",
    "--background": "#111110",
    "--foreground": "#b5b3ad",
    "--foreground-strong": "#eeeeec",
    "--foreground-muted": "#7c7b74",
    "--extra-muted-foreground": "#3b3a37",
    "--faintly-muted": "#222221",
    "--ti-hrule-foreground": "#3b3a37",
    "--ti-pictogram-edge": "#363a3f",
    "--ti-pictogram-node": "#2e3135",
    "--ti-pictogram-muted": "#43484e",
    "--ti-pictogram-user": "#d4d8de",
    "--ti-pictogram-throb": "#ac4d39",
    "--ti-pictogram-compromised": "#e54d2e",
    "--ti-pictogram-accent-glow": "rgba(251, 146, 60, 0.2)",
    "--grass-8": "#30a46c",
    "--amber-8": "#f59e0b",
    "--sand-8": "#62605b",
    "--font-headline": "Inter, Helvetica Neue, Segoe UI, Helvetica, Arial, sans-serif",
    "--font-subhead": "Inter, Helvetica Neue, Segoe UI, Helvetica, Arial, sans-serif",
    "--font-eyebrow": "Inter, Helvetica Neue, Segoe UI, Helvetica, Arial, sans-serif",
  },
};

const TI_SCENE_STYLES_LIGHT = {
  background: "#fdfdfc",
  color: "#21201c",
  vars: {
    ...TI_VIDEO_RHYTHM_VARS,
    "--color-bg": "#fdfdfc",
    "--color-bg-subtle": "#f9f9f8",
    "--color-surface": "#fdfdfc",
    "--color-surface-strong": "#f1f0ef",
    "--color-text": "#21201c",
    "--color-text-muted": "#63635e",
    "--color-primary": "#21201c",
    "--color-accent": "#e54d2e",
    "--color-secondary": "#f1f0ef",
    "--ti-section-rule": "#e54d2e",
    "--ti-alarm-red": "#e54d2e",
    "--ti-headline-color": "#21201c",
    "--ti-body-color": "#63635e",
    "--ti-cta-red": "#e54d2e",
    "--ti-cta-background": "#e54d2e",
    "--ti-cta-foreground": "#fdfdfc",
    "--ti-inverted-alert": "#e54d2e",
    "--background": "#fdfdfc",
    "--foreground": "#63635e",
    "--foreground-strong": "#21201c",
    "--foreground-muted": "#82827c",
    "--extra-muted-foreground": "#cfceca",
    "--faintly-muted": "#f1f0ef",
    "--ti-hrule-foreground": "#cfceca",
    "--ti-pictogram-edge": "#b9bbc6",
    "--ti-pictogram-node": "#b9bbc6",
    "--ti-pictogram-muted": "#d9d9e0",
    "--ti-pictogram-user": "#60646c",
    "--ti-pictogram-throb": "#ec8e7b",
    "--ti-pictogram-compromised": "#e54d2e",
    "--ti-pictogram-accent-glow": "rgba(234, 88, 12, 0.18)",
    "--grass-8": "#30a46c",
    "--amber-8": "#f59e0b",
    "--sand-8": "#bcbbb5",
    "--font-headline": "Inter, Helvetica Neue, Segoe UI, Helvetica, Arial, sans-serif",
    "--font-subhead": "Inter, Helvetica Neue, Segoe UI, Helvetica, Arial, sans-serif",
    "--font-eyebrow": "Inter, Helvetica Neue, Segoe UI, Helvetica, Arial, sans-serif",
  },
};

const TI_BACKGROUND_PROPS_DARK = {
  variant: "solid",
  color: "#111110",
};

const TI_BACKGROUND_PROPS_LIGHT = {
  variant: "solid",
  color: "#fdfdfc",
};

function propsAttr(value: unknown): string {
  const raw = JSON.stringify(value);
  return raw.replace(/&/g, "&amp;").replace(/'/g, "&#39;").replace(/</g, "&lt;");
}

function swapTiLightPaletteTokens(xml: string): string {
  // Context-aware fixes for legacy dark palette tokens whose hex values
  // collide with new light palette tokens.  #21201c was the old dark
  // --color-surface but is also the new light --color-text / --foreground-
  // strong (sand-12 light).  A blind global replace would turn light text
  // into the light background.  Swap only within the specific CSS variable
  // keys where the old dark value appeared.
  const targeted: Array<[string, string]> = [
    ['"--color-surface":"#21201c"', '"--color-surface":"#fdfdfc"'],
    ['"--color-surface-strong":"#2a2926"', '"--color-surface-strong":"#f1f0ef"'],
    ['"--color-secondary":"#7f7e77"', '"--color-secondary":"#f1f0ef"'],
    ['"--sand-8":"#9090a0"', '"--sand-8":"#bcbbb5"'],
  ];
  let updated = xml;
  for (const [dark, light] of targeted) {
    updated = updated.replaceAll(dark, light);
  }

  // Unambiguous dark -> light mappings (safe to replace globally).
  const replacements: Array<[string, string]> = [
    ["rgba(251, 146, 60, 0.2)", "rgba(234, 88, 12, 0.18)"],
    ["#111110", "#fdfdfc"],
    ["#191918", "#f9f9f8"],
    ["#222221", "#f1f0ef"],
    ["#2a2a28", "#e9e8e6"],
    ["#2a2926", "#f1f0ef"],
    ["#3b3a37", "#cfceca"],
    ["#7c7b74", "#82827c"],
    ["#b5b3ad", "#63635e"],
    ["#eeeeec", "#21201c"],
    ["#62605b", "#bcbbb5"],
    ["#7f7e77", "#f1f0ef"],
    ["#853a2d", "#e54d2e"],
    ["#ff977d", "#e54d2e"],
    ["#363a3f", "#b9bbc6"],
    ["#2e3135", "#b9bbc6"],
    ["#43484e", "#d9d9e0"],
    ["#ac4d39", "#ec8e7b"],
    ["#9090a0", "#bcbbb5"],
  ];
  for (const [darkToken, lightToken] of replacements) {
    updated = updated.replaceAll(darkToken, lightToken);
  }
  return updated;
}

function normalizePreviewQuoteCards(xml: string): string {
  if (!xml.includes("<quote-card")) return xml;
  return xml.replaceAll("<quote-card", "<ti-quote-card");
}

function normalizePreviewFonts(xml: string): string {
  return xml.replaceAll(
    "Helvetica Neue, Segoe UI, Helvetica, Arial, sans-serif",
    "Inter, Helvetica Neue, Segoe UI, Helvetica, Arial, sans-serif",
  );
}

function rethemeDslXml(xml: string, theme: "dark" | "light"): string {
  let updated = normalizePreviewQuoteCards(normalizePreviewFonts(xml));
  if (theme === "dark") return updated;
  const darkSceneStyles = propsAttr(TI_SCENE_STYLES_DARK);
  const lightSceneStyles = propsAttr(TI_SCENE_STYLES_LIGHT);
  const darkBackgroundProps = propsAttr(TI_BACKGROUND_PROPS_DARK);
  const lightBackgroundProps = propsAttr(TI_BACKGROUND_PROPS_LIGHT);
  updated = updated
    .replaceAll(darkSceneStyles, lightSceneStyles)
    .replaceAll(darkBackgroundProps, lightBackgroundProps);
  if (updated.includes("#111110") || updated.includes("#191918") || updated.includes("#222221") || updated.includes("#2a2926")) {
    updated = swapTiLightPaletteTokens(updated);
  }
  return updated;
}

type ScriptData = ReturnType<typeof dslToScriptData>;

type TiPreviewMountOptions = {
  xml: string;
  theme?: "dark" | "light";
  autoPlay?: boolean;
  audioSrc?: string;
  rhythmOverlay?: boolean;
};

type TiPreviewPlayerProps = {
  script: ScriptData;
  width: number;
  height: number;
  autoPlay?: boolean;
  audioSrc?: string;
  rhythmOverlay?: boolean;
};

function scriptDuration(script: ScriptData): number {
  const scenes = script.scenes ?? [];
  if (!scenes.length) return 10;
  const lastScene = scenes[scenes.length - 1];
  return typeof lastScene.endSec === "number" && lastScene.endSec > 0 ? lastScene.endSec : 10;
}

function TiPreviewPlayer({ script, width, height, autoPlay = false, audioSrc, rhythmOverlay = false }: TiPreviewPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(autoPlay);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState<number | null>(null);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [audioProgressObserved, setAudioProgressObserved] = useState(false);
  const [viewportSize, setViewportSize] = useState({ width, height });
  const animationFrameRef = useRef<number>();
  const lastTimestampRef = useRef<number>();
  const currentTimeRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement>(null);
  const lastAudioTimeRef = useRef(0);
  const viewportRef = useRef<HTMLDivElement>(null);
  const usedAudioClockRef = useRef(false);

  const fps = script.fps ?? 30;
  const scriptDerivedDuration = useMemo(() => scriptDuration(script), [script]);
  const playbackState = useMemo(
    () =>
      computePreviewPlaybackState({
        audioBlocked,
        audioDuration,
        audioProgressObserved,
        audioSrc,
        currentTime,
        isPlaying,
        scriptDerivedDuration,
      }),
    [audioBlocked, audioDuration, audioProgressObserved, audioSrc, currentTime, isPlaying, scriptDerivedDuration],
  );
  const { duration, hasAudioSource, useAudioClock, visualTime } = playbackState;

  const currentFrame = Math.floor(visualTime * fps);
  const sceneBackground = script.scenes?.[0]?.styles?.background;
  const backgroundColor = typeof sceneBackground === "string" ? sceneBackground : "#111110";
  const rhythmRowHeight =
    script.scenes?.[0]?.styles?.vars?.["--ti-row-height"] ?? TI_VIDEO_RHYTHM_VARS["--ti-row-height"];
  const fittedStage = useMemo(
    () =>
      computePreviewStageFit({
        containerHeight: viewportSize.height,
        containerWidth: viewportSize.width,
        stageHeight: height,
        stageWidth: width,
      }),
    [height, viewportSize.height, viewportSize.width, width],
  );

  const applyTime = useCallback((nextTime: number) => {
    const clamped = Math.max(0, Math.min(nextTime, duration));
    currentTimeRef.current = clamped;
    setCurrentTime(clamped);
  }, [duration]);

  const playAudio = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || !hasAudioSource) return true;
    try {
      await audio.play();
      setAudioBlocked(false);
      return true;
    } catch {
      setAudioBlocked(true);
      return false;
    }
  }, [hasAudioSource]);

  const pauseAudio = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !hasAudioSource) return;
    audio.pause();
  }, [hasAudioSource]);

  const seekAudio = useCallback(
    (nextTime: number) => {
      const audio = audioRef.current;
      if (!audio || !hasAudioSource) return;
      try {
        audio.currentTime = nextTime;
      } catch {
        // ignore seek failures before metadata loads
      }
    },
    [hasAudioSource],
  );

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !hasAudioSource) {
      setAudioDuration(null);
      setAudioProgressObserved(false);
      setAudioBlocked(false);
      lastAudioTimeRef.current = 0;
      return;
    }
    setAudioDuration(null);
    setAudioProgressObserved(false);
    setAudioBlocked(false);
    lastAudioTimeRef.current = 0;

    const onLoadedMetadata = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        setAudioDuration(audio.duration);
      }
    };

    const markAudioProgress = () => {
      if (!Number.isFinite(audio.currentTime)) return;
      if (audio.currentTime > 0 || audio.currentTime !== lastAudioTimeRef.current) {
        setAudioProgressObserved(true);
        setAudioBlocked(false);
      }
      lastAudioTimeRef.current = audio.currentTime;
    };

    const onEnded = () => {
      setIsPlaying(false);
    };

    const onError = () => {
      setAudioBlocked(true);
      setAudioProgressObserved(false);
    };

    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("timeupdate", markAudioProgress);
    audio.addEventListener("seeked", markAudioProgress);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    if (audio.readyState >= 1) {
      onLoadedMetadata();
    }

    return () => {
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("timeupdate", markAudioProgress);
      audio.removeEventListener("seeked", markAudioProgress);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
    };
  }, [audioSrc, hasAudioSource]);

  useEffect(() => {
    if (!autoPlay || !hasAudioSource) return;
    void playAudio();
  }, [audioSrc, autoPlay, hasAudioSource, playAudio]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === "undefined") return;

    const updateViewport = () => {
      const rect = viewport.getBoundingClientRect();
      setViewportSize((current) => {
        const nextWidth = Math.round(rect.width);
        const nextHeight = Math.round(rect.height);
        if (current.width === nextWidth && current.height === nextHeight) {
          return current;
        }
        return {
          width: nextWidth > 0 ? nextWidth : width,
          height: nextHeight > 0 ? nextHeight : height,
        };
      });
    };

    updateViewport();
    const observer = new ResizeObserver(updateViewport);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [height, width]);

  useEffect(() => {
    if (usedAudioClockRef.current && !useAudioClock) {
      currentTimeRef.current = visualTime;
      setCurrentTime(visualTime);
    }
    usedAudioClockRef.current = useAudioClock;
  }, [useAudioClock, visualTime]);

  useEffect(() => {
    if (!isPlaying) {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      pauseAudio();
      return;
    }

    if (hasAudioSource) {
      void playAudio();
    }

    const tick = (timestamp: number) => {
      if (!isPlaying) return;

      if (useAudioClock) {
        const audio = audioRef.current;
        if (audio && Number.isFinite(audio.currentTime)) {
          let nextTime = audio.currentTime;
          if (nextTime >= duration && duration > 0) {
            nextTime = 0;
            audio.currentTime = 0;
          }
          applyTime(nextTime);
        }
      } else if (lastTimestampRef.current !== undefined) {
        const delta = (timestamp - lastTimestampRef.current) / 1000;
        applyTime(advanceScriptPreviewTime(currentTimeRef.current, delta, duration));
      }

      lastTimestampRef.current = timestamp;
      animationFrameRef.current = requestAnimationFrame(tick);
    };

    lastTimestampRef.current = undefined;
    animationFrameRef.current = requestAnimationFrame(tick);
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [applyTime, duration, hasAudioSource, isPlaying, pauseAudio, playAudio, useAudioClock]);

  const startPlayback = useCallback(async () => {
    if (hasAudioSource) {
      await playAudio();
    }
    setIsPlaying(true);
    lastTimestampRef.current = undefined;
  }, [hasAudioSource, playAudio]);

  const stopPlayback = useCallback(() => {
    setIsPlaying(false);
    lastTimestampRef.current = undefined;
  }, []);

  const handleSeek = useCallback(
    (nextTime: number) => {
      applyTime(nextTime);
      seekAudio(nextTime);
      lastTimestampRef.current = undefined;
    },
    [applyTime, seekAudio],
  );

  const lastBroadcastRef = useRef<{ currentTime: number; duration: number } | null>(null);
  useEffect(() => {
    if (typeof window === "undefined" || window.parent === window) return;
    const roundedTime = Math.round(currentTime * 10) / 10;
    const roundedDuration = Math.round(duration * 10) / 10;
    const previous = lastBroadcastRef.current;
    if (
      previous &&
      previous.currentTime === roundedTime &&
      previous.duration === roundedDuration
    ) {
      return;
    }
    lastBroadcastRef.current = { currentTime: roundedTime, duration: roundedDuration };
    window.parent.postMessage(
      {
        kind: "ti-preview-time",
        currentTime: roundedTime,
        duration: roundedDuration,
      },
      "*",
    );
  }, [currentTime, duration]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const payload = event.data;
      if (!payload || typeof payload !== "object") return;
      if (payload.kind === "ti-preview-play") {
        void startPlayback();
        return;
      }
      if (payload.kind === "ti-preview-pause") {
        stopPlayback();
        return;
      }
      if (payload.kind === "ti-preview-seek" && typeof payload.time === "number") {
        handleSeek(payload.time);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [handleSeek, startPlayback, stopPlayback]);

  return (
    <div
      style={{
        background: "#000",
        height: "100%",
        overflow: "hidden",
        position: "relative",
        width: "100%",
      }}
    >
      {hasAudioSource ? (
        <audio ref={audioRef} preload="auto" src={audioSrc} style={{ display: "none" }} />
      ) : null}
      <div
        ref={viewportRef}
        style={{
          alignItems: "center",
          background: backgroundColor,
          display: "flex",
          justifyContent: "center",
          overflow: "hidden",
          position: "absolute",
          inset: 0,
        }}
      >
        <div
          style={{
            height,
            left: "50%",
            position: "absolute",
            top: "50%",
            transform: `translate(-50%, -50%) scale(${fittedStage.scale})`,
            transformOrigin: "center center",
            width,
          }}
        >
          <RendererProvider
            frame={currentFrame}
            config={{
              fps,
              width,
              height,
              durationFrames: Math.max(1, Math.floor(duration * fps)),
            }}
          >
            <ComposableRenderer script={script} />
          </RendererProvider>
          {rhythmOverlay ? (
            <div
              aria-hidden="true"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(to bottom, rgba(18, 52, 118, 0.045) 0, rgba(18, 52, 118, 0.045) var(--ti-row-height), transparent var(--ti-row-height), transparent calc(var(--ti-row-height) * 2))",
                backgroundSize: "100% var(--ti-row-height)",
                inset: 0,
                pointerEvents: "none",
                position: "absolute",
                zIndex: 20,
                "--ti-row-height": rhythmRowHeight,
              }}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function parsePreviewScript(xml: string): ScriptData {
  const result = executeVomXml(xml);
  const composition =
    Array.isArray(result?.compositions) && result.compositions[0] ? result.compositions[0] : result;
  const script = dslToScriptData(composition, { type: "cue-count", secondsPerCue: 3 });

  // executeVomXml currently ignores <transition> elements in the browser parser.
  // Re-inject transitions into a unified timeline by parsing the raw XML.
  const timeline = [];
  const scenes = script.scenes ?? [];
  let sceneIndex = 0;

  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "text/xml");
  const root = doc.documentElement;
  const elements = Array.from(root.children);

  for (const el of elements) {
    if (el.tagName === "scene") {
      const s = scenes[sceneIndex];
      if (s) {
        timeline.push(s);
        sceneIndex++;
      }
    } else if (el.tagName === "transition") {
      const prevScene = sceneIndex > 0 ? scenes[sceneIndex - 1] : null;
      const nextScene = sceneIndex < scenes.length ? scenes[sceneIndex] : null;
      
      const durationAttr = el.getAttribute("duration");
      const durationStr = typeof durationAttr === "string" ? durationAttr.replace("f", "") : durationAttr;
      const durationFrames = durationStr ? parseFloat(durationStr) : 16;
      const durationSec = durationFrames / (script.fps ?? 30);
      
      const startSec = nextScene ? (nextScene.startSec ?? 0) : 0;
      const endSec = startSec + durationSec;
      
      const propsAttr = el.getAttribute("props");
      const props = propsAttr ? JSON.parse(propsAttr) : undefined;
      
      timeline.push({
        kind: "transition",
        id: el.getAttribute("id") || `trans-${sceneIndex}`,
        effect: el.getAttribute("effect") || "push",
        durationFrames: durationFrames,
        ease: el.getAttribute("ease"),
        props: props,
        startSec,
        endSec,
        fromSceneId: prevScene?.id,
        toSceneId: nextScene?.id
      });
    }
  }

  script.timeline = timeline;
  return script;
}

function mountTiPreview(container: HTMLElement, options: TiPreviewMountOptions): () => void {
  const theme = options.theme ?? "light";
  const xml = rethemeDslXml(options.xml, theme);
  const script = parsePreviewScript(xml);
  const width = script.meta?.width && script.meta.width > 0 ? script.meta.width : 1280;
  const height = script.meta?.height && script.meta.height > 0 ? script.meta.height : 720;
  const root = window.ReactDOM.createRoot(container);
  root.render(
    <TiPreviewPlayer
      audioSrc={options.audioSrc}
      autoPlay={options.autoPlay ?? false}
      height={height}
      rhythmOverlay={options.rhythmOverlay ?? false}
      script={script}
      width={width}
    />,
  );
  return () => root.unmount();
}

declare global {
  interface Window {
    mountTiPreview: typeof mountTiPreview;
    parseTiPreviewScript: typeof parsePreviewScript;
    rethemeTiPreviewXml: typeof rethemeDslXml;
  }
}

window.mountTiPreview = mountTiPreview;
window.parseTiPreviewScript = parsePreviewScript;
window.rethemeTiPreviewXml = rethemeDslXml;
