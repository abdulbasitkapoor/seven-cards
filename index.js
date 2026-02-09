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
            rooms[roomId].players.push({ id: socket.id, name: playerName, hand: [], announcedLast: false });
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

        room.deck = createDeck(room.players.length > 4 ? 2 : 1);
        room.players.forEach(p => p.hand = room.deck.splice(0, 7));
        
        const firstCard = room.deck.pop();
        room.discardPile.push(firstCard);
        room.currentSuit = firstCard.suit;
        room.currentRank = firstCard.rank;
        room.gameStarted = true;

        sendPrivateState(roomId);
    });

    // Handle "Last Card" announcement BEFORE playing
    socket.on('announce-last', (roomId) => {
        const room = rooms[roomId];
        const player = room.players.find(p => p.id === socket.id);
        if (player) {
            player.announcedLast = true;
            io.to(roomId).emit('system-msg', `${player.name} announced: LAST CARD!`);
        }
    });

    socket.on('play-card', ({ roomId, cardIndex, chosenSuit }) => {
        const room = rooms[roomId];
        const player = room.players[room.turn];
        if (socket.id !== player.id) return;

        const card = player.hand[cardIndex];
        
        // Validation
        const isAce = card.rank === 'A';
        if (!isAce && card.suit !== room.currentSuit && card.rank !== room.currentRank) {
            socket.emit('error-msg', "Illegal move!");
            return;
        }

        // Logic for "Last Card" penalty
        // If they have 2 cards and play one without announcing, they must draw 2
        if (player.hand.length === 2 && !player.announcedLast) {
            socket.emit('error-msg', "Forgot to announce Last Card! +2 Penalty.");
            for(let i=0; i<2; i++) {
                if (room.deck.length === 0) reshuffle(room);
                player.hand.push(room.deck.pop());
            }
        }

        // Play the card
        player.hand.splice(cardIndex, 1);
        room.discardPile.push(card);
        room.currentRank = card.rank;
        room.currentSuit = isAce ? chosenSuit : card.suit;

        // Reset announcement after turn
        player.announcedLast = false;

        // Apply Card Rules
        if (card.rank === '2') room.drawPenalty += 2;
        if (card.rank === 'J' && card.suit === '♠') room.drawPenalty += 7;
        
        let skip = (card.rank === '8') ? 2 : 1;

        // King Logic (Reverse)
        if (card.rank === 'K') {
            room.direction *= -1;
            // In 2 player game, King gives you another turn immediately
            if (room.players.length === 2) skip = 0; 
        }

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
            recentCards: room.discardPile.slice(-4),
            turnName: room.players[room.turn].name,
            isMyTurn: room.players[room.turn].id === p.id,
            penalty: room.drawPenalty,
            others: room.players.map(other => ({ 
                name: other.name, 
                count: other.hand.length,
                isLast: other.hand.length === 1 
            }))
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
    // Move all but the top card back to deck and shuffle
    room.deck = room.discardPile.sort(() => Math.random() - 0.5);
    room.discardPile = [top];
    console.log("Deck exhausted. Reshuffling...");
}

http.listen(process.env.PORT || 3000);
