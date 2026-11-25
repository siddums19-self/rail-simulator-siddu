// Station Master mode: a top-down panel of one station. Trains arrive at the home signals of each
// approach line; you choose the platform (route in), and when they are ready you clear the starter
// (route out). Routes through the same throat that cross each other cannot be set together.
// Modes: Rush 15 / Rush 20 (timed), Move 100 (race), Endless (until gridlock).

const L = (id, label, extra = {}) => ({ id, label, ...extra });
const T = (no, name, kind, from, to, extra = {}) => ({ no, name, kind, from, to, ...extra });
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

export const SM_STATIONS = {
  GTL: {
    name: 'Guntakal Jn', local: 'గుంతకల్లు', pf: 7, goods: 2, sideNames: ['WEST', 'EAST'], pf1South: true,
    // north at the top: Adoni leaves north-west, Ballari south-west; Dhone north-east, Gooty south-east,
    // and the Anantapur direct line south from PF 1 / 2 (the southernmost platforms)
    left: [L('AD', 'Adoni · Raichur · Wadi'), L('BAY', 'Ballari · Hubballi · Goa')],
    right: [L('DHNE', 'Dhone · Kurnool'), L('GY', 'Gooty · Bengaluru · Chennai'), L('ATP', 'Anantapur direct', { pf: [1, 2] })],
    trains: [
      T('12793', 'Rayalaseema Exp', 'exp', 'GY', 'AD'), T('12794', 'Rayalaseema Exp', 'exp', 'AD', 'GY'),
      T('18463', 'Prashanti Exp', 'exp', 'GY', 'DHNE', { reverse: true }), T('18464', 'Prashanti Exp', 'exp', 'DHNE', 'GY', { reverse: true }),
      T('17225', 'Amaravati Exp', 'exp', 'BAY', 'DHNE'), T('17226', 'Amaravati Exp', 'exp', 'DHNE', 'BAY'),
      T('12627', 'Karnataka Exp', 'exp', 'AD', 'GY'), T('12628', 'Karnataka Exp', 'exp', 'GY', 'AD'),
      T('22691', 'Rajdhani Exp', 'vip', 'AD', 'GY'), T('22692', 'Rajdhani Exp', 'vip', 'GY', 'AD'),
      T('16591', 'Hampi Exp', 'exp', 'BAY', 'GY'), T('16592', 'Hampi Exp', 'exp', 'GY', 'BAY'),
      T('07415', 'Guntakal–Anantapur DEMU', 'pass', 'BAY', 'ATP'), T('07416', 'Anantapur–Hosapete DEMU', 'pass', 'ATP', 'BAY'),
      T('77414', 'Guntakal–Kurnool DEMU', 'pass', 'AD', 'DHNE'),
      T('BOXN', 'Coal rake', 'goods', 'BAY', 'GY'), T('BCN', 'Container special', 'goods', 'AD', 'GY'), T('BTPN', 'Tank rake', 'goods', 'DHNE', 'BAY'),
      // Dhone line
      T('17603', 'Kacheguda–Yelahanka Exp', 'exp', 'DHNE', 'GY'), T('17604', 'Yelahanka–Kacheguda Exp', 'exp', 'GY', 'DHNE'),
      T('12797', 'Venkatadri Exp', 'exp', 'DHNE', 'GY'), T('12798', 'Venkatadri Exp', 'exp', 'GY', 'DHNE'),
      T('57471', 'Guntakal–Kacheguda Passenger', 'pass', 'AD', 'DHNE'), T('57472', 'Kacheguda–Guntakal Passenger', 'pass', 'DHNE', 'BAY'),
      T('BOXN', 'Cement rake (Dhone)', 'goods', 'DHNE', 'GY'),
      // Anantapur direct line (PF 1 / 2)
      T('07419', 'Guntakal–Dharmavaram DEMU', 'pass', 'AD', 'ATP'), T('07420', 'Dharmavaram–Guntakal DEMU', 'pass', 'ATP', 'BAY'),
      T('17211', 'Machilipatnam–Dharmavaram Exp', 'exp', 'DHNE', 'ATP', { reverse: true }), T('17212', 'Dharmavaram–Machilipatnam Exp', 'exp', 'ATP', 'DHNE', { reverse: true }),
      T('BOXN', 'Iron ore rake (Anantapur)', 'goods', 'ATP', 'BAY'),
      // Ballari line
      T('17415', 'Haripriya Exp', 'exp', 'BAY', 'GY'), T('17416', 'Haripriya Exp', 'exp', 'GY', 'BAY'),
      T('07563', 'Ballari–Guntakal DEMU', 'pass', 'BAY', 'DHNE'), T('07564', 'Guntakal–Hosapete DEMU', 'pass', 'DHNE', 'BAY'),
      T('BOXN', 'Iron ore rake (Hosapete)', 'goods', 'BAY', 'DHNE')
    ]
  },
  SC: {
    name: 'Secunderabad Jn', local: 'సికింద్రాబాద్', pf: 10, goods: 1, sideNames: ['WEST', 'EAST'],
    left: [L('LPI', 'Begumpet · Lingampalli · Wadi'), L('HYB', 'Sitaphalmandi · Hyderabad')],
    right: [L('MLY', 'Malkajgiri · Medchal · Nizamabad'), L('KZJ', 'Moula Ali · Kazipet · Delhi'), L('KCG', 'Kacheguda · Falaknuma')],
    trains: [
      T('12723', 'Telangana Exp', 'exp', 'HYB', 'KZJ'), T('12724', 'Telangana Exp', 'exp', 'KZJ', 'HYB'),
      T('12793', 'Rayalaseema Exp', 'exp', 'LPI', 'KZJ'), T('12794', 'Rayalaseema Exp', 'exp', 'KZJ', 'LPI'),
      T('12759', 'Charminar Exp', 'exp', 'HYB', 'KZJ'), T('12760', 'Charminar Exp', 'exp', 'KZJ', 'HYB'),
      T('12727', 'Godavari Exp', 'exp', 'HYB', 'KZJ'), T('17405', 'Krishna Exp', 'exp', 'MLY', 'KCG'),
      T('20702', 'Vande Bharat', 'vip', 'KCG', 'KZJ'), T('12437', 'Rajdhani Exp', 'vip', 'LPI', 'KZJ'),
      T('BOXN', 'Coal rake', 'goods', 'KZJ', 'LPI'), T('BCN', 'Container special', 'goods', 'LPI', 'MLY')
    ],
    locals: { every: 13, label: 'MMTS', names: ['Lingampalli–Falaknuma', 'Falaknuma–Lingampalli', 'Hyderabad–Medchal', 'Lingampalli–Medchal'],
      pairs: [['LPI', 'KCG'], ['KCG', 'LPI'], ['HYB', 'MLY'], ['LPI', 'MLY'], ['MLY', 'LPI'], ['KCG', 'HYB']], base: 47150 }
  },
  BZA: {
    name: 'Vijayawada Jn', local: 'విజయవాడ', pf: 10, goods: 2, sideNames: ['NORTH', 'SOUTH'],
    left: [L('KZJ', 'Kondapalli · Kazipet · Secunderabad'), L('VSKP', 'Eluru · Rajahmundry · Visakhapatnam'), L('YARD', 'Coaching yard')],
    right: [L('GNT', 'Guntur · Narasaraopet · Dhone'), L('MAS', 'Tenali · Ongole · Chennai')],
    trains: [
      T('12841', 'Coromandel Exp', 'exp', 'VSKP', 'MAS'), T('12842', 'Coromandel Exp', 'exp', 'MAS', 'VSKP'),
      T('12759', 'Charminar Exp', 'exp', 'KZJ', 'MAS'), T('12760', 'Charminar Exp', 'exp', 'MAS', 'KZJ'),
      T('18463', 'Prashanti Exp', 'exp', 'GNT', 'VSKP'), T('18464', 'Prashanti Exp', 'exp', 'VSKP', 'GNT'),
      T('17225', 'Amaravati Exp (terminates)', 'exp', 'GNT', 'YARD'), T('17226', 'Amaravati Exp', 'exp', 'YARD', 'GNT'),
      T('12805', 'Janmabhoomi Exp', 'exp', 'VSKP', 'KZJ', { reverse: true }), T('20833', 'Vande Bharat', 'vip', 'VSKP', 'KZJ', { reverse: true }),
      T('12711', 'Pinakini Exp', 'exp', 'YARD', 'MAS'), T('12296', 'Sanghamitra Exp', 'exp', 'KZJ', 'MAS'),
      T('BOXN', 'Coal rake', 'goods', 'VSKP', 'MAS'), T('BCN', 'Container special', 'goods', 'KZJ', 'VSKP')
    ]
  },
  SBC: {
    name: 'KSR Bengaluru', local: 'ಕೆಎಸ್ಆರ್ ಬೆಂಗಳೂರು', pf: 10, goods: 1, sideNames: ['WEST', 'EAST'],
    left: [L('MYS', 'Kengeri · Mysuru'), L('YARD', 'Coaching yard')],
    right: [L('YPR', 'Yesvantpur · Yelahanka · Hubballi'), L('BNC', 'Cantonment · K R Puram · Chennai')],
    trains: [
      T('12007', 'Shatabdi Exp', 'vip', 'BNC', 'MYS'), T('12008', 'Shatabdi Exp', 'vip', 'MYS', 'BNC'),
      T('12613', 'Tippu Exp', 'exp', 'MYS', 'BNC'), T('20607', 'Vande Bharat', 'vip', 'BNC', 'MYS'),
      T('12627', 'Karnataka Exp', 'exp', 'YARD', 'YPR'), T('12628', 'Karnataka Exp (terminates)', 'exp', 'YPR', 'YARD'),
      T('18463', 'Prashanti Exp', 'exp', 'YARD', 'YPR'), T('16591', 'Hampi Exp', 'exp', 'YARD', 'YPR'),
      T('12658', 'Chennai Mail (terminates)', 'exp', 'BNC', 'YARD'), T('12657', 'Chennai Mail', 'exp', 'YARD', 'BNC'),
      T('BCN', 'Container special', 'goods', 'YPR', 'BNC')
    ],
    locals: { every: 22, label: 'MEMU', names: ['Mysuru–Bangarpet', 'Bangarpet–Mysuru', 'Tumakuru–Whitefield'],
      pairs: [['MYS', 'BNC'], ['BNC', 'MYS'], ['YPR', 'BNC']], base: 66550 }
  },
  MAS: {
    name: 'MGR Chennai Central', local: 'சென்னை சென்ட்ரல்', pf: 17, goods: 0, terminal: true, sideNames: ['BUFFER STOPS', 'OUT'],
    left: [],
    right: [L('SUB', 'Suburban · Avadi · Tiruvallur', { pf: range(1, 6) }), L('AJJ', 'Arakkonam · Katpadi · Bengaluru'), L('GDR', 'Basin Bridge · Gudur · Vijayawada'), L('YARD', 'Basin Bridge coaching yard')],
    trains: [
      T('12841', 'Coromandel Exp (terminates)', 'exp', 'GDR', 'YARD'), T('12842', 'Coromandel Exp', 'exp', 'YARD', 'GDR'),
      T('12657', 'Chennai Mail', 'exp', 'YARD', 'AJJ'), T('12658', 'Chennai Mail (terminates)', 'exp', 'AJJ', 'YARD'),
      T('12759', 'Charminar Exp (terminates)', 'exp', 'GDR', 'YARD'), T('12621', 'Tamil Nadu Exp', 'exp', 'YARD', 'GDR'),
      T('20607', 'Vande Bharat', 'vip', 'YARD', 'AJJ'), T('12007', 'Shatabdi Exp', 'vip', 'YARD', 'AJJ'),
      T('12711', 'Pinakini Exp (terminates)', 'exp', 'GDR', 'YARD')
    ],
    locals: { every: 12, label: 'EMU', names: ['Chennai Central–Tiruvallur', 'Chennai Central–Arakkonam', 'Chennai Central–Avadi'],
      pairs: [['SUB', 'SUB'], ['SUB', 'SUB'], ['AJJ', 'AJJ']], base: 43500 }
  },
  ATP: {
    name: 'Anantapur', local: 'అనంతపురం', pf: 3, goods: 1, sideNames: ['SOUTH', 'NORTH'],
    left: [L('DMM', 'Dharmavaram · Puttaparthi · Bengaluru')],
    right: [L('GTLD', 'Guntakal direct line'), L('GY', 'Gooty · Kurnool · Hyderabad')],
    trains: [
      T('18463', 'Prashanti Exp', 'exp', 'DMM', 'GY'), T('18464', 'Prashanti Exp', 'exp', 'GY', 'DMM'),
      T('22691', 'Rajdhani Exp', 'vip', 'DMM', 'GY', { nonstop: true }), T('22692', 'Rajdhani Exp', 'vip', 'GY', 'DMM', { nonstop: true }),
      T('12627', 'Karnataka Exp', 'exp', 'DMM', 'GTLD'), T('12628', 'Karnataka Exp', 'exp', 'GTLD', 'DMM'),
      T('17603', 'Kacheguda–Yelahanka Exp', 'exp', 'GY', 'DMM'), T('07415', 'Guntakal–Anantapur DEMU', 'pass', 'GTLD', 'DMM'),
      T('BOXN', 'Iron ore rake', 'goods', 'GTLD', 'DMM'), T('BCN', 'Container special', 'goods', 'DMM', 'GY')
    ]
  },
  KZJ: {
    name: 'Kazipet Jn', local: 'కాజీపేట', pf: 4, goods: 2, sideNames: ['WEST', 'EAST'],
    left: [L('SC', 'Jangaon · Bhongir · Secunderabad')],
    right: [L('PDPL', 'Peddapalli · Balharshah · Delhi'), L('WL', 'Warangal · Khammam · Vijayawada')],
    trains: [
      T('12723', 'Telangana Exp', 'exp', 'SC', 'PDPL'), T('12724', 'Telangana Exp', 'exp', 'PDPL', 'SC'),
      T('12437', 'Rajdhani Exp', 'vip', 'SC', 'PDPL'), T('12793', 'Rayalaseema Exp', 'exp', 'SC', 'WL'),
      T('12794', 'Rayalaseema Exp', 'exp', 'WL', 'SC'), T('12727', 'Godavari Exp', 'exp', 'SC', 'WL'),
      T('12759', 'Charminar Exp', 'exp', 'SC', 'WL'), T('20702', 'Vande Bharat', 'vip', 'WL', 'SC'),
      T('57121', 'Kazipet–Balharshah Passenger', 'pass', 'WL', 'PDPL'),
      T('BOXN', 'Ramagundam coal rake', 'goods', 'PDPL', 'WL'), T('BOXN', 'Singareni coal rake', 'goods', 'PDPL', 'SC'), T('BCN', 'Container special', 'goods', 'WL', 'PDPL')
    ]
  },
  CSMT: {
    name: 'Mumbai CSMT', local: 'छत्रपती शिवाजी महाराज टर्मिनस', pf: 18, goods: 0, terminal: true, sideNames: ['BUFFER STOPS', 'OUT'],
    left: [],
    right: [L('HB', 'Harbour line · Wadala · Vashi · Panvel', { pf: [1, 2] }), L('ML', 'Main line locals · Dadar · Thane · Kalyan', { pf: range(3, 7) }),
      L('MAIN', 'Long distance · Dadar · Kalyan · Pune / Nashik', { pf: range(8, 18) }), L('YARD', 'Wadi Bunder yard', { pf: range(8, 18) })],
    trains: [
      T('12123', 'Deccan Queen', 'vip', 'YARD', 'MAIN'), T('12124', 'Deccan Queen (terminates)', 'vip', 'MAIN', 'YARD'),
      T('22221', 'Rajdhani Exp', 'vip', 'YARD', 'MAIN'), T('12137', 'Punjab Mail (terminates)', 'exp', 'MAIN', 'YARD'),
      T('11301', 'Udyan Exp', 'exp', 'YARD', 'MAIN'), T('12809', 'Howrah Mail', 'exp', 'YARD', 'MAIN'),
      T('22225', 'Vande Bharat (terminates)', 'vip', 'MAIN', 'YARD'), T('11020', 'Konark Exp (terminates)', 'exp', 'MAIN', 'YARD')
    ],
    locals: { every: 5, label: 'Local', names: ['Kalyan fast', 'Thane slow', 'Kasara fast', 'Panvel', 'Vashi', 'Karjat fast', 'Dombivli slow', 'Bandra (Harbour)'],
      pairs: [['ML', 'ML'], ['ML', 'ML'], ['ML', 'ML'], ['HB', 'HB'], ['HB', 'HB'], ['ML', 'ML'], ['ML', 'ML'], ['HB', 'HB']], base: 95001 }
  }
};

