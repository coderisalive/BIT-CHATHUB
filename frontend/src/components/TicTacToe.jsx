import React, { useEffect, useState } from 'react';

const TicTacToe = ({ gameId, socket, players, currentUserId }) => {
  const [game, setGame] = useState(null);

  useEffect(() => {
    if (!socket || !gameId) return;

    // Join the game room
    socket.emit('join_game', { gameId, playerId: currentUserId });

    const handleUpdate = (updatedGame) => {
      if (updatedGame.gameId === gameId) {
        setGame(updatedGame);
      }
    };

    socket.on('game_update', handleUpdate);

    return () => {
      socket.off('game_update', handleUpdate);
    };
  }, [socket, gameId, currentUserId]);

  const handleMove = (index) => {
    if (!game || game.status !== 'playing') return;
    if (game.currentTurn !== currentUserId) return;
    if (game.board[index] !== "") return;

    socket.emit('make_move', {
      gameId,
      playerId: currentUserId,
      position: index
    });
  };

  const handleJoin = () => {
    socket.emit('join_game', { gameId, playerId: currentUserId });
  };

  if (!game) return <div className="game-status">Loading Game...</div>;

  const isPlayer = game.players.includes(currentUserId);
  const myTurn = game.currentTurn === currentUserId;
  const opponentId = game.players.find(id => id !== currentUserId);
  
  let statusMsg = "";
  if (game.status === 'waiting') {
    statusMsg = isPlayer && game.players[0] === currentUserId 
      ? "Waiting for opponent..." 
      : "You've been invited to play!";
  } else if (game.status === 'playing') {
    statusMsg = myTurn ? "Your turn!" : "Opponent's turn...";
  } else if (game.status === 'finished') {
    if (game.winner === 'draw') {
      statusMsg = "It's a draw!";
    } else {
      statusMsg = game.winner === currentUserId ? "You won! 🎉" : "You lost. 💀";
    }
  }

  return (
    <div className="game-container">
      <div className="game-status">{statusMsg}</div>
      
      <div className="tictactoe-board">
        {game.board.map((cell, i) => (
          <button
            key={i}
            className={`tictactoe-cell ${cell.toLowerCase()}`}
            onClick={() => handleMove(i)}
            disabled={!myTurn || cell !== "" || game.status !== 'playing'}
          >
            {cell}
          </button>
        ))}
      </div>

      {game.status === 'waiting' && !isPlayer && (
        <div className="game-actions">
          <button className="game-btn accept" onClick={handleJoin}>Join Game</button>
        </div>
      )}

      {game.status === 'finished' && (
        <div className="game-actions">
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Game Over</span>
        </div>
      )}
    </div>
  );
};

export default TicTacToe;
