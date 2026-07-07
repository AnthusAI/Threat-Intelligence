import React, { useEffect } from 'react';
import type { Preview } from '@storybook/react'
import '../app/globals.css';

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
       color: /(background|color)$/i,
       date: /Date$/i,
      },
    },
  },
};

preview.decorators = [
  (Story) => {
    useEffect(() => {
      document.documentElement.setAttribute('data-site-brand', 'threat-intelligence');
      document.documentElement.classList.add('dark-theme');
    }, []);
    return (
      <div className="min-h-screen text-[color:var(--foreground)] bg-[color:var(--background)]">
        <Story />
      </div>
    );
  },
];

export default preview;