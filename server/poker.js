'use strict';

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const RANK_VAL = {};
RANKS.forEach((r, i) => RANK_VAL[r] = i + 2);

const HAND_NAMES = [
  'High card','One pair','Two pair','Three of a kind',
  'Straight','Flush','Full house','Four of a kind',
  'Straight flush','Royal flush'
];

function makeDeck() {
  const d = [];
  for (const s of SUITS) for (const r of RANKS) d.push({ rank: r, suit: s });
  return d;
}

function shuffle(d) {
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

function evalFive(cards) {
  const ranks = cards.map(c => RANK_VAL[c.rank]).sort((a, b) => b - a);
  const suits = cards.map(c => c.suit);
  const isFlush = suits.every(s => s === suits[0]);
  const rankCount = {};
  ranks.forEach(r => rankCount[r] = (rankCount[r] || 0) + 1);
  const counts = Object.values(rankCount).sort((a, b) => b - a);
  const uniqueRanks = [...new Set(ranks)].sort((a, b) => b - a);

  let isStraight = false, straightHigh = 0;
  if (uniqueRanks.length === 5) {
    if (uniqueRanks[0] - uniqueRanks[4] === 4) { isStraight = true; straightHigh = uniqueRanks[0]; }
    if (JSON.stringify(uniqueRanks) === JSON.stringify([14,5,4,3,2])) { isStraight = true; straightHigh = 5; }
  }

  let cat, tiebreakers;
  if (isFlush && isStraight && straightHigh === 14) { cat = 9; tiebreakers = [14]; }
  else if (isFlush && isStraight) { cat = 8; tiebreakers = [straightHigh]; }
  else if (counts[0] === 4) {
    const four = +Object.keys(rankCount).find(k => rankCount[k] === 4);
    const kick = +Object.keys(rankCount).find(k => rankCount[k] === 1);
    cat = 7; tiebreakers = [four, kick];
  } else if (counts[0] === 3 && counts[1] === 2) {
    const three = +Object.keys(rankCount).find(k => rankCount[k] === 3);
    const two = +Object.keys(rankCount).find(k => rankCount[k] === 2);
    cat = 6; tiebreakers = [three, two];
  } else if (isFlush) { cat = 5; tiebreakers = ranks; }
  else if (isStraight) { cat = 4; tiebreakers = [straightHigh]; }
  else if (counts[0] === 3) {
    const three = +Object.keys(rankCount).find(k => rankCount[k] === 3);
    const kicks = Object.keys(rankCount).filter(k => rankCount[k] === 1).map(Number).sort((a, b) => b - a);
    cat = 3; tiebreakers = [three, ...kicks];
  } else if (counts[0] === 2 && counts[1] === 2) {
    const pairs = Object.keys(rankCount).filter(k => rankCount[k] === 2).map(Number).sort((a, b) => b - a);
    const kick = +Object.keys(rankCount).find(k => rankCount[k] === 1);
    cat = 2; tiebreakers = [...pairs, kick];
  } else if (counts[0] === 2) {
    const pair = +Object.keys(rankCount).find(k => rankCount[k] === 2);
    const kicks = Object.keys(rankCount).filter(k => rankCount[k] === 1).map(Number).sort((a, b) => b - a);
    cat = 1; tiebreakers = [pair, ...kicks];
  } else { cat = 0; tiebreakers = ranks; }

  return { cat, tiebreakers, value: cat * 1e10 + tiebreakers.reduce((a, v, i) => a + v * Math.pow(100, 5 - i), 0) };
}

function bestFive(cards) {
  let best = null;
  function combo(start, chosen) {
    if (chosen.length === 5) {
      const r = evalFive(chosen);
      if (!best || r.value > best.value) best = r;
      return;
    }
    for (let i = start; i < cards.length; i++) combo(i + 1, [...chosen, cards[i]]);
  }
  combo(0, []);
  return best;
}

function handRank(hole, community) {
  return bestFive([...hole, ...community]);
}

// ── Table state machine ──────────────────────────────────────────────────────

class PokerTable {
  constructor(tableId, options = {}) {
    this.id = tableId;
    this.smallBlind = options.smallBlind || 10;
    this.bigBlind = options.bigBlind || 20;
    this.startingChips = options.startingChips || 1000;
    this.maxPlayers = options.maxPlayers || 6;

    this.players = [];   // { id, name, chips, hole, bet, folded, allIn, seatIndex, connected }
    this.deck = [];
    this.community = [];
    this.pot = 0;
    this.currentBet = 0;
    this.phase = 'waiting'; // waiting | preflop | flop | turn | river | showdown
    this.dealerSeat = 0;
    this.actionSeat = 0;
    this.log = [];
    this.actionTimer = null;
    this.bettingRoundStarter = null; // seat that opened this betting round
  }

  // ── Seat management ────────────────────────────────────────────────────────

  addPlayer(id, name) {
    if (this.players.length >= this.maxPlayers) return { error: 'Table full' };
    if (this.players.find(p => p.id === id)) return { error: 'Already seated' };
    const seat = this.players.length;
    const player = {
      id, name, chips: this.startingChips,
      hole: [], bet: 0, folded: false, allIn: false,
      seatIndex: seat, connected: true,
    };
    this.players.push(player);
    this.emit('player_joined', { id, name, seat, chips: player.chips });
    if (this.players.length >= 2 && this.phase === 'waiting') {
      setTimeout(() => this.startHand(), 1500);
    }
    return { ok: true, seat };
  }

  removePlayer(id) {
    const idx = this.players.findIndex(p => p.id === id);
    if (idx === -1) return;
    const p = this.players[idx];
    p.connected = false;
    // If mid-hand, fold them
    if (this.phase !== 'waiting' && !p.folded) {
      p.folded = true;
      this.emit('player_action', { seat: p.seatIndex, action: 'fold', name: p.name });
      this.checkAdvance();
    }
  }

  // ── Hand lifecycle ─────────────────────────────────────────────────────────

  startHand() {
    if (this.players.filter(p => p.connected).length < 2) return;
    this.deck = shuffle(makeDeck());
    this.community = [];
    this.pot = 0;
    this.currentBet = 0;
    this.phase = 'preflop';
    this.log = [];

    this.players.forEach(p => {
      p.hole = [];
      p.bet = 0;
      p.folded = false;
      p.allIn = false;
      if (p.chips <= 0) p.chips = this.startingChips; // auto rebuy
    });

    // Advance dealer
    this.dealerSeat = (this.dealerSeat + 1) % this.players.length;

    // Deal hole cards
    for (let i = 0; i < 2; i++) this.players.forEach(p => p.hole.push(this.deck.pop()));

    // Blinds
    const sbSeat = (this.dealerSeat + 1) % this.players.length;
    const bbSeat = (this.dealerSeat + 2) % this.players.length;
    this._postBlind(sbSeat, this.smallBlind);
    this._postBlind(bbSeat, this.bigBlind);
    this.currentBet = this.bigBlind;
    this.actionSeat = (bbSeat + 1) % this.players.length;
    this.bettingRoundStarter = this.actionSeat;

    this._addLog(`Hand started. Dealer: seat ${this.dealerSeat}`);
    this.emit('hand_started', {
      dealerSeat: this.dealerSeat,
      pot: this.pot,
      phase: this.phase,
      players: this._publicPlayers(),
      // Send each player their private hole cards via separate event
    });

    // Emit private hole cards to each player
    this.players.forEach(p => {
      this.emitTo(p.id, 'your_cards', { hole: p.hole });
    });

    this._scheduleAction();
  }

  _postBlind(seat, amount) {
    const p = this.players[seat];
    const actual = Math.min(amount, p.chips);
    p.chips -= actual;
    p.bet += actual;
    this.pot += actual;
    this._addLog(`${p.name} posts $${actual}`);
  }

  // ── Action handling ────────────────────────────────────────────────────────

  handleAction(playerId, action, amount = 0) {
    const p = this.players.find(x => x.id === playerId);
    if (!p) return { error: 'Not at table' };
    if (this.players[this.actionSeat].id !== playerId) return { error: 'Not your turn' };
    if (p.folded || p.allIn) return { error: 'Cannot act' };

    clearTimeout(this.actionTimer);

    const toCall = this.currentBet - p.bet;

    switch (action) {
      case 'fold':
        p.folded = true;
        this._addLog(`${p.name} folds`);
        this.emit('player_action', { seat: p.seatIndex, action: 'fold', name: p.name, pot: this.pot });
        break;

      case 'check':
        if (toCall > 0) return { error: 'Cannot check, must call or fold' };
        this._addLog(`${p.name} checks`);
        this.emit('player_action', { seat: p.seatIndex, action: 'check', name: p.name, pot: this.pot });
        break;

      case 'call': {
        const actual = Math.min(toCall, p.chips);
        p.chips -= actual; p.bet += actual; this.pot += actual;
        if (p.chips === 0) p.allIn = true;
        this._addLog(`${p.name} calls $${actual}`);
        this.emit('player_action', { seat: p.seatIndex, action: 'call', amount: actual, name: p.name, pot: this.pot, players: this._publicPlayers() });
        break;
      }

      case 'raise': {
        if (amount <= toCall) return { error: 'Raise must be more than call amount' };
        const actual = Math.min(amount, p.chips);
        p.chips -= actual; p.bet += actual; this.pot += actual;
        this.currentBet = p.bet;
        if (p.chips === 0) p.allIn = true;
        this.bettingRoundStarter = this.actionSeat; // re-open action
        this._addLog(`${p.name} raises to $${p.bet}`);
        this.emit('player_action', { seat: p.seatIndex, action: 'raise', amount: actual, name: p.name, pot: this.pot, currentBet: this.currentBet, players: this._publicPlayers() });
        break;
      }

      default:
        return { error: 'Unknown action' };
    }

    this.checkAdvance();
    return { ok: true };
  }

  checkAdvance() {
    const inHand = this.players.filter(p => !p.folded);

    if (inHand.length === 1) {
      this._endHand();
      return;
    }

    // Check if betting round is complete
    const canAct = inHand.filter(p => !p.allIn);
    const allMatched = canAct.every(p => p.bet === this.currentBet);

    if (allMatched) {
      // Move action forward one seat first, check if we've gone around
      const nextSeat = (this.actionSeat + 1) % this.players.length;
      const nextP = this.players[nextSeat];

      // If next player already matched or is out, the round is done
      if (allMatched && canAct.length >= 1) {
        this._nextPhase();
        return;
      }
    }

    // Advance to next active player
    this.actionSeat = (this.actionSeat + 1) % this.players.length;
    const next = this.players[this.actionSeat];
    if (next.folded || next.allIn) {
      this.checkAdvance();
      return;
    }

    this._scheduleAction();
  }

  _nextPhase() {
    this.players.forEach(p => { p.bet = 0; });
    this.currentBet = 0;

    const phases = { preflop: 'flop', flop: 'turn', turn: 'river', river: 'showdown' };
    this.phase = phases[this.phase] || 'showdown';

    if (this.phase === 'showdown') {
      this._endHand();
      return;
    }

    const draws = { flop: 3, turn: 1, river: 1 };
    for (let i = 0; i < draws[this.phase]; i++) this.community.push(this.deck.pop());

    this._addLog(`--- ${this.phase.toUpperCase()} ---`);
    this.emit('phase_change', { phase: this.phase, community: this.community, pot: this.pot, players: this._publicPlayers() });

    // Find first active player after dealer
    this.actionSeat = (this.dealerSeat + 1) % this.players.length;
    while (this.players[this.actionSeat].folded || this.players[this.actionSeat].allIn) {
      this.actionSeat = (this.actionSeat + 1) % this.players.length;
    }

    this._scheduleAction();
  }

  _endHand() {
    clearTimeout(this.actionTimer);
    this.phase = 'showdown';

    // Collect remaining bets
    this.players.forEach(p => { this.pot += p.bet; p.bet = 0; });

    const inHand = this.players.filter(p => !p.folded);
    let winners, handName, reason;

    if (inHand.length === 1) {
      winners = inHand;
      reason = 'Everyone else folded';
      handName = '';
    } else {
      // Evaluate hands
      inHand.forEach(p => { p._rank = handRank(p.hole, this.community); });
      const best = inHand.reduce((a, b) => b._rank.value > a._rank.value ? b : a);
      winners = inHand.filter(p => p._rank.value === best._rank.value);
      handName = HAND_NAMES[best._rank.cat];
      reason = winners.length > 1 ? `Split pot — ${handName}` : `${handName}`;
    }

    const share = Math.floor(this.pot / winners.length);
    winners.forEach(p => p.chips += share);
    this.pot = 0;

    this._addLog(`Winner: ${winners.map(w => w.name).join(', ')} — ${reason}`);

    // Build showdown info (reveal all cards)
    const showdown = inHand.map(p => ({
      id: p.id,
      name: p.name,
      seat: p.seatIndex,
      hole: p.hole,
      handName: p._rank ? HAND_NAMES[p._rank.cat] : '',
      winner: winners.includes(p),
    }));

    this.emit('hand_over', {
      winners: winners.map(w => ({ id: w.id, name: w.name, seat: w.seatIndex, amount: share })),
      reason,
      pot: share * winners.length,
      showdown,
      players: this._publicPlayers(),
    });

    // Start next hand after delay
    if (this.players.filter(p => p.connected).length >= 2) {
      setTimeout(() => this.startHand(), 4000);
    } else {
      this.phase = 'waiting';
    }
  }

  // ── Auto-fold on timeout ───────────────────────────────────────────────────

  _scheduleAction() {
    const p = this.players[this.actionSeat];
    if (!p) return;

    this.emit('your_turn', {
      seat: this.actionSeat,
      playerId: p.id,
      toCall: this.currentBet - p.bet,
      currentBet: this.currentBet,
      pot: this.pot,
      timeoutMs: 30000,
    });

    // Auto-fold after 30s
    this.actionTimer = setTimeout(() => {
      this._addLog(`${p.name} auto-folded (timeout)`);
      this.handleAction(p.id, p.bet >= this.currentBet ? 'check' : 'fold');
    }, 30000);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  _publicPlayers() {
    return this.players.map(p => ({
      id: p.id,
      name: p.name,
      chips: p.chips,
      bet: p.bet,
      folded: p.folded,
      allIn: p.allIn,
      seatIndex: p.seatIndex,
      connected: p.connected,
      cardCount: p.hole.length, // don't reveal cards
    }));
  }

  _addLog(msg) {
    this.log.push(msg);
    if (this.log.length > 50) this.log.shift();
  }

  tableState(forPlayerId) {
    const me = this.players.find(p => p.id === forPlayerId);
    return {
      tableId: this.id,
      phase: this.phase,
      pot: this.pot,
      community: this.community,
      currentBet: this.currentBet,
      actionSeat: this.actionSeat,
      dealerSeat: this.dealerSeat,
      players: this._publicPlayers(),
      myHole: me ? me.hole : [],
      log: this.log.slice(-10),
    };
  }

  // Set by the server to allow the table to emit socket events
  setEmitter(emitFn, emitToFn) {
    this.emit = emitFn;
    this.emitTo = emitToFn;
  }
}

module.exports = { PokerTable, HAND_NAMES };