// Default traffic: average seconds between main-line trains at "Normal" flow (game time), per station.
// Suburban locals come on top (their own interval in each station's locals.every).
export const SM_FLOW = { GTL: 26, SC: 22, BZA: 18, SBC: 22, MAS: 16, ATP: 45, KZJ: 24, CSMT: 24 };
export const FLOW_LEVELS = [
  { k: 0.5, label: 'Quiet' }, { k: 0.75, label: 'Light' }, { k: 1, label: 'Normal' }, { k: 1.5, label: 'Busy' }, { k: 2, label: 'Peak hour' }
];
const MODE_FLOW = { rush15: 1, rush20: 1, move100: 1.25, endless: 0.75 }; // endless starts gentle and ramps up

export const SM_MODES = {
  rush15: { label: 'Rush 15 min', limit: 15 * 60 },
  rush20: { label: 'Rush 20 min', limit: 20 * 60 },
  move100: { label: 'Move 100 trains', target: 100 },
  endless: { label: 'Endless (until gridlock)' }
};

const KIND = {
  local: { dwell: 6, pts: 50, col: '#22c55e', len: 0.42 },
  pass: { dwell: 10, pts: 70, col: '#a3a3a3', len: 0.5 },
  exp: { dwell: 14, pts: 100, col: '#3b82f6', len: 0.8 },
  vip: { dwell: 10, pts: 160, col: '#f59e0b', len: 0.78 },
  goods: { dwell: 4, pts: 70, col: '#92400e', len: 0.92 }
};
const BOOKED_MIN = { local: 1, pass: 2, exp: 5, vip: 3, goods: 1 };
export const haltSecs = (min) => Math.max(5, 5 + (min - 1) * (20 / 9));   // 1 min -> 5 s, 10 min -> 25 s
const MOVE_SECS = 4.5, APPROACH_SECS = 90, GRIDLOCK_QUEUE = 5; // trains show up 90 real seconds before the home signal

