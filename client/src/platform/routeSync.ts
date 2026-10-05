import { leaveRoom } from './net/actions';
import { routeCode, useRouter } from './router';
import { usePlatformStore } from './store/usePlatformStore';

/**
 * Keeps the store in step with the address bar whatever moved it: the Back button, the brand
 * link or any navigate(). A route that no longer names the room leaves the room (the URL is
 * already where the user went, so resetRoom leaves it alone), and a join error stays on the page
 * that raised it instead of greeting the user on the next game's home. Returns the unsubscribe.
 */
export function startRouteSync(): () => void {
  return useRouter.subscribe(({ route }) => {
    const store = usePlatformStore.getState();
    if (store.room && routeCode(route) !== store.room.code) leaveRoom();
    else if (store.joinError) store.clearJoinError();
  });
}
