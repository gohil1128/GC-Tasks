import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
  False during server rendering and hydration, true after. The theme is only
  known in the browser, so anything that shows the current choice waits for
  this rather than rendering a guess the server and browser disagree on.
*/
export function useMounted(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