export class StationMaster {
  // announce(text, localInfo): station PA; onGameOver({ mode, venue, score, trains, avgDelay }); onView(view)
  constructor(root, { onExit, toast, announce, onGameOver, onView } = {}) {
    this.root = root; this.onExit = onExit; this.toast = toast || (() => {});
    this.announce = announce || (() => {}); this.onGameOver = onGameOver || (() => {}); this.onView = onView || (() => {});
    this.view = 'drone';
    this.speed = 2;
    this.dash = root.querySelector('#sm-dash');
    const press = (e) => { if (e.button > 0) return; this._dashClick(e); };
    if (this.dash) this.dash.addEventListener('pointerdown', press);
    root.querySelector('#sm-pfs')?.addEventListener('pointerdown', press);
    this.dashOpen = { arr: true, dep: true };
    this.canvas = root.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.info = root.querySelector('#sm-info');
    this.logEl = root.querySelector('#sm-log');
    this.titleEl = root.querySelector('#sm-title');
    this.flowEl = root.querySelector('#sm-flow-info');
    this.canvas.addEventListener('pointerdown', (e) => this._click(e));
    window.addEventListener('keydown', (e) => { if (this.running && e.key === 'Escape') this.sel = null; });
    this.running = false;
  }

  // opts.tracks: the real station's lines (from the simulator's layout); opts.physical: moves trains on them
  start(code, mode = 'rush15', opts = {}) {
    const S = SM_STATIONS[code];
    this.S = S; this.code = code; this.mode = mode; this.M = SM_MODES[mode];
    this.physical = opts.physical || null;
    this.speed ||= 1;
    if (opts.tracks) this.tracks = opts.tracks;
    else {
      this.tracks = [];
      for (let i = 1; i <= S.pf; i++) this.tracks.push({ pf: i, label: `PF ${i}`, occ: null });
      for (let g = 1; g <= S.goods; g++) this.tracks.push({ pf: null, label: `Goods ${g}`, occ: null });
      if (S.pf1South) this.tracks.reverse(); // rows run north -> south
    }
    this.tracks.forEach((t, i) => { t.i = i; });
    this.lines = {};
    S.left.forEach((l, k) => { this.lines[l.id] = { ...l, side: 0, k, n: S.left.length }; });
    S.right.forEach((l, k) => { this.lines[l.id] = { ...l, side: 1, k, n: S.right.length }; });
    Object.assign(this, { t: 0, realT: 0, trains: [], moves: [], score: 0, moved: 0, onTime: 0, sel: null, nextSpawn: 2, nextLocal: 4, seq: 0, over: null, msg: '' });
    this.flow ??= 1;                          // player's flow multiplier (Quiet .. Peak hour)
    this.flowBase = SM_FLOW[code] || 22;
    this._openingTraffic();
    this.root.style.display = 'flex';
    this.setView(this.view);
    if (!this.running) { this.running = true; this._last = performance.now(); if (!this.external) this._loop(); }
  }

  stop() { this.running = false; this.root.style.display = 'none'; this.setView('panel', true); }

  // 'panel' (signal panel) | 'tower' | 'drone' | 'platform' (the real station, drawn by smWorld.js through the main renderer)
  setView(v, closing = false) {
    this.view = v;
    this.root.classList.toggle('sm-3d', v !== 'panel');
    this.onView(closing ? null : v);
  }

  _loop() {
    if (!this.running) return;
    this.tick(Math.min(0.1, (performance.now() - this._last) / 1000));
    requestAnimationFrame(() => this._loop());
  }

  // one frame (called by the main render loop, so game, trains and camera move in the same frame)
  tick(dtReal) {
    if (!this.running) return;
    const now = performance.now(), dt = Math.min(0.1, dtReal) * (this.speed || 1);
    this._last = now;
    this.realT += Math.min(0.1, dtReal);
    this._dtReal = Math.min(0.1, dtReal);
    if (!this.over) this._pendingTick();
    if (!this.over) this._update(dt);
    if (this.view === 'panel') this._draw(); else this._info();
    if (!this._dt || now - this._dt > 250) { this._dt = now; this._dashboard(); }
  }

