/** True when the browser mock API stands in for the backend (no VITE_API_BASE_URL, or forced). */
export const IS_MOCK: boolean =
  import.meta.env?.VITE_MOCK_API === "true" || !import.meta.env?.VITE_API_BASE_URL;
