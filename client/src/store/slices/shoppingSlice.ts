import { shoppingApi } from '../../api/client'
import type { StoreApi } from 'zustand'
import type { TripStoreState } from '../tripStore'
import type { ShoppingItem } from '../../types'
import type { ShoppingCreateItemRequest, ShoppingUpdateItemRequest } from '@trek/shared'
import { getApiErrorMessage } from '../../types'
import { notify } from '../notify'

type SetState = StoreApi<TripStoreState>['setState']
type GetState = StoreApi<TripStoreState>['getState']

export interface ShoppingSlice {
  addShoppingItem: (tripId: number | string, data: ShoppingCreateItemRequest) => Promise<ShoppingItem>
  updateShoppingItem: (tripId: number | string, id: number, data: ShoppingUpdateItemRequest) => Promise<ShoppingItem>
  deleteShoppingItem: (tripId: number | string, id: number) => Promise<void>
  toggleShoppingItem: (tripId: number | string, id: number, checked: boolean) => Promise<void>
  clearCheckedShoppingItems: (tripId: number | string) => Promise<void>
  reorderShoppingItems: (tripId: number | string, orderedIds: number[]) => Promise<void>
}

/**
 * Mirrors the server's ON DELETE SET NULL on shopping_items.budget_item_id: once an
 * expense is deleted, the items it booked are open for booking again.
 */
export function unlinkShoppingFromBudget(items: ShoppingItem[], budgetItemId: number): ShoppingItem[] {
  return items.some(i => i.budget_item_id === budgetItemId)
    ? items.map(i => (i.budget_item_id === budgetItemId ? { ...i, budget_item_id: null } : i))
    : items
}

export const createShoppingSlice = (set: SetState, get: GetState): ShoppingSlice => ({
  addShoppingItem: async (tripId, data) => {
    try {
      const result = await shoppingApi.create(tripId, data)
      set(state => ({ shoppingItems: [...state.shoppingItems, result.item] }))
      return result.item
    } catch (err: unknown) {
      throw new Error(getApiErrorMessage(err, 'Error adding shopping item'))
    }
  },

  updateShoppingItem: async (tripId, id, data) => {
    try {
      const result = await shoppingApi.update(tripId, id, data)
      set(state => ({
        shoppingItems: state.shoppingItems.map(item => item.id === id ? result.item : item),
      }))
      return result.item
    } catch (err: unknown) {
      throw new Error(getApiErrorMessage(err, 'Error updating shopping item'))
    }
  },

  deleteShoppingItem: async (tripId, id) => {
    const prev = get().shoppingItems
    set(state => ({ shoppingItems: state.shoppingItems.filter(item => item.id !== id) }))
    try {
      await shoppingApi.delete(tripId, id)
    } catch (err: unknown) {
      set({ shoppingItems: prev })
      throw new Error(getApiErrorMessage(err, 'Error deleting shopping item'))
    }
  },

  toggleShoppingItem: async (tripId, id, checked) => {
    set(state => ({
      shoppingItems: state.shoppingItems.map(item =>
        item.id === id ? { ...item, checked: checked ? 1 : 0 } : item
      ),
    }))
    try {
      await shoppingApi.update(tripId, id, { checked })
    } catch (err: unknown) {
      set(state => ({
        shoppingItems: state.shoppingItems.map(item =>
          item.id === id ? { ...item, checked: checked ? 0 : 1 } : item
        ),
      }))
      notify(getApiErrorMessage(err, 'Error updating shopping item'), 'error')
    }
  },

  clearCheckedShoppingItems: async (tripId) => {
    const prev = get().shoppingItems
    set(state => ({ shoppingItems: state.shoppingItems.filter(item => !item.checked) }))
    try {
      await shoppingApi.clearChecked(tripId)
    } catch (err: unknown) {
      set({ shoppingItems: prev })
      notify(getApiErrorMessage(err, 'Error clearing completed items'), 'error')
    }
  },

  reorderShoppingItems: async (tripId, orderedIds) => {
    const prev = get().shoppingItems
    set(state => {
      const byId = new Map(state.shoppingItems.map(i => [i.id, i]))
      const reordered = orderedIds
        .map(id => byId.get(id))
        .filter((i): i is ShoppingItem => i !== undefined)
        .map((item, idx): ShoppingItem => ({ ...item, sort_order: idx }))
      const remaining = state.shoppingItems.filter(i => !orderedIds.includes(i.id))
      return { shoppingItems: [...reordered, ...remaining] }
    })
    try {
      await shoppingApi.reorder(tripId, orderedIds)
    } catch (err: unknown) {
      set({ shoppingItems: prev })
      notify(getApiErrorMessage(err, 'Error reordering shopping items'), 'error')
    }
  },
})