  // ------------------------------------------------------------ simulation
  _spawn(tpl, local = false) {
    const k = KIND[tpl.kind];
    const tr = { ...tpl, id: ++this.seq, state: 'approach', eta: APPROACH_SECS, wait: 0, readyWait: 0, track: null, local, through: tpl.kind === 'goods',
      booked: tpl.nonstop ? 0 : (tpl.reverse ? 10 : tpl.from === 'YARD' ? 10 : BOOKED_MIN[tpl.kind] ?? 2) };
    tr.dwell = tpl.nonstop ? 2 : haltSecs(tr.booked); // must stand at least its booked halt before it can be sent off
    this.trains.push(tr);
  }

  // The shift starts mid-service: a few trains already standing at platforms (yours to send off), and the
  // first arrivals not far out.
  _openingTraffic() {
    const S = this.S, list = (this.roster?.length ? this.roster : S.trains).filter((t) => t.kind !== 'goods');
    const pick = () => list[Math.floor(Math.random() * list.length)];
    const pfs = this.tracks.filter((t) => t.pf).sort(() => Math.random() - 0.5);
    const n = Math.min(3, Math.max(1, Math.floor(pfs.length / 3)));
    for (let k = 0, used = 0; k < pfs.length && used < n; k++) {
      const tpl = pick(), tk = pfs[k];
      this._spawn(tpl);
      const tr = this.trains.at(-1);
      if (!this._allowed(tr, tk, false)) { // '' = allowed
        tr.state = k === 0 ? 'ready' : 'dwell'; tr.eta = 0;
        tr.dwell = k === 0 ? 0 : 6 + Math.random() * 14;
        tr.track = tk; tk.occ = tr; tr.preplaced = true; used++;
      } else this.trains.pop();
    }
    for (const eta of [18, 42]) { this._spawn(pick()); this.trains.at(-1).eta = eta; }
    this.nextSpawn = 25;
  }

  _update(dt) {
    this.t += dt;
    const S = this.S;
    // traffic builds up as the session goes on
    const ramp = Math.min(1, this.t / 420);
    this.nextSpawn -= dt;
    if (this.nextSpawn <= 0) {
      const list = this.roster?.length ? this.roster : S.trains;
      if (!this._bag?.length) this._bag = list.slice().sort(() => Math.random() - 0.5);
      const tpl = this._bag.pop();
      this._spawn(tpl);
      const k = this.flowK();
      this.nextSpawn = (this.flowBase / k) * (1 - (this.mode === 'endless' ? 0.4 : 0.2) * ramp) * (0.65 + Math.random() * 0.7);
    }
    if (S.locals) {
      this.nextLocal -= dt;
      if (this.nextLocal <= 0) {
        const L0 = S.locals, j = Math.floor(Math.random() * L0.pairs.length);
        const [from, to] = L0.pairs[j];
        this._spawn({ no: String(L0.base + Math.floor(Math.random() * 400)), name: `${L0.label} ${L0.names[j % L0.names.length]}`, kind: 'local', from, to }, true);
        this.nextLocal = (L0.every / this.flowK()) * (1.15 - 0.35 * ramp) * (0.75 + Math.random() * 0.5);
      }
    }
    for (const tr of this.trains) {
      if (tr.state === 'approach') { tr.eta -= this._dtReal ?? dt; if (tr.eta <= 0) { tr.state = 'home'; tr.eta = 0; if (tr.pending) this._pendingTick(); } }
      else if (tr.state === 'home') { tr.wait += dt; if (tr.wait > 60 && !tr.angry) { tr.angry = true; this._log(`⚠ ${tr.no} ${tr.name} held at the home signal for a minute — passengers are restless`); } }
      else if (tr.state === 'dwell') { tr.dwell -= this._dtReal ?? dt; if (tr.dwell <= 0) { tr.state = 'ready'; } }
      else if (tr.state === 'ready') tr.readyWait += dt;
    }
    for (const m of this.moves) m.p = this.physical ? this.physical.progress(this, m, dt) : m.p + dt / MOVE_SECS;
    for (const m of this.moves.filter((x) => x.p >= 1)) {
      const tr = m.tr;
      if (m.dir === 'in') {
        tr.state = 'dwell';
        if (tr.through) { tr.state = 'ready'; if (!this.routeOut(tr, true)) { tr.wantOut = true; tr.err = `Could not run through — stopped at ${tr.track.label}; leaves as soon as its exit clears`; tr.errAt = this.realT; } }
      }
      else { // left the station
        tr.state = 'gone';
        this._finish(tr);
      }
    }
    this.moves = this.moves.filter((m) => m.p < 1);
    this.trains = this.trains.filter((tr) => tr.state !== 'gone');
    // end conditions
    if (this.M.limit && this.t >= this.M.limit) this._end(`Time up — ${this.moved} trains moved`);
    if (this.M.target && this.moved >= this.M.target) this._end(`${this.M.target} trains moved in ${fmt(this.t)}`);
    if (this.mode === 'endless') {
      for (const id of Object.keys(this.lines)) if (this._queue(id).length >= GRIDLOCK_QUEUE) { this._end(`Gridlock on the ${this.lines[id].label} line after ${fmt(this.t)}`); break; }
    }
  }

  _finish(tr) {
    const k = KIND[tr.kind];
    const delay = tr.wait + tr.readyWait;
    let pts = k.pts - Math.max(0, delay - 8) * (tr.kind === 'vip' ? 6 : 2);
    if (tr.badPlatform) pts -= 30;
    pts = Math.round(Math.max(-80, pts));
    this.score += pts; this.moved++;
    if (delay <= 15) this.onTime++;
    if (tr.track) tr.track.occ = null;
    this._log(`${pts >= 0 ? '✓' : '✗'} ${tr.no} ${tr.name}: ${pts >= 0 ? '+' : ''}${pts} (${Math.round(delay)} s delay)`);
  }

  _end(text) {
    this.over = text;
    this.onGameOver({ mode: 'station', venue: this.code, score: this.score, trains: this.moved, onTime: this.onTime, modeLabel: this.M.label, text });
    this.sel = null;
    this._log(`■ ${text}. Score ${this.score}`);
    try {
      const key = `sm-best-${this.code}-${this.mode}`, best = Number(localStorage.getItem(key) || -1e9);
      if (this.score > best) { localStorage.setItem(key, String(this.score)); this.best = true; }
    } catch { /* storage unavailable */ }
  }

  _log(text) { this.msg = text; this.log = [text, ...(this.log || [])].slice(0, 6); }

  _queue(lineId) { return this.trains.filter((tr) => tr.state === 'home' && tr.from === lineId).sort((a, b) => b.wait - a.wait); }

  // two routes through the same throat clash if they share a line or a track, or cross each other
  _conflict(side, k, ti) {
    for (const m of this.moves) {
      if (m.side !== side) continue;
      if (m.k === k || m.ti === ti || (m.k - k) * (m.ti - ti) < 0) return m;
    }
    return null;
  }

  _allowed(tr, track, through = tr.through) {
    if (track.occ && track.occ !== tr) return `${track.label} is occupied by ${track.occ.no}`;
    if (track.reserved && track.reserved !== tr && track.reserved.state !== 'gone') return `${track.label} is already chosen for ${track.reserved.no}`;
    if (tr.kind !== 'goods' && !through && !track.pf) return `${track.label} has no platform — a train can only pass through it`;
    for (const id of [tr.from, tr.to]) {
      const l = this.lines[id];
      if (l?.pf && !(track.pf && l.pf.includes(track.pf))) return `${l.label} only reaches PF ${l.pf[0]}–${l.pf[l.pf.length - 1]}`;
    }
    return null;
  }

