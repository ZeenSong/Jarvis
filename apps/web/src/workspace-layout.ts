export const defaultWorkspaceLayout = { activityVisible: true, inspectorVisible: true, panelWidth: 25 };
export function parseWorkspaceLayout(raw: string | null) {
  try {
    const value = JSON.parse(raw ?? "null");
    if (value && typeof value.activityVisible === "boolean" && typeof value.inspectorVisible === "boolean" &&
        Number.isInteger(value.panelWidth) && value.panelWidth >= 18 && value.panelWidth <= 30) {
      return { activityVisible: value.activityVisible as boolean, inspectorVisible: value.inspectorVisible as boolean, panelWidth: value.panelWidth as number };
    }
  } catch { /* Corrupt preferences must not prevent opening a workspace. */ }
  return { ...defaultWorkspaceLayout };
}
