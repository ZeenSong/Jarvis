/** Small, controlled outline icon set shared by the product navigation. */
export function NavigationIcon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    home: "M3 10 12 3l9 7M5 9v12h5v-7h4v7h5V9",
    spaces: "M3 7V5h6l2 2h10v13H3V7Z",
    apps: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
    tasks: "M8 3h8v4H8zM8 5H5v16h14V5h-3M8 13l3 3 5-6",
    jarvis: "M21 11a9 9 0 0 1-9 9H5l-3 2 1-6a9 9 0 1 1 18-5ZM8 11h.01M12 11h.01M16 11h.01",
    system: "M4 4h16v6H4zM4 14h16v6H4zM7 7h.01M7 17h.01M15 7h3M15 17h3",
    settings: "M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7ZM19 13.5v-3l-2-.6a7 7 0 0 0-.8-1.9l.9-1.9-2.1-2.1-1.9.9a7 7 0 0 0-1.9-.8L10.5 2h-3l-.6 2a7 7 0 0 0-1.9.8l-1.9-.9L1 6l.9 1.9a7 7 0 0 0-.8 1.9l-2 .6v3l2 .6a7 7 0 0 0 .8 1.9L1 17.8l2.1 2.1 1.9-.9a7 7 0 0 0 1.9.8l.6 2h3l.6-2a7 7 0 0 0 1.9-.8l1.9.9 2.1-2.1-.9-1.9a7 7 0 0 0 .8-1.9l2-.6Z",
  };
  return <svg aria-hidden="true" focusable="false" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name] ?? paths.apps} /></svg>;
}