  flowK() { return this.flow * (MODE_FLOW[this.mode] || 1); }
  trainsPerHour() {
    const main = 3600 / (this.flowBase / this.flowK()), loc = this.S.locals ? 3600 / (this.S.locals.every / this.flowK()) : 0;
    return Math.round(main + loc);
  }

  // Choose a line: the route is set at once (or, for a train still approaching, the moment it reaches
  // the home signal, so it runs in without stopping). One change is allowed while it is still possible.
  select(tr, track) {
    if (this.over || !tr) return false;
    const why = this._allowed(tr, track);
    if (why) { tr.err = why; tr.errAt = this.realT; return false; }
    const first = !tr.pending && !(tr.state === 'in' && tr.track);
    if (!first) {
      if ((tr.changes || 0) >= 1) { tr.err = 'Only one change is allowed — the route stays as set'; tr.errAt = this.realT; return false; }
      if (!this._change(tr, track)) return false;
      tr.changes = 1;
      return true;
    }
    if (tr.state !== 'home' && tr.state !== 'approach') return false;
    tr.pending = { track, through: !!tr.through };
    track.reserved = tr;
    tr.err = null; tr.wait2 = null;
    this.sel = null;
    if (tr.state === 'home') this._pendingTick();
    return true;
  }

  // the one change: before the route is set just re-point it; once moving, only while it is still short
  // of the points and the new route is clear
  _change(tr, track) {
    if (tr.pending) {
      tr.pending.track.reserved = null;
      tr.pending = { track, through: !!tr.through };
      track.reserved = tr;
      if (tr.state === 'home') this._pendingTick();
      return true;
    }
    const m = this.moves.find((x) => x.tr === tr && x.dir === 'in');
    if (!m || m.p > 0.35) { tr.err = 'Too late to change — the train is already over the points'; tr.errAt = this.realT; return false; }
    const line = this.lines[tr.from];
    this.moves = this.moves.filter((x) => x !== m);
    const c = this._conflict(line.side, line.k, track.i);
    if (c) { this.moves.push(m); tr.err = `Can't change now: ${c.tr.no} is crossing that route`; tr.errAt = this.realT; return false; }
    tr.track.occ = null;
    track.occ = tr; tr.track = track;
    this.moves.push({ tr, dir: 'in', side: line.side, k: line.k, ti: track.i, p: m.p, reroute: true });
    this.physical?.reroute?.(this, tr);
    this._log(`${tr.no} rerouted to ${track.label}`);
    return true;
  }
  cancelSelect(tr) {
    if (!tr?.pending) return;
    tr.pending.track.reserved = null; tr.pending = null;
  }
  _pendingTick() {
    for (const tr of this.trains) {
      const p = tr.pending;
      if (p && tr.state === 'home') {
        tr.through = p.through;
        const r = this._tryIn(tr, p.track);
        if (r === true) { p.track.reserved = null; tr.pending = null; tr.wait2 = null; }
        else tr.wait2 = r;
      }
      if (tr.wantOut && tr.state === 'ready') { const r = this._tryOut(tr); if (r === true) tr.wantOut = false; else tr.wait2 = r; }
    }
  }

  routeIn(tr, track) { return this.select(tr, track); }

  _tryIn(tr, track) {
    if (track.occ) return `${track.label} is occupied by ${track.occ.no}`;
    const line = this.lines[tr.from];
    const q = this._queue(tr.from);
    if (q[0] !== tr) return `Behind ${q[0].no} on the same line`;
    const c = this._conflict(line.side, line.k, track.i);
    if (c) return `Waiting for ${c.tr.no} ${c.tr.name} to clear the ${this.S.sideNames[line.side].toLowerCase()} points — route sets itself`;
    if (tr.kind === 'goods' && track.pf && !tr.through) { tr.badPlatform = true; this._log(`${tr.no} goods taken through ${track.label} — a platform is blocked`); }
    track.occ = tr; tr.track = track; tr.state = 'in';
    this._pa(tr, tr.through ? 'through' : 'arriving');
    this.moves.push({ tr, dir: 'in', side: line.side, k: line.k, ti: track.i, p: 0 });
    return true;
  }

  // starter: clears now, or as soon as the exit is clear
  routeOut(tr, quiet = false) {
    if (tr.state !== 'ready') return false;
    const r = this._tryOut(tr);
    if (r === true) return true;
    if (!quiet) { tr.wantOut = true; tr.wait2 = r; }
    return false;
  }
  _tryOut(tr) {
    const line = this.lines[tr.to];
    const c = this._conflict(line.side, line.k, tr.track.i);
    if (c) return `Starter requested — waiting for ${c.tr.no} ${c.tr.name} to clear the ${this.S.sideNames[line.side].toLowerCase()} points`;
    tr.state = 'out';
    if (!tr.through) this._pa(tr, tr.to === 'YARD' ? 'yard' : 'departing');
    this.moves.push({ tr, dir: 'out', side: line.side, k: line.k, ti: tr.track.i, p: 0 });
    tr.wait2 = null;
    return true;
  }

  // Station PA, matching what the station master just did with the signals
  _pa(tr, what) {
    const pf = tr.track?.pf, where = pf ? `platform number ${pf}` : tr.track ? tr.track.label.toLowerCase().replace('goods', 'goods line') : 'the main line';
    const goods = tr.kind === 'goods';
    const id = goods ? 'A goods train' : `Train number ${tr.no.split('').join(' ')}, ${tr.name.replace(/ \(terminates\)/, '').replace(/\bExp\b/, 'Express')}`;
    const from = this.lines[tr.from]?.label.split(' · ').at(-1), to = this.lines[tr.to]?.label.split(' · ').at(-1);
    let text;
    if (what === 'arriving') text = `May I have your attention please. ${id}${goods || tr.from === 'YARD' ? '' : ` from ${from}`}, is arriving on ${where}.`;
    else if (what === 'through') text = `Attention please. ${id} will pass through ${where} without stopping. Passengers are requested to stand behind the yellow line.`;
    else if (what === 'departing') text = `${id}${goods ? '' : ` to ${to}`}, is leaving from ${where}. We wish you a happy journey.`;
    else text = `${id} has terminated. The rake is being taken to the yard. Passengers are requested not to board.`;
    if (goods && what === 'arriving') text = `Attention please. A goods train is arriving on ${where}.`;
    const kind = what === 'through' ? null : what === 'departing' ? 'departing' : what === 'arriving' ? 'arriving' : null;
    this.announce(text, goods || !kind ? null : { kind, no: tr.no, name: tr.name.replace(/ \(terminates\)/, ''), pf, code: this.code, stnName: this.S.name });
  }

  // ------------------------------------------------------------ dashboard (works in every view)
  // the route choice for one train: Halt / Pass switch + one button per usable line (also used above the train)
  chooserHtml(t) {
    const btn = (act, id, label, on = true, cls = '') => `<button class="${cls}" data-act="${act}" data-id="${id}" ${on ? '' : 'disabled'}>${label}</button>`;
    const set = t.track && t.state === 'in' ? t.track : t.pending?.track;
    const canChange = !set || (t.changes || 0) < 1;
    if (!canChange) return '';
    const sw = t.kind === 'local' ? '' : `<div class="mode-switch">${btn('halt', t.id, '■ HALT', true, t.through ? '' : 'on halt')}${btn('pass', t.id, '▶ PASS THROUGH', true, t.through ? 'on pass' : '')}</div>`;
    const lines = this.tracks.filter((tk) => t.through || t.kind === 'goods' || tk.pf).map((tk) => {
      const name = tk.pf ? `PF ${tk.pf}` : tk.label.replace(/\s*\(.*\)/, '');
      const chosen = set === tk;
      return btn('pf', `${t.id}:${tk.i}`, `${chosen ? '✓ ' : ''}${t.through ? 'Pass' : 'Halt'} ${name}`, !chosen && !this._allowed(t, tk), `pfb ${t.through ? 'pass' : 'halt'}${tk.pf ? '' : ' loop'}${chosen ? ' chosen' : ''}`);
    }).join('');
    return sw + `<div class="row pfrow">${lines}</div>`;
  }

