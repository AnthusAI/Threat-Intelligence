"use client";

import { useEffect, type RefObject } from "react";

/*
 * Figures are choreographed in script rather than with independent CSS keyframes so that every beat is caused by
 * the one before it: a target lights only when the signal head actually reaches it, arrowheads land as the path
 * passes them, and the signal fades out instead of snapping off. Every figure shares the four-beat 4.2s loop.
 */

export const FIGURE_LOOP_MILLISECONDS = 4200;
export const ESTABLISH_ENDS_AT_MILLISECONDS = 420;
export const TRAVEL_ENDS_AT_MILLISECONDS = 1680;
export const RESOLVE_ENDS_AT_MILLISECONDS = 1930;
export const HOLD_ENDS_AT_MILLISECONDS = 3780;
export const RESOLVED_FRAME_MILLISECONDS = 2600;
const LONGEST_FRAME_STEP_MILLISECONDS = 1000 / 30;

export function createCubicBezierEasing(controlX1: number, controlY1: number, controlX2: number, controlY2: number) {
  const bezierCoordinate = (progress: number, control1: number, control2: number) =>
    3 * (1 - progress) * (1 - progress) * progress * control1 + 3 * (1 - progress) * progress * progress * control2 + progress * progress * progress;
  const bezierSlope = (progress: number, control1: number, control2: number) =>
    3 * (1 - progress) * (1 - progress) * control1 + 6 * (1 - progress) * progress * (control2 - control1) + 3 * progress * progress * (1 - control2);
  return (time: number): number => {
    if (time <= 0) return 0;
    if (time >= 1) return 1;
    let curveParameter = time;
    for (let iteration = 0; iteration < 8; iteration += 1) {
      const slope = bezierSlope(curveParameter, controlX1, controlX2);
      if (Math.abs(slope) < 1e-6) break;
      curveParameter -= (bezierCoordinate(curveParameter, controlX1, controlX2) - time) / slope;
      curveParameter = Math.min(1, Math.max(0, curveParameter));
    }
    return bezierCoordinate(curveParameter, controlY1, controlY2);
  };
}

export const easeSignalTravel = createCubicBezierEasing(0.2, 0.7, 0.2, 1);
export const easeOut = createCubicBezierEasing(0, 0, 0.58, 1);

export function easeOutWithOvershoot(progress: number): number {
  const overshoot = 1.9;
  const shifted = progress - 1;
  return 1 + (overshoot + 1) * shifted * shifted * shifted + overshoot * shifted * shifted;
}

export function progressBetween(loopTimeMilliseconds: number, startMilliseconds: number, durationMilliseconds: number): number {
  return Math.min(1, Math.max(0, (loopTimeMilliseconds - startMilliseconds) / durationMilliseconds));
}

export function signalFadeOpacityAt(loopTimeMilliseconds: number): number {
  return 1 - easeOut(progressBetween(loopTimeMilliseconds, HOLD_ENDS_AT_MILLISECONDS, FIGURE_LOOP_MILLISECONDS - HOLD_ENDS_AT_MILLISECONDS));
}

export function findChoreographedElements<ElementType extends SVGElement>(canvas: SVGSVGElement, motionRole: string): ElementType[] {
  return Array.from(canvas.querySelectorAll<ElementType>(`[data-motion="${motionRole}"]`));
}

export function drawPathUpTo(path: SVGGeometryElement, drawnShare: number) {
  const pathLength = path.getTotalLength();
  path.style.strokeDasharray = `${pathLength} ${pathLength}`;
  path.style.strokeDashoffset = `${pathLength * (1 - drawnShare)}`;
}

export function placeSignalHeadOnPath(signalHead: SVGCircleElement, path: SVGGeometryElement, drawnShare: number, visible: boolean) {
  const headPoint = path.getPointAtLength(path.getTotalLength() * drawnShare);
  signalHead.setAttribute("cx", headPoint.x.toFixed(2));
  signalHead.setAttribute("cy", headPoint.y.toFixed(2));
  signalHead.style.opacity = visible ? "1" : "0";
}

export function scaleAboutPoint(element: SVGElement, scale: number, centerX: number, centerY: number) {
  element.setAttribute("transform", `translate(${centerX} ${centerY}) scale(${scale.toFixed(3)}) translate(${-centerX} ${-centerY})`);
}

export function popIn(element: SVGGraphicsElement, popProgress: number, fadeOpacity: number) {
  const bounds = element.getBBox();
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  const scale = popProgress <= 0 ? 0.001 : easeOutWithOvershoot(popProgress);
  scaleAboutPoint(element, Math.max(0.001, scale), centerX, centerY);
  element.style.opacity = `${Math.min(1, popProgress * 3) * fadeOpacity}`;
}

export function usePictogramChoreography(
  canvasReference: RefObject<SVGSVGElement | null>,
  choreographFrame: (canvas: SVGSVGElement, loopTimeMilliseconds: number) => void,
) {
  useEffect(() => {
    const canvas = canvasReference.current;
    if (!canvas) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      choreographFrame(canvas, RESOLVED_FRAME_MILLISECONDS);
      return;
    }
    const plateElement = canvas.closest(".pictogram-plate");
    let elapsedVisibleMilliseconds = 0;
    let previousTimestamp: number | null = null;
    let animationFrameRequest = 0;
    choreographFrame(canvas, 0);
    const renderFrame = (timestamp: number) => {
      animationFrameRequest = window.requestAnimationFrame(renderFrame);
      if (plateElement?.classList.contains("figure-offscreen")) {
        previousTimestamp = null;
        return;
      }
      const frameStep = previousTimestamp === null ? 0 : Math.min(LONGEST_FRAME_STEP_MILLISECONDS, timestamp - previousTimestamp);
      previousTimestamp = timestamp;
      elapsedVisibleMilliseconds += frameStep;
      choreographFrame(canvas, elapsedVisibleMilliseconds % FIGURE_LOOP_MILLISECONDS);
    };
    animationFrameRequest = window.requestAnimationFrame(renderFrame);
    return () => window.cancelAnimationFrame(animationFrameRequest);
  }, [canvasReference, choreographFrame]);
}
