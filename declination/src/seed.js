// Demo data. Seeds an empty database on the first API request (see ensureReady in app.js).
import crypto from 'node:crypto';
import db from './db.js';
import { hashPassword, verifyPassword } from './auth.js';

function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function nextDow(from, dow) { const d = new Date(from); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + ((dow - d.getDay() + 7) % 7 || 7)); return d; }
function iso(d, h, m) { const x = new Date(d); x.setHours(h, m, 0, 0); return x.toISOString(); }

function weather(temp, cond, feels, low, wind, hum, uv, sunset, days) {
  return JSON.stringify({ temp, cond, feels, low, wind, humidity: hum, uv, sunset, days });
}

// Demo login: anna@declination.app. Password is DEMO_PASSWORD, or wyoming1230 when unset.
// Set DEMO_PASSWORD=off to lock the demo account.
const LOCKED = process.env.DEMO_PASSWORD === 'off';
export const DEMO_PASSWORD = LOCKED ? crypto.randomBytes(24).toString('hex') : (process.env.DEMO_PASSWORD || 'wyoming1230');

async function seed(q) {
  const now = new Date();
  const ins = (sql, ...a) => q.run(sql, ...a);
  const insId = async (sql, ...a) => (await q.get(sql + ' RETURNING id', ...a)).id;

  const mkUser = (name, surname, email, handle, bio, level, fol, fing, pass) => {
    const { salt, hash } = pass ? hashPassword(pass) : { salt: null, hash: null };
    return insId('INSERT INTO users (name,surname,email,handle,pass_salt,pass_hash,bio,level,followers,following) VALUES (?,?,?,?,?,?,?,?,?,?)',
      name, surname, email, handle, salt, hash, bio, level, fol, fing);
  };
  const anna = await mkUser('Anna', 'Hakobyan', 'anna@declination.app', 'anna.hikes',
    'Chasing peaks across Armenia. 42 summits and counting. Host of Yerevan Weekend Walkers, always up for a sunrise start.', 7, 2400, 312, DEMO_PASSWORD);
  await ins("UPDATE users SET avatar='/assets/anna.jpg' WHERE id=?", anna);
  const narek = await mkUser('Narek', 'Sargsyan', 'narek@declination.app', 'narek.s', 'Weekend walker.', 4, 410, 120);
  const lilit = await mkUser('Lilit', 'Manukyan', 'lilit@declination.app', 'lilit.m', 'Forest trails only.', 5, 530, 200);
  const tigran = await mkUser('Tigran', 'Karapetyan', 'tigran@declination.app', 'tigran.k', 'Food and trails.', 3, 220, 90);
  const ani = await mkUser('Ani', 'Harutyunyan', 'ani@declination.app', 'ani.h', 'Sunrise squad host.', 6, 890, 140);
  const nare = await mkUser('Nare', 'Simonyan', 'nare@declination.app', 'nare.s', '', 2, 90, 60);
  const dk = await mkUser('David', 'Khachatryan', 'david@declination.app', 'david.k', '', 2, 40, 30);
  const rv = await mkUser('Rita', 'Vardanyan', 'rita@declination.app', 'rita.v', '', 2, 40, 30);
  const eh = await mkUser('Edgar', 'Hovhannisyan', 'edgar@declination.app', 'edgar.h', '', 2, 40, 30);
  const am = await mkUser('Armen', 'Mkrtchyan', 'armen@declination.app', 'armen.m', '', 2, 40, 30);
  const gh = await mkUser('Gayane', 'Harutyunyan', 'gayane@declination.app', 'gayane.h', '', 2, 40, 30);
  const sp = await mkUser('Sevak', 'Petrosyan', 'sevak@declination.app', 'sevak.p', '', 2, 40, 30);
  const extra = [];
  for (let i = 1; i <= 6; i++) extra.push(await mkUser('Hiker', String(i), `hiker${i}@declination.app`, `hiker.${i}`, '', 1, 0, 0));

  const days = (base, hi, lo) => [0, 1, 2, 3, 4].map((i) => ({ hi: hi + [0, 2, -1, -3, 1][i], lo: lo + [0, 1, -1, -3, 0][i], cond: 'Clear' }));
  const trails = [
    ['lake-kari-loop', 'Lake Kari Loop', 'Mount Aragats, Armenia', 'Moderate', 7.2, 540, 3, 'lakes', 1, 980,
      'A scenic loop around the glacial Lake Kari beneath the peaks of Mount Aragats. The path climbs gently through alpine meadows before circling the lake, with open views of all four Aragats summits. Carry layers: the weather at 3,200 m changes quickly.',
      weather(3, 'Clear sky', -1, -3, 14, 41, '5 (Moderate)', '17:42', [{ hi: 3, lo: -3 }, { hi: 5, lo: -2 }, { hi: 2, lo: -4 }, { hi: 0, lo: -6 }, { hi: 4, lo: -3 }])],
    ['garni-gorge-walk', 'Garni Gorge Walk', 'Garni, Kotayk, Armenia', 'Easy', 4.1, 120, 1.5, 'under5,family,waterfalls', 0, 870,
      'A gentle riverside walk through the Garni Gorge and its basalt columns, the Symphony of Stones. Flat, well marked and suitable for families.',
      weather(17, 'Sunny', 17, 9, 8, 38, '6 (High)', '18:05', [{ hi: 17, lo: 9 }, { hi: 18, lo: 10 }, { hi: 16, lo: 8 }, { hi: 15, lo: 7 }, { hi: 17, lo: 9 }])],
    ['dilijan-forest-trail', 'Dilijan Forest Trail', 'Dilijan National Park, Armenia', 'Hard', 12.6, 880, 6, 'lakes', 0, 640,
      'A long, shaded climb through the beech and oak forest of Dilijan National Park, ending at a ridge with views over Parz Lake. Steep and muddy after rain.',
      weather(11, 'Cloudy', 9, 5, 11, 63, '3 (Moderate)', '17:58', [{ hi: 11, lo: 5 }, { hi: 12, lo: 6 }, { hi: 10, lo: 4 }, { hi: 9, lo: 3 }, { hi: 12, lo: 5 }])],
    ['tatev-monastery-path', 'Tatev Monastery Path', 'Tatev, Syunik, Armenia', 'Moderate', 8.4, 410, 3.5, 'family', 0, 760,
      'A well-trodden path through the Vorotan Gorge to Tatev Monastery, with a view of the Devil’s Bridge. Ends with a ride back on the Wings of Tatev.',
      weather(15, 'Sunny', 14, 8, 9, 35, '5 (Moderate)', '18:10', [{ hi: 15, lo: 8 }, { hi: 16, lo: 9 }, { hi: 14, lo: 7 }, { hi: 13, lo: 6 }, { hi: 16, lo: 8 }])],
    ['lastiver-waterfall-walk', 'Lastiver Waterfall Walk', 'Lastiver, Tavush, Armenia', 'Easy', 3.8, 160, 1.5, 'under5,waterfalls,family', 0, 590,
      'A short, mossy walk to a pair of hidden waterfalls in the forest above the Aghstev. Slippery in wet weather; wear shoes with grip.',
      weather(12, 'Light rain', 10, 7, 7, 82, '2 (Low)', '17:55', [{ hi: 12, lo: 7 }, { hi: 11, lo: 6 }, { hi: 13, lo: 7 }, { hi: 14, lo: 8 }, { hi: 12, lo: 7 }])],
    ['aragats-northern-summit', 'Aragats Northern Summit', 'Mount Aragats, Armenia', 'Hard', 11.3, 1020, 5.5, 'lakes', 0, 710,
      'The classic climb to the northern summit of Mount Aragats, the highest peak in Armenia. Exposed and windy near the top, with snow possible from October.',
      weather(1, 'Windy', -6, -5, 38, 45, '6 (High)', '17:40', [{ hi: 1, lo: -5 }, { hi: 2, lo: -4 }, { hi: -1, lo: -7 }, { hi: -3, lo: -9 }, { hi: 1, lo: -5 }])],
  ];
  const trailIds = {};
  const updated = Date.now() - 5 * 60 * 1000;
  for (const t of trails) {
    trailIds[t[0]] = await insId(`INSERT INTO trails (slug,name,location,difficulty,distance_km,elevation_m,duration_h,tags,featured,popularity,description,weather,weather_updated,image)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, t[0], t[1], t[2], t[3], t[4], t[5], t[6], t[7], t[8], t[9], t[10], t[11], updated, `/assets/${t[0]}.jpg`);
  }
  const kari = trailIds['lake-kari-loop'];

  const place = (trail, kind, name, dist, rating, reviews, o = {}) => insId(`INSERT INTO places (trail_id,kind,name,distance_km,rating,reviews,price,amenities,rooms_total,cuisine,price_level,slots,hours,notes,image)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, trail, kind, name, dist, rating, reviews, o.price ?? null, o.amenities ?? '', o.rooms ?? 0, o.cuisine ?? null, o.pl ?? null, o.slots ?? '', o.hours ?? null, o.notes ?? null, o.img ?? null);
  const lodge = await place(kari, 'hotel', 'Aragats Mountain Lodge', 2.1, 4.8, 214, { price: 58, amenities: 'Breakfast,Wi-Fi,Parking', rooms: 5, img: '/assets/aragats-mountain-lodge.jpg' });
  await place(kari, 'hotel', 'Kari Guesthouse', 0.8, 4.6, 98, { price: 42, amenities: 'Home cooking,Wi-Fi,Gear storage', rooms: 2, img: '/assets/kari-guesthouse.jpg' });
  const spa = await place(kari, 'hotel', 'Alpine Spa Hotel', 6.4, 4.7, 160, { price: 75, amenities: 'Spa,Breakfast,Parking', rooms: 1, img: '/assets/alpine-spa-hotel.jpg' });
  await place(kari, 'restaurant', 'Aragats Table', 1.9, 4.7, 320, { cuisine: 'Armenian', pl: '$$', slots: '18:00,19:30,20:30,21:00', img: '/assets/aragats-table.jpg' });
  await place(kari, 'restaurant', 'Khorovats House', 2.6, 4.5, 187, { cuisine: 'Barbecue', pl: '$$', slots: '18:30,19:00,20:00,21:00', img: '/assets/khorovats-house.jpg' });
  await place(kari, 'restaurant', 'Bread & Honey Café', 1.4, 4.8, 96, { cuisine: 'Café and bakery', pl: '$', slots: '17:00,18:00,19:00,20:00', img: '/assets/bread-honey-cafe.jpg' });
  await place(kari, 'church', 'Church of the Holy Mother of God', 1.2, 4.9, 128, { cuisine: 'Armenian Apostolic', hours: '09:00 – 18:00', notes: 'Free entry', img: '/assets/church-holy-mother.jpg' });
  await place(kari, 'church', 'Tegher Monastery', 3.4, 4.7, 86, { cuisine: 'Armenian Apostolic', hours: '10:00 – 17:00', notes: 'Free entry', img: '/assets/tegher-monastery.jpg' });
  await place(kari, 'church', 'Saghmosavank Monastery', 7.8, 4.8, 203, { cuisine: 'Armenian Apostolic', hours: '09:00 – 19:00', notes: 'Tours 11:00', img: '/assets/saghmosavank-monastery.jpg' });
  // The spa hotel is fully booked for the next three months by other guests.
  await ins('INSERT INTO bookings (user_id,place_id,kind,start_date,end_date,guests,rooms,total) VALUES (?,?,?,?,?,?,?,?)',
    narek, spa, 'hotel', addDays(now, -30).toISOString().slice(0, 10), addDays(now, 120).toISOString().slice(0, 10), 2, 1, 0);

  const sat = nextDow(now, 6), sun = nextDow(now, 0), sat2 = addDays(sat, 7);
  const grp = (name, trail, host, d, h, m, point, cap) => insId('INSERT INTO groups_ (name,trail_id,host_id,starts_at,meeting_point,capacity) VALUES (?,?,?,?,?,?)',
    name, trail, host, iso(d, h, m), point, cap);
  const join = async (g, ...us) => { for (const u of us) await ins('INSERT INTO group_members (group_id,user_id) VALUES (?,?)', g, u); };
  const g1 = await grp('Lake Kari Sunrise Squad', kari, ani, sat, 6, 30, 'Aragats Lodge parking', 8);
  await join(g1, ani, nare, lilit, tigran, anna);
  const g2 = await grp('Yerevan Weekend Walkers', trailIds['garni-gorge-walk'], narek, sun, 10, 0, 'Republic Square', 12);
  await join(g2, narek, anna, am, gh, sp, ...extra.slice(0, 4));
  const g3 = await grp('Dilijan Trail Crew', trailIds['dilijan-forest-trail'], lilit, sat2, 7, 30, 'Dilijan bus station', 8);
  await join(g3, lilit, dk, rv, eh, ...extra.slice(0, 4));

  const msg = (g, u, minsAgo, body) => ins('INSERT INTO messages (group_id,user_id,body,created_at) VALUES (?,?,?,?)', g, u, body, Date.now() - minsAgo * 60000);
  await msg(g1, ani, 190, 'Morning everyone! Forecast for Saturday looks clear. Meeting at the lodge parking at 06:30 sharp.');
  await msg(g1, nare, 175, 'Perfect. Should we bring microspikes?');
  await msg(g1, ani, 170, 'Yes, the shaded section by the lake will be icy. Layers too: it is about -3° at dawn.');
  await msg(g1, lilit, 120, 'Can I bring a friend? Is there a spot left?');
  await msg(g1, tigran, 95, 'There are 3 spots left, I just checked. I will book us a table for after the hike.');
  await msg(g1, anna, 60, 'Count me in. I will bring hot tea for everyone.');

  const post = (u, g, mins, body, likes, comments, img = null) => ins('INSERT INTO posts (user_id,group_id,body,likes,comments,created_at,image) VALUES (?,?,?,?,?,?,?)', u, g, body, likes, comments, Date.now() - mins * 60000, img);
  await post(ani, g1, 120, 'Sunrise at Lake Kari was unreal. Frozen edges, zero wind. Who is in for next weekend?', 128, 14);
  await post(tigran, g2, 300, 'Found the best khorovats spot after the Garni walk. Tables fill up fast, so book ahead.', 128, 14);
  const photos = [['Aragats at blue hour.', 'post-blue-hour', 3200], ['Garni basalt in the rain.', 'post-garni-basalt', 1800], ['Dilijan, first snow.', 'post-dilijan-snow', 2400], ['Tatev cable car.', 'post-tatev-cablecar', 4100],
    ['Lastiver waterfall.', 'post-lastiver', 950], ['Summit selfie, Aragats North.', 'post-summit', 1500], ['Trail lunch.', 'post-trail-lunch', 2900], ['Group photo.', 'post-group', 1200],
    ['Camp coffee.', 'post-camp-coffee', 2200], ['Campfire.', 'post-campfire', 1700], ['Waterfall viewpoint.', 'post-watsup', 860]];
  for (const [i, [body, f, l]] of photos.entries()) await post(anna, i < 3 ? g2 : null, 1000 + i * 700, body, l, 10 + i, `/assets/${f}.jpg`);
  for (const t of ['lake-kari-loop', 'garni-gorge-walk', 'dilijan-forest-trail']) await ins('INSERT INTO saved_trails (user_id,trail_id,saved_at) VALUES (?,?,?)', anna, trailIds[t], addDays(now, -1));
  await ins('INSERT INTO challenge_progress (user_id,trails_done) VALUES (?,?)', anna, 2);
  await ins('INSERT INTO hikes (user_id,trail_id,name,distance_km,elevation_m,duration_s,completed_at) VALUES (?,?,?,?,?,?,?)', anna, kari, 'Lake Kari Loop', 7.2, 540, 10800, Date.now() - 6 * 864e5);
  await ins('INSERT INTO hikes (user_id,trail_id,name,distance_km,elevation_m,duration_s,completed_at) VALUES (?,?,?,?,?,?,?)', anna, trailIds['garni-gorge-walk'], 'Garni Gorge Walk', 4.1, 120, 5400, Date.now() - 13 * 864e5);
  await ins('INSERT INTO bookings (user_id,place_id,kind,start_date,end_date,guests,rooms,total) VALUES (?,?,?,?,?,?,?,?)', anna, lodge, 'hotel',
    sat.toISOString().slice(0, 10), addDays(sat, 2).toISOString().slice(0, 10), 2, 1, 116);
}

// Seeds the database if it is empty. An advisory lock stops two cold-starting functions from seeding at once.
export async function seedIfEmpty() {
  if ((await db.get('SELECT COUNT(*)::int c FROM users')).c > 0) return false;
  return db.tx(async (q) => {
    await q.run('SELECT pg_advisory_xact_lock(4207)');
    if ((await q.get('SELECT COUNT(*)::int c FROM users')).c > 0) return false;
    await seed(q);
    return true;
  });
}

// Keeps the demo account's password in sync with DEMO_PASSWORD.
export async function syncDemoPassword() {
  if (LOCKED) return;
  const demo = await db.get("SELECT id, pass_salt, pass_hash FROM users WHERE email='anna@declination.app'");
  if (demo && !verifyPassword(DEMO_PASSWORD, demo.pass_salt, demo.pass_hash)) {
    const { salt, hash } = hashPassword(DEMO_PASSWORD);
    await db.run('UPDATE users SET pass_salt=?, pass_hash=? WHERE id=?', salt, hash, demo.id);
  }
}
