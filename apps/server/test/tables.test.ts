import { openDb } from '../src/db/connection.js';
import { createTableStore } from '../src/tables/store.js';

function freshStore() {
  const db = openDb(':memory:');
  return createTableStore(db);
}

test('createTable sanitises a hostile table name', () => {
  const store = freshStore();
  const def = store.createTable({
    name: 'Customers; DROP',
    label: 'Customers',
    columns: [{ name: 'name', label: 'Name', type: 'text' }],
    displayField: 'name',
  });
  expect(def.name).toBe('customers_drop');
  expect(store.getTable('customers_drop')).toBeDefined();
});

test('createTable sanitises column names but keeps labels verbatim', () => {
  const store = freshStore();
  const def = store.createTable({
    name: 'customers',
    label: 'Customers',
    columns: [{ name: 'First Name', label: 'First Name', type: 'text' }],
    displayField: 'First Name',
  });
  expect(def.columns).toEqual([{ name: 'first_name', label: 'First Name', type: 'text' }]);
  expect(def.displayField).toBe('first_name');
});

test('upsert creates then updates the same row', () => {
  const store = freshStore();
  store.createTable({
    name: 'customers',
    label: 'Customers',
    columns: [
      { name: 'email', label: 'Email', type: 'email' },
      { name: 'name', label: 'Name', type: 'text' },
    ],
    displayField: 'name',
  });
  const first = store.upsert('customers', { email: 'sarah@x.com', name: 'Sarah' }, 'email');
  expect(first.created).toBe(true);
  const second = store.upsert('customers', { email: 'sarah@x.com', name: 'Sarah Lee' }, 'email');
  expect(second.created).toBe(false);
  expect(second.id).toBe(first.id);
  const rows = store.query('customers');
  expect(rows).toHaveLength(1);
  expect(rows[0]!['name']).toBe('Sarah Lee');
});

test('insert into an unknown table throws', () => {
  const store = freshStore();
  expect(() => store.insert('nope', { name: 'x' })).toThrow('Unknown table: nope');
});

test('unknown columns in a row are ignored, not written', () => {
  const store = freshStore();
  store.createTable({
    name: 'customers',
    label: 'Customers',
    columns: [{ name: 'name', label: 'Name', type: 'text' }],
    displayField: 'name',
  });
  store.insert('customers', { name: 'Sarah', bogus: 'nope' });
  const rows = store.query('customers');
  expect(rows).toHaveLength(1);
  expect(rows[0]).not.toHaveProperty('bogus');
  expect(rows[0]!['name']).toBe('Sarah');
});

test('email columns reject values without @', () => {
  const store = freshStore();
  store.createTable({
    name: 'customers',
    label: 'Customers',
    columns: [{ name: 'email', label: 'Email', type: 'email' }],
    displayField: 'email',
  });
  expect(() => store.insert('customers', { email: 'not-an-email' })).toThrow(
    'Invalid email for column email',
  );
});

test('creating a duplicate table throws', () => {
  const store = freshStore();
  store.createTable({
    name: 'customers',
    label: 'Customers',
    columns: [{ name: 'name', label: 'Name', type: 'text' }],
    displayField: 'name',
  });
  expect(() =>
    store.createTable({
      name: 'Customers',
      label: 'Customers',
      columns: [{ name: 'name', label: 'Name', type: 'text' }],
      displayField: 'name',
    }),
  ).toThrow('Table already exists: customers');
});

test('upsert with an unknown key field throws', () => {
  const store = freshStore();
  store.createTable({
    name: 'customers',
    label: 'Customers',
    columns: [{ name: 'name', label: 'Name', type: 'text' }],
    displayField: 'name',
  });
  expect(() => store.upsert('customers', { name: 'Sarah' }, 'email')).toThrow(
    'Unknown column: email for table customers',
  );
});

test('upsert without a key value throws', () => {
  const store = freshStore();
  store.createTable({
    name: 'customers',
    label: 'Customers',
    columns: [{ name: 'email', label: 'Email', type: 'email' }],
    displayField: 'email',
  });
  expect(() => store.upsert('customers', {}, 'email')).toThrow('Missing value for key field: email');
});