  statusHtml(t) {
    let x = '';
    const set = t.track && t.state === 'in' ? t.track : null, p = t.pending;
    const mode = (thr) => (thr ? 'Pass through' : 'Halt at');
    if (set) x += `<div class="sel-st lock">▶ Route set: ${mode(t.through)} <b>${set.label}</b>${(t.changes || 0) < 1 ? ' · 1 change left' : ''}</div>`;
    else if (p && t.state === 'approach') x += `<div class="sel-st lock">▶ ${mode(p.through)} <b>${p.track.label}</b> — runs straight in, no stop${(t.changes || 0) < 1 ? ' · 1 change left' : ''}</div>`;
    else if (p) x += `<div class="sel-st pend">🔒 ${mode(p.through)} <b>${p.track.label}</b>${t.wait2 ? `<br><span>${t.wait2}</span>` : ''}</div>`;
    else if (t.wantOut && t.wait2) x += `<div class="sel-st pend">🔒 ${t.wait2}</div>`;
    if (t.err && this.realT - (t.errAt ?? this.realT) < 7) x += `<div class="sel-err">✗ ${t.err}</div>`;
    return x;
  }

  _dashboard() {
    if (!this.dash) return;
    const mmss = (sec) => `${Math.floor(sec / 60)}:${String(Math.max(0, Math.round(sec % 60))).padStart(2, '0')}`;
    const lineOf = (id) => this.lines[id]?.label.split(' · ')[0] || id;
    const btn = (act, id, label, on = true, cls = '') => `<button class="${cls}" data-act="${act}" data-id="${id}" ${on ? '' : 'disabled'}>${label}</button>`;
    const card = (t, sub, body = '', cls = '') => `<div class="sec-card ${cls}${this.sel === t ? ' sel' : ''}" data-act="pick" data-id="${t.id}"><b style="color:${KIND[t.kind].col}">${t.no}</b> ${t.name}<br><small>${sub}</small>${body}</div>`;
    // ARRIVALS: stopped at the home signal, approaching (set the route early), running in
    const waiting = this.trains.filter((t) => t.state === 'home').sort((a, b) => b.wait - a.wait);
    const coming = this.trains.filter((t) => t.state === 'approach').sort((a, b) => a.eta - b.eta);
    const runIn = this.trains.filter((t) => t.state === 'in');
    let arr = '';
    arr += waiting.map((t) => card(t, `⛔ stopped at the home signal ${Math.round(t.wait)} s · from ${lineOf(t.from)} → ${lineOf(t.to)}${t.reverse ? ' · reverses here' : ''}${this._queue(t.from)[0] === t ? '' : ' · queued behind'}`, this.chooserHtml(t) + this.statusHtml(t), 'arr urgent')).join('');
    arr += coming.map((t) => card(t, `🚆 at the home signal in <b>${mmss(t.eta)}</b> · from ${lineOf(t.from)} → ${lineOf(t.to)}${t.reverse ? ' · reverses here' : ''}`, this.chooserHtml(t) + this.statusHtml(t), 'arr')).join('');
    arr += runIn.map((t) => card(t, `↘ running in to ${t.track.label}`, this.chooserHtml(t) + this.statusHtml(t), 'arr')).join('');
    // DEPARTURES: on the platforms (boarding / ready) and leaving
    const onPf = this.trains.filter((t) => t.state === 'dwell' || t.state === 'ready').sort((a, b) => (a.state === 'ready' ? -1 : 1) - (b.state === 'ready' ? -1 : 1) || a.dwell - b.dwell);
    const leaving = this.trains.filter((t) => t.state === 'out');
    let dep = '';
    dep += onPf.map((t) => card(t, `${t.track.label} · ${t.state === 'ready' ? `<b class="rd">READY</b> to ${lineOf(t.to)} · waiting ${Math.round(t.readyWait)} s` : `${t.reverse ? 'engine change' : 'boarding'} · booked ${t.booked} min · departs in ${Math.ceil(t.dwell)} s → ${lineOf(t.to)}`}`,
      `<div class="row">${btn('starter', t.id, t.to === 'YARD' ? '▶ Signal rake to yard' : '▶ Clear starter signal', t.state === 'ready' && !t.wantOut, t.state === 'ready' ? 'go' : '')}</div>${this.statusHtml(t)}`, t.state === 'ready' ? 'dep ready' : 'dep')).join('');
    dep += leaving.map((t) => card(t, `↗ leaving ${t.track?.label || ''} towards ${lineOf(t.to)}`, '', 'dep')).join('');
    const sec = (key, title, n, body, cls) => `<div class="dash-sec ${cls}"><div class="dash-h" data-act="fold" data-id="${key}">${this.dashOpen[key] ? '▾' : '▸'} ${title} <span class="cnt">${n}</span></div>${this.dashOpen[key] ? (body || '<div class="muted sec-help">None right now.</div>') : ''}</div>`;
    const h = sec('arr', 'Arrivals', waiting.length + coming.length + runIn.length, arr, 'arrivals') + sec('dep', 'Departures', onPf.length + leaving.length, dep, 'departures');
    if (h !== this._lastDash) { this.dash.innerHTML = h; this._lastDash = h; }
    this._platformBoard();
  }

  // bottom-right board: every line with the train on it and what it is doing
  _platformBoard() {
    const el = this.root.querySelector('#sm-pfs');
    if (!el) return;
    const btn = (act, id, label, cls = '') => `<button class="${cls}" data-act="${act}" data-id="${id}">${label}</button>`;
    const rows = this.tracks.map((tk) => {
      const t = tk.occ, r = tk.reserved;
      let st = '<span class="free">free</span>', act = '';
      if (t) {
        st = t.state === 'in' ? `<span class="mv">${t.through ? 'running through' : 'arriving'}</span>` : t.state === 'dwell' ? `<span class="dw">${t.reverse ? 'engine change' : 'boarding'} ${Math.ceil(t.dwell)}s</span>`
          : t.state === 'ready' ? `<span class="rd">READY</span>` : `<span class="mv">departing</span>`;
        if (t.state === 'ready') act = t.wantOut ? '<span class="muted">starter requested</span>' : btn('starter', t.id, t.to === 'YARD' ? 'To yard' : 'Clear starter', 'go mini');
      } else if (r) st = `<span class="rs">booked for ${r.no}</span>`;
      const who = t ? `<b style="color:${KIND[t.kind].col}">${t.no}</b> ${t.name}` : r ? `<i>${r.no} ${r.name}</i>` : '—';
      return `<tr><td class="ln">${tk.label}</td><td>${who}</td><td>${st}</td><td>${act}</td></tr>`;
    }).join('');
    const html = `<div class="pfs-h">Platforms & lines</div><table>${rows}</table>`;
    if (html !== this._lastPfs) { el.innerHTML = html; this._lastPfs = html; }
  }

