"use client";

import { useEffect, useRef } from "react";
import { PICTOGRAM_STROKE, PictogramLabel } from "./pictogram-glyphs";

/*
 * The balance is driven as a small physical system rather than keyframes: the beam is an underdamped spring
 * pulled toward an angle set by how many cheap attempts have landed in the left pan, each landing gives it a
 * knock, and the pans hang from the beam ends and swing against its motion. One loop follows the four beats of
 * the figure system: establish, travel (attempts fall in), resolve (the beam settles level), hold, then reset.
 */

const LOOP_DURATION_MILLISECONDS = 4200;
const ATTEMPTS_START_FALLING_AT_MILLISECONDS = 420;
const MILLISECONDS_BETWEEN_ATTEMPTS = 160;
const ATTEMPT_FALL_DURATION_MILLISECONDS = 300;
const ATTEMPT_FALL_HEIGHT = 74;
const ATTEMPT_LANDING_BOUNCE_HEIGHT = 3;
const ATTEMPT_LANDING_BOUNCE_DURATION_MILLISECONDS = 140;
const ATTEMPTS_LEAVE_AT_MILLISECONDS = 3720;
const ATTEMPTS_LEAVE_DURATION_MILLISECONDS = 260;

const BEAM_PIVOT_X = 360;
const BEAM_PIVOT_Y = 250;
const BEAM_HALF_LENGTH = 210;
const PAN_HANGER_DISTANCE_FROM_PIVOT = 181.7;
const BEAM_ANGLE_WHEN_ATTACKERS_OUTWEIGH_DEGREES = -7.86;
const BEAM_ANGLE_AT_REST_DEGREES = 0;
const BEAM_SPRING_STIFFNESS = 64;
const BEAM_SPRING_DAMPING = 6.2;
const BEAM_KNOCK_PER_LANDING_DEGREES_PER_SECOND = -16;
const PAN_SWING_PER_BEAM_VELOCITY = -0.055;
const PAN_SWING_LIMIT_DEGREES = 4;
const LONGEST_SIMULATION_STEP_SECONDS = 1 / 30;

const ATTACKER_POSITIONS_X = [122, 141, 160, 179, 198, 217, 236];
const LEFT_PAN_HANGER_AS_DRAWN = { x: 180, y: 274.9 };
const RIGHT_PAN_HANGER_AS_DRAWN = { x: 540, y: 225.1 };

type BeamState = { angleDegrees: number; angularVelocityDegreesPerSecond: number };

function degreesToRadians(angleDegrees: number): number {
  return (angleDegrees * Math.PI) / 180;
}

function panHangerPosition(side: "left" | "right", beamAngleDegrees: number): { x: number; y: number } {
  const direction = side === "left" ? -1 : 1;
  const beamAngleRadians = degreesToRadians(beamAngleDegrees);
  return {
    x: BEAM_PIVOT_X + direction * PAN_HANGER_DISTANCE_FROM_PIVOT * Math.cos(beamAngleRadians),
    y: BEAM_PIVOT_Y + direction * PAN_HANGER_DISTANCE_FROM_PIVOT * Math.sin(beamAngleRadians),
  };
}

function landingTimeForAttempt(attemptIndex: number): number {
  return ATTEMPTS_START_FALLING_AT_MILLISECONDS + attemptIndex * MILLISECONDS_BETWEEN_ATTEMPTS + ATTEMPT_FALL_DURATION_MILLISECONDS;
}

function countAttemptsLandedAt(loopTimeMilliseconds: number): number {
  if (loopTimeMilliseconds >= ATTEMPTS_LEAVE_AT_MILLISECONDS) return 0;
  return ATTACKER_POSITIONS_X.filter((_, attemptIndex) => loopTimeMilliseconds >= landingTimeForAttempt(attemptIndex)).length;
}

