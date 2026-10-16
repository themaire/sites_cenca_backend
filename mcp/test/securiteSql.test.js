"use strict";

// Tests hors ligne des garde-fous SQL (aucune connexion à la base) : npm test
const test = require('node:test');
const assert = require('node:assert');
const { validerRequeteLecture, masquerResultats } = require('../fonctions/securiteSql');

const acceptees = [
  'SELECT code, nom FROM sitcenca.listesitescenca',
  'select 1;',
  "WITH s AS (SELECT * FROM sitcenca.sites) SELECT count(*) FROM s",
  "SELECT * FROM sitcenca.sites WHERE remarque = 'à mettre à jour : UPDATE puis DELETE'",
  "SELECT * FROM esp.geometries WHERE date_update > now() - interval '1 year'",
  "SELECT \"offset\", replace(nom, 'a', 'b') FROM t",
  'EXPLAIN SELECT * FROM opegerer.operations',
  "SELECT 'a--b', $1::text",
  'SELECT $$ DROP TABLE x $$',
  '(SELECT 1) UNION (SELECT 2)',
];

const refusees = [
  ['UPDATE sitcenca.sites SET code = 1', /lectures/],
  ['SELECT 1; DROP TABLE sitcenca.sites', /une seule requête/i],
  ["SELECT 'x--' ; DELETE FROM t", /une seule requête/i],
  ["SELECT E'a\\'' ; DELETE FROM t", /une seule requête/i],
  ['WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d', /modification/],
  ['SELECT * INTO nouvelle FROM t', /INTO/],
  ['SELECT * FROM t FOR UPDATE', /modification|verrouillage/],
  ['SELECT * FROM t FOR SHARE', /verrouillage/],
  ['SELECT pg_sleep(100)', /fonction/],
  ["SELECT set_config('transaction_read_only', 'off', true)", /fonction/],
  ['SELECT pg_terminate_backend(pid) FROM x', /fonction/],
  ["SELECT query_to_xml('select 1', true, true, '')", /fonction/],
  ['SELECT sal_hash FROM admin.salaries', /sal_hash/],
  ['SELECT "SAL_HASH" FROM admin.salaries', /sal_hash/i],
  ['SELECT * FROM admin.blacklist_token', /blacklist_token/],
  ['SET ROLE postgres', /lectures/],
  ['COPY t TO STDOUT', /lectures/],
  ['/* commentaire */ DELETE FROM t', /lectures/],
  ['', /vide/],
];

test('requêtes de lecture acceptées', () => {
  for (const sql of acceptees) assert.doesNotThrow(() => validerRequeteLecture(sql), sql);
});

test('requêtes dangereuses refusées', () => {
  for (const [sql, motif] of refusees) assert.throws(() => validerRequeteLecture(sql), motif, sql);
});

test('LIMIT ajouté seulement aux requêtes enveloppables', () => {
  assert.strictEqual(validerRequeteLecture('SELECT 1').limitable, true);
  assert.strictEqual(validerRequeteLecture('EXPLAIN SELECT 1').limitable, false);
});

test('empreintes bcrypt et JWT masquées, même dans du JSON', () => {
  const bcrypt = '$2b$10$' + 'a'.repeat(53);
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJpZCI6MTIzNDV9.' + 'b'.repeat(20);
  const { rows } = masquerResultats(
    [{ ligne: `{"nom":"x","h":"${bcrypt}"}`, objet: { jeton: jwt }, nom: 'Dupont' }],
    [{ name: 'ligne' }, { name: 'objet' }, { name: 'nom' }],
  );
  assert.ok(!JSON.stringify(rows).includes(bcrypt));
  assert.ok(!JSON.stringify(rows).includes(jwt));
  assert.strictEqual(rows[0].nom, 'Dupont');
});

test('colonne sensible retirée même sous alias', () => {
  const { rows, fields } = masquerResultats([{ h: 'x', sal_hash: 'y', nom: 'a' }], [{ name: 'h' }, { name: 'sal_hash' }, { name: 'nom' }]);
  assert.deepStrictEqual(Object.keys(rows[0]), ['h', 'nom']);
  assert.deepStrictEqual(fields.map(f => f.name), ['h', 'nom']);
});
