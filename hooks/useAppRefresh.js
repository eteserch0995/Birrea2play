import { useCallback, useState } from 'react';

/**
 * Pull-to-refresh helper.
 * Usage:
 *   const { refreshing, onRefresh } = useAppRefresh(fetchData);
 *   <FlatList refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />} ... />
 */
export function useAppRefresh(fetchFn) {
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetchFn();
    } finally {
      setRefreshing(false);
    }
  }, [fetchFn]);

  return { refreshing, onRefresh };
}
