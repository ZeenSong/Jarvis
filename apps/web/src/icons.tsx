/** Small, controlled outline icon set shared by the product navigation. */
export function NavigationIcon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    home: "M3 10 12 3l9 7M5 9v12h5v-7h4v7h5V9",
    spaces: "M3 7V5h6l2 2h10v13H3V7Z",
    apps: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
    tasks: "M8 3h8v4H8zM8 5H5v16h14V5h-3M8 13l3 3 5-6",
    jarvis: "M21 11a9 9 0 0 1-9 9H5l-3 2 1-6a9 9 0 1 1 18-5ZM8 11h.01M12 11h.01M16 11h.01",
    system: "M4 4h16v6H4zM4 14h16v6H4zM7 7h.01M7 17h.01M15 7h3M15 17h3",
  };
  return <svg aria-hidden="true" focusable="false" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name] ?? paths.apps} /></svg>;
}