function describeAttemptAt(attemptIndex: number, loopTimeMilliseconds: number): { offsetY: number; opacity: number } {
  const fallStart = ATTEMPTS_START_FALLING_AT_MILLISECONDS + attemptIndex * MILLISECONDS_BETWEEN_ATTEMPTS;
  const landing = fallStart + ATTEMPT_FALL_DURATION_MILLISECONDS;
  if (loopTimeMilliseconds < fallStart) return { offsetY: -ATTEMPT_FALL_HEIGHT, opacity: 0 };
  if (loopTimeMilliseconds < landing) {
    const fallProgress = (loopTimeMilliseconds - fallStart) / ATTEMPT_FALL_DURATION_MILLISECONDS;
    return { offsetY: -ATTEMPT_FALL_HEIGHT * (1 - fallProgress * fallProgress), opacity: Math.min(1, fallProgress * 2.5) };
  }
  if (loopTimeMilliseconds < ATTEMPTS_LEAVE_AT_MILLISECONDS) {
    const timeSinceLanding = loopTimeMilliseconds - landing;
    const bounceProgress = timeSinceLanding / ATTEMPT_LANDING_BOUNCE_DURATION_MILLISECONDS;
    const bounceOffset = bounceProgress < 1 ? -ATTEMPT_LANDING_BOUNCE_HEIGHT * Math.sin(Math.PI * bounceProgress) : 0;
    return { offsetY: bounceOffset, opacity: 1 };
  }
  const leaveProgress = Math.min(1, (loopTimeMilliseconds - ATTEMPTS_LEAVE_AT_MILLISECONDS) / ATTEMPTS_LEAVE_DURATION_MILLISECONDS);
  return { offsetY: -10 * leaveProgress, opacity: 1 - leaveProgress };
}

function targetBeamAngleAt(loopTimeMilliseconds: number): number {
  const shareOfAttemptsLanded = countAttemptsLandedAt(loopTimeMilliseconds) / ATTACKER_POSITIONS_X.length;
  return BEAM_ANGLE_AT_REST_DEGREES + shareOfAttemptsLanded * (BEAM_ANGLE_WHEN_ATTACKERS_OUTWEIGH_DEGREES - BEAM_ANGLE_AT_REST_DEGREES);
}

function advanceBeamSpring(beamState: BeamState, targetAngleDegrees: number, stepSeconds: number): BeamState {
  const angularAcceleration =
    -BEAM_SPRING_STIFFNESS * (beamState.angleDegrees - targetAngleDegrees) - BEAM_SPRING_DAMPING * beamState.angularVelocityDegreesPerSecond;
  const angularVelocityDegreesPerSecond = beamState.angularVelocityDegreesPerSecond + angularAcceleration * stepSeconds;
  return { angleDegrees: beamState.angleDegrees + angularVelocityDegreesPerSecond * stepSeconds, angularVelocityDegreesPerSecond };
}

function panTransform(side: "left" | "right", beamState: BeamState): string {
  const hangerAsDrawn = side === "left" ? LEFT_PAN_HANGER_AS_DRAWN : RIGHT_PAN_HANGER_AS_DRAWN;
  const hangerNow = panHangerPosition(side, beamState.angleDegrees);
  const swingDegrees = Math.max(
    -PAN_SWING_LIMIT_DEGREES,
    Math.min(PAN_SWING_LIMIT_DEGREES, beamState.angularVelocityDegreesPerSecond * PAN_SWING_PER_BEAM_VELOCITY),
  );
  return `translate(${(hangerNow.x - hangerAsDrawn.x).toFixed(2)} ${(hangerNow.y - hangerAsDrawn.y).toFixed(2)}) rotate(${swingDegrees.toFixed(2)} ${hangerAsDrawn.x} ${hangerAsDrawn.y})`;
}

