socket.on('play-card', ({ roomId, cardIndex, chosenSuit }) => {
        const room = rooms[roomId];
        const player = room.players[room.turn];
        if (socket.id !== player.id) return; 

        const card = player.hand[cardIndex];

        // --- THE FIX: VALIDATION ---
        const isAce = card.rank === 'A';
        const matchesSuit = card.suit === room.currentSuit;
        const matchesRank = card.rank === room.currentRank;

        if (!isAce && !matchesSuit && !matchesRank) {
            // Tell the player it's an illegal move
            socket.emit('error-msg', "Illegal move! Match the suit or the rank.");
            return; 
        }
        // ---------------------------

        player.hand.splice(cardIndex, 1);
        room.discardPile.push(card);
        room.currentRank = card.rank;
        room.currentSuit = isAce ? chosenSuit : card.suit;

        if (card.rank === '2') room.drawPenalty += 2;
        if (card.rank === 'J' && card.suit === '♠') room.drawPenalty += 7;
        if (card.rank === 'K') room.direction *= -1;
        let skip = (card.rank === '8') ? 2 : 1;

        room.turn = (room.turn + (skip * room.direction) + room.players.length) % room.players.length;
        sendPrivateState(roomId);
    });
