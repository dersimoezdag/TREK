import { describe, it, expect, vi, beforeEach } from 'vitest';
import ShoppingListPanel from './ShoppingListPanel';
import { render, screen, fireEvent, waitFor } from '../../../tests/helpers/render';
import { resetAllStores, seedStore } from '../../../tests/helpers/store';
import { useTripStore } from '../../store/tripStore';
import { useAuthStore } from '../../store/authStore';
import { buildUser } from '../../../tests/helpers/factories';
import type { ShoppingItem } from '../../types';

const ME = 1;

function shoppingItem(overrides: Partial<ShoppingItem> = {}): ShoppingItem {
  return {
    id: 101,
    trip_id: 1,
    name: 'Milk',
    checked: 0,
    quantity: '2L',
    category: 'Supermarket',
    assigned_user_id: null,
    notes: null,
    sort_order: 0,
    created_at: '2026-10-03T10:00:00Z',
    ...overrides,
  };
}

describe('ShoppingListPanel', () => {
  beforeEach(() => {
    resetAllStores();
    seedStore(useAuthStore, {
      user: buildUser({ id: ME, role: 'admin' }),
    });
    seedStore(useTripStore, {
      trip: { id: 1, user_id: ME, currency: 'EUR' } as never,
    });
  });

  it('renders empty state when there are no items', () => {
    render(<ShoppingListPanel tripId={1} items={[]} />);
    expect(screen.getByText(/No items on the shopping list yet/i)).toBeInTheDocument();
  });

  it('renders items grouped by category with quantities', () => {
    const items = [
      shoppingItem({ id: 1, name: 'Baguette', quantity: '2x', category: 'Bakery', checked: 0 }),
      shoppingItem({ id: 2, name: 'Juice', quantity: '1L', category: 'Drinks', checked: 1 }),
    ];

    render(<ShoppingListPanel tripId={1} items={items} />);

    expect(screen.getByText('Baguette')).toBeInTheDocument();
    expect(screen.getByText('2x')).toBeInTheDocument();
    expect(screen.getByText('Juice')).toBeInTheDocument();
    expect(screen.getByText('1L')).toBeInTheDocument();
  });

  it('submits a new item via quick-add bar', async () => {
    const addShoppingItemSpy = vi.fn().mockResolvedValue(shoppingItem({ id: 99, name: 'Bananas' }));
    seedStore(useTripStore, {
      trip: { id: 1, user_id: ME, currency: 'EUR' } as never,
      addShoppingItem: addShoppingItemSpy,
    });

    render(<ShoppingListPanel tripId={1} items={[]} />);

    const nameInput = screen.getByPlaceholderText(/Item name|Artikel/i);
    fireEvent.change(nameInput, { target: { value: 'Bananas' } });

    const qtyInput = screen.getByPlaceholderText(/Qty|Menge/i);
    fireEvent.change(qtyInput, { target: { value: '1 bunch' } });

    const addBtn = screen.getByRole('button', { name: /Add item|Hinzufügen/i });
    fireEvent.click(addBtn);

    expect(addShoppingItemSpy).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        name: 'Bananas',
        quantity: '1 bunch',
      }),
    );
  });

  it('toggles item checked state when check button is clicked', () => {
    const toggleSpy = vi.fn();
    seedStore(useTripStore, {
      trip: { id: 1, user_id: ME, currency: 'EUR' } as never,
      toggleShoppingItem: toggleSpy,
    });

    const items = [shoppingItem({ id: 1, name: 'Coffee', checked: 0 })];
    render(<ShoppingListPanel tripId={1} items={items} />);

    const checkBtn = screen.getByRole('button', { name: /Bought: Coffee/i });
    fireEvent.click(checkBtn);

    expect(toggleSpy).toHaveBeenCalledWith(1, 1, true);
  });

  it('filters items by open and done status', () => {
    const items = [
      shoppingItem({ id: 1, name: 'Apples', checked: 0 }),
      shoppingItem({ id: 2, name: 'Pears', checked: 1 }),
    ];

    render(<ShoppingListPanel tripId={1} items={items} />);

    expect(screen.getByText('Apples')).toBeInTheDocument();
    expect(screen.getByText('Pears')).toBeInTheDocument();

    // Click 'To buy'
    fireEvent.click(screen.getByText('To buy'));
    expect(screen.getByText('Apples')).toBeInTheDocument();
    expect(screen.queryByText('Pears')).not.toBeInTheDocument();

    // Click 'Bought'
    fireEvent.click(screen.getByText('Bought'));
    expect(screen.queryByText('Apples')).not.toBeInTheDocument();
    expect(screen.getByText('Pears')).toBeInTheDocument();
  });

  it('opens budget modal and transfers expense to budget', async () => {
    const addBudgetItemSpy = vi.fn().mockResolvedValue({ id: 50 });
    const clearCheckedSpy = vi.fn().mockResolvedValue(undefined);

    seedStore(useTripStore, {
      trip: { id: 1, user_id: ME, currency: 'EUR' } as never,
      addBudgetItem: addBudgetItemSpy,
      clearCheckedShoppingItems: clearCheckedSpy,
    });

    const items = [shoppingItem({ id: 1, name: 'Snacks', checked: 1 })];
    render(<ShoppingListPanel tripId={1} items={items} />);

    const budgetBtn = screen.getByRole('button', { name: /Add as expense to budget/i });
    fireEvent.click(budgetBtn);

    const amountInput = screen.getByPlaceholderText('0.00');
    fireEvent.change(amountInput, { target: { value: '15.99' } });

    const submitBtn = screen.getByRole('button', { name: /Save|Speichern/i });
    fireEvent.click(submitBtn);

    expect(addBudgetItemSpy).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        category: 'groceries',
        total_price: 15.99,
        currency: 'EUR',
        member_ids: [ME],
      }),
    );
  });
});
