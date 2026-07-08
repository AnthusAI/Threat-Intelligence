import React, { useEffect } from 'react';
import type { Preview } from '@storybook/react'
import { applyReaderTheme } from '@/components/reader-settings';
import type { ReaderThemeSetting } from '@/components/reader-settings';
import '../app/globals.css';

const preview: Preview = {
  parameters: {
    papyrusTheme: 'dark',
    controls: {
      matchers: {
       color: /(background|color)$/i,
       date: /Date$/i,
      },
    },
  },
};

preview.decorators = [
  (Story, context) => {
    const theme = (context.parameters.papyrusTheme as ReaderThemeSetting | undefined) ?? 'dark';
    useEffect(() => {
      document.documentElement.setAttribute('data-site-brand', 'threat-intelligence');
      applyReaderTheme(theme);
    }, [theme]);
    return (
      <div className="min-h-screen text-[color:var(--foreground)] bg-[color:var(--background)]">
        <Story />
      </div>
    );
  },
];

export default preview;