  _dashClick(e) {
    const b = e.target.closest('button[data-act]') || e.target.closest('[data-act="fold"]') || e.target.closest('[data-act="pick"]');
    if (!b) return;
    if (b.dataset.act === 'fold') { this.dashOpen[b.dataset.id] = !this.dashOpen[b.dataset.id]; this._lastDash = null; this._dashboard(); return; }
    if (this.over) return;
    if (b.tagName === 'BUTTON') e.preventDefault();
    if (b.dataset.act === 'pick') { const t = this.trains.find((x) => x.id === Number(b.dataset.id)); if (t) this.sel = t; return; }
    const [id, ti] = b.dataset.id.split(':').map(Number);
    const tr = this.trains.find((t) => t.id === id);
    if (!tr) return;
    tr.err = null;
    if (b.dataset.act === 'halt') { tr.through = false; if (tr.pending && !tr.pending.locked && !this._allowed(tr, tr.pending.track)) tr.pending.through = false; else if (tr.pending && !tr.pending.locked) this.cancelSelect(tr); }
    else if (b.dataset.act === 'pass') { tr.through = true; if (tr.pending && !tr.pending.locked) tr.pending.through = true; }
    else if (b.dataset.act === 'cancel') this.cancelSelect(tr);
    else if (b.dataset.act === 'pf') this.select(tr, this.tracks[ti]);
    else if (b.dataset.act === 'starter') this.routeOut(tr);
    this._lastDash = null;
    this._dt = 0;
  }

  // Airport-Madness style picking (3D view or panel): tap a waiting train, then a platform line;
  // tap a READY train to clear its starter.
  clickTrain(tr) {
    if (this.over || !tr) return;
    if (tr.state === 'ready') { this.routeOut(tr); return; }
    if (tr.state === 'home' || tr.state === 'approach' || tr.state === 'in') { this.sel = this.sel === tr ? null : tr; this._dt = 0; }
  }
  clickTrack(track) {
    if (this.over || !track) return;
    if (track.occ && track.occ.state === 'ready') { this.routeOut(track.occ); return; }
    if (this.sel) this.select(this.sel, track);
  }

  // ------------------------------------------------------------ layout & input
  _geom() {
    const W = this._off?.W ?? this.canvas.clientWidth, H = this._off?.H ?? this.canvas.clientHeight;
    const term = !!this.S.terminal;
    const gx0 = term ? W * 0.03 : W * 0.2, gx1 = W * 0.8;              // throat (signal) x on each side
    const px0 = term ? W * 0.06 : W * 0.32, px1 = term ? W * 0.62 : W * 0.68; // platform zone
    const top = 56, bot = H - 20, n = this.tracks.length, rowH = (bot - top) / n;
    const ty = (i) => top + (i + 0.5) * rowH;
    const ly = (l) => top + ((l.k + 0.5) / l.n) * (bot - top);
    return { W, H, gx0, gx1, px0, px1, top, bot, rowH, ty, ly, term };
  }

  _click(e) {
    if (this.over) return;
    const r = this.canvas.getBoundingClientRect(), x = e.clientX - r.left - (this._off?.x || 0), y = e.clientY - r.top - (this._off?.y || 0);
    for (const h of this._hits || []) {
      if (x < h.x0 || x > h.x1 || y < h.y0 || y > h.y1) continue;
      if (h.kind === 'queue') { this.clickTrain(h.tr); return; }
      if (h.kind === 'track') { this.clickTrack(h.track); return; }
    }
    this.sel = null;
  }

