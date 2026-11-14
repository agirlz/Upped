// Outline icon set (24px grid, 2px stroke) matching the Upped design system.

const paths: Record<string, React.ReactNode> = {
  home: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />,
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.6-3.4 3.2-5.5 6.5-5.5s5.9 2.1 6.5 5.5" />
      <path d="M16 4.8a3.3 3.3 0 0 1 0 6.4M18 14.8c1.9.7 3.1 2.5 3.5 5.2" />
    </>
  ),
  crown: <path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z" />,
  trophy: (
    <>
      <path d="M7 4h10v5a5 5 0 0 1-10 0z" />
      <path d="M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4M12 14v3M8 21h8M9.5 17h5l.5 4h-6z" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="1" />
    </>
  ),
  play: <path d="M7 4.5v15l12-7.5z" />,
  comment: <path d="M4 5h16v11H9l-5 4z" />,
  heart: <path d="M12 20s-7.5-4.5-8.8-9.2A4.6 4.6 0 0 1 12 7.2a4.6 4.6 0 0 1 8.8 3.6C19.5 15.5 12 20 12 20z" />,
  share: <path d="M12 15V3M7.5 7.5 12 3l4.5 4.5M5 12v8h14v-8" />,
  more: (
    <>
      <circle cx="5" cy="12" r="1.2" />
      <circle cx="12" cy="12" r="1.2" />
      <circle cx="19" cy="12" r="1.2" />
    </>
  ),
  camera: (
    <>
      <rect x="2.5" y="6" width="13" height="12" rx="2" />
      <path d="M15.5 10.5 21.5 7v10l-6-3.5z" />
    </>
  ),
  chart: <path d="M4 20V10M10 20V4M16 20v-7M21 20H3" />,
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c.8-4 3.9-6.5 8-6.5s7.2 2.5 8 6.5" />
    </>
  ),
  chevron: <path d="M9 5l7 7-7 7" />,
  back: <path d="M15 5l-7 7 7 7" />,
  check: <path d="M4.5 12.5 9.5 17.5 19.5 6.5" />,
  upRight: <path d="M7 17 17 7M8 7h9v9" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  flame: <path d="M12 21c-3.9 0-6.5-2.6-6.5-6.2 0-3.3 2.6-5.3 3.6-8.8 1.8 1.4 2.4 3 2.4 4.6 1-.7 1.7-1.9 1.8-3.4 2.6 2 4.2 4.8 4.2 7.6 0 3.6-2.6 6.2-5.5 6.2z" />,
  flag: <path d="M5 21V4M5 4h11l-2 4 2 4H5" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  hoop: (
    <>
      <rect x="4" y="3" width="16" height="9" rx="1" />
      <path d="M8 12h8l-1.3 8h-5.4zM9 15h6M10 12l1 8M14 12l-1 8" />
    </>
  ),
  basket: <path d="M4 8h16l-2 13H6zM3 8h18M8 8l1 13M16 8l-1 13M12 8v13M5 12.5h14M5.6 17h12.8" />,
  bulb: <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z" />,
  sound: <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4zM16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11" />,
  mute: <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4zM16 9.5l5 5M21 9.5l-5 5" />,
  replay: <path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4.5h4.5" />,
  equals: <path d="M5 9h14M5 15h14" />,
  pin: (
    <>
      <path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z" />
      <circle cx="12" cy="10" r="2.3" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
};

export type IconName = keyof typeof paths;

export function Icon({ name, size = 20, className }: { name: IconName | string; size?: number; className?: string }) {
  return (
    <svg
      className={`icon ${className ?? ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

/** The UPPED wordmark with its crown. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <span className="logo-mark" style={{ fontSize: size }}>
      <svg className="logo-crown" viewBox="0 0 24 14" width={size * 0.7} height={size * 0.42} aria-hidden="true">
        <path d="M2 12 1 2l6 5 5-6 5 6 6-5-1 10z" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
      </svg>
      UPPED
    </span>
  );
}
