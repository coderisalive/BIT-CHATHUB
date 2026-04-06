import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';

const NumberGuess = ({ gameId, socket, onGameEnd }) => {
  const { user } = useAuth();
  const [gameState, setGameState] = useState(null);
  const [guess, setGuess] = useState("");
  const [targetInput, setTargetInput] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!socket || !gameId) return;

    socket.emit('join_game', { gameId, playerId: user.firebaseUID });

    const handleUpdate = (updatedGame) => {
      console.log("[NumberGuess] Update received:", updatedGame);
      setGameState(updatedGame);
      setError("");
    };

    const handleError = (data) => {
      setError(data.error);
    };

    socket.on('game_update', handleUpdate);
    socket.on('game_error', handleError);

    return () => {
      socket.off('game_update', handleUpdate);
      socket.off('game_error', handleError);
    };
  }, [gameId, socket, user.firebaseUID]);

  const handleSetTarget = () => {
    const val = parseInt(targetInput);
    if (isNaN(val) || val < 1 || val > 100) {
      setError("Please pick a number between 1 and 100.");
      return;
    }
    socket.emit('set_target_number', { gameId, value: val, playerId: user.firebaseUID });
  };

  const handleGuess = () => {
    const val = parseInt(guess);
    if (isNaN(val) || val < 1 || val > 100) {
      setError("Please guess a number between 1 and 100.");
      return;
    }
    socket.emit('make_guess', { gameId, value: val, playerId: user.firebaseUID });
    setGuess("");
  };

  if (!gameState) return <div className="game-loading">Loading Game...</div>;

  const isPicker = gameState.players[0] === user.firebaseUID;
  const isGuesser = gameState.players[1] === user.firebaseUID;
  const isGameOver = gameState.status === 'finished';

  return (
    <div className="number-guess-container">
      <div className="game-header">
        <h3>🔢 Number Guess</h3>
        <div className="attempts-badge">
          {gameState.attempts} / {gameState.maxAttempts} Attempts
        </div>
      </div>

      {gameState.status === 'waiting' && isPicker && (
        <div className="picking-view">
          <p>Pick a secret number (1-100)</p>
          <div className="game-input-group">
            <input 
              type="number" 
              value={targetInput} 
              onChange={(e) => setTargetInput(e.target.value)}
              placeholder="e.g. 42"
              min="1" max="100"
            />
            <button onClick={handleSetTarget} className="game-btn-primary">Set Number</button>
          </div>
        </div>
      )}

      {gameState.status === 'waiting' && !isPicker && (
        <div className="waiting-view">
          <div className="game-spinner"></div>
          <p>Waiting for opponent to pick a number...</p>
        </div>
      )}

      {gameState.status === 'playing' && (
        <div className="playing-view">
          {isGuesser ? (
            <div className="guesser-controls">
              <p>Make your guess! (1-100)</p>
              <div className="game-input-group">
                <input 
                  type="number" 
                  value={guess} 
                  onChange={(e) => setGuess(e.target.value)}
                  placeholder="?"
                  autoFocus
                  onKeyPress={(e) => e.key === 'Enter' && handleGuess()}
                />
                <button onClick={handleGuess} className="game-btn-primary">Guess</button>
              </div>
            </div>
          ) : (
            <div className="picker-watching">
              <p>Your secret number: <strong>{gameState.targetNumber}</strong></p>
              <p>Waiting for guesses...</p>
            </div>
          )}

          <div className="guess-history">
            {gameState.guesses.slice().reverse().map((g, i) => (
              <div key={i} className={`guess-item ${g.result}`}>
                <span className="guess-val">{g.value}</span>
                <span className="guess-result">
                  {g.result === 'high' ? 'Too High ⬆️' : g.result === 'low' ? 'Too Low ⬇️' : 'CORRECT 🎉'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {isGameOver && (
        <div className={`game-over-view ${gameState.winner === user.firebaseUID ? 'winner' : 'loser'}`}>
          <h2>{gameState.winner === 'system' ? 'Game Over!' : (gameState.winner === user.firebaseUID ? 'YOU WON! 🎉' : 'OPPONENT WON! 🏆')}</h2>
          <p>The secret number was: <strong>{gameState.targetNumber}</strong></p>
          <button onClick={onGameEnd} className="game-btn-secondary">Close Game</button>
        </div>
      )}

      {error && <p className="game-error-msg">{error}</p>}

    </div>
  );
};

export default NumberGuess;
