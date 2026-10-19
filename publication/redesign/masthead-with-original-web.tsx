"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { BlogPageBackground } from "../blog-defense/page-background";
import type { LayoutRect } from "../blog-defense/layout";
import { PUBLICATION_TAGLINE } from "./publication-identity";

const MASTHEAD_TEXT_OBSTACLE_SELECTOR = "[data-masthead-obstacle]";
const OBSTACLE_CLEARANCE_PIXELS = 10;

function measureTextExtent(element: HTMLElement): DOMRect {
  const range = document.createRange();
  range.selectNodeContents(element);
  const textRect = range.getBoundingClientRect();
  range.detach();
  return textRect.width > 0 && textRect.height > 0 ? textRect : element.getBoundingClientRect();
}

function useMastheadTextObstacles(mastheadReference: RefObject<HTMLElement | null>): LayoutRect[] {
  const [textObstacles, setTextObstacles] = useState<LayoutRect[]>([]);
  useEffect(() => {
    const mastheadElement = mastheadReference.current;
    if (!mastheadElement) return;
    const measureTextObstacles = () => {
      const webLayer = mastheadElement.querySelector<HTMLElement>(".blog-page-background");
      const webLayerRect = webLayer?.getBoundingClientRect();
      if (!webLayerRect) return;
      const measuredObstacles = Array.from(mastheadElement.querySelectorAll<HTMLElement>(MASTHEAD_TEXT_OBSTACLE_SELECTOR)).map((element) => {
        const textRect = measureTextExtent(element);
        return {
          x: textRect.left - webLayerRect.left - OBSTACLE_CLEARANCE_PIXELS,
          y: textRect.top - webLayerRect.top - OBSTACLE_CLEARANCE_PIXELS,
          width: textRect.width + OBSTACLE_CLEARANCE_PIXELS * 2,
          height: textRect.height + OBSTACLE_CLEARANCE_PIXELS * 2,
        };
      });
      const mastheadRect = mastheadElement.getBoundingClientRect();
      const contentColumnBelowMasthead = {
        x: 0,
        y: mastheadRect.bottom - webLayerRect.top,
        width: mastheadRect.right - webLayerRect.left,
        height: webLayerRect.height,
      };
      const allObstacles = [...measuredObstacles, contentColumnBelowMasthead];
      setTextObstacles((previousObstacles) =>
        JSON.stringify(previousObstacles) === JSON.stringify(allObstacles) ? previousObstacles : allObstacles,
      );
    };
    measureTextObstacles();
    const resizeObserver = new ResizeObserver(measureTextObstacles);
    resizeObserver.observe(mastheadElement);
    void document.fonts?.ready.then(measureTextObstacles);
    return () => resizeObserver.disconnect();
  }, [mastheadReference]);
  return textObstacles;
}

export function MastheadWithOriginalWeb() {
  const mastheadReference = useRef<HTMLElement | null>(null);
  const textObstacles = useMastheadTextObstacles(mastheadReference);
  return (
    <section aria-labelledby="ti-masthead-wordmark" className="ti-masthead" ref={mastheadReference}>
      <div className="ti-masthead__web">
        <BlogPageBackground headerObstacles={textObstacles} pageRef={mastheadReference} />
      </div>
      <div className="ti-masthead__copy">
        <h1 className="ti-masthead__wordmark" data-masthead-obstacle="" id="ti-masthead-wordmark">
          Threat Intelligence
        </h1>
        <p className="ti-masthead__tagline" data-masthead-obstacle="">
          {PUBLICATION_TAGLINE.replace(/\.$/, "")}
        </p>
      </div>
    </section>
  );
}
