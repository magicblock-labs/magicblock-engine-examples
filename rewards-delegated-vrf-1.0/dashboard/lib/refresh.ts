export const DASHBOARD_DATA_REFRESH_EVENT = "dashboard-data-refresh";

export function requestDashboardDataRefresh(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent(DASHBOARD_DATA_REFRESH_EVENT));
}
