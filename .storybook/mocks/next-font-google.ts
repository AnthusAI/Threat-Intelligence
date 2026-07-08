type MockFont = {
  style: { fontFamily: string };
  variable: string;
  className: string;
};

function mockFont(_config?: Record<string, unknown>): MockFont {
  return {
    style: { fontFamily: '"Inter", system-ui, sans-serif' },
    variable: "--font-mock",
    className: "font-mock",
  };
}

export const IBM_Plex_Serif = mockFont;
export const Inter = mockFont;
export const Playfair_Display = mockFont;
export const Plus_Jakarta_Sans = mockFont;
