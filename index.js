const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static('public'));

let rooms = {};

io.on('connection', (socket) => {
    socket.on('join-room', ({ roomId, playerName }) => {
        socket.join(roomId);
        if (!rooms[roomId]) {
            rooms[roomId] = { id: roomId, players: [], deck: [], discardPile: [], turn: 0, direction: 1, drawPenalty: 0, currentSuit: '', currentRank: '' };
        }
        rooms[roomId].players.push({ id: socket.id, name: playerName, hand: [] });
        io.to(roomId).emit('update-lobby', rooms[roomId].players);
    });

    socket.on('start-game', (roomId) => {
        const room = rooms[roomId];
        const deckCount = room.players.length > 6 ? 2 : 1;
        room.deck = createDeck(deckCount);
        room.players.forEach(p => p.hand = room.deck.splice(0, 7));
        const first = room.deck.pop();
        room.discardPile.push(first);
        room.currentSuit = first.suit; room.currentRank = first.rank;
        io.to(roomId).emit('game-state', room);
    });

    socket.on('play-card', ({ roomId, cardIndex, chosenSuit }) => {
        const room = rooms[roomId];
        const player = room.players[room.turn];
        const card = player.hand[cardIndex];
        player.hand.splice(cardIndex, 1);
        room.discardPile.push(card);
        room.currentRank = card.rank;
        room.currentSuit = (card.rank === 'A') ? chosenSuit : card.suit;
        if (card.rank === '2') room.drawPenalty += 2;
        if (card.rank === 'J' && card.suit === '♠') room.drawPenalty += 7;
        if (card.rank === 'K') room.direction *= -1;
        let skip = (card.rank === '8') ? 2 : 1;
        room.turn = (room.turn + (skip * room.direction) + room.players.length) % room.players.length;
        io.to(roomId).emit('game-state', room);
    });

    socket.on('draw-card', (roomId) => {
        const room = rooms[roomId];
        const player = room.players[room.turn];
        const count = room.drawPenalty > 0 ? room.drawPenalty : 1;
        for(let i=0; i<count; i++) {
            if (room.deck.length === 0) {
                const top = room.discardPile.pop();
                room.deck = room.discardPile.sort(() => Math.random() - 0.5);
                room.discardPile = [top];
            }
            player.hand.push(room.deck.pop());
        }
        room.drawPenalty = 0;
        room.turn = (room.turn + room.direction + room.players.length) % room.players.length;
        io.to(roomId).emit('game-state', room);
    });
});

function createDeck(c) {
    const s=['♥','♦','♣','♠'], r=['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
    let d=[]; for(let i=0;i<c;i++) s.forEach(x=>r.forEach(y=>d.push({suit:x,rank:y})));
    return d.sort(()=>Math.random()-0.5);
}

http.listen(process.env.PORT || 3000);
