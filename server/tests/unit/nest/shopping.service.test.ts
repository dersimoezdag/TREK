import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';

const { testDb, dbMock } = vi.hoisted(() => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  const mock = {
    db,
    closeDb: () => {},
    reinitialize: () => {},
    getPlaceWithTags: () => null,
    canAccessTrip: (tripId: any, userId: number) =>
      db.prepare(`
        SELECT t.id, t.user_id FROM trips t
        LEFT JOIN trip_members m ON m.trip_id = t.id AND m.user_id = ?
        WHERE t.id = ? AND (t.user_id = ? OR m.user_id IS NOT NULL)
      `).get(userId, tripId, userId),
    isOwner: (tripId: any, userId: number) =>
      !!db.prepare('SELECT id FROM trips WHERE id = ? AND user_id = ?').get(tripId, userId),
  };
  return { testDb: db, dbMock: mock };
});

vi.mock('../../../src/db/database', () => dbMock);
vi.mock('../../../src/config', () => ({
  JWT_SECRET: 'test-secret',
  ENCRYPTION_KEY: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2',
  updateJwtSecret: () => {},
}));
vi.mock('../../../src/websocket', () => ({ broadcast: vi.fn() }));

import { createTables } from '../../../src/db/schema';
import { runMigrations } from '../../../src/db/migrations';
import { resetTestDb } from '../../helpers/test-db';
import { createUser, createTrip, addTripMember } from '../../helpers/factories';
import { DatabaseService } from '../../../src/nest/database/database.service';
import { PermissionsService } from '../../../src/nest/permissions/permissions.service';
import { ShoppingService } from '../../../src/nest/shopping/shopping.service';
import { RealtimeService } from '../../../src/nest/realtime/realtime.service';

const svc = new ShoppingService(new DatabaseService(testDb), new PermissionsService(new DatabaseService(testDb)), new RealtimeService());

beforeAll(() => {
  createTables(testDb);
  runMigrations(testDb);
});

beforeEach(() => {
  resetTestDb(testDb);
});

afterAll(() => {
  testDb.close();
});

describe('ShoppingService', () => {
  it('SHOP-SVC-001: creates and lists shopping items in sort order', () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);

    const item1 = svc.createItem(trip.id, { name: 'Milk', quantity: '2L', category: 'Supermarket' }) as any;
    const item2 = svc.createItem(trip.id, { name: 'Bread', quantity: '1', category: 'Bakery' }) as any;

    expect(item1.id).toBeDefined();
    expect(item1.name).toBe('Milk');
    expect(item1.quantity).toBe('2L');
    expect(item1.category).toBe('Supermarket');
    expect(item1.checked).toBe(0);

    const list = svc.listItems(trip.id) as any[];
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe(item1.id);
    expect(list[1].id).toBe(item2.id);
  });

  it('SHOP-SVC-002: updates a shopping item', () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);

    const item = svc.createItem(trip.id, { name: 'Apples', quantity: '1kg' }) as any;
    const updated = svc.updateItem(
      trip.id,
      item.id,
      { checked: 1, name: 'Green Apples', quantity: '2kg', category: 'Supermarket' },
      ['checked', 'name', 'quantity', 'category']
    ) as any;

    expect(updated).toBeDefined();
    expect(updated.checked).toBe(1);
    expect(updated.name).toBe('Green Apples');
    expect(updated.quantity).toBe('2kg');
    expect(updated.category).toBe('Supermarket');
  });

  it('SHOP-SVC-003: deletes a shopping item', () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);

    const item = svc.createItem(trip.id, { name: 'Cheese' }) as any;
    const ok = svc.deleteItem(trip.id, item.id);
    expect(ok).toBe(true);

    const list = svc.listItems(trip.id) as any[];
    expect(list).toHaveLength(0);
  });

  it('SHOP-SVC-004: clearChecked removes all completed items', () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);

    const item1 = svc.createItem(trip.id, { name: 'Item 1' }) as any;
    const item2 = svc.createItem(trip.id, { name: 'Item 2' }) as any;
    svc.updateItem(trip.id, item1.id, { checked: 1 }, ['checked']);

    const deletedIds = svc.clearChecked(trip.id);
    expect(deletedIds).toEqual([item1.id]);

    const remaining = svc.listItems(trip.id) as any[];
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(item2.id);
  });

  it('SHOP-SVC-005: reorders items according to orderedIds', () => {
    const { user } = createUser(testDb);
    const trip = createTrip(testDb, user.id);

    const item1 = svc.createItem(trip.id, { name: 'A' }) as any;
    const item2 = svc.createItem(trip.id, { name: 'B' }) as any;
    const item3 = svc.createItem(trip.id, { name: 'C' }) as any;

    svc.reorderItems(trip.id, [item3.id, item1.id, item2.id]);

    const list = svc.listItems(trip.id) as any[];
    expect(list.map(i => i.id)).toEqual([item3.id, item1.id, item2.id]);
  });

  it('SHOP-SVC-006: verifies trip access for owner and member', () => {
    const { user: owner } = createUser(testDb);
    const { user: member } = createUser(testDb);
    const { user: stranger } = createUser(testDb);
    const trip = createTrip(testDb, owner.id);
    addTripMember(testDb, trip.id, member.id);

    expect(svc.verifyTripAccess(trip.id, owner.id)).toBeDefined();
    expect(svc.verifyTripAccess(trip.id, member.id)).toBeDefined();
    expect(svc.verifyTripAccess(trip.id, stranger.id)).toBeFalsy();
  });
});
