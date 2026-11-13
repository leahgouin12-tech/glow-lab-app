import { useCallback } from 'react';
import { restore, softDelete } from '../db/repo';
import type { TableName } from '../db/schema';
import { useToast } from './primitives';

/**
 * Deleting a row is a soft delete, so the only honest apology is a way back.
 * This pairs the removal with an undo in the same gesture; the row stays
 * recoverable in Settings afterwards too, if the toast is missed.
 */
export function useUndoDelete() {
  const toast = useToast();
  return useCallback(
    async (table: TableName, id: string, label: string) => {
      await softDelete(table, id);
      toast(`Moved “${label}” to deleted records.`, {
        tone: 'ok',
        action: {
          label: 'Undo',
          onClick: () =>
            void restore(table, id).then(() => toast(`“${label}” is back.`, 'ok'))
        }
      });
    },
    [toast]
  );
}
