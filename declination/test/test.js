'use strict';
const os = require('os'), path = require('path'), fs = require('fs'), assert = require('assert');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dcl-'));
process.env.DB_FILE = path.join(tmp, 't.db'); process.env.DATA_DIR = tmp;
const { seedIfEmpty } = require('../src/seed'); seedIfEmpty();
const { server } = require('../src/server');

let cookie = '';
async function api(method, url, body) {
  const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  return { status: r.status, data: await r.json().catch(() => null) };
}
let base, passed = 0;
const t = async (name, fn) => { try { await fn(); passed++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name, '\n   ', e.message); process.exitCode = 1; } };

server.listen(0, async () => {
  base = 'http://127.0.0.1:' + server.address().port;
  await t('me is null when logged out', async () => { const r = await api('GET', '/api/me'); assert.strictEqual(r.data.user, null); });
  await t('trails list: 6 seeded', async () => { const r = await api('GET', '/api/trails'); assert.strictEqual(r.data.count, 6); });
  await t('trail filters', async () => {
    assert.strictEqual((await api('GET', '/api/trails?difficulty=Hard')).data.count, 2);
    assert.strictEqual((await api('GET', '/api/trails?tags=under5')).data.count, 2);
    assert.strictEqual((await api('GET', '/api/trails?q=garni')).data.count, 1);
    assert.strictEqual((await api('GET', "/api/trails?q=%25")).data.count, 0);
  });
  await t('sort by distance', async () => { const r = await api('GET', '/api/trails?sort=distance'); assert.strictEqual(r.data.trails[0].name, 'Lastiver Waterfall Walk'); });
  await t('trail detail + weather', async () => { const r = await api('GET', '/api/trails/lake-kari-loop'); assert.strictEqual(r.data.weather.forecast.length, 5); assert.strictEqual(r.data.plan.fromPrice, 42); });
  await t('protected routes need auth', async () => { assert.strictEqual((await api('GET', '/api/saved')).status, 401); });
  await t('signup validation', async () => {
    assert.strictEqual((await api('POST', '/api/auth/signup', { name: '', surname: 'x', email: 'a@b.co', password: 'abcdefg1' })).status, 400);
    assert.strictEqual((await api('POST', '/api/auth/signup', { name: 'A', surname: 'B', email: 'bad', password: 'abcdefg1' })).status, 400);
    assert.strictEqual((await api('POST', '/api/auth/signup', { name: 'A', surname: 'B', email: 'a@b.co', password: 'short' })).status, 400);
  });
  await t('signup, duplicate, logout, login', async () => {
    const r = await api('POST', '/api/auth/signup', { name: 'Mary', surname: 'Test', email: 'mary@test.io', password: 'hikehike9' });
    assert.strictEqual(r.status, 201); assert.strictEqual((await api('GET', '/api/me')).data.user.email, 'mary@test.io');
    assert.strictEqual((await api('POST', '/api/auth/signup', { name: 'Mary', surname: 'Test', email: 'MARY@test.io', password: 'hikehike9' })).status, 409);
    await api('POST', '/api/auth/logout'); cookie = '';
    assert.strictEqual((await api('POST', '/api/auth/login', { email: 'mary@test.io', password: 'wrongpass1' })).status, 401);
    assert.strictEqual((await api('POST', '/api/auth/login', { email: 'mary@test.io', password: 'hikehike9' })).status, 200);
  });
  await t('save / unsave trail', async () => {
    assert.strictEqual((await api('POST', '/api/trails/1/save')).data.saved, true);
    assert.strictEqual((await api('GET', '/api/saved')).data.trails.length, 1);
    await api('DELETE', '/api/trails/1/save'); assert.strictEqual((await api('GET', '/api/saved')).data.trails.length, 0);
  });
  let places;
  await t('places for trail', async () => {
    places = (await api('GET', '/api/trails/1/places')).data;
    assert.strictEqual(places.hotels.length, 3); assert.strictEqual(places.restaurants.length, 3); assert.strictEqual(places.churches.length, 3);
    assert.strictEqual(places.hotels.find((h) => h.name.startsWith('Alpine')).status, 'soldout');
    assert.strictEqual(places.hotels.find((h) => h.name.startsWith('Kari')).status, 'few');
  });
  await t('hotel booking math, overbooking blocked', async () => {
    const lodge = places.hotels.find((h) => h.name.startsWith('Aragats'));
    const d = new Date(); d.setUTCDate(d.getUTCDate() + 20); const s = d.toISOString().slice(0, 10); d.setUTCDate(d.getUTCDate() + 2); const e = d.toISOString().slice(0, 10);
    const r = await api('POST', '/api/bookings', { placeId: lodge.id, start: s, end: e, guests: 2 });
    assert.strictEqual(r.status, 201); assert.strictEqual(r.data.booking.total, 116); assert.strictEqual(r.data.booking.nights, 2);
    assert.strictEqual((await api('POST', '/api/bookings', { placeId: places.hotels.find((h) => h.name.startsWith('Alpine')).id, start: s, end: e, guests: 2 })).status, 409);
    assert.strictEqual((await api('POST', '/api/bookings', { placeId: lodge.id, start: '2020-01-01', end: '2020-01-03', guests: 2 })).status, 400);
    assert.strictEqual((await api('POST', '/api/bookings', { placeId: lodge.id, start: e, end: s, guests: 2 })).status, 400);
    assert.strictEqual((await api('GET', '/api/bookings')).data.bookings.length, 1);
  });
  await t('restaurant reservation', async () => {
    const r0 = places.restaurants[0]; const d = new Date(); d.setUTCDate(d.getUTCDate() + 3);
    assert.strictEqual((await api('POST', '/api/bookings', { placeId: r0.id, date: d.toISOString().slice(0, 10), time: '03:00', guests: 2 })).status, 400);
    assert.strictEqual((await api('POST', '/api/bookings', { placeId: r0.id, date: d.toISOString().slice(0, 10), time: r0.slots[0].time, guests: 2 })).status, 201);
  });
  await t('groups: list, join, full, chat gating', async () => {
    const g = (await api('GET', '/api/groups')).data.groups; assert.ok(g.length >= 3);
    const full = g.find((x) => x.full), open = g.find((x) => !x.full && !x.isMember);
    assert.strictEqual((await api('POST', `/api/groups/${full.id}/join`)).status, 409);
    assert.strictEqual((await api('GET', `/api/groups/${open.id}/messages`)).status, 403);
    assert.strictEqual((await api('POST', `/api/groups/${open.id}/join`)).status, 200);
    assert.strictEqual((await api('POST', `/api/groups/${open.id}/messages`, { body: 'Hello!' })).status, 201);
    assert.strictEqual((await api('POST', `/api/groups/${open.id}/messages`, { body: '  ' })).status, 400);
    assert.ok((await api('GET', `/api/groups/${open.id}/messages`)).data.messages.some((m) => m.mine && m.body === 'Hello!'));
  });
  await t('record trail then appears in explore', async () => {
    assert.strictEqual((await api('POST', '/api/recordings', { name: '', distanceKm: 3, durationS: 600 })).status, 400);
    const r = await api('POST', '/api/recordings', { name: 'Morning Ridge', distanceKm: 5.4, elevationM: 300, durationS: 7200, shared: true });
    assert.strictEqual(r.status, 201); assert.strictEqual(r.data.trail.isNew, true);
    const list = (await api('GET', '/api/trails')).data; assert.strictEqual(list.count, 7); assert.strictEqual(list.trails[0].name, 'Morning Ridge');
  });
  await t('private recording hidden from others', async () => {
    await api('POST', '/api/recordings', { name: 'Secret Spot', distanceKm: 2, elevationM: 10, durationS: 900, shared: false });
    assert.strictEqual((await api('GET', '/api/trails')).data.count, 8);
    cookie = ''; assert.strictEqual((await api('GET', '/api/trails')).data.count, 7);
  });
  await t('posts & likes toggle', async () => {
    await api('POST', '/api/auth/login', { email: 'mary@test.io', password: 'hikehike9' });
    const p = await api('POST', '/api/posts', { body: 'First hike!' }); assert.strictEqual(p.status, 201);
    assert.strictEqual((await api('POST', `/api/posts/${p.data.post.id}/like`)).data.post.likes, 1);
    assert.strictEqual((await api('POST', `/api/posts/${p.data.post.id}/like`)).data.post.likes, 0);
  });
  await t('forgot password never leaks existence', async () => {
    const a = await api('POST', '/api/auth/forgot', { email: 'nobody@nowhere.io' }), b = await api('POST', '/api/auth/forgot', { email: 'mary@test.io' });
    assert.strictEqual(a.status, 200); assert.deepStrictEqual(a.data, b.data);
  });
  await t('google sign-in reports not configured', async () => { assert.strictEqual((await api('GET', '/api/auth/google')).status, 501); });
  await t('static: index + traversal blocked', async () => {
    const r = await fetch(base + '/'); assert.ok([200, 404].includes(r.status));
    const x = await fetch(base + '/..%2f..%2fetc/passwd.txt'); assert.ok(x.status >= 400);
  });
  console.log(`\n${passed} passed`); server.close(); fs.rmSync(tmp, { recursive: true, force: true });
});
