import { ScrollViewStyleReset } from 'expo-router/html';
import { type PropsWithChildren } from 'react';

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1, shrink-to-fit=no"
        />
        <title>EnviroSight Chicago</title>
        <meta name="description" content="Environmental Risk + Health + Equity for Chicago neighborhoods" />
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#075f43" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="EnviroSight" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
        <link rel="icon" type="image/png" href="/icon-192.png" />
        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: APP_CSS }} />
      </head>
      <body>
        <noscript>
          <div style={{ padding: 24, fontFamily: 'system-ui', textAlign: 'center' }}>
            EnviroSight Chicago needs JavaScript to load community-area risk data, satellite imagery, and live air quality.
          </div>
        </noscript>
        {children}
      </body>
    </html>
  );
}

const APP_CSS = `
  html, body {
    height: 100%;
    margin: 0;
    padding: 0;
    background-color: #f9fafb;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    -webkit-tap-highlight-color: transparent;
    overscroll-behavior-y: none;
    text-size-adjust: 100%;
    -webkit-text-size-adjust: 100%;
  }
  body {
    overflow-x: hidden;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  }
  /* When launched from the home screen on iOS, respect the notch */
  @supports (padding-top: env(safe-area-inset-top)) {
    body {
      padding-top: env(safe-area-inset-top);
      padding-bottom: env(safe-area-inset-bottom);
    }
  }
  /* Subtle scrollbar styling — visible but not distracting */
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-thumb { background: rgba(7, 95, 67, 0.25); border-radius: 999px; }
  ::-webkit-scrollbar-thumb:hover { background: rgba(7, 95, 67, 0.45); }
  ::-webkit-scrollbar-track { background: transparent; }

  /* Prevent text selection on interactive elements (more app-like) */
  button, [role="button"], a {
    -webkit-user-select: none;
    user-select: none;
    -webkit-touch-callout: none;
  }

  /* Smoother focus rings */
  :focus-visible {
    outline: 2px solid #075f43;
    outline-offset: 2px;
    border-radius: 4px;
  }
`;
