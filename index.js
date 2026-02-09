const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);

app.use(express.static('public'));

let rooms = {};

io.on('connection', (socket) => {
    socket.on('join-room', ({ roomId, playerName, maxPlayers }) => {
        socket.join(roomId);
        if (!rooms[roomId]) {
            rooms[roomId] = { 
                id: roomId, players: [], deck: [], discardPile: [], 
                turn: 0, direction: 1, drawPenalty: 0, 
                currentSuit: '', currentRank: '', gameStarted: false,
                maxPlayers: parseInt(maxPlayers) || 2
            };
        }
        
        if (rooms[roomId].players.length < rooms[roomId].maxPlayers && !rooms[roomId].gameStarted) {
            rooms[roomId].players.push({ id: socket.id, name: playerName, hand: [] });
        }

        io.to(roomId).emit('update-lobby', {
            players: rooms[roomId].players.map(p => p.name),
            ready: rooms[roomId].players.length >= rooms[roomId].maxPlayers,
            max: rooms[roomId].maxPlayers
        });
    });

    socket.on('start-game', (roomId) => {
        const room = rooms[roomId];
        if (!room || room.players.length < room.maxPlayers) return;

        room.deck = createDeck(room.players.length > 6 ? 2 : 1);
        room.players.forEach(p => p.hand = room.deck.splice(0, 7));
        
        const firstCard = room.deck.pop();
        room.discardPile.push(firstCard);
        room.currentSuit = firstCard.suit;
        room.currentRank = firstCard.rank;
        room.gameStarted = true;

        sendPrivateState(roomId);
    });

    socket.on('play-card', ({ roomId, cardIndex, chosenSuit }) => {
        const room = rooms[roomId];
        const player = room.players[room.turn];
        if (socket.id !== player.id) return;

        const card = player.hand[cardIndex];
        
        // --- VALIDATION RULE ---
        const isAce = card.rank === 'A';
        const matchesSuit = card.suit === room.currentSuit;
        const matchesRank = card.rank === room.currentRank;

        if (!isAce && !matchesSuit && !matchesRank) {
            socket.emit('error-msg', "Illegal move! You must match the Suit or Rank.");
            return;
        }

        player.hand.splice(cardIndex, 1);
        room.discardPile.push(card);
        room.currentRank = card.rank;
        room.currentSuit = isAce ? chosenSuit : card.suit;

        // --- SPECIAL CARD EFFECTS ---
        if (card.rank === '2') room.drawPenalty += 2;
        if (card.rank === 'J' && card.suit === '♠') room.drawPenalty += 7;
        if (card.rank === 'K') room.direction *= -1;
        let skip = (card.rank === '8') ? 2 : 1;

        if (player.hand.length === 0) {
            io.to(roomId).emit('winner', player.name);
            delete rooms[roomId];
            return;
        }

        room.turn = (room.turn + (skip * room.direction) + room.players.length) % room.players.length;
        sendPrivateState(roomId);
    });

    socket.on('draw-card', (roomId) => {
        const room = rooms[roomId];
        const player = room.players[room.turn];
        if (socket.id !== player.id) return;

        const count = room.drawPenalty > 0 ? room.drawPenalty : 1;
        for(let i=0; i<count; i++) {
            if (room.deck.length === 0) reshuffle(room);
            player.hand.push(room.deck.pop());
        }
        room.drawPenalty = 0;
        room.turn = (room.turn + room.direction + room.players.length) % room.players.length;
        sendPrivateState(roomId);
    });
});

function sendPrivateState(roomId) {
    const room = rooms[roomId];
    room.players.forEach((p) => {
        io.to(p.id).emit('game-state', {
            hand: p.hand,
            recentCards: room.discardPile.slice(-4), // Only send the last 4 cards
            turnName: room.players[room.turn].name,
            isMyTurn: room.players[room.turn].id === p.id,
            penalty: room.drawPenalty,
            others: room.players.map(other => ({ name: other.name, count: other.hand.length }))
        });
    });
}

function createDeck(c) {
    const s=['♥','♦','♣','♠'], r=['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
    let d=[]; for(let i=0;i<c;i++) s.forEach(x=>r.forEach(y=>d.push({suit:x,rank:y})));
    return d.sort(()=>Math.random()-0.5);
}

function reshuffle(room) {
    const top = room.discardPile.pop();
    room.deck = room.discardPile.sort(() => Math.random() - 0.5);
    room.discardPile = [top];
}

http.listen(process.env.PORT || 3000);