  // ------------------------------------------------------------ drawing: signal panel (EI / RRI style)
  _draw() {
    const c = this.canvas, dpr = window.devicePixelRatio || 1;
    const CW = c.clientWidth, CH = c.clientHeight;
    if (c.width !== Math.round(CW * dpr) || c.height !== Math.round(CH * dpr)) { c.width = Math.round(CW * dpr); c.height = Math.round(CH * dpr); }
    const g = this.ctx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#04070b'; g.fillRect(0, 0, CW, CH);
    const narrow = CW < 900, offX = narrow || this.root.classList.contains('min') ? 0 : 320, offY = narrow ? Math.min(CH * 0.5, 380) : 66;
    this._off = { x: offX, y: offY, W: CW - offX, H: CH - offY };
    g.translate(offX, offY);
    const W = this._off.W, H = this._off.H;
    const G = this._geom(), S = this.S, hits = [];
    const CY = '#38bdf8', WH = '#d4d4d8', YL = '#facc15', RD = '#ef4444', GN = '#22c55e', mono = (px, b = '') => `${b} ${px}px ui-monospace, Menlo, Consolas, monospace`;
    g.textBaseline = 'middle';
    // frame + title
    g.strokeStyle = '#1e3a5f'; g.lineWidth = 1.5; g.strokeRect(8, 8, W - 16, H - 16);
    g.fillStyle = CY; g.font = mono(13, 'bold'); g.fillText(`${S.name.toUpperCase()}  ·  ELECTRONIC INTERLOCKING PANEL`, 18, 24);
    g.font = mono(11); g.fillStyle = '#94a3b8'; g.fillText(`${S.local}   ${S.sideNames[0]} ◀   ▶ ${S.sideNames[1]}`, 18, 42);
    const moveOf = (ti) => this.moves.find((m) => m.ti === ti);
    // tracks
    for (const tk of this.tracks) {
      const y = G.ty(tk.i), m = moveOf(tk.i), occ = tk.occ;
      const lit = m ? YL : occ ? RD : WH;
      g.strokeStyle = lit; g.lineWidth = m ? 4 : 2.5; g.setLineDash(tk.pf ? [] : [10, 5]);
      g.beginPath(); g.moveTo(G.term ? G.px0 - 8 : G.gx0 + 30, y); g.lineTo(G.gx1 - 30, y); g.stroke(); g.setLineDash([]);
      // track-section insulation joints
      g.fillStyle = '#04070b'; for (const x of [G.px0, G.px1]) g.fillRect(x - 1.5, y - 4, 3, 8);
      if (G.term) { g.fillStyle = RD; g.fillRect(G.px0 - 14, y - 7, 4, 14); }
      // platform box + line name
      g.font = mono(Math.min(11, G.rowH * 0.42), 'bold');
      if (tk.pf) { g.strokeStyle = '#475569'; g.lineWidth = 1; g.strokeRect(G.px0 + 40, y - G.rowH * 0.5 + 2, G.px1 - G.px0 - 80, Math.max(3, G.rowH * 0.16)); }
      g.fillStyle = CY; g.fillText(`${tk.pf ? `PF-${tk.pf}` : tk.label.toUpperCase()}`, G.px1 + 18, y + 1);
      if (occ) { // train on the track: label in the panel style
        const k = KIND[occ.kind];
        g.fillStyle = occ.state === 'ready' ? YL : '#e2e8f0'; g.font = mono(Math.min(11, G.rowH * 0.45), 'bold');
        g.fillText(`${occ.no} ${occ.name.toUpperCase().slice(0, 24)}  ${occ.state === 'dwell' ? `${Math.ceil(occ.dwell)}s` : occ.state === 'ready' ? 'READY ▶ TAP' : ''}`, G.px0 + 50, y - G.rowH * 0.28);
        g.fillStyle = k.col; g.fillRect(G.px0 + 44, y - 3, 3, 6);
      }
      const ok = this.sel && !this._allowed(this.sel, tk);
      if (this.sel && ok) { g.strokeStyle = 'rgba(34,197,94,.55)'; g.lineWidth = 1; g.strokeRect(G.px0, y - G.rowH / 2 + 1, G.px1 - G.px0, G.rowH - 2); }
      // starter signals at both ends
      for (const [x, side] of [[G.px0 - 12, 0], [G.px1 + 2, 1]]) {
        if (G.term && side === 0) continue;
        const out = m && m.dir === 'out' && this.lines[m.tr.to].side === side;
        g.fillStyle = out ? GN : RD; g.beginPath(); g.arc(x + 5, y - 9, 3.2, 0, 7); g.fill();
        g.strokeStyle = '#64748b'; g.lineWidth = 1; g.beginPath(); g.moveTo(x + 5, y - 6); g.lineTo(x + 5, y - 2); g.stroke();
      }
      hits.push({ kind: 'track', track: tk, x0: G.px0, x1: G.px1 + 70, y0: y - G.rowH / 2, y1: y + G.rowH / 2 });
    }
    // points / routes in the throats
    for (const m of this.moves) {
      const l = this.lines[m.dir === 'in' ? m.tr.from : m.tr.to], left = l.side === 0;
      const xs = left ? G.gx0 : G.gx1, xp = left ? G.px0 : G.px1, ly = G.ly(l), ty = G.ty(m.ti);
      g.strokeStyle = YL; g.lineWidth = 4;
      g.beginPath(); g.moveTo(xs, ly); g.bezierCurveTo((xs + xp) / 2, ly, (xs + xp) / 2, ty, xp, ty); g.stroke();
      const p = m.dir === 'in' ? m.p : 1 - m.p, x = xs + (xp - xs) * p, y = ly + (ty - ly) * (p * p * (3 - 2 * p));
      g.fillStyle = RD; g.fillRect(x - 14, y - 4, 28, 8);
      g.fillStyle = '#fff'; g.font = mono(9, 'bold'); g.fillText(m.tr.no, x - 13, y - 10);
    }
    // approach lines, home signals and the trains waiting there
    for (const l of Object.values(this.lines)) {
      const y = G.ly(l), left = l.side === 0, xs = left ? G.gx0 : G.gx1;
      const q = this._queue(l.id), routeIn = this.moves.some((m) => m.dir === 'in' && m.tr.from === l.id);
      g.strokeStyle = q.length ? RD : WH; g.lineWidth = 2.5;
      g.beginPath(); g.moveTo(left ? 14 : W - 14, y); g.lineTo(xs, y); g.stroke();
      // home signal
      const sx = xs + (left ? -16 : 16);
      g.fillStyle = routeIn ? GN : RD; g.beginPath(); g.arc(sx, y - 11, 4.5, 0, 7); g.fill();
      g.fillStyle = YL; g.beginPath(); g.arc(sx + (left ? -10 : 10), y - 11, 3, 0, 7); g.globalAlpha = routeIn ? 1 : 0.15; g.fill(); g.globalAlpha = 1;
      g.fillStyle = CY; g.font = mono(10.5, 'bold'); g.textAlign = left ? 'left' : 'right';
      g.fillText(`${left ? '◀ ' : ''}${l.label.toUpperCase()}${left ? '' : ' ▶'}`, left ? 18 : W - 18, y - 24);
      g.font = mono(9.5); g.fillStyle = '#64748b'; g.fillText(`HOME ${l.id}`, sx + (left ? -40 : 40), y + 12);
      q.forEach((tr, j) => {
        if (j > 2) return;
        const bw = Math.min(170, (left ? G.gx0 : W - G.gx1) - 30), bh = 22;
        const bx = left ? xs - bw - 26 : xs + 26, by = y + 18 + j * (bh + 3);
        g.fillStyle = this.sel === tr ? YL : '#0f172a'; g.strokeStyle = KIND[tr.kind].col; g.lineWidth = 1.5;
        g.globalAlpha = j === 0 ? 1 : 0.55; g.fillRect(bx, by, bw, bh); g.strokeRect(bx, by, bw, bh); g.globalAlpha = 1;
        g.fillStyle = this.sel === tr ? '#111' : '#e2e8f0'; g.font = mono(10, 'bold'); g.textAlign = 'left';
        g.fillText(`${tr.no} ${tr.name.toUpperCase()}`.slice(0, 24), bx + 4, by + 7);
        g.font = mono(9); g.fillText(`${Math.round(tr.wait)}s → ${(this.lines[tr.to]?.label.split(' · ')[0] || tr.to).toUpperCase()}${tr.through ? ' · THRU' : ''}`, bx + 4, by + 16);
        if (j === 0) hits.push({ kind: 'queue', tr, x0: bx, x1: bx + bw, y0: by, y1: by + bh });
      });
      const appr = this.trains.filter((tr) => tr.state === 'approach' && tr.from === l.id).length;
      if (appr) { g.fillStyle = YL; g.font = mono(9.5); g.textAlign = left ? 'left' : 'right'; g.fillText(`APPROACHING ×${appr}`, left ? 18 : W - 18, y - 38); }
      g.textAlign = 'left';
    }
    // axle-counter / track-circuit indication strip, as on the real panel
    const by = H - 34;
    g.strokeStyle = '#1e3a5f'; g.strokeRect(16, by - 14, W - 32, 26);
    g.font = mono(9.5, 'bold'); g.fillStyle = YL; g.fillText('TRACK CIRCUIT', 24, by);
    this.tracks.forEach((tk, i) => {
      const x = 130 + i * Math.min(70, (W - 160) / this.tracks.length);
      g.fillStyle = tk.occ ? RD : '#1f2937'; g.beginPath(); g.arc(x, by, 5, 0, 7); g.fill();
      g.fillStyle = CY; g.font = mono(9); g.fillText(tk.pf ? `${tk.pf}T` : `G${i}`, x + 8, by);
    });
    this._hits = hits;
    if (this.over) {
      g.fillStyle = 'rgba(2,6,23,.85)'; g.fillRect(W / 2 - 230, H / 2 - 60, 460, 120);
      g.fillStyle = YL; g.font = mono(18, 'bold'); g.textAlign = 'center'; g.fillText(this.over, W / 2, H / 2 - 18);
      g.fillStyle = '#e2e8f0'; g.font = mono(13); g.fillText(`SCORE ${this.score} · ${this.onTime}/${this.moved} ON TIME${this.best ? ' · NEW BEST' : ''}`, W / 2, H / 2 + 14);
      g.textAlign = 'left';
    }
    this._info();
  }

  _info() {
    const M = this.M;
    const left = M.limit ? `${fmt(Math.max(0, M.limit - this.t))} left` : M.target ? `${this.moved}/${M.target} · ${fmt(this.t)}` : fmt(this.t);
    const html = `<div class="sm-stat"><b>${this.score}</b><span>score</span></div><div class="sm-stat"><b>${this.moved}</b><span>moved</span></div>`
      + `<div class="sm-stat"><b>${this.moved ? Math.round((100 * this.onTime) / this.moved) : 100}%</b><span>on time</span></div><div class="sm-stat"><b>${left}</b><span>${M.label}</span></div>`;
    if (html !== this._lastInfo) { this.info.innerHTML = html; this._lastInfo = html; }
    const log = (this.over ? [`■ ${this.over} — score ${this.score}`] : []).concat(this.log || []).map((l) => `<div>${l}</div>`).join('');
    if (this.logEl && log !== this._lastLog) { this.logEl.innerHTML = log; this._lastLog = log; }
    if (this.titleEl) this.titleEl.textContent = `${this.S.name} · ${this.S.local}`;
    if (this.flowEl) { const txt = `≈ ${this.trainsPerHour()} trains / hour${this.S.locals ? ` incl. ${this.S.locals.label}` : ''}`; if (this.flowEl.textContent !== txt) this.flowEl.textContent = txt; }
  }
}

function fmt(s) { s = Math.max(0, Math.floor(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