export function BalanceOfPowerFigure({ accessibleDescription }: { accessibleDescription: string }) {
  const canvasReference = useRef<SVGSVGElement | null>(null);
  const beamReference = useRef<SVGGElement | null>(null);
  const leftPanReference = useRef<SVGGElement | null>(null);
  const rightPanReference = useRef<SVGGElement | null>(null);
  const attemptReferences = useRef<Array<SVGGElement | null>>([]);

  useEffect(() => {
    const canvasElement = canvasReference.current;
    if (!canvasElement) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const plateElement = canvasElement.closest(".pictogram-plate");
    let beamState: BeamState = { angleDegrees: BEAM_ANGLE_AT_REST_DEGREES, angularVelocityDegreesPerSecond: 0 };
    let elapsedVisibleMilliseconds = 0;
    let previousTimestamp: number | null = null;
    let previousAttemptsLanded = 0;
    let animationFrameRequest = 0;

    const renderFrame = (timestamp: number) => {
      animationFrameRequest = window.requestAnimationFrame(renderFrame);
      if (plateElement?.classList.contains("figure-offscreen")) {
        previousTimestamp = null;
        return;
      }
      const stepSeconds = previousTimestamp === null ? 0 : Math.min(LONGEST_SIMULATION_STEP_SECONDS, (timestamp - previousTimestamp) / 1000);
      previousTimestamp = timestamp;
      elapsedVisibleMilliseconds += stepSeconds * 1000;
      const loopTimeMilliseconds = elapsedVisibleMilliseconds % LOOP_DURATION_MILLISECONDS;

      const attemptsLanded = countAttemptsLandedAt(loopTimeMilliseconds);
      if (attemptsLanded > previousAttemptsLanded) {
        beamState = {
          ...beamState,
          angularVelocityDegreesPerSecond:
            beamState.angularVelocityDegreesPerSecond + BEAM_KNOCK_PER_LANDING_DEGREES_PER_SECOND * (attemptsLanded - previousAttemptsLanded),
        };
      }
      previousAttemptsLanded = attemptsLanded;
      beamState = advanceBeamSpring(beamState, targetBeamAngleAt(loopTimeMilliseconds), stepSeconds);

      beamReference.current?.setAttribute("transform", `rotate(${beamState.angleDegrees.toFixed(3)} ${BEAM_PIVOT_X} ${BEAM_PIVOT_Y})`);
      leftPanReference.current?.setAttribute("transform", panTransform("left", beamState));
      rightPanReference.current?.setAttribute("transform", panTransform("right", beamState));
      attemptReferences.current.forEach((attemptElement, attemptIndex) => {
        if (!attemptElement) return;
        const attempt = describeAttemptAt(attemptIndex, loopTimeMilliseconds);
        attemptElement.setAttribute("transform", `translate(0 ${attempt.offsetY.toFixed(2)})`);
        attemptElement.setAttribute("opacity", attempt.opacity.toFixed(3));
      });
    };

    animationFrameRequest = window.requestAnimationFrame(renderFrame);
    return () => window.cancelAnimationFrame(animationFrameRequest);
  }, []);

  return (
    <svg aria-label={accessibleDescription} className="pictogram-canvas" ref={canvasReference} role="img" viewBox="0 0 720 380">
      <line className="s-ghost" strokeWidth={PICTOGRAM_STROKE.object} x1="80" x2="640" y1="330" y2="330" />
      <polygon className="f-fill s-line" points="325,330 395,330 360,250" strokeWidth={PICTOGRAM_STROKE.object} />
      <g ref={beamReference} transform={`rotate(${BEAM_ANGLE_WHEN_ATTACKERS_OUTWEIGH_DEGREES} ${BEAM_PIVOT_X} ${BEAM_PIVOT_Y})`}>
        <line
          className="s-line"
          strokeLinecap="round"
          strokeWidth={PICTOGRAM_STROKE.structure}
          x1={BEAM_PIVOT_X - BEAM_HALF_LENGTH}
          x2={BEAM_PIVOT_X + BEAM_HALF_LENGTH}
          y1={BEAM_PIVOT_Y}
          y2={BEAM_PIVOT_Y}
        />
      </g>
      <circle className="f-line" cx={BEAM_PIVOT_X} cy={BEAM_PIVOT_Y} r="4" />
      <g ref={leftPanReference}>
        <path className="f-none s-muted" d="M180 275 V284 M110 284 H250 M110 284 V318 M250 284 V318" strokeWidth="1" />
        <line className="s-line" strokeWidth={PICTOGRAM_STROKE.signalHeavy} x1="100" x2="260" y1="318" y2="318" />
        <g className="f-signal">
          {ATTACKER_POSITIONS_X.map((attackerX, attemptIndex) => (
            <g
              key={attackerX}
              ref={(attemptElement) => {
                attemptReferences.current[attemptIndex] = attemptElement;
              }}
            >
              <circle cx={attackerX} cy="301" r="5" />
              <path d={`M${attackerX - 6} 317 Q${attackerX} 303 ${attackerX + 6} 317 Z`} />
            </g>
          ))}
        </g>
      </g>
      <g ref={rightPanReference}>
        <path className="f-none s-muted" d="M540 225 V232 M495 232 H585 M495 232 V272 M585 232 V272" strokeWidth="1" />
        <line className="s-line" strokeWidth={PICTOGRAM_STROKE.signalHeavy} x1="485" x2="595" y1="272" y2="272" />
        <circle className="f-text" cx="540" cy="248" r="9" />
        <path className="f-text" d="M526 271 Q540 246 554 271 Z" />
      </g>
      <PictogramLabel tone="muted" x={180} y={358}>MANY CHEAP ATTEMPTS</PictogramLabel>
      <PictogramLabel tone="muted" x={540} y={358}>ONE RARE, CAPABLE ADVERSARY</PictogramLabel>
    </svg>
  );
}
