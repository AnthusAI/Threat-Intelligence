import test from "node:test";
import assert from "node:assert/strict";

import {
  advanceScriptPreviewTime,
  computePreviewPlaybackState,
} from "../videoml/preview-timing.ts";

test("preview uses script timing when audio is absent", () => {
  const state = computePreviewPlaybackState({
    audioBlocked: false,
    audioDuration: null,
    audioProgressObserved: false,
    audioSrc: "",
    currentTime: 2.5,
    isPlaying: true,
    scriptDerivedDuration: 15,
  });

  assert.equal(state.hasAudioSource, false);
  assert.equal(state.useAudioClock, false);
  assert.equal(state.duration, 15);
  assert.equal(state.visualTime, 2.5);
  assert.equal(state.controlLabel, "Pause");
});

test("preview keeps script timing until audio is actually advancing", () => {
  const state = computePreviewPlaybackState({
    audioBlocked: false,
    audioDuration: 75,
    audioProgressObserved: false,
    audioSrc: "/seed-art/threat-intelligence/videos/how-to-play-games-securely-light.mp4",
    currentTime: 2.5,
    isPlaying: true,
    scriptDerivedDuration: 15,
  });

  assert.equal(state.hasAudioSource, true);
  assert.equal(state.audioReady, true);
  assert.equal(state.useAudioClock, false);
  assert.equal(state.duration, 15);
  assert.equal(state.visualTime, 2.5);
});

test("preview falls back cleanly when autoplay is blocked", () => {
  const state = computePreviewPlaybackState({
    audioBlocked: true,
    audioDuration: 75,
    audioProgressObserved: false,
    audioSrc: "/seed-art/threat-intelligence/videos/how-to-play-games-securely-light.mp4",
    currentTime: 2.5,
    isPlaying: false,
    scriptDerivedDuration: 15,
  });

  assert.equal(state.useAudioClock, false);
  assert.equal(state.duration, 15);
  assert.equal(state.controlLabel, "Play (audio)");
});

test("preview switches to audio timing once audio is advancing", () => {
  const state = computePreviewPlaybackState({
    audioBlocked: false,
    audioDuration: 75,
    audioProgressObserved: true,
    audioSrc: "/seed-art/threat-intelligence/videos/how-to-play-games-securely-light.mp4",
    currentTime: 10,
    isPlaying: true,
    scriptDerivedDuration: 15,
  });

  assert.equal(state.useAudioClock, true);
  assert.equal(state.duration, 75);
  assert.equal(state.visualTime, 2);
});

test("preview supports late recovery from script timing to audio timing", () => {
  const beforeRecovery = computePreviewPlaybackState({
    audioBlocked: false,
    audioDuration: 75,
    audioProgressObserved: false,
    audioSrc: "/seed-art/threat-intelligence/videos/how-to-play-games-securely-light.mp4",
    currentTime: 5,
    isPlaying: true,
    scriptDerivedDuration: 15,
  });
  const afterRecovery = computePreviewPlaybackState({
    audioBlocked: false,
    audioDuration: 75,
    audioProgressObserved: true,
    audioSrc: "/seed-art/threat-intelligence/videos/how-to-play-games-securely-light.mp4",
    currentTime: 5,
    isPlaying: true,
    scriptDerivedDuration: 15,
  });

  assert.equal(beforeRecovery.useAudioClock, false);
  assert.equal(beforeRecovery.visualTime, 5);
  assert.equal(afterRecovery.useAudioClock, true);
  assert.equal(afterRecovery.visualTime, 1);
});

test("script timing wraps cleanly at the end of the preview", () => {
  assert.equal(advanceScriptPreviewTime(14.8, 0.5, 15), 0);
});
