import theme from './theme.css?raw';

// Read the actual Tailwind theme, not a second list of token values.
export const themeTokens = Object.fromEntries(
  [...theme.matchAll(/^\s+(--[\w-]+):\s*([^;]+);$/gm)].flatMap(([, name, value]) =>
    name && value ? [[name, value] as const] : [],
  ),
);
