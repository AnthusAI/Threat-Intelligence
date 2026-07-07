import type { Meta, StoryObj } from '@storybook/react';
import { THREAT_INTELLIGENCE_PICTOGRAM_REGISTRY } from './art';
import React from 'react';

const meta: Meta = {
  title: 'Threat Intelligence/Pictograms',
  parameters: {
    layout: 'fullscreen',
  },
};

export default meta;
type Story = StoryObj;

import { PICTOGRAM_PALETTE } from './system';

const timing = {
  cycleS: 20,
  phase: 0,
  prefersReducedMotion: false,
  delayS: (ms: number = 0) => ms / 1000,
};

export const AllPictograms: Story = {
  render: () => (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 p-8 max-w-7xl mx-auto">
      {Object.entries(THREAT_INTELLIGENCE_PICTOGRAM_REGISTRY).map(([slug, entry]) => (
        <div key={slug} className="flex flex-col border rounded-xl overflow-hidden bg-black/5 dark:bg-white/5 p-4">
          <h2 className="text-sm font-mono mb-4 truncate" title={slug}>
            {slug}
          </h2>
          <div className="aspect-square w-full relative bg-background rounded-lg border shadow-inner flex items-center justify-center">
            {entry.render({
              alt: slug,
              palette: PICTOGRAM_PALETTE,
              timing,
            })}
          </div>
        </div>
      ))}
    </div>
  ),
};